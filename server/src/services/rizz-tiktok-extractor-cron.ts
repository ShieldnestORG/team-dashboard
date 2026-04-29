// ---------------------------------------------------------------------------
// Rizz TikTok Extractor cron registration.
//
// Cron: rizz-extractor:scrape-and-audit  — every 15 minutes.
// Owner agent: rizz.
//
// Registered only when RIZZ_EXTRACTOR_ENABLED=true. The cron registry also
// exposes a per-job enabled toggle via the dashboard.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runExtractor } from "./rizz-tiktok-extractor.js";
import { logger } from "../middleware/logger.js";

export interface StartRizzExtractorCronOpts {
  companyId: string;
}

export function startRizzExtractorCron(db: Db, opts: StartRizzExtractorCronOpts): void {
  registerCronJob({
    jobName: "rizz-extractor:scrape-and-audit",
    schedule: "*/15 * * * *",
    ownerAgent: "rizz",
    sourceFile: "rizz-tiktok-extractor-cron.ts",
    handler: async () => {
      try {
        const result = await runExtractor(db, { companyId: opts.companyId });
        if (result.picked > 0 || result.audited > 0 || result.errored > 0) {
          logger.info(
            {
              picked: result.picked,
              audited: result.audited,
              errored: result.errored,
              ids: result.auditedSubmissionIds,
            },
            "rizz-extractor: cycle complete",
          );
        }
      } catch (err) {
        logger.error({ err }, "rizz-extractor: cycle failed");
      }
    },
  });
}
