import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";
import { sendAlert, setAlertDb } from "./alerting.js";
import { getLatestEval } from "./eval-store.js";
import { getAutomationHealth } from "./automation-health.js";
import { alertEvents, type Db } from "@paperclipai/db";
import { desc, gte } from "drizzle-orm";

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

async function getUnhealthyCrons(db: Db) {
  const health = await getAutomationHealth(db);
  return health.crons.jobs.filter(
    (j) => j.enabled && (j.staleness === "critical" || j.lastError !== null),
  );
}

/**
 * Watchdog: scan automation-health for enabled cron jobs that are either
 * critically stale (missed multiple expected runs) or erroring on their last
 * run, and fire a single aggregated alert. Runs ~every 15 min; the
 * type-level cooldown in sendAlert() dedups so it can't spam. cron_stale is
 * a routine severity: it is persisted for the weekly recap, not emailed.
 */
async function cronWatchdog(db: Db): Promise<void> {
  const unhealthy = await getUnhealthyCrons(db);

  if (unhealthy.length === 0) {
    logger.debug("Cron watchdog: all enabled jobs healthy");
    return;
  }

  const lines = unhealthy.map((j) => {
    const reason =
      j.staleness === "critical" && j.lastError
        ? `critically stale + erroring`
        : j.staleness === "critical"
          ? `critically stale (no recent run)`
          : `erroring`;
    const err = j.lastError ? ` — ${j.lastError}` : "";
    return `• ${j.jobName} (${j.ownerAgent}): ${reason}${err}`;
  });

  const body = `${unhealthy.length} enabled cron job${
    unhealthy.length === 1 ? "" : "s"
  } unhealthy:\n\n${lines.join("\n")}\n\nReview /automation-health for details.`;

  await sendAlert(
    "cron_stale",
    `${unhealthy.length} cron job${unhealthy.length === 1 ? "" : "s"} unhealthy`,
    body,
  );
}

/**
 * Weekly ops recap — the one scheduled ops email. Summarizes every alert
 * recorded in alert_events over the last 7 days (routine types never email
 * immediately; this is where they surface), plus current cron health and the
 * latest eval run. Sends even when all clear so the cadence is predictable.
 */
async function weeklyRecap(db: Db): Promise<void> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const events = await db
    .select()
    .from(alertEvents)
    .where(gte(alertEvents.createdAt, since))
    .orderBy(desc(alertEvents.createdAt));

  const parts: string[] = [];

  if (events.length === 0) {
    parts.push("Alerts this week: none — all quiet.");
  } else {
    parts.push(`Alerts this week: ${events.length} total`);
    const byType = new Map<string, { count: number; emailed: number; latestSubject: string }>();
    for (const e of events) {
      const g = byType.get(e.type) ?? { count: 0, emailed: 0, latestSubject: e.subject };
      g.count += 1;
      if (e.emailSent) g.emailed += 1;
      byType.set(e.type, g);
    }
    for (const [type, g] of byType) {
      parts.push(`• ${type}: ${g.count}× (${g.emailed} emailed immediately) — latest: ${g.latestSubject}`);
    }
  }

  const unhealthy = await getUnhealthyCrons(db);
  if (unhealthy.length === 0) {
    parts.push("\nCron jobs: all enabled jobs healthy.");
  } else {
    parts.push(`\nCron jobs currently unhealthy: ${unhealthy.length}`);
    for (const j of unhealthy) {
      parts.push(`• ${j.jobName} (${j.ownerAgent})${j.lastError ? ` — ${j.lastError}` : " — stale"}`);
    }
  }

  const latestEval = getLatestEval();
  if (latestEval) {
    parts.push(`\nLatest eval: ${latestEval.passed}/${latestEval.totalTests} passed — ran ${latestEval.ranAt}`);
  }

  const allClear = events.length === 0 && unhealthy.length === 0;
  const headline = allClear
    ? "Weekly Ops Recap — all clear"
    : `Weekly Ops Recap — ${events.length} alert${events.length === 1 ? "" : "s"}, ${unhealthy.length} cron${unhealthy.length === 1 ? "" : "s"} unhealthy`;

  await sendAlert("weekly_recap", headline, parts.join("\n"));
}

export function startAlertCrons(db?: Db) {
  registerCronJob({ jobName: "alert:health-check", schedule: "*/5 * * * *", ownerAgent: "nova", sourceFile: "alert-crons.ts", handler: checkHealth });

  // Partner report & site health crons (require db)
  if (db) {
    setAlertDb(db); // persist every alert to alert_events for history + the weekly recap

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

    // Self-healing watchdog — every 15 min, record stale/erroring cron jobs.
    registerCronJob({
      jobName: "alert:cron-watchdog",
      schedule: "*/15 * * * *",
      ownerAgent: "nova",
      sourceFile: "alert-crons.ts",
      handler: async () => {
        await cronWatchdog(db);
        return { checked: true };
      },
    });

    // Weekly ops recap — Sunday 8 AM, the one scheduled ops email.
    registerCronJob({
      jobName: "alert:weekly-recap",
      schedule: "0 8 * * 0",
      ownerAgent: "nova",
      sourceFile: "alert-crons.ts",
      handler: async () => {
        await weeklyRecap(db);
        return { sent: true };
      },
    });
  }

  const jobCount = db ? 5 : 1;
  logger.info({ count: jobCount }, "Alert cron jobs registered");
}
