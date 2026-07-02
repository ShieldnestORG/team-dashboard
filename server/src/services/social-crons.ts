/**
 * Cron registration for the socials hub queue relayer.
 *
 * Runs every minute. Drains a small batch of due social_posts rows and
 * dispatches them via the platform-publishers registry.
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runSocialRelayerTick, runLeadRelayerTick } from "./social-relayer.js";
import { runZernioEngagementSyncTick } from "./socials/zernio-sync.js";
import { runZernioAnalyticsIngestTick } from "./socials/zernio-analytics.js";
import { logger } from "../middleware/logger.js";
import type { StorageService } from "../storage/types.js";

export function startSocialCrons(db: Db, storageService: StorageService): void {
  registerCronJob({
    jobName: "socials:relay",
    schedule: "* * * * *",
    ownerAgent: "system",
    sourceFile: "social-crons.ts",
    handler: async () => {
      const result = await runSocialRelayerTick(db, storageService);
      if (result.picked > 0) {
        logger.info(result, "socials:relay tick");
      }
      return result;
    },
  });

  // Captured leads → Brevo (nurture CRM). No-ops quietly when Brevo env or
  // lead backlog is empty; see runLeadRelayerTick.
  registerCronJob({
    jobName: "socials:lead-sync",
    schedule: "*/5 * * * *",
    ownerAgent: "system",
    sourceFile: "social-crons.ts",
    handler: () => runLeadRelayerTick(db),
  });

  // Zernio automation mirror + tagged-contact poll (clickTag audience).
  registerCronJob({
    jobName: "socials:zernio-sync",
    schedule: "20 * * * *",
    ownerAgent: "system",
    sourceFile: "social-crons.ts",
    handler: () => runZernioEngagementSyncTick(db),
  });

  // Zernio analytics ingestion (Goal B). Daily — IG lags ~48h and YouTube
  // 2-3d, so a tighter cadence buys nothing.
  registerCronJob({
    jobName: "socials:zernio-analytics",
    schedule: "40 6 * * *",
    ownerAgent: "system",
    sourceFile: "social-crons.ts",
    handler: () => runZernioAnalyticsIngestTick(db),
  });

  logger.info(
    "Social crons registered (socials:relay, socials:lead-sync, socials:zernio-sync, socials:zernio-analytics)",
  );
}
