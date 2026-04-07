import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";
import { sendAlert } from "./alerting.js";
import { getLatestEval } from "./eval-store.js";

interface AlertCronJob {
  name: string;
  schedule: string;
  ownerAgent: string;
  run: () => Promise<void>;
  nextRun: Date | null;
  running: boolean;
}

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

export function startAlertCrons() {
  const jobs: AlertCronJob[] = [
    { name: "alert:health-check", schedule: "*/5 * * * *", ownerAgent: "nova", run: checkHealth, nextRun: null, running: false },
    { name: "alert:digest", schedule: "0 7 * * *", ownerAgent: "nova", run: dailyDigest, nextRun: null, running: false },
  ];

  for (const job of jobs) {
    const parsed = parseCron(job.schedule);
    if (parsed) job.nextRun = nextCronTick(parsed, new Date());
  }

  logger.info(
    { jobs: jobs.map((j) => ({ name: j.name, schedule: j.schedule, nextRun: j.nextRun?.toISOString() })) },
    "Alert cron scheduler started",
  );

  const TICK_INTERVAL_MS = 30_000;
  const interval = setInterval(async () => {
    const now = new Date();
    for (const job of jobs) {
      if (job.running) continue;
      if (!job.nextRun || now < job.nextRun) continue;
      job.running = true;
      logger.info({ job: job.name, ownerAgent: job.ownerAgent }, "Alert cron job starting");
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name, ownerAgent: job.ownerAgent }, "Alert cron job failed");
      } finally {
        job.running = false;
        const parsed = parseCron(job.schedule);
        if (parsed) job.nextRun = nextCronTick(parsed, new Date());
      }
    }
  }, TICK_INTERVAL_MS);

  return () => clearInterval(interval);
}
