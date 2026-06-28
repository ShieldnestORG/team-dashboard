import { describe, it, expect } from "vitest";

import {
  computeStaleness,
  estimateIntervalMs,
} from "../services/automation-health.js";
import type { CronJobState } from "../services/cron-registry.js";

// ---------------------------------------------------------------------------
// automation-health staleness heuristic — monthly false-positive regression.
//
// The 2026-06-23 cron_stale alert flagged TEN perfectly healthy monthly crons
// (affiliate:*, creditscore:*, directory:mentions:generate, owned-sites:*,
// reports:partner-metrics — all "0 H 1 * *") as "critically stale (no recent
// run)". They had each run on the 1st and were not due until the 1st of the
// next month, but estimateIntervalMs() bucketed a "1st-of-month" cron as a
// 7-day weekly interval, so the 2.5×-interval (=17.5d) "critical" threshold
// tripped for ~13 days of every month. That noise also buried a real failure
// (memory:embed) that wasn't in the alert. These tests pin the monthly cadence.
// ---------------------------------------------------------------------------

const DAY = 24 * 60 * 60 * 1000;

function job(partial: Partial<CronJobState>): CronJobState {
  return {
    jobName: "test:job",
    schedule: "0 9 1 * *",
    scheduleOverride: null,
    ownerAgent: "test",
    sourceFile: "test.ts",
    enabled: true,
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null,
    nextRunAt: null,
    runCount: 0,
    errorCount: 0,
    running: false,
    ...partial,
  };
}

describe("estimateIntervalMs", () => {
  it("treats a 1st-of-month cron as ~monthly (30d), not weekly", () => {
    expect(estimateIntervalMs("0 9 1 * *")).toBe(30 * DAY);
  });

  it("treats a twice-monthly cron (1st + 15th) as ~15d", () => {
    expect(estimateIntervalMs("0 0 1,15 * *")).toBe(15 * DAY);
  });

  it("leaves weekly (DOW-restricted) jobs at 7d", () => {
    expect(estimateIntervalMs("0 9 * * 1")).toBe(7 * DAY);
  });

  it("leaves twice-weekly (Wed+Sat) jobs at ceil(7/2)=4d", () => {
    expect(estimateIntervalMs("0 10 * * 3,6")).toBe(4 * DAY);
  });

  it("leaves daily jobs at 1d", () => {
    expect(estimateIntervalMs("0 3 * * *")).toBe(DAY);
  });

  it("leaves hourly jobs at 1h", () => {
    expect(estimateIntervalMs("0 * * * *")).toBe(60 * 60 * 1000);
  });

  it("leaves every-minute jobs at 1m", () => {
    expect(estimateIntervalMs("* * * * *")).toBe(60 * 1000);
  });
});

describe("computeStaleness — monthly false-positive regression", () => {
  it("a monthly job that ran on the 1st is 'ok' on the 23rd (the alert scenario)", () => {
    const j = job({ schedule: "0 9 1 * *", lastRunAt: "2026-06-01T09:02:00.000Z" });
    expect(computeStaleness(j, new Date("2026-06-23T10:02:00.000Z"))).toBe("ok");
  });

  it("a monthly job stays 'ok' even at the very end of its month", () => {
    const j = job({ schedule: "0 9 1 * *", lastRunAt: "2026-06-01T09:02:00.000Z" });
    expect(computeStaleness(j, new Date("2026-06-30T23:00:00.000Z"))).toBe("ok");
  });

  it("still flags a monthly job genuinely missed for ~3 months (critical)", () => {
    const j = job({ schedule: "0 9 1 * *", lastRunAt: "2026-04-01T09:02:00.000Z" });
    expect(computeStaleness(j, new Date("2026-06-25T10:00:00.000Z"))).toBe("critical");
  });

  it("still flags a daily job that has not run in 3 days (critical)", () => {
    const j = job({ schedule: "0 3 * * *", lastRunAt: "2026-06-20T03:00:00.000Z" });
    expect(computeStaleness(j, new Date("2026-06-23T03:00:00.000Z"))).toBe("critical");
  });

  it("disabled jobs are always 'ok' regardless of age", () => {
    const j = job({ enabled: false, lastRunAt: "2020-01-01T00:00:00.000Z" });
    expect(computeStaleness(j, new Date("2026-06-23T00:00:00.000Z"))).toBe("ok");
  });
});
