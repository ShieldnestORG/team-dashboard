import { sql } from "drizzle-orm";
import { eq, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intelCompanies, intelReports } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { isDuplicate, scoreContent, shouldIngest } from "./intel-quality.js";
import { INTEL_COMPANIES } from "../data/intel-companies.js";
import { AI_COMPANIES } from "../data/intel-companies-ai.js";
import { DEFI_COMPANIES } from "../data/intel-companies-defi.js";
import { DEVTOOLS_COMPANIES } from "../data/intel-companies-devtools.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Merge all directory seed data, deduplicating by slug (first occurrence wins)
// ---------------------------------------------------------------------------

const ALL_COMPANIES = (() => {
  const seen = new Set<string>();
  const merged: Array<typeof INTEL_COMPANIES[number] & { directory: string }> = [];

  for (const c of INTEL_COMPANIES) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug);
      merged.push({ ...c, directory: c.directory ?? "crypto" });
    }
  }
  for (const c of AI_COMPANIES) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug);
      merged.push({ ...c, directory: c.directory ?? "ai-ml" });
    }
  }
  for (const c of DEFI_COMPANIES) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug);
      merged.push({ ...c, directory: c.directory ?? "defi" });
    }
  }
  for (const c of DEVTOOLS_COMPANIES) {
    if (!seen.has(c.slug)) {
      seen.add(c.slug);
      merged.push({ ...c, directory: c.directory ?? "devtools" });
    }
  }

  return merged;
})();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IngestResult {
  success: boolean;
  processed: number;
  skipped: number;
  errors: string[];
  offset: number;
  limit: number;
  total: number;
  next_offset: number;
}

interface CoinGeckoMarket {
  id: string;
  name: string;
  symbol: string;
  current_price: number;
  market_cap: number;
  price_change_percentage_24h: number;
  total_volume: number;
}

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
}

interface GitHubRelease {
  tag_name: string;
  name: string;
  body: string | null;
  published_at: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

interface GitHubCommit {
  sha: string;
  commit: { message: string; author: { date: string } };
  html_url: string;
}

interface RedditPost {
  id: string;
  title: string;
  selftext: string;
  url: string;
  permalink: string;
  score: number;
  num_comments: number;
  created_utc: number;
  is_self: boolean;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const NITTER_INSTANCES = [
  "https://nitter.privacydev.net",
  "https://nitter.poast.org",
  "https://nitter.1d4.us",
  "https://nitter.tiekoetter.com",
  "https://nitter.nl",
];

const GITHUB_API = "https://api.github.com";

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemBlocks =
    xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ||
    xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ||
    [];

  for (const block of itemBlocks) {
    const title = (
      block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1] ?? ""
    ).trim();
    const link = (
      block.match(/<link[^>]*>([^<]+)<\/link>/i)?.[1] ??
      block.match(/<link[^>]+href="([^"]+)"/i)?.[1] ??
      ""
    ).trim();
    const pubDate = (
      block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ??
      block.match(/<published[^>]*>([\s\S]*?)<\/published>/i)?.[1] ??
      ""
    ).trim();
    const desc = (
      block.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1] ??
      block.match(/<content[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content>/i)?.[1] ??
      ""
    ).trim();

    const cleanDesc = desc
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 500);

    if (title && link) {
      items.push({ title, link, pubDate, description: cleanDesc });
    }
  }
  return items;
}

function githubHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "CoherenceDaddy/1.0",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function intelService(db: Db) {
  // Helper: run raw SQL via db.execute (Drizzle's raw SQL escape hatch)
  // For postgres-js driver, db.execute returns RowList which is array-like
  async function rawQuery<T = Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> {
    const result = await db.execute(query);
    return result as unknown as T[];
  }

  // ------ Companies ------

  async function listCompanies(directory?: string, limit = 100, offset = 0) {
    const qLimit = Math.min(Math.max(1, limit), 500);
    const qOffset = Math.max(0, offset);

    // LEFT JOIN the latest active directory_listing so callers can surface
    // the `featured` flag + tier on directory.coherencedaddy.com. Back-compat:
    // extra fields are additive; existing consumers ignore them.
    const rows = directory
      ? await rawQuery<Record<string, unknown>>(sql`
          SELECT c.*,
            (l.id IS NOT NULL) AS featured,
            l.tier AS listing_tier
          FROM intel_companies c
          LEFT JOIN LATERAL (
            SELECT id, tier FROM directory_listings
            WHERE company_id = c.id AND status IN ('active','past_due')
            ORDER BY started_at DESC NULLS LAST, created_at DESC
            LIMIT 1
          ) l ON true
          WHERE c.directory = ${directory}
          ORDER BY featured DESC, c.name ASC
          LIMIT ${qLimit} OFFSET ${qOffset}
        `)
      : await rawQuery<Record<string, unknown>>(sql`
          SELECT c.*,
            (l.id IS NOT NULL) AS featured,
            l.tier AS listing_tier
          FROM intel_companies c
          LEFT JOIN LATERAL (
            SELECT id, tier FROM directory_listings
            WHERE company_id = c.id AND status IN ('active','past_due')
            ORDER BY started_at DESC NULLS LAST, created_at DESC
            LIMIT 1
          ) l ON true
          ORDER BY featured DESC, c.name ASC
          LIMIT ${qLimit} OFFSET ${qOffset}
        `);

    const countCondition = directory
      ? sql`SELECT COUNT(*) AS total FROM intel_companies WHERE directory = ${directory}`
      : sql`SELECT COUNT(*) AS total FROM intel_companies`;
    const [{ total }] = await rawQuery<{ total: string }>(countCondition);

    return { items: rows, total: Number(total), limit: qLimit, offset: qOffset };
  }

  async function getCompany(slug: string) {
    const companies = await db
      .select()
      .from(intelCompanies)
      .where(eq(intelCompanies.slug, slug));

    if (companies.length === 0) return null;

    const company = companies[0];
    const reportTypes = ["news", "price", "twitter", "github", "reddit"];
    const latestReports: Record<string, unknown>[] = [];

    for (const reportType of reportTypes) {
      const rows = await rawQuery(sql`
        SELECT id, company_slug, report_type, headline, body, source_url, captured_at
        FROM intel_reports
        WHERE company_slug = ${slug}
          AND report_type = ${reportType}
        ORDER BY captured_at DESC
        LIMIT 5
      `);
      latestReports.push(...rows);
    }

    const countRows = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_reports WHERE company_slug = ${slug}`,
    );
    const reportCount = Number(countRows[0]?.total ?? 0);

    return { company, latest_reports: latestReports, report_count: reportCount };
  }

  async function seedCompanies() {
    let seeded = 0;
    for (const company of ALL_COMPANIES) {
      await db.execute(sql`
        INSERT INTO intel_companies (slug, name, category, directory, description, website, coingecko_id, github_org, subreddit, twitter_handle, rss_feeds)
        VALUES (
          ${company.slug},
          ${company.name},
          ${company.category},
          ${company.directory},
          ${company.description},
          ${company.website},
          ${company.coingecko_id},
          ${company.github_org},
          ${company.subreddit},
          ${company.twitter_handle ?? null},
          ${JSON.stringify(company.rss_feeds ?? [])}::jsonb
        )
        ON CONFLICT (slug) DO UPDATE SET
          name = EXCLUDED.name,
          category = EXCLUDED.category,
          directory = EXCLUDED.directory,
          description = EXCLUDED.description,
          website = EXCLUDED.website,
          coingecko_id = EXCLUDED.coingecko_id,
          github_org = EXCLUDED.github_org,
          subreddit = EXCLUDED.subreddit,
          twitter_handle = EXCLUDED.twitter_handle,
          rss_feeds = EXCLUDED.rss_feeds
      `);
      seeded++;
    }

    // Fire backfill in background for newly added companies
    backfillNewCompanies().catch((err) =>
      logger.error({ err }, "Post-seed backfill failed"),
    );

    return { success: true, message: `Seeded ${seeded} companies across ${new Set(ALL_COMPANIES.map(c => c.directory)).size} directories`, count: seeded };
  }

  // ------ Search ------

  async function search(query: string, limit: number, company?: string) {
    const queryEmbedding = await getEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const companyFilter = company
      ? sql`AND r.company_slug = ${company}`
      : sql``;

    const results = await rawQuery(sql`
      SELECT
        r.company_slug,
        c.name AS company_name,
        r.report_type,
        r.headline,
        r.body,
        r.source_url,
        r.captured_at,
        1 - (r.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM intel_reports r
      JOIN intel_companies c ON c.slug = r.company_slug
      WHERE r.embedding IS NOT NULL
        ${companyFilter}
      ORDER BY r.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `);

    return {
      results: results.map((r: Record<string, unknown>) => ({
        company_slug: r.company_slug,
        company_name: r.company_name,
        report_type: r.report_type,
        headline: r.headline,
        body: r.body,
        source_url: r.source_url,
        captured_at: r.captured_at,
        similarity: Math.round(Number(r.similarity) * 100) / 100,
      })),
      query,
    };
  }

  // ------ Stats ------

  async function stats() {
    const [
      totals, byType, topCompanies, recentActivity, coverage, lastIngested,
      timeWindows, storageEstimate, freshnessRows, ingestionHealth, directoryStats,
    ] = await Promise.all([
        rawQuery<{ total: string }>(sql`SELECT COUNT(*) AS total FROM intel_reports`),
        rawQuery<{ report_type: string; count: string }>(sql`
          SELECT report_type, COUNT(*) AS count
          FROM intel_reports GROUP BY report_type ORDER BY count DESC
        `),
        rawQuery<{ company_slug: string; name: string; count: string }>(sql`
          SELECT r.company_slug, c.name, COUNT(*) AS count
          FROM intel_reports r JOIN intel_companies c ON c.slug = r.company_slug
          GROUP BY r.company_slug, c.name ORDER BY count DESC LIMIT 10
        `),
        rawQuery<{ last_24h: string }>(sql`
          SELECT COUNT(*) AS last_24h FROM intel_reports
          WHERE captured_at > NOW() - INTERVAL '24 hours'
        `),
        rawQuery(sql`
          SELECT
            (SELECT COUNT(*) FROM intel_companies) AS total_companies,
            (SELECT COUNT(DISTINCT company_slug) FROM intel_reports) AS companies_with_data,
            (SELECT COUNT(*) FROM intel_companies WHERE twitter_handle IS NOT NULL) AS with_twitter,
            (SELECT COUNT(*) FROM intel_companies WHERE github_org IS NOT NULL) AS with_github,
            (SELECT COUNT(*) FROM intel_companies WHERE subreddit IS NOT NULL) AS with_reddit,
            (SELECT COUNT(*) FROM intel_companies WHERE rss_feeds != '[]') AS with_rss,
            (SELECT COUNT(*) FROM intel_companies WHERE coingecko_id IS NOT NULL) AS with_coingecko
        `),
        rawQuery<{ report_type: string; last_at: string }>(sql`
          SELECT report_type, MAX(captured_at) AS last_at
          FROM intel_reports GROUP BY report_type
        `),
        // Reports by time window
        rawQuery<{ last_hour: string; last_24h: string; last_7d: string; last_30d: string }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE captured_at > NOW() - INTERVAL '1 hour') AS last_hour,
            COUNT(*) FILTER (WHERE captured_at > NOW() - INTERVAL '24 hours') AS last_24h,
            COUNT(*) FILTER (WHERE captured_at > NOW() - INTERVAL '7 days') AS last_7d,
            COUNT(*) FILTER (WHERE captured_at > NOW() - INTERVAL '30 days') AS last_30d
          FROM intel_reports
        `),
        // Storage estimate (approximate total characters in body + headline)
        rawQuery<{ total_chars: string }>(sql`
          SELECT COALESCE(SUM(LENGTH(body) + LENGTH(headline)), 0) AS total_chars
          FROM intel_reports
        `),
        // Freshness: companies with at least 1 report in last 7 days
        rawQuery<{ total_companies: string; fresh_companies: string }>(sql`
          SELECT
            (SELECT COUNT(*) FROM intel_companies) AS total_companies,
            COUNT(DISTINCT r.company_slug) AS fresh_companies
          FROM intel_reports r
          WHERE r.captured_at > NOW() - INTERVAL '7 days'
        `),
        // Ingestion health: per report_type, last_ingested + count in last 24h
        rawQuery<{ report_type: string; last_ingested: string; count_last_24h: string }>(sql`
          SELECT
            report_type,
            MAX(captured_at) AS last_ingested,
            COUNT(*) FILTER (WHERE captured_at > NOW() - INTERVAL '24 hours') AS count_last_24h
          FROM intel_reports
          GROUP BY report_type
        `),
        // Per-directory breakdown
        rawQuery<{ directory: string; companies: string; reports: string; fresh: string }>(sql`
          SELECT
            c.directory,
            COUNT(DISTINCT c.slug) AS companies,
            COUNT(r.id) AS reports,
            COUNT(DISTINCT CASE WHEN r.captured_at > NOW() - INTERVAL '7 days' THEN c.slug END) AS fresh
          FROM intel_companies c
          LEFT JOIN intel_reports r ON r.company_slug = c.slug
          GROUP BY c.directory
          ORDER BY companies DESC
        `),
      ]);

    const cov = coverage[0] as Record<string, string> | undefined;
    const tw = timeWindows[0] as Record<string, string> | undefined;
    const totalCompanies = Number(freshnessRows[0]?.total_companies ?? 0);
    const freshCompanies = Number(freshnessRows[0]?.fresh_companies ?? 0);

    return {
      total_reports: Number(totals[0]?.total ?? 0),
      reports_last_24h: Number(recentActivity[0]?.last_24h ?? 0),
      by_type: Object.fromEntries(byType.map((r) => [r.report_type, Number(r.count)])),
      last_ingested: Object.fromEntries(lastIngested.map((r) => [r.report_type, r.last_at])),
      top_companies: topCompanies.map((r) => ({
        slug: r.company_slug,
        name: r.name,
        count: Number(r.count),
      })),
      coverage: {
        total_companies: Number(cov?.total_companies ?? 0),
        companies_with_data: Number(cov?.companies_with_data ?? 0),
        sources: {
          twitter: Number(cov?.with_twitter ?? 0),
          github: Number(cov?.with_github ?? 0),
          reddit: Number(cov?.with_reddit ?? 0),
          rss: Number(cov?.with_rss ?? 0),
          coingecko: Number(cov?.with_coingecko ?? 0),
        },
      },
      reports_by_window: {
        last_hour: Number(tw?.last_hour ?? 0),
        last_24h: Number(tw?.last_24h ?? 0),
        last_7d: Number(tw?.last_7d ?? 0),
        last_30d: Number(tw?.last_30d ?? 0),
      },
      storage_estimate: {
        total_characters: Number(storageEstimate[0]?.total_chars ?? 0),
        approx_mb: Math.round((Number(storageEstimate[0]?.total_chars ?? 0) / 1_048_576) * 100) / 100,
      },
      freshness: {
        companies_with_recent_data: freshCompanies,
        total_companies: totalCompanies,
        freshness_pct: totalCompanies > 0
          ? Math.round((freshCompanies / totalCompanies) * 10000) / 100
          : 0,
      },
      ingestion_health: Object.fromEntries(
        ingestionHealth.map((r) => [r.report_type, {
          last_ingested: r.last_ingested,
          count_last_24h: Number(r.count_last_24h),
        }]),
      ),
      directories: Object.fromEntries(
        directoryStats.map((d) => [d.directory, {
          companies: Number(d.companies),
          reports: Number(d.reports),
          fresh_companies: Number(d.fresh),
        }]),
      ),
      generated_at: new Date().toISOString(),
    };
  }

  // ------ Price Ingest ------

  async function ingestPrices(limit = 90, offset = 0): Promise<IngestResult> {
    const errors: string[] = [];
    let processed = 0;

    const companies = await rawQuery<{ slug: string; name: string; coingecko_id: string }>(sql`
      SELECT slug, name, coingecko_id FROM intel_companies
      WHERE coingecko_id IS NOT NULL ORDER BY slug LIMIT ${limit} OFFSET ${offset}
    `);

    const ids = companies.map((c) => c.coingecko_id);
    const marketData = await fetchCoinGeckoMarkets(ids);

    for (const company of companies) {
      try {
        const coin = marketData.get(company.coingecko_id);
        if (!coin) {
          errors.push(`${company.slug}: not found in CoinGecko response`);
          continue;
        }

        const priceBody = JSON.stringify({
          price_usd: coin.current_price,
          market_cap_usd: coin.market_cap,
          price_change_24h_pct: coin.price_change_percentage_24h,
          volume_24h_usd: coin.total_volume,
          symbol: coin.symbol,
          captured_at: new Date().toISOString(),
        });

        const headline = `Price snapshot: ${company.name} — $${coin.current_price} (${coin.price_change_percentage_24h?.toFixed(2)}% 24h)`;
        const embedding = await getEmbedding(`${headline} ${priceBody}`);
        const embeddingStr = `[${embedding.join(",")}]`;

        await db.execute(sql`
          INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
          VALUES (
            ${company.slug},
            'price',
            ${headline},
            ${priceBody},
            ${null},
            ${embeddingStr}::vector
          )
        `);

        processed++;
      } catch (err) {
        errors.push(`${company.slug}: ${String(err)}`);
      }
    }

    const [{ total }] = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_companies WHERE coingecko_id IS NOT NULL`,
    );

    return {
      success: true, processed, skipped: 0, errors,
      offset, limit, total: Number(total), next_offset: offset + limit,
    };
  }

  // ------ News Ingest ------

  async function ingestNews(limit = 30, offset = 0): Promise<IngestResult> {
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    const companies = await rawQuery<{ slug: string; name: string; rss_feeds: string }>(sql`
      SELECT slug, name, rss_feeds FROM intel_companies
      WHERE rss_feeds != '[]' ORDER BY slug LIMIT ${limit} OFFSET ${offset}
    `);

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

    for (const company of companies) {
      const feeds: string[] = typeof company.rss_feeds === "string"
        ? JSON.parse(company.rss_feeds)
        : (company.rss_feeds as unknown as string[]);

      for (const feedUrl of feeds) {
        try {
          const res = await fetch(feedUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; CoherenceDaddy/1.0)" },
            signal: AbortSignal.timeout(8000),
          });
          if (!res.ok) {
            errors.push(`${company.slug} feed ${feedUrl}: HTTP ${res.status}`);
            continue;
          }

          const xml = await res.text();
          const items = parseRSSItems(xml);

          for (const item of items) {
            try {
              if (item.pubDate) {
                const d = new Date(item.pubDate);
                if (!isNaN(d.getTime()) && d < cutoff) { skipped++; continue; }
              }

              const existing = await rawQuery(sql`
                SELECT id FROM intel_reports
                WHERE company_slug = ${company.slug} AND source_url = ${item.link} LIMIT 1
              `);
              if (existing.length > 0) { skipped++; continue; }

              const headline = item.title;
              const body = `${item.description} Source: ${item.link}`;

              // Quality gate: score content before ingesting
              const quality = scoreContent(`${headline} ${body}`, "news");
              if (!shouldIngest(quality)) {
                skipped++;
                continue;
              }

              const embedding = await getEmbedding(`${headline} ${body}`);
              const embeddingStr = `[${embedding.join(",")}]`;

              // Semantic dedup: skip if >90% similar to existing report
              if (await isDuplicate(db, company.slug, embeddingStr, "news")) {
                skipped++;
                continue;
              }

              await db.execute(sql`
                INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
                VALUES (${company.slug}, 'news', ${headline}, ${body}, ${item.link}, ${embeddingStr}::vector)
                ON CONFLICT DO NOTHING
              `);

              processed++;
            } catch (itemErr) {
              errors.push(`${company.slug} item "${item.title}": ${String(itemErr)}`);
            }
          }
        } catch (feedErr) {
          errors.push(`${company.slug} feed ${feedUrl}: ${String(feedErr)}`);
        }
      }
    }

    const [{ total }] = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_companies WHERE rss_feeds != '[]'`,
    );

    return {
      success: true, processed, skipped, errors,
      offset, limit, total: Number(total), next_offset: offset + limit,
    };
  }

  // ------ Twitter Ingest ------

  async function ingestTwitter(limit = 20, offset = 0): Promise<IngestResult> {
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    const companies = await rawQuery<{ slug: string; name: string; twitter_handle: string }>(sql`
      SELECT slug, name, twitter_handle FROM intel_companies
      WHERE twitter_handle IS NOT NULL ORDER BY slug LIMIT ${limit} OFFSET ${offset}
    `);

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

    for (const company of companies) {
      const handle = company.twitter_handle;

      try {
        const xmlContent = await fetchNitterRSS(handle) ?? await fetchRSSHubTwitter(handle);
        if (!xmlContent) {
          errors.push(`${company.slug}: all sources failed for @${handle}`);
          continue;
        }

        const items = parseRSSItems(xmlContent);

        for (const item of items) {
          try {
            if (item.pubDate) {
              const d = new Date(item.pubDate);
              if (!isNaN(d.getTime()) && d < cutoff) { skipped++; continue; }
            }

            const existing = await rawQuery(sql`
              SELECT id FROM intel_reports
              WHERE company_slug = ${company.slug} AND source_url = ${item.link} LIMIT 1
            `);
            if (existing.length > 0) { skipped++; continue; }

            const headline = item.title;
            const body = `${item.description} Source: ${item.link}`;

            // Quality gate
            const quality = scoreContent(`${headline} ${body}`, "twitter");
            if (!shouldIngest(quality)) {
              skipped++;
              continue;
            }

            const embedding = await getEmbedding(`${headline} ${body}`);
            const embeddingStr = `[${embedding.join(",")}]`;

            // Semantic dedup
            if (await isDuplicate(db, company.slug, embeddingStr, "twitter")) {
              skipped++;
              continue;
            }

            await db.execute(sql`
              INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
              VALUES (${company.slug}, 'twitter', ${headline}, ${body}, ${item.link}, ${embeddingStr}::vector)
              ON CONFLICT DO NOTHING
            `);

            processed++;
          } catch (itemErr) {
            errors.push(`${company.slug} tweet "${item.title}": ${String(itemErr)}`);
          }
        }
      } catch (err) {
        errors.push(`${company.slug}: ${String(err)}`);
      }
    }

    const [{ total }] = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_companies WHERE twitter_handle IS NOT NULL`,
    );

    return {
      success: true, processed, skipped, errors,
      offset, limit, total: Number(total), next_offset: offset + limit,
    };
  }

  // ------ GitHub Ingest ------

  async function ingestGithub(limit = 15, offset = 0): Promise<IngestResult> {
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    const companies = await rawQuery<{ slug: string; name: string; github_org: string }>(sql`
      SELECT slug, name, github_org FROM intel_companies
      WHERE github_org IS NOT NULL ORDER BY slug LIMIT ${limit} OFFSET ${offset}
    `);

    const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);

    for (const company of companies) {
      const org = company.github_org;

      try {
        const [releases, commits] = await Promise.all([
          fetchOrgReleases(org),
          fetchRecentCommits(org),
        ]);

        for (const release of releases) {
          try {
            const publishedAt = new Date(release.published_at);
            if (publishedAt < cutoff) { skipped++; continue; }

            const headline = `${company.name} released ${release.tag_name}: ${release.name || release.tag_name}`;
            const body = [
              release.body?.slice(0, 400) ?? "No release notes.",
              `Source: ${release.html_url}`,
            ].join(" ");

            const existing = await rawQuery(sql`
              SELECT id FROM intel_reports
              WHERE company_slug = ${company.slug} AND source_url = ${release.html_url} LIMIT 1
            `);
            if (existing.length > 0) { skipped++; continue; }

            const embedding = await getEmbedding(`${headline} ${body}`);
            const embeddingStr = `[${embedding.join(",")}]`;
            await db.execute(sql`
              INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
              VALUES (${company.slug}, 'github', ${headline}, ${body}, ${release.html_url}, ${embeddingStr}::vector)
              ON CONFLICT DO NOTHING
            `);

            processed++;
          } catch (e) {
            errors.push(`${company.slug} release: ${String(e)}`);
          }
        }

        if (commits.length > 0) {
          try {
            const recentCommit = commits[0];
            const commitDate = new Date(recentCommit.commit.author.date);
            if (commitDate >= cutoff) {
              const headline = `${company.name} GitHub activity: ${commits.length} recent commits`;
              const summary = commits
                .map((c) => `- ${c.commit.message.split("\n")[0].slice(0, 100)}`)
                .join("\n");
              const body = `${summary}\nSource: ${recentCommit.html_url}`;

              const existing = await rawQuery(sql`
                SELECT id FROM intel_reports
                WHERE company_slug = ${company.slug} AND source_url = ${recentCommit.html_url} LIMIT 1
              `);
              if (existing.length === 0) {
                const embedding = await getEmbedding(`${headline} ${body}`);
                const embeddingStr = `[${embedding.join(",")}]`;
                await db.execute(sql`
                  INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
                  VALUES (${company.slug}, 'github', ${headline}, ${body}, ${recentCommit.html_url}, ${embeddingStr}::vector)
                  ON CONFLICT DO NOTHING
                `);
                processed++;
              } else {
                skipped++;
              }
            } else {
              skipped++;
            }
          } catch (e) {
            errors.push(`${company.slug} commits: ${String(e)}`);
          }
        }
      } catch (err) {
        errors.push(`${company.slug}: ${String(err)}`);
      }
    }

    const [{ total }] = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_companies WHERE github_org IS NOT NULL`,
    );

    return {
      success: true, processed, skipped, errors,
      offset, limit, total: Number(total), next_offset: offset + limit,
    };
  }

  // ------ Reddit Ingest ------

  async function ingestReddit(limit = 20, offset = 0): Promise<IngestResult> {
    const errors: string[] = [];
    let processed = 0;
    let skipped = 0;

    const companies = await rawQuery<{ slug: string; name: string; subreddit: string }>(sql`
      SELECT slug, name, subreddit FROM intel_companies
      WHERE subreddit IS NOT NULL ORDER BY slug LIMIT ${limit} OFFSET ${offset}
    `);

    const cutoff = new Date(Date.now() - SEVEN_DAYS_MS);

    for (const company of companies) {
      const subreddit = company.subreddit;

      try {
        const [newPosts, hotPosts] = await Promise.all([
          fetchSubredditPosts(subreddit, "new"),
          fetchSubredditPosts(subreddit, "hot"),
        ]);

        const seen = new Set<string>();
        const posts = [...newPosts, ...hotPosts].filter((p) => {
          if (seen.has(p.id)) return false;
          seen.add(p.id);
          return true;
        });

        for (const post of posts) {
          try {
            const postDate = new Date(post.created_utc * 1000);
            if (postDate < cutoff) { skipped++; continue; }
            if (post.score < 5 && post.num_comments < 3) { skipped++; continue; }

            const sourceUrl = `https://www.reddit.com${post.permalink}`;
            const headline = `r/${subreddit}: ${post.title} (${post.score} upvotes, ${post.num_comments} comments)`;
            const bodyText = post.is_self && post.selftext
              ? post.selftext.slice(0, 400)
              : `Link: ${post.url}`;
            const body = `${bodyText} Source: ${sourceUrl}`;

            // Quality gate with engagement metadata
            const quality = scoreContent(`${headline} ${body}`, "reddit", {
              score: post.score,
              numComments: post.num_comments,
            });
            if (!shouldIngest(quality)) {
              skipped++;
              continue;
            }

            const existing = await rawQuery(sql`
              SELECT id FROM intel_reports
              WHERE company_slug = ${company.slug} AND source_url = ${sourceUrl} LIMIT 1
            `);
            if (existing.length > 0) { skipped++; continue; }

            const embedding = await getEmbedding(`${headline} ${body}`);
            const embeddingStr = `[${embedding.join(",")}]`;

            // Semantic dedup
            if (await isDuplicate(db, company.slug, embeddingStr, "reddit")) {
              skipped++;
              continue;
            }

            await db.execute(sql`
              INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
              VALUES (${company.slug}, 'reddit', ${headline}, ${body}, ${sourceUrl}, ${embeddingStr}::vector)
              ON CONFLICT DO NOTHING
            `);

            processed++;
          } catch (postErr) {
            errors.push(`${company.slug} post "${post.title?.slice(0, 40)}": ${String(postErr)}`);
          }
        }
      } catch (err) {
        errors.push(`${company.slug} r/${subreddit}: ${String(err)}`);
      }
    }

    const [{ total }] = await rawQuery<{ total: string }>(
      sql`SELECT COUNT(*) AS total FROM intel_companies WHERE subreddit IS NOT NULL`,
    );

    return {
      success: true, processed, skipped, errors,
      offset, limit, total: Number(total), next_offset: offset + limit,
    };
  }

  // ------ Backfill ------

  async function backfillNewCompanies(): Promise<{ processed: number; errors: string[] }> {
    const errors: string[] = [];
    let processed = 0;

    // Find companies with fewer than 5 reports
    const sparse = await rawQuery<{ slug: string; coingecko_id: string | null; github_org: string | null; subreddit: string | null; twitter_handle: string | null; rss_feeds: string; cnt: string }>(sql`
      SELECT c.slug, c.coingecko_id, c.github_org, c.subreddit, c.twitter_handle, c.rss_feeds::text,
        COALESCE(r.cnt, 0) AS cnt
      FROM intel_companies c
      LEFT JOIN (
        SELECT company_slug, COUNT(*) AS cnt FROM intel_reports GROUP BY company_slug
      ) r ON r.company_slug = c.slug
      WHERE COALESCE(r.cnt, 0) < 5
      ORDER BY COALESCE(r.cnt, 0) ASC
      LIMIT 100
    `);

    logger.info({ count: sparse.length }, "Backfill: found companies with sparse data");

    // Process in small batches with delays to respect rate limits
    for (const company of sparse) {
      try {
        // Price backfill
        if (company.coingecko_id) {
          const priceResult = await ingestPrices(1, 0);
          processed += priceResult.processed;
        }

        // GitHub backfill (wider window)
        if (company.github_org) {
          const ghResult = await ingestGithub(1, 0);
          processed += ghResult.processed;
        }

        // Reddit backfill
        if (company.subreddit) {
          const redditResult = await ingestReddit(1, 0);
          processed += redditResult.processed;
        }

        // Small delay between companies to be polite
        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (err) {
        errors.push(`${company.slug}: ${String(err)}`);
      }
    }

    logger.info({ processed, errors: errors.length }, "Backfill completed");
    return { processed, errors };
  }

  // ------ Price History (time series for charts) ------

  async function getPriceHistory(slug: string, range: string) {
    const rangeMap: Record<string, string> = {
      "7d": "7 days",
      "30d": "30 days",
      "90d": "90 days",
      "1y": "365 days",
    };
    const interval = rangeMap[range] ?? rangeMap["30d"];

    const rows = await rawQuery<{
      captured_at: string;
      body: string;
    }>(sql`
      SELECT captured_at, body
      FROM intel_reports
      WHERE company_slug = ${slug}
        AND report_type = 'price'
        AND captured_at > NOW() - ${interval}::interval
      ORDER BY captured_at ASC
    `);

    const prices = rows.map((r) => {
      try {
        const data = typeof r.body === "string" ? JSON.parse(r.body) : r.body;
        return {
          timestamp: r.captured_at,
          price_usd: data.price_usd ?? null,
          market_cap_usd: data.market_cap_usd ?? null,
          volume_24h_usd: data.volume_24h_usd ?? null,
          price_change_24h_pct: data.price_change_24h_pct ?? null,
        };
      } catch {
        return null;
      }
    }).filter(Boolean);

    return { slug, range: range || "30d", prices };
  }

  // ------ News for a company ------

  async function getCompanyNews(slug: string, limit: number) {
    const qLimit = Math.min(Math.max(1, limit), 50);
    const rows = await rawQuery<Record<string, unknown>>(sql`
      SELECT id, headline, body, source_url, captured_at
      FROM intel_reports
      WHERE company_slug = ${slug}
        AND report_type = 'news'
      ORDER BY captured_at DESC
      LIMIT ${qLimit}
    `);
    return { slug, news: rows };
  }

  // ------ Social / Twitter for a company ------

  async function getCompanySocial(slug: string, limit: number) {
    const qLimit = Math.min(Math.max(1, limit), 50);
    const rows = await rawQuery<Record<string, unknown>>(sql`
      SELECT id, headline, body, source_url, captured_at
      FROM intel_reports
      WHERE company_slug = ${slug}
        AND report_type = 'twitter'
      ORDER BY captured_at DESC
      LIMIT ${qLimit}
    `);
    return { slug, social: rows };
  }

  // ------ Related companies (same directory/category) ------

  async function getRelatedCompanies(slug: string, limit = 10) {
    const qLimit = Math.min(Math.max(1, limit), 20);
    const rows = await rawQuery<Record<string, unknown>>(sql`
      SELECT c2.slug, c2.name, c2.category, c2.directory, c2.description, c2.website, c2.twitter_handle
      FROM intel_companies c1
      JOIN intel_companies c2
        ON c2.directory = c1.directory
        AND c2.slug != c1.slug
      WHERE c1.slug = ${slug}
      ORDER BY
        CASE WHEN c2.category = c1.category THEN 0 ELSE 1 END,
        c2.name ASC
      LIMIT ${qLimit}
    `);
    return { slug, related: rows };
  }

  return {
    listCompanies,
    getCompany,
    seedCompanies,
    search,
    stats,
    ingestPrices,
    ingestNews,
    ingestTwitter,
    ingestGithub,
    ingestReddit,
    backfillNewCompanies,
    getPriceHistory,
    getCompanyNews,
    getCompanySocial,
    getRelatedCompanies,
  };
}

