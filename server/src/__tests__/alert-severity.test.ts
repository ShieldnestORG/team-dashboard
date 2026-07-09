import { describe, it, expect } from "vitest";

import { alertSeverity } from "../services/alerting.js";

// Severity routing is the contract that keeps the ops inbox quiet: routine
// types must never email immediately (they surface in the Sunday weekly
// recap), and outage-class types must always email.
describe("alertSeverity routing", () => {
  it("routes noisy watchdog/eval types to routine (weekly recap only)", () => {
    expect(alertSeverity("cron_stale")).toBe("routine");
    expect(alertSeverity("eval_failed")).toBe("routine");
  });

  it("keeps outage, breaker, and recap types critical (immediate email)", () => {
    for (const type of [
      "service_down",
      "service_recovered",
      "health_down",
      "disk_warning",
      "memory_warning",
      "cron_breaker",
      "weekly_recap",
    ] as const) {
      expect(alertSeverity(type)).toBe("critical");
    }
  });
});
