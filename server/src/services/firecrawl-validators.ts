import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Firecrawl Validators — scrapes public validator-list pages for chains where
// LCD doesn't expose ranked validator metadata cheaply (uptime, slashing,
// real-time rank). Output is written to intel_reports as report_type
// 'validator-rank' and shadowed into validator_rank_history for time-series.
//
// Uses the same self-hosted Firecrawl endpoint as firecrawl-sync.ts.
// ---------------------------------------------------------------------------

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || "http://168.231.127.180";
const REQUEST_TIMEOUT_MS = 45_000;

interface ValidatorPage {
  /** intel_companies.slug for the chain */
  slug: string;
  /** Public URL whose markdown lists the validator set */
  url: string;
  /** Optional: validator address/moniker we care about ranking */
  trackedMoniker?: string;
}

const PAGES: ValidatorPage[] = [
  {
    slug: "cosmos",
    url: "https://www.mintscan.io/cosmos/validators",
    trackedMoniker: process.env.SHIELDNEST_COSMOS_MONIKER || undefined,
  },
  {
    slug: "osmosis",
    url: "https://www.mintscan.io/osmosis/validators",
    trackedMoniker: process.env.SHIELDNEST_OSMOSIS_MONIKER || undefined,
  },
];

if (process.env.TX_VALIDATORS_URL) {
  PAGES.push({
    slug: "tx-blockchain",
    url: process.env.TX_VALIDATORS_URL,
    trackedMoniker: process.env.SHIELDNEST_TX_MONIKER || "ShieldNest",
  });
}

interface ValidatorRow {
  rank: number;
  moniker: string;
  votingPowerPct: number | null;
  commissionPct: number | null;
}

interface ValidatorPayload {
  chain: string;
  source: "firecrawl";
  source_url: string;
  total_listed: number;
  top10: ValidatorRow[];
  tracked: ValidatorRow | null;
  captured_at: string;
}

// ---------------------------------------------------------------------------
// Firecrawl scrape
// ---------------------------------------------------------------------------

async function scrapeMarkdown(url: string): Promise<string | null> {
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
      logger.warn({ url, status: res.status }, "Firecrawl scrape non-ok");
      return null;
    }
    const data = (await res.json()) as { success: boolean; data?: { markdown?: string } };
    if (!data.success || !data.data?.markdown) return null;
    return data.data.markdown;
  } catch (err) {
    logger.warn({ err, url }, "Firecrawl scrape threw");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validator table parser
//
// Mintscan validator tables in markdown render roughly as:
//   1 | Coinbase Cloud | 5.21% | 5%
//   2 | Binance Node   | 4.87% | 0%
//
// We scan for lines that start with a small integer followed by a name and
// percentage columns. Tolerant: only requires rank + moniker + at least one
// percent value. Picks at most the top 50 rows + any row containing the
// tracked moniker.
// ---------------------------------------------------------------------------

const ROW_RE = /^\s*\|?\s*(\d{1,4})\s*\|\s*([^|]+?)\s*\|\s*([\d.]+)\s*%?\s*\|\s*([\d.]+)\s*%?/;

function parseValidatorTable(markdown: string): ValidatorRow[] {
  const rows: ValidatorRow[] = [];
  for (const line of markdown.split(/\r?\n/)) {
    const m = line.match(ROW_RE);
    if (!m) continue;
    const rank = parseInt(m[1]!, 10);
    if (!Number.isFinite(rank) || rank > 500) continue;
    const moniker = m[2]!.replace(/[*_`]/g, "").trim();
    if (!moniker || moniker.length > 80) continue;
    const votingPowerPct = parseFloat(m[3]!);
    const commissionPct = parseFloat(m[4]!);
    rows.push({
      rank,
      moniker,
      votingPowerPct: Number.isFinite(votingPowerPct) ? votingPowerPct : null,
      commissionPct: Number.isFinite(commissionPct) ? commissionPct : null,
    });
    if (rows.length >= 200) break;
  }
  // Dedupe by rank, keep first occurrence
  const seen = new Set<number>();
  return rows.filter((r) => {
    if (seen.has(r.rank)) return false;
    seen.add(r.rank);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function firecrawlValidatorsService(db: Db) {
  async function ingestPage(page: ValidatorPage): Promise<{ ok: boolean; error?: string }> {
    try {
      const markdown = await scrapeMarkdown(page.url);
      if (!markdown) return { ok: false, error: `${page.slug}: empty markdown` };

      const validators = parseValidatorTable(markdown);
      if (validators.length === 0) {
        return { ok: false, error: `${page.slug}: no validator rows parsed` };
      }

      const top10 = validators.slice(0, 10);
      const tracked = page.trackedMoniker
        ? validators.find((v) => v.moniker.toLowerCase().includes(page.trackedMoniker!.toLowerCase())) || null
        : null;

      const payload: ValidatorPayload = {
        chain: page.slug,
        source: "firecrawl",
        source_url: page.url,
        total_listed: validators.length,
        top10,
        tracked,
        captured_at: new Date().toISOString(),
      };

      const headlineParts = [`${validators.length} validators`];
      if (top10[0]) headlineParts.push(`#1 ${top10[0].moniker} (${top10[0].votingPowerPct}%)`);
      if (tracked) headlineParts.push(`tracked: ${tracked.moniker} #${tracked.rank}`);
      const headline = `Validators: ${page.slug} — ${headlineParts.join(", ")}`;
      const body = JSON.stringify(payload);

      const embedding = await getEmbedding(`${headline} ${body}`);
      const embeddingStr = `[${embedding.join(",")}]`;

      await db.execute(sql`
        INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
        VALUES (
          ${page.slug},
          'validator-rank',
          ${headline},
          ${body},
          ${page.url},
          ${embeddingStr}::vector
        )
      `);

      // Time-series shadow into validator_rank_history (top 50 + tracked)
      const historyRows = validators.slice(0, 50);
      if (tracked && !historyRows.some((r) => r.rank === tracked.rank)) {
        historyRows.push(tracked);
      }
      for (const row of historyRows) {
        await db.execute(sql`
          INSERT INTO validator_rank_history (network, moniker, rank, voting_power, commission)
          VALUES (
            ${page.slug},
            ${row.moniker},
            ${row.rank},
            ${row.votingPowerPct},
            ${row.commissionPct}
          )
        `);
      }

      logger.info(
        { chain: page.slug, total: validators.length, tracked: tracked?.rank ?? null },
        "Firecrawl validators ingested",
      );
      return { ok: true };
    } catch (err) {
      const msg = `${page.slug}: ${String(err)}`;
      logger.error({ err, chain: page.slug }, "Firecrawl validators failed");
      return { ok: false, error: msg };
    }
  }

  async function ingestValidators(): Promise<{
    success: boolean;
    processed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;
    for (const page of PAGES) {
      const result = await ingestPage(page);
      if (result.ok) processed++;
      else if (result.error) errors.push(result.error);
    }
    return { success: errors.length === 0 && processed > 0, processed, errors };
  }

  return { ingestValidators };
}