// ---------------------------------------------------------------------------
// External API helpers (module-level, shared across service instances)
// ---------------------------------------------------------------------------

async function fetchCoinGeckoMarkets(ids: string[]): Promise<Map<string, CoinGeckoMarket>> {
  const result = new Map<string, CoinGeckoMarket>();
  const BATCH = 250;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    try {
      const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${batch.join(",")}&order=market_cap_desc&per_page=${BATCH}&page=1&sparkline=false`;
      const cgHeaders: Record<string, string> = { Accept: "application/json" };
      const cgKey = process.env.COIN_GECKO_API_KEY;
      if (cgKey) cgHeaders["x-cg-demo-api-key"] = cgKey;
      const res = await fetch(url, {
        headers: cgHeaders,
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;
      const data: CoinGeckoMarket[] = await res.json();
      for (const coin of data) result.set(coin.id, coin);
    } catch {
      // batch failed — continue
    }
  }
  return result;
}

async function fetchNitterRSS(handle: string): Promise<string | null> {
  for (const instance of NITTER_INSTANCES) {
    try {
      const res = await fetch(`${instance}/${handle}/rss`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CoherenceDaddy/1.0)" },
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) return await res.text();
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRSSHubTwitter(handle: string): Promise<string | null> {
  try {
    const res = await fetch(`https://rsshub.app/twitter/user/${handle}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CoherenceDaddy/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) return await res.text();
  } catch {
    // fall through
  }
  return null;
}

