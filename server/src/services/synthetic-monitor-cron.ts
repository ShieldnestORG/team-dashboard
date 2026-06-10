// ---------------------------------------------------------------------------
// Synthetic monitor cron registration.
//
// Job:    monitor:synthetic-canary
// When:   Every 15 minutes.
// Owner:  nova (the ops/monitoring agent that already owns vps-monitor).
//
// Wires the prebuilt Playwright canary in `synthetic-monitor.ts` to the cron
// registry. Renders each key public URL in a real browser and flags console
// errors / page errors / broken images / non-2xx status / load time — the
// regressions the HTTP-HEAD `vps-monitor.ts` cannot see.
//
// GATED OFF BY DEFAULT. The cron is only registered when
// `SYNTHETIC_MONITOR_ENABLED=true`, so a deploy with the flag unset registers
// no job, runs nothing, and changes nothing. The operator opts in explicitly.
//
// Flakiness guard: a single failed canary does NOT alert. We track consecutive
// failures per URL in-process and only fire `sendAlert` once a URL has failed
// `ALERT_AFTER_CONSECUTIVE_FAILURES` ticks in a row. A passing run resets the
// counter (and fires a one-time recovery alert if the URL had been alerting).
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendAlert } from "./alerting.js";
import {
  runSyntheticBatch,
  syntheticMonitorEnabled,
  type SyntheticCheckResult,
} from "./synthetic-monitor.js";
import { logger } from "../middleware/logger.js";

const SCHEDULE = "*/15 * * * *"; // every 15 minutes
const ALERT_AFTER_CONSECUTIVE_FAILURES = 2;

// Default public surfaces to canary. Override with a comma-separated
// SYNTHETIC_MONITOR_URLS env var (whitespace + empties trimmed).
const DEFAULT_URLS = [
  "https://coherencedaddy.com",
  "https://creditscore.coherencedaddy.com",
  "https://affiliates.coherencedaddy.com",
  "https://directory.coherencedaddy.com",
];

export function getSyntheticMonitorUrls(): string[] {
  const raw = process.env.SYNTHETIC_MONITOR_URLS;
  if (!raw) return DEFAULT_URLS;
  const urls = raw
    .split(",")
    .map((u) => u.trim())
    .filter((u) => u.length > 0);
  return urls.length > 0 ? urls : DEFAULT_URLS;
}

// Per-URL consecutive-failure tracking, scoped to this process. Keyed by URL.
const consecutiveFailures = new Map<string, number>();
const alerting = new Set<string>();

/** Build a short human-readable reason for why a canary result is `ok: false`. */
function failureReason(result: SyntheticCheckResult): string {
  const parts: string[] = [];
  if (result.httpStatus === null || result.httpStatus < 200 || result.httpStatus >= 400) {
    parts.push(`status ${result.httpStatus ?? "unreachable"}`);
  }
  if (result.consoleErrorCount > 0) parts.push(`${result.consoleErrorCount} console error(s)`);
  if (result.pageErrorCount > 0) parts.push(`${result.pageErrorCount} page error(s)`);
  if (result.brokenImageCount > 0) parts.push(`${result.brokenImageCount} broken image(s)`);
  return parts.length > 0 ? parts.join(", ") : "failed";
}

/**
 * Exported for tests — runs one canary batch and applies the consecutive-failure
 * alerting policy. Returns a per-URL summary so callers can assert behavior
 * without reaching into module state.
 */
export async function runSyntheticMonitorTick(): Promise<{
  checked: number;
  failing: number;
  alertsFired: number;
}> {
  const urls = getSyntheticMonitorUrls();
  const results = await runSyntheticBatch(urls);

  let failing = 0;
  let alertsFired = 0;

  for (const result of results) {
    if (result.ok) {
      // Recovery: clear the streak and, if we had been alerting, say so once.
      const wasAlerting = alerting.delete(result.url);
      consecutiveFailures.delete(result.url);
      if (wasAlerting) {
        await sendAlert(
          "service_recovered",
          `Synthetic canary RECOVERED: ${result.url}`,
          `${result.url} is rendering cleanly again.\nLoad time: ${result.loadTimeMs}ms · HTTP ${result.httpStatus}`,
        );
        alertsFired += 1;
      }
      continue;
    }

    failing += 1;
    const streak = (consecutiveFailures.get(result.url) ?? 0) + 1;
    consecutiveFailures.set(result.url, streak);

    if (streak >= ALERT_AFTER_CONSECUTIVE_FAILURES && !alerting.has(result.url)) {
      alerting.add(result.url);
      const reason = failureReason(result);
      const sampleErrors = [...result.consoleErrors, ...result.pageErrors]
        .slice(0, 5)
        .map((e) => `  - ${e}`)
        .join("\n");
      await sendAlert(
        "health_down",
        `Synthetic canary FAILING: ${result.url}`,
        [
          `${result.url} has failed ${streak} consecutive synthetic checks.`,
          `Reason: ${reason}`,
          `HTTP status: ${result.httpStatus ?? "unreachable"}`,
          `Load time: ${result.loadTimeMs}ms`,
          sampleErrors ? `\nSample errors:\n${sampleErrors}` : "",
        ].join("\n"),
      );
      alertsFired += 1;
    }
  }

  return { checked: results.length, failing, alertsFired };
}

/**
 * Registers the synthetic-canary cron. NO-OP unless SYNTHETIC_MONITOR_ENABLED
 * is true — so an un-flagged deploy registers nothing and behaves identically
 * to before. Callers can invoke this unconditionally at startup.
 */
export function startSyntheticMonitorCron(_db: Db): void {
  if (!syntheticMonitorEnabled()) {
    logger.info(
      "Synthetic monitor cron not registered (SYNTHETIC_MONITOR_ENABLED is not 'true')",
    );
    return;
  }

  registerCronJob({
    jobName: "monitor:synthetic-canary",
    schedule: SCHEDULE,
    ownerAgent: "nova",
    sourceFile: "synthetic-monitor-cron.ts",
    handler: async () => {
      const summary = await runSyntheticMonitorTick();
      logger.info(summary, "synthetic monitor: canary batch complete");
    },
  });

  logger.info(
    { urls: getSyntheticMonitorUrls() },
    "Synthetic monitor cron registered (every 15 min)",
  );
}
