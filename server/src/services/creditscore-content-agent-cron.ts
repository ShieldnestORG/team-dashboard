// ---------------------------------------------------------------------------
// CreditScore Content Agent cron registration.
//
// Cron: creditscore:content-drafts  — 1st of month, 10 AM UTC (runs right
// after the fix-priority digest so the "here's your gap" email and the
// drafted remediation pages surface on the same day).
// Owner agent: cipher (Technical Writer).
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { creditscoreContentAgent } from "./creditscore-content-agent.js";
import { logger } from "../middleware/logger.js";

export function startCreditscoreContentAgent(db: Db): void {
  const agent = creditscoreContentAgent(db);
  registerCronJob({
    jobName: "creditscore:content-drafts",
    schedule: "0 10 1 * *",
    ownerAgent: "cipher",
    sourceFile: "creditscore-content-agent-cron.ts",
    handler: async () => {
      try {
        await agent.runMonthlyDraftCycle();
      } catch (err) {
        logger.error({ err }, "creditscore:content-drafts — cycle failed");
      }
    },
  });
}
