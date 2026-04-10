import type { Db } from "@paperclipai/db";
import { trendScannerService } from "./trend-scanner.js";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";

// In-memory cache of latest signals (served via API)
let latestSignals: unknown = null;

export function getLatestSignals() {
  return latestSignals;
}

export function startTrendCrons(db?: Db) {
  const svc = trendScannerService(db);

  registerCronJob({
    jobName: "trends:scan",
    schedule: "0 */6 * * *",
    ownerAgent: "echo",
    sourceFile: "trend-crons.ts",
    handler: async () => {
      const signals = await svc.scan();
      latestSignals = signals;
      return signals;
    },
  });

  // Run immediately on startup to populate cache
  void svc.scan().then((signals) => {
    latestSignals = signals;
    logger.info("Initial trend scan completed");
  }).catch((err) => {
    logger.error({ err }, "Initial trend scan failed");
  });

  logger.info({ count: 1 }, "Trend cron jobs registered");
}
