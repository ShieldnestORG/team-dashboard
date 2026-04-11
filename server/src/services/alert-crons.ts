import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";
import { sendAlert } from "./alerting.js";
import { getLatestEval } from "./eval-store.js";
import type { Db } from "@paperclipai/db";

async function checkHealth(): Promise<void> {
  try {
    const resp = await fetch(`http://127.0.0.1:${process.env.PORT || 5173}/api/health/readiness`);
    const data = await resp.json() as { ready: boolean; reason?: string };
    if (!data.ready) {
      await sendAlert("health_down", "Health check failed", `Readiness probe returned not ready. Reason: ${data.reason || "unknown"}`);
    }
  } catch (err) {
    await sendAlert("health_down", "Health check unreachable", `Could not reach health endpoint: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function dailyDigest(): Promise<void> {
  const parts: string[] = [];

  // Eval results
  const latestEval = getLatestEval();
  if (latestEval) {
    const passRate = latestEval.totalTests > 0 ? Math.round((latestEval.passed / latestEval.totalTests) * 100) : 0;
    parts.push(`Eval Results: ${latestEval.passed}/${latestEval.totalTests} passed (${passRate}%) — ran ${latestEval.ranAt}`);
    if (latestEval.failed > 0) {
      parts.push(`  Failed cases: ${latestEval.results.filter(r => !r.pass).map(r => r.case).join(", ")}`);
    }
  } else {
    parts.push("Eval Results: No eval runs recorded yet");
  }

  // Health status
  try {
    const resp = await fetch(`http://127.0.0.1:${process.env.PORT || 5173}/api/health/metrics`);
    const data = await resp.json() as { uptime: number; memoryMB: number; activeRuns: number };
    parts.push(`\nServer: uptime ${Math.round(data.uptime / 3600)}h, memory ${data.memoryMB}MB, active runs: ${data.activeRuns}`);
  } catch {
    parts.push("\nServer: metrics unavailable");
  }

  const body = parts.join("\n");
  // Only send digest as alert if there are failures
  if (latestEval && latestEval.failed > 0) {
    await sendAlert("eval_failed", "Daily Digest — Eval Failures Detected", body);
  } else {
    logger.info("Daily digest: all clear, no alert needed");
  }
}

export function startAlertCrons(db?: Db) {
  registerCronJob({ jobName: "alert:health-check", schedule: "*/5 * * * *", ownerAgent: "nova", sourceFile: "alert-crons.ts", handler: checkHealth });
  registerCronJob({ jobName: "alert:digest",       schedule: "0 7 * * *",   ownerAgent: "nova", sourceFile: "alert-crons.ts", handler: dailyDigest });

  // Partner report & site health crons (require db)
  if (db) {
    // Monthly partner metrics report — 1st of month at 8 AM
    registerCronJob({
      jobName: "reports:partner-metrics",
      schedule: "0 8 1 * *",
      ownerAgent: "nova",
      sourceFile: "alert-crons.ts",
      handler: async () => {
        const { sendPartnerMetricsReport } = await import("./partner-reports.js");
        await sendPartnerMetricsReport(db);
        return { sent: true };
      },
    });

    // Weekly partner site health check — Monday 9 AM
    registerCronJob({
      jobName: "monitor:partner-sites",
      schedule: "0 9 * * 1",
      ownerAgent: "nova",
      sourceFile: "alert-crons.ts",
      handler: async () => {
        const { checkPartnerSiteHealth } = await import("./partner-reports.js");
        await checkPartnerSiteHealth(db);
        return { checked: true };
      },
    });
  }

  const jobCount = db ? 4 : 2;
  logger.info({ count: jobCount }, "Alert cron jobs registered");
}
