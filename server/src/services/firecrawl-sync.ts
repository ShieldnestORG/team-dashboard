// ---------------------------------------------------------------------------
// Firecrawl Sync — Echo's weekly refresh of intel company websites.
//
// Intel crons pull metadata (CoinGecko prices, GitHub stats, Twitter feeds)
// but the actual website markdown of each tracked company is only scraped
// on-demand via Firecrawl. This service picks the most-engaged intel
// companies (ranked by recent intel_report count) and re-scrapes their
// homepages, upserting the markdown into `intel_reports` with a BGE-M3
// embedding so the vector knowledge base reflects current site content.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";

const DEFAULT_LIMIT = 50;
const CONCURRENCY = 3;
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Firecrawl scrape (single URL → markdown)
// ---------------------------------------------------------------------------

async function firecrawlScrape(url: string): Promise<string | null> {
  try {
    const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer self-hosted",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        timeout: REQUEST_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS + 5_000),
    });

    if (!res.ok) {
      logger.warn({ url, status: res.status }, "Firecrawl sync scrape failed (non-ok)");
      return null;
    }

    const data = (await res.json()) as {
      success: boolean;
      data?: { markdown?: string };
    };

    if (!data.success || !data.data?.markdown) return null;

    return data.data.markdown.slice(0, 50_000);
  } catch (err) {
    logger.warn({ err, url }, "Firecrawl sync scrape threw");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pick top N intel companies by recent intel_report activity.
//
// intel_companies has no signal_score column, so we rank by the number of
// intel_reports captured in the last 30 days — a proxy for engagement.
// Companies with zero reports fall back to creation order.
// ---------------------------------------------------------------------------

interface TopCompanyRow {
  slug: string;
  name: string;
  website: string | null;
}

async function pickTopCompanies(db: Db, limit: number): Promise<TopCompanyRow[]> {
  const rows = await db.execute<{ slug: string; name: string; website: string | null }>(sql`
    SELECT c.slug, c.name, c.website
    FROM intel_companies c
    LEFT JOIN (
      SELECT company_slug, COUNT(*) AS report_count
      FROM intel_reports
      WHERE captured_at > now() - interval '30 days'
      GROUP BY company_slug
    ) r ON r.company_slug = c.slug
    WHERE c.website IS NOT NULL AND c.website <> ''
    ORDER BY COALESCE(r.report_count, 0) DESC, c.created_at DESC
    LIMIT ${limit}
  `);

  const list = Array.isArray(rows) ? rows : (rows as unknown as { rows: TopCompanyRow[] }).rows ?? [];
  return list as TopCompanyRow[];
}

// ---------------------------------------------------------------------------
// Process one company: scrape → embed → upsert intel_report
// ---------------------------------------------------------------------------

async function syncOneCompany(
  db: Db,
  company: TopCompanyRow,
): Promise<boolean> {
  if (!company.website) return false;

  const markdown = await firecrawlScrape(company.website);
  if (!markdown) return false;

  const headline = `${company.name} — weekly site refresh`;
  const body = markdown.slice(0, 8_000);
  const textForEmbedding = `${company.name} ${markdown}`.slice(0, 2_000);

  let embedding: number[] | null = null;
  try {
    embedding = await getEmbedding(textForEmbedding);
  } catch (err) {
    logger.warn({ err, slug: company.slug }, "Firecrawl sync: embedding failed, storing report without vector");
  }

  try {
    if (embedding && embedding.length > 0) {
      const embeddingStr = `[${embedding.join(",")}]`;
      await db.execute(sql`
        INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
        VALUES (
          ${company.slug},
          ${"firecrawl-sync"},
          ${headline},
          ${body},
          ${company.website},
          ${embeddingStr}::vector
        )
      `);
    } else {
      await db.execute(sql`
        INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url)
        VALUES (
          ${company.slug},
          ${"firecrawl-sync"},
          ${headline},
          ${body},
          ${company.website}
        )
      `);
    }
    return true;
  } catch (err) {
    logger.warn({ err, slug: company.slug }, "Firecrawl sync: insert failed");
    return false;
  }
}

// ---------------------------------------------------------------------------
// Polite concurrency runner (cap = 3)
// ---------------------------------------------------------------------------

async function runWithConcurrency<T, R>(
  items: T[],
  cap: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;

  const workers = Array.from({ length: Math.min(cap, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const r = await worker(item);
        results.push(r);
      } catch (err) {
        logger.warn({ err }, "Firecrawl sync worker threw");
      }
    }
  });

  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface FirecrawlSyncResult {
  processed: number;
  succeeded: number;
  failed: number;
}

export async function syncTopIntelCompanies(
  db: Db,
  opts?: { limit?: number },
): Promise<FirecrawlSyncResult> {
  const limit = opts?.limit ?? DEFAULT_LIMIT;
  logger.info({ limit }, "Firecrawl sync: starting");

  const companies = await pickTopCompanies(db, limit);
  if (companies.length === 0) {
    logger.info("Firecrawl sync: no intel companies with websites found");
    return { processed: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  await runWithConcurrency(companies, CONCURRENCY, async (company) => {
    const ok = await syncOneCompany(db, company);
    if (ok) {
      succeeded++;
      logger.info({ slug: company.slug }, "Firecrawl sync: ok");
    } else {
      failed++;
      logger.info({ slug: company.slug }, "Firecrawl sync: failed");
    }
  });

  const result: FirecrawlSyncResult = {
    processed: companies.length,
    succeeded,
    failed,
  };

  logger.info(result, "Firecrawl sync: complete");
  return result;
}
