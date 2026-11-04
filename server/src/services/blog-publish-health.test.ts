// ---------------------------------------------------------------------------
// blog-publish-health — detection rule + once-per-outage dedup.
// The 2026-04-27 → 2026-11-03 cd outage (425 posts refused "Unauthorized")
// ran six months with no alert; these lock in that a run of failures alerts
// once, stays quiet while it lasts, and alerts again after a recovery.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  BLOG_TARGETS,
  alertBody,
  alertSubject,
  evaluateTargetHealth,
  needsAlert,
  type PublishAttempt,
} from "./blog-publish-health.js";

const H = 60 * 60 * 1000;
const T0 = Date.parse("2026-04-27T00:00:00Z");
const cd = BLOG_TARGETS[0];

/** "S" = success, "F" = failure, one attempt every `gapH` hours from T0. */
function attempts(pattern: string, gapH: number, error = "Unauthorized"): PublishAttempt[] {
  return [...pattern].map((c, i) => ({
    at: new Date(T0 + i * gapH * H),
    success: c === "S",
    error: c === "S" ? null : error,
  }));
}

/**
 * Replay the hourly cron: 30 min after each attempt, evaluate everything so far
 * (newest first) and record an alert when needsAlert says so, the same way
 * alert_events is consulted in production.
 */
function replay(history: PublishAttempt[]) {
  const alerts: Array<{ index: number; consecutiveFailures: number }> = [];
  const failingAfter: boolean[] = [];
  let lastAlertAt: Date | null = null;
  history.forEach((a, index) => {
    const now = new Date(a.at.getTime() + 0.5 * H);
    const seen = history.slice(0, index + 1).reverse();
    const health = evaluateTargetHealth(seen, now);
    failingAfter.push(health.failing);
    if (needsAlert(health, lastAlertAt)) {
      alerts.push({ index, consecutiveFailures: health.consecutiveFailures });
      lastAlertAt = now;
    }
  });
  return { alerts, failingAfter };
}

describe("blog publish health: failing, then recovering, then failing again", () => {
  // Hourly attempts, so the 24 h window always holds earlier successes and
  // only the consecutive-failures rule can fire.
  const pattern = "SSSSS" + "FFFFFFF" + "S" + "FFFFF";
  const { alerts, failingAfter } = replay(attempts(pattern, 1));

  it("stays quiet for 4 failures in a row", () => {
    expect(failingAfter.slice(5, 9)).toEqual([false, false, false, false]);
  });

  it("alerts once at the 5th failure and not again while the outage lasts", () => {
    expect(alerts[0]).toEqual({ index: 9, consecutiveFailures: 5 });
    expect(failingAfter.slice(9, 12)).toEqual([true, true, true]);
    expect(alerts.filter((a) => a.index >= 9 && a.index <= 11)).toHaveLength(1);
  });

  it("clears on the next success", () => {
    expect(failingAfter[12]).toBe(false);
  });

  it("alerts again for a new outage after the recovery", () => {
    expect(alerts).toEqual([
      { index: 9, consecutiveFailures: 5 },
      { index: 17, consecutiveFailures: 5 },
    ]);
  });
});

describe("blog publish health: 24 h window rule", () => {
  it("fires on 2 failed attempts in 24 h with no success, before 5 in a row", () => {
    // success, then two failures 48 h and 54 h later
    const history: PublishAttempt[] = [
      { at: new Date(T0), success: true, error: null },
      { at: new Date(T0 + 48 * H), success: false, error: "HTTP 502" },
      { at: new Date(T0 + 54 * H), success: false, error: "HTTP 503" },
    ];
    const { alerts, failingAfter } = replay(history);
    expect(failingAfter).toEqual([false, false, true]);
    expect(alerts).toEqual([{ index: 2, consecutiveFailures: 2 }]);
  });

  it("does not fire on one lone failure (the 2026-08-14 tokns-app case)", () => {
    const history: PublishAttempt[] = [
      { at: new Date(T0), success: true, error: null },
      { at: new Date(T0 + 40 * H), success: false, error: "Failed to save article" },
      { at: new Date(T0 + 44 * H), success: true, error: null },
    ];
    expect(replay(history).alerts).toEqual([]);
  });

  it("never fires for failures that alternate with successes (the 2026-05/07 sn slug clashes)", () => {
    expect(replay(attempts("SF".repeat(40), 2, "A post with this slug already exists")).alerts).toEqual([]);
  });
});

describe("blog publish health: once per outage across restarts", () => {
  const failing = evaluateTargetHealth(attempts("SFFFFF", 1).reverse(), new Date(T0 + 6 * H));
  const lastSuccessAt = new Date(T0);

  it("is failing with the success as the outage start", () => {
    expect(failing.failing).toBe(true);
    expect(failing.lastSuccessAt).toEqual(lastSuccessAt);
  });

  it("re-alerts only when the last alert predates the last success", () => {
    expect(needsAlert(failing, null)).toBe(true);
    expect(needsAlert(failing, new Date(T0 + 5.5 * H))).toBe(false); // alerted this outage
    expect(needsAlert(failing, new Date(T0 - H))).toBe(true); // alert was for an earlier outage
  });

  it("does not repeat for a target that never succeeded", () => {
    const never = evaluateTargetHealth(attempts("FFFFF", 1).reverse(), new Date(T0 + 5 * H));
    expect(never.lastSuccessAt).toBeNull();
    expect(needsAlert(never, null)).toBe(true);
    expect(needsAlert(never, new Date(T0 + 4.5 * H))).toBe(false);
  });
});

describe("blog publish health: alert text", () => {
  it("names the target, the count and the last error", () => {
    const h = evaluateTargetHealth(attempts("SFFFFF", 4).reverse(), new Date(T0 + 21 * H));
    expect(alertSubject(cd)).toBe("Blog publish failing: cd (coherencedaddy.com)");
    const body = alertBody(cd, h);
    expect(body).toContain('publish target "cd"');
    expect(body).toContain("Failed attempts in a row: 5");
    expect(body).toContain("Last success: 2026-04-27T00:00:00Z");
    expect(body).toContain("Last error: Unauthorized");
  });
});
