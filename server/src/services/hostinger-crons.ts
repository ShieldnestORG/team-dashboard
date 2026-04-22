// ---------------------------------------------------------------------------
// Owned utility-site network cron jobs.
// - owned-sites:sync-metrics — 6h pull from GA4 + AdSense for live/monetized sites
// - owned-sites:content-refresh — monthly trigger for Ollama content refresh on VPS2
// See docs/products/utility-network/README.md.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { ownedSitesService } from "./owned-sites.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

async function syncMetrics(db: Db): Promise<void> {
  const svc = ownedSitesService(db);
  const result = await svc.syncAll(COMPANY_ID);
  const ga4Ok = result.ga4Results.filter((r) => r.ok).length;
  const adsenseOk = result.adsenseResults.filter((r) => r.ok).length;
  logger.info(
    {
      sitesProcessed: result.sitesProcessed,
      ga4Ok,
      ga4Total: result.ga4Results.length,
      adsenseOk,
      adsenseTotal: result.adsenseResults.length,
    },
    "owned-sites:sync-metrics — batch complete",
  );
}

async function refreshContent(_db: Db): Promise<void> {
  // Content refresh is driven by the Ollama pipeline on VPS2. Team-dashboard
  // only *triggers* the job — the LLM workload does not belong in the Express
  // server. Wiring is a follow-up (needs VPS2 SSH tunnel or webhook endpoint).
  logger.info(
    "owned-sites:content-refresh — trigger stub (VPS2 Ollama pipeline not yet wired)",
  );
}

export function startOwnedSitesCrons(db: Db): void {
  registerCronJob({
    jobName: "owned-sites:sync-metrics",
    schedule: "0 */6 * * *",
    ownerAgent: "metrics-agent",
    sourceFile: "hostinger-crons.ts",
    handler: () => syncMetrics(db),
  });

  registerCronJob({
    jobName: "owned-sites:content-refresh",
    schedule: "0 9 1 * *",
    ownerAgent: "content-agent",
    sourceFile: "hostinger-crons.ts",
    handler: () => refreshContent(db),
  });
}
