import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Mintscan API integration — chain metrics for Cosmos ecosystem networks
// ---------------------------------------------------------------------------

const MINTSCAN_BASE_URL = "https://apis.mintscan.io";
const MINTSCAN_API_KEY = process.env.MINTSCAN_API_KEY || "";

const NETWORKS = ["cosmos", "osmosis", "txhuman"] as const;
type Network = (typeof NETWORKS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChainAPRResponse {
  apr: number;
  [key: string]: unknown;
}

interface ValidatorAPRResponse {
  apr: number;
  [key: string]: unknown;
}

interface ChainMetricsPayload {
  network: string;
  apr: number | null;
  validator_apr: number | null;
  validator_address: string | null;
  captured_at: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function mintscanFetch<T>(path: string): Promise<T> {
  const url = `${MINTSCAN_BASE_URL}${path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${MINTSCAN_API_KEY}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Mintscan API ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function mintscanService(db: Db) {
  async function rawQuery<T = Record<string, unknown>>(
    query: ReturnType<typeof sql>,
  ): Promise<T[]> {
    const result = await db.execute(query);
    return result as unknown as T[];
  }

  // ---- Chain APR ----

  async function getChainAPR(network: string): Promise<number | null> {
    if (!MINTSCAN_API_KEY) {
      logger.warn("MINTSCAN_API_KEY not set — skipping chain APR fetch");
      return null;
    }

    try {
      const data = await mintscanFetch<ChainAPRResponse>(
        `/v1/${network}/apr`,
      );
      return data.apr ?? null;
    } catch (err) {
      logger.error({ err, network }, "Failed to fetch chain APR from Mintscan");
      return null;
    }
  }

  // ---- Validator APR ----

  async function getValidatorAPR(
    network: string,
    address: string,
  ): Promise<number | null> {
    if (!MINTSCAN_API_KEY) {
      logger.warn("MINTSCAN_API_KEY not set — skipping validator APR fetch");
      return null;
    }

    try {
      const data = await mintscanFetch<ValidatorAPRResponse>(
        `/v1/${network}/validators/${address}/apr`,
      );
      return data.apr ?? null;
    } catch (err) {
      logger.error(
        { err, network, address },
        "Failed to fetch validator APR from Mintscan",
      );
      return null;
    }
  }

  // ---- Ingest chain metrics for all networks ----

  async function ingestChainMetrics(): Promise<{
    success: boolean;
    processed: number;
    errors: string[];
  }> {
    if (!MINTSCAN_API_KEY) {
      return { success: false, processed: 0, errors: ["MINTSCAN_API_KEY not configured"] };
    }

    const errors: string[] = [];
    let processed = 0;

    for (const network of NETWORKS) {
      try {
        const apr = await getChainAPR(network);

        const payload: ChainMetricsPayload = {
          network,
          apr,
          validator_apr: null,
          validator_address: null,
          captured_at: new Date().toISOString(),
        };

        const headline = `Chain metrics: ${network} — APR ${apr != null ? `${apr.toFixed(2)}%` : "unavailable"}`;
        const body = JSON.stringify(payload);

        const embedding = await getEmbedding(`${headline} ${body}`);
        const embeddingStr = `[${embedding.join(",")}]`;

        await db.execute(sql`
          INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
          VALUES (
            ${network},
            'chain-metrics',
            ${headline},
            ${body},
            ${"https://mintscan.io/" + network},
            ${embeddingStr}::vector
          )
        `);

        processed++;
        logger.info({ network, apr }, "Mintscan chain metrics ingested");
      } catch (err) {
        const msg = `${network}: ${String(err)}`;
        errors.push(msg);
        logger.error({ err, network }, "Mintscan ingest error");
      }
    }

    return { success: errors.length === 0, processed, errors };
  }

  // ---- Get latest chain metrics for a network ----

  async function getLatestChainMetrics(
    network: string,
  ): Promise<{ network: string; metrics: Record<string, unknown> | null }> {
    const rows = await rawQuery<{
      headline: string;
      body: string;
      captured_at: string;
    }>(sql`
      SELECT headline, body, captured_at
      FROM intel_reports
      WHERE company_slug = ${network}
        AND report_type = 'chain-metrics'
      ORDER BY captured_at DESC
      LIMIT 1
    `);

    if (rows.length === 0) {
      return { network, metrics: null };
    }

    const row = rows[0];
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(row.body);
    } catch {
      parsed = { raw: row.body };
    }

    return {
      network,
      metrics: {
        ...parsed,
        headline: row.headline,
        captured_at: row.captured_at,
      },
    };
  }

  return {
    getChainAPR,
    getValidatorAPR,
    ingestChainMetrics,
    getLatestChainMetrics,
  };
}
