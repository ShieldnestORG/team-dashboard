// ---------------------------------------------------------------------------
// CreditScore fulfillment-agent cron registrations.
//
// 3 jobs:
//   - creditscore:schema-impls       — monthly 1st @ 11:00 UTC   (core)
//   - creditscore:competitor-scans   — monthly 1st @ 11:30 UTC   (forge)
//   - creditscore:sage-weekly        — weekly Mondays @ 12:00 UTC (sage)
//
// Staggered after creditscore:scan (every 6h), creditscore:fix-priority-digest
// (1st @ 9:00), and creditscore:content-drafts (1st @ 10:00) so each agent
// sees the latest upstream artifacts.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { creditscoreSchemaAgent } from "./creditscore-schema-agent.js";
import { creditscoreCompetitorAgent } from "./creditscore-competitor-agent.js";
import { creditscoreSageStrategist } from "./creditscore-sage-strategist.js";
import { logger } from "../middleware/logger.js";

export function startCreditscoreFulfillmentCrons(db: Db): void {
  const schema = creditscoreSchemaAgent(db);
  const competitor = creditscoreCompetitorAgent(db);
  const sage = creditscoreSageStrategist(db);

  registerCronJob({
    jobName: "creditscore:schema-impls",
    schedule: "0 11 1 * *",
    ownerAgent: "core",
    sourceFile: "creditscore-fulfillment-crons.ts",
    handler: async () => {
      try {
        await schema.runMonthlySchemaCycle();
      } catch (err) {
        logger.error({ err }, "creditscore:schema-impls — cycle failed");
      }
    },
  });

  registerCronJob({
    jobName: "creditscore:competitor-scans",
    schedule: "30 11 1 * *",
    ownerAgent: "forge",
    sourceFile: "creditscore-fulfillment-crons.ts",
    handler: async () => {
      try {
        await competitor.runMonthlyCompetitorCycle();
      } catch (err) {
        logger.error({ err }, "creditscore:competitor-scans — cycle failed");
      }
    },
  });

  registerCronJob({
    jobName: "creditscore:sage-weekly",
    schedule: "0 12 * * 1", // Mondays at 12:00 UTC
    ownerAgent: "sage",
    sourceFile: "creditscore-fulfillment-crons.ts",
    handler: async () => {
      try {
        await sage.runWeeklyCycle();
      } catch (err) {
        logger.error({ err }, "creditscore:sage-weekly — cycle failed");
      }
    },
  });
}
