import { describe, expect, it } from "vitest";
import {
  MAX_CONSECUTIVE_IMMEDIATE_FAILURES,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_DELAY_MS,
  classifyDisconnect,
  computeBackoffDelayMs,
  shouldProbeSession,
} from "./liveReconnect";

describe("computeBackoffDelayMs", () => {
  it("stays close to 1s on the first attempt (fast reconnect)", () => {
    const delay = computeBackoffDelayMs(1, () => 0.5);
    expect(delay).toBe(RECONNECT_BASE_DELAY_MS);
  });

  it("grows exponentially with attempt count", () => {
    const noJitter = () => 0.5; // multiplier of exactly 1.0
    expect(computeBackoffDelayMs(2, noJitter)).toBe(2000);
    expect(computeBackoffDelayMs(3, noJitter)).toBe(4000);
    expect(computeBackoffDelayMs(4, noJitter)).toBe(8000);
  });

  it("caps at 5 minutes even for very high attempt counts", () => {
    expect(computeBackoffDelayMs(30, () => 0.5)).toBe(RECONNECT_MAX_DELAY_MS);
    expect(computeBackoffDelayMs(1000, () => 0.5)).toBe(RECONNECT_MAX_DELAY_MS);
  });

  it("applies jitter within +/-20% of the unjittered value", () => {
    const low = computeBackoffDelayMs(3, () => 0);
    const high = computeBackoffDelayMs(3, () => 0.999999);
    expect(low).toBeGreaterThanOrEqual(3200); // 4000 * 0.8
    expect(high).toBeLessThanOrEqual(4800); // 4000 * 1.2
  });

  it("treats attempt numbers below 1 as attempt 1", () => {
    expect(computeBackoffDelayMs(0, () => 0.5)).toBe(RECONNECT_BASE_DELAY_MS);
    expect(computeBackoffDelayMs(-5, () => 0.5)).toBe(RECONNECT_BASE_DELAY_MS);
  });
});

describe("classifyDisconnect", () => {
  it("classifies a socket that never opened, or closed fast, as an immediate failure", () => {
    expect(classifyDisconnect(0)).toBe("immediate-failure");
    expect(classifyDisconnect(4999)).toBe("immediate-failure");
  });

  it("classifies long-lived connections as healthy drops", () => {
    expect(classifyDisconnect(60_000)).toBe("healthy-drop");
    expect(classifyDisconnect(120_000)).toBe("healthy-drop");
  });

  it("classifies mid-length connections as partial drops", () => {
    expect(classifyDisconnect(5000)).toBe("partial-drop");
    expect(classifyDisconnect(59_999)).toBe("partial-drop");
  });
});

describe("shouldProbeSession", () => {
  it("does not probe below the threshold", () => {
    expect(shouldProbeSession(0)).toBe(false);
    expect(shouldProbeSession(MAX_CONSECUTIVE_IMMEDIATE_FAILURES - 1)).toBe(false);
  });

  it("probes once the threshold is reached", () => {
    expect(shouldProbeSession(MAX_CONSECUTIVE_IMMEDIATE_FAILURES)).toBe(true);
    expect(shouldProbeSession(MAX_CONSECUTIVE_IMMEDIATE_FAILURES + 5)).toBe(true);
  });
});