async function fetchOrgReleases(org: string): Promise<GitHubRelease[]> {
  try {
    const res = await fetch(
      `${GITHUB_API}/orgs/${org}/repos?type=public&sort=updated&per_page=5`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const repos: Array<{ name: string; full_name: string }> = await res.json();

    const releases: GitHubRelease[] = [];
    for (const repo of repos.slice(0, 3)) {
      try {
        const rRes = await fetch(`${GITHUB_API}/repos/${repo.full_name}/releases/latest`, {
          headers: githubHeaders(),
          signal: AbortSignal.timeout(4000),
        });
        if (rRes.ok) {
          const release: GitHubRelease = await rRes.json();
          if (!release.draft && !release.prerelease) releases.push(release);
        }
      } catch { /* skip */ }
    }
    return releases;
  } catch {
    return [];
  }
}

async function fetchRecentCommits(org: string): Promise<GitHubCommit[]> {
  try {
    const res = await fetch(
      `${GITHUB_API}/orgs/${org}/repos?type=public&sort=pushed&per_page=3`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(6000) },
    );
    if (!res.ok) return [];
    const repos: Array<{ name: string; full_name: string }> = await res.json();
    if (repos.length === 0) return [];

    const topRepo = repos[0];
    const cRes = await fetch(
      `${GITHUB_API}/repos/${topRepo.full_name}/commits?per_page=3`,
      { headers: githubHeaders(), signal: AbortSignal.timeout(6000) },
    );
    if (!cRes.ok) return [];
    return await cRes.json();
  } catch {
    return [];
  }
}

async function fetchSubredditPosts(
  subreddit: string,
  sort: "new" | "hot" = "new",
): Promise<RedditPost[]> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=10&t=week`,
      {
        headers: {
          "User-Agent": "CoherenceDaddy/1.0 (coherencedaddy.com)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!res.ok) return [];
    const json: { data: { children: Array<{ data: RedditPost }> } } = await res.json();
    return json.data?.children?.map((c) => c.data) ?? [];
  } catch {
    return [];
  }
}
