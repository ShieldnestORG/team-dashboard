/**
 * Cron registration for the socials hub queue relayer.
 *
 * Runs every minute. Drains a small batch of due social_posts rows and
 * dispatches them via the platform-publishers registry.
 */

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runSocialRelayerTick } from "./social-relayer.js";
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

  logger.info("Social crons registered (socials:relay)");
}
