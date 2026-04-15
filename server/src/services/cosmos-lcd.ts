import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Cosmos LCD — chain metrics via direct public REST endpoints.
//
// Replaces the (deprecated) Mintscan vendor integration. Hits standard Cosmos
// SDK LCD paths on public nodes — no API key, no per-call billing, swap a URL
// to recover from a node outage. Output shape matches the previous
// mintscan.ts payload so content-crons.ts consumers work unchanged.
// ---------------------------------------------------------------------------

interface LCDNetwork {
  /** intel_companies.slug for this chain — used as company_slug in intel_reports */
  slug: string;
  /** Public LCD base URL */
  baseUrl: string;
  /** Mintscan/explorer URL written into source_url */
  explorerUrl: string;
  /**
   * Mint module dialect:
   * - "cosmos-sdk" = standard /cosmos/mint/v1beta1/annual_provisions (Cosmos Hub, most chains)
   * - "osmosis"    = /osmosis/mint/v1beta1 with epoch_provisions × distribution_proportions.staking
   */
  mintDialect: "cosmos-sdk" | "osmosis";
}

const NETWORKS: LCDNetwork[] = [
  {
    slug: "cosmos",
    baseUrl: process.env.COSMOS_LCD_URL || "https://cosmos-rest.publicnode.com",
    explorerUrl: "https://www.mintscan.io/cosmos",
    mintDialect: "cosmos-sdk",
  },
  {
    slug: "osmosis",
    baseUrl: process.env.OSMOSIS_LCD_URL || "https://osmosis-rest.publicnode.com",
    explorerUrl: "https://www.mintscan.io/osmosis",
    mintDialect: "osmosis",
  },
];

// TX Blockchain (tx.org) — only included if an LCD URL is configured.
// CLAUDE.md tracks ShieldNest's validator on TX; until we have the LCD
// endpoint, the cron simply skips this network with a debug log.
if (process.env.TX_LCD_URL) {
  NETWORKS.push({
    slug: "tx-blockchain",
    baseUrl: process.env.TX_LCD_URL,
    explorerUrl: process.env.TX_EXPLORER_URL || "https://tx.org",
    mintDialect: (process.env.TX_MINT_DIALECT as "cosmos-sdk" | "osmosis") || "cosmos-sdk",
  });
}

const HTTP_TIMEOUT_MS = 15_000;

