import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// DefiLlama — chain TVL ingestion (no API key, free).
//
// Pulls per-chain TVL from the public DefiLlama API and writes one
// intel_reports row per tracked chain with report_type='chain-tvl'. The
// content engine reads these rows via a topic picker to write "TVL is up X%"
// pieces.
// ---------------------------------------------------------------------------

const DEFILLAMA_BASE = "https://api.llama.fi";
const HTTP_TIMEOUT_MS = 15_000;

interface ChainTVLEntry {
  /** intel_companies.slug */
  slug: string;
  /** DefiLlama chain name as it appears in the v2/chains response */
  llamaName: string;
}

const CHAINS: ChainTVLEntry[] = [
  { slug: "cosmos", llamaName: "Cosmos" },
  { slug: "osmosis", llamaName: "Osmosis" },
  // tx-blockchain not yet listed on DefiLlama — added when available
];

interface LlamaChainRow {
  name: string;
  tvl: number;
  tokenSymbol?: string | null;
  cmcId?: string | null;
}

interface ChainTVLPayload {
  chain: string;
  tvl_usd: number;
  delta_24h_pct: number | null;
  source: "defillama";
  captured_at: string;
}

async function llamaFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${DEFILLAMA_BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DefiLlama ${res.status} ${path}`);
  return (await res.json()) as T;
}

export function defillamaService(db: Db) {
  async function ingestChainTVL(): Promise<{
    success: boolean;
    processed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;

    let chainList: LlamaChainRow[];
    try {
      chainList = await llamaFetch<LlamaChainRow[]>("/v2/chains");
    } catch (err) {
      logger.error({ err }, "DefiLlama /v2/chains fetch failed");
      return { success: false, processed: 0, errors: [String(err)] };
    }

    for (const chain of CHAINS) {
      try {
        const row = chainList.find((c) => c.name === chain.llamaName);
        if (!row || typeof row.tvl !== "number") {
          errors.push(`${chain.slug}: not found on DefiLlama`);
          continue;
        }

        // Pull 24h-ago TVL from previous report row (best-effort, not from the API)
        let delta24hPct: number | null = null;
        try {
          const prev = (await db.execute(sql`
            SELECT body FROM intel_reports
            WHERE company_slug = ${chain.slug}
              AND report_type = 'chain-tvl'
              AND captured_at < NOW() - INTERVAL '20 hours'
            ORDER BY captured_at DESC LIMIT 1
          `)) as unknown as Array<{ body: string }>;
          if (prev.length > 0) {
            const prevPayload = JSON.parse(prev[0]!.body) as { tvl_usd?: number };
            if (typeof prevPayload.tvl_usd === "number" && prevPayload.tvl_usd > 0) {
              delta24hPct = ((row.tvl - prevPayload.tvl_usd) / prevPayload.tvl_usd) * 100;
            }
          }
        } catch {
          // non-critical
        }

        const payload: ChainTVLPayload = {
          chain: chain.slug,
          tvl_usd: row.tvl,
          delta_24h_pct: delta24hPct,
          source: "defillama",
          captured_at: new Date().toISOString(),
        };

        const tvlFormatted = `$${(row.tvl / 1_000_000).toFixed(1)}M`;
        const deltaStr =
          delta24hPct != null
            ? ` (${delta24hPct >= 0 ? "+" : ""}${delta24hPct.toFixed(1)}% 24h)`
            : "";
        const headline = `Chain TVL: ${chain.slug} — ${tvlFormatted}${deltaStr}`;
        const body = JSON.stringify(payload);

        const embedding = await getEmbedding(`${headline} ${body}`);
        const embeddingStr = `[${embedding.join(",")}]`;

        await db.execute(sql`
          INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
          VALUES (
            ${chain.slug},
            'chain-tvl',
            ${headline},
            ${body},
            ${`https://defillama.com/chain/${chain.llamaName}`},
            ${embeddingStr}::vector
          )
        `);

        processed++;
        logger.info({ chain: chain.slug, tvl: row.tvl, delta24hPct }, "DefiLlama TVL ingested");
      } catch (err) {
        const msg = `${chain.slug}: ${String(err)}`;
        errors.push(msg);
        logger.error({ err, chain: chain.slug }, "DefiLlama ingest error");
      }
    }

    return { success: errors.length === 0 && processed > 0, processed, errors };
  }

  return { ingestChainTVL };
}
