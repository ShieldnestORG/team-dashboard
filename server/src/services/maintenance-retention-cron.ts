import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { runRetentionSweep } from "./maintenance/retention-sweep.js";

export function startRetentionCron(db: Db) {
  registerCronJob({
    jobName: "maintenance:retention-sweep",
    schedule: "15 3 * * *",
    ownerAgent: "system",
    sourceFile: "maintenance-retention-cron.ts",
    handler: async () => {
      const summary = await runRetentionSweep(db);
      return summary;
    },
  });
}
