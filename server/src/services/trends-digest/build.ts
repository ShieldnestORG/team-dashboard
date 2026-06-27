// ---------------------------------------------------------------------------
// Production digest build — the function the route (POST /api/trends/digest/
// build) and the cron both call. Wires the live signal source + real Serper
// enrichment into the assembler, then persists the result as PENDING. It NEVER
// sends; sending is a separate, human-approved step (Rule 7).
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { trendScannerService, type TrendSignals } from "../trend-scanner.js";
import { getLatestSignals } from "../trend-crons.js";
import { assembleDigest } from "./assemble.js";
import { serperSaturation } from "./serper.js";
import { trendsDigestStore } from "./store.js";
import type { TrendDigest } from "./types.js";

export interface BuildOptions {
  /** Fetch fresh signals instead of using the cached scan. */
  forceScan?: boolean;
}

/**
 * Build a fresh digest from live signals and store it as `pending`. Returns the
 * digest. Default prose models (Ollama → Claude) and the default Haiku citation
 * judge run here; the number guard + citation gate keep them honest, and the
 * deterministic fallbacks mean the build always produces a grounded digest.
 */
export async function buildAndStorePendingDigest(
  db: Db,
  opts: BuildOptions = {},
): Promise<TrendDigest> {
  let signals = getLatestSignals() as TrendSignals | null;
  if (opts.forceScan || !signals) {
    signals = await trendScannerService(db).scan();
  }

  const digest = await assembleDigest(signals, {
    // Real saturation enrichment — Serper if SERPER_API_KEY is set, else {}.
    enrichSaturation: async (ctx) =>
      (await serperSaturation(ctx.keyword)) ?? {},
  });

  await trendsDigestStore(db).savePending(digest);
  logger.info(
    {
      date: digest.digestDate,
      items: digest.items.length,
      adFriendly: digest.adFriendlyItemIds.length,
    },
    "trends-digest: pending digest built + stored (awaiting human approval)",
  );
  return digest;
}