interface ChainMetricsPayload {
  network: string;
  apr: number | null;
  validator_apr: number | null;
  validator_address: string | null;
  validator_count: number | null;
  block_height: number | null;
  bonded_tokens: string | null;
  inflation_rate: number | null;
  community_tax: number | null;
  source: "lcd";
  captured_at: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

async function lcdFetch<T>(baseUrl: string, path: string): Promise<T> {
  const url = `${baseUrl}${path}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`LCD ${res.status} ${url}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Per-metric fetchers
// ---------------------------------------------------------------------------

async function getInflation(baseUrl: string): Promise<number | null> {
  try {
    const data = await lcdFetch<{ inflation: string }>(baseUrl, "/cosmos/mint/v1beta1/inflation");
    const n = Number(data.inflation);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD inflation fetch failed");
    return null;
  }
}

async function getAnnualProvisions(baseUrl: string): Promise<number | null> {
  try {
    const data = await lcdFetch<{ annual_provisions: string }>(
      baseUrl,
      "/cosmos/mint/v1beta1/annual_provisions",
    );
    const n = Number(data.annual_provisions);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD annual_provisions fetch failed");
    return null;
  }
}

/**
 * Osmosis mint module: epoch is daily, only `distribution_proportions.staking`
 * fraction of provisions is paid to stakers (the rest goes to community pool,
 * developer rewards, and pool incentives).
 *
 * Returns the equivalent of `annual_provisions × stakingProportion` in uosmo.
 */
async function getOsmosisStakerAnnualProvisions(baseUrl: string): Promise<number | null> {
  try {
    const [epochData, paramsData] = await Promise.all([
      lcdFetch<{ epoch_provisions: string }>(baseUrl, "/osmosis/mint/v1beta1/epoch_provisions"),
      lcdFetch<{ params: { distribution_proportions: { staking: string } } }>(
        baseUrl,
        "/osmosis/mint/v1beta1/params",
      ),
    ]);
    const daily = Number(epochData.epoch_provisions);
    const stakingProportion = Number(paramsData.params.distribution_proportions.staking);
    if (!Number.isFinite(daily) || !Number.isFinite(stakingProportion)) return null;
    return daily * 365 * stakingProportion;
  } catch (err) {
    logger.debug({ err, baseUrl }, "Osmosis mint fetch failed");
    return null;
  }
}

async function getCommunityTax(baseUrl: string): Promise<number | null> {
  try {
    const data = await lcdFetch<{ params: { community_tax: string } }>(
      baseUrl,
      "/cosmos/distribution/v1beta1/params",
    );
    const n = Number(data.params.community_tax);
    return Number.isFinite(n) ? n : null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD community_tax fetch failed");
    return null;
  }
}

async function getBondedTokens(baseUrl: string): Promise<{ bonded: number | null; bondedStr: string | null }> {
  try {
    const data = await lcdFetch<{ pool: { bonded_tokens: string; not_bonded_tokens: string } }>(
      baseUrl,
      "/cosmos/staking/v1beta1/pool",
    );
    const bondedStr = data.pool.bonded_tokens;
    const bonded = Number(bondedStr);
    return { bonded: Number.isFinite(bonded) ? bonded : null, bondedStr };
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD pool fetch failed");
    return { bonded: null, bondedStr: null };
  }
}

async function getValidatorCount(baseUrl: string): Promise<number | null> {
  try {
    // pagination.limit=1 + count_total returns total without pulling the full list
    const data = await lcdFetch<{ pagination: { total: string } }>(
      baseUrl,
      "/cosmos/staking/v1beta1/validators?status=BOND_STATUS_BONDED&pagination.limit=1&pagination.count_total=true",
    );
    const total = Number(data.pagination?.total);
    return Number.isFinite(total) ? total : null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD validator count fetch failed");
    return null;
  }
}

async function getLatestBlockHeight(baseUrl: string): Promise<number | null> {
  try {
    const data = await lcdFetch<{ block: { header: { height: string } } }>(
      baseUrl,
      "/cosmos/base/tendermint/v1beta1/blocks/latest",
    );
    const h = Number(data.block.header.height);
    return Number.isFinite(h) ? h : null;
  } catch (err) {
    logger.debug({ err, baseUrl }, "LCD block height fetch failed");
    return null;
  }
}

/**
 * Cosmos-SDK staking APR formula:
 *   apr = (annual_provisions × (1 - community_tax)) / bonded_tokens
 *
 * Osmosis variant (community tax already excluded by distribution_proportions.staking):
 *   apr = staker_annual_provisions / bonded_tokens
 *
 * Returns null if any required input is missing.
 */
function computeStakingAPR(
  dialect: "cosmos-sdk" | "osmosis",
  stakerAnnualProvisions: number | null,
  communityTax: number | null,
  bondedTokens: number | null,
): number | null {
  if (stakerAnnualProvisions == null || bondedTokens == null || bondedTokens === 0) {
    return null;
  }
  const numerator =
    dialect === "cosmos-sdk"
      ? stakerAnnualProvisions * (1 - (communityTax ?? 0))
      : stakerAnnualProvisions;
  const aprDecimal = numerator / bondedTokens;
  return Math.round(aprDecimal * 10_000) / 100;
}

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function cosmosLcdService(db: Db) {
  async function ingestNetwork(network: LCDNetwork): Promise<{ ok: boolean; error?: string }> {
    try {
      const provisionsFetcher =
        network.mintDialect === "osmosis"
          ? () => getOsmosisStakerAnnualProvisions(network.baseUrl)
          : () => getAnnualProvisions(network.baseUrl);

      const [annualProvisions, communityTax, pool, validatorCount, blockHeight, inflation] = await Promise.all([
        provisionsFetcher(),
        getCommunityTax(network.baseUrl),
        getBondedTokens(network.baseUrl),
        getValidatorCount(network.baseUrl),
        getLatestBlockHeight(network.baseUrl),
        getInflation(network.baseUrl),
      ]);

      const apr = computeStakingAPR(network.mintDialect, annualProvisions, communityTax, pool.bonded);

      const payload: ChainMetricsPayload = {
        network: network.slug,
        apr,
        validator_apr: null,
        validator_address: null,
        validator_count: validatorCount,
        block_height: blockHeight,
        bonded_tokens: pool.bondedStr,
        inflation_rate: inflation,
        community_tax: communityTax,
        source: "lcd",
        captured_at: new Date().toISOString(),
      };

      const parts: string[] = [`APR ${apr != null ? `${apr.toFixed(2)}%` : "N/A"}`];
      if (validatorCount != null) parts.push(`${validatorCount} validators`);
      if (blockHeight != null) parts.push(`block #${blockHeight.toLocaleString()}`);
      const headline = `Chain metrics: ${network.slug} — ${parts.join(", ")}`;
      const body = JSON.stringify(payload);

      const embedding = await getEmbedding(`${headline} ${body}`);
      const embeddingStr = `[${embedding.join(",")}]`;

      await db.execute(sql`
        INSERT INTO intel_reports (company_slug, report_type, headline, body, source_url, embedding)
        VALUES (
          ${network.slug},
          'chain-metrics',
          ${headline},
          ${body},
          ${network.explorerUrl},
          ${embeddingStr}::vector
        )
      `);

      logger.info(
        { network: network.slug, apr, validatorCount, blockHeight },
        "Cosmos LCD chain metrics ingested",
      );
      return { ok: true };
    } catch (err) {
      const msg = `${network.slug}: ${String(err)}`;
      logger.error({ err, network: network.slug }, "Cosmos LCD ingest failed");
      return { ok: false, error: msg };
    }
  }

  async function ingestChainMetrics(): Promise<{
    success: boolean;
    processed: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let processed = 0;

    for (const network of NETWORKS) {
      const result = await ingestNetwork(network);
      if (result.ok) processed++;
      else if (result.error) errors.push(result.error);
    }

    if (NETWORKS.length === 0) {
      logger.warn("Cosmos LCD: no networks configured");
    }

    return { success: errors.length === 0 && processed > 0, processed, errors };
  }

  return { ingestChainMetrics };
}
