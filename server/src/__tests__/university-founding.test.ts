// ---------------------------------------------------------------------------
// Coherent Ones University — founding-member price-lock logic tests.
//
// The founding flag is the load-bearing promise ("rate locked for life"), so
// the eligibility math gets pure-function TDD coverage independent of the DB:
//
//   1. isFoundingEligible(count, cap) — the gate: a new member is a founder
//      iff the EXISTING member count is below the cap (count < cap). count is
//      the number of members BEFORE this one, so the Nth founder (count=N-1)
//      is in and the (N+1)th (count=N) is out.
//   2. foundingCap() — reads UNIVERSITY_FOUNDING_CAP, defaults to 100, and is
//      defensive against junk / non-positive values.
//   3. resolvePlanKey(plan) — normalizes the checkout 'plan' param to a stable
//      plan key, defaulting to monthly for anything unrecognized.
// ---------------------------------------------------------------------------

import { describe, it, expect, afterEach } from "vitest";
import {
  isFoundingEligible,
  foundingCap,
  resolvePlanKey,
  DEFAULT_FOUNDING_CAP,
  PLAN_MONTHLY,
  PLAN_ANNUAL,
} from "../services/university-founding.js";

describe("isFoundingEligible", () => {
  it("is true while the existing count is below the cap", () => {
    expect(isFoundingEligible(0, 100)).toBe(true); // 1st member
    expect(isFoundingEligible(99, 100)).toBe(true); // 100th member (count=99)
  });

  it("is false once the count reaches or exceeds the cap", () => {
    expect(isFoundingEligible(100, 100)).toBe(false); // 101st member
    expect(isFoundingEligible(150, 100)).toBe(false);
  });

  it("is never eligible when the cap is zero or negative (founding disabled)", () => {
    expect(isFoundingEligible(0, 0)).toBe(false);
    expect(isFoundingEligible(0, -5)).toBe(false);
  });
});

describe("foundingCap", () => {
  const KEY = "UNIVERSITY_FOUNDING_CAP";
  const original = process.env[KEY];
  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it("defaults to 100 when unset", () => {
    delete process.env[KEY];
    expect(foundingCap()).toBe(DEFAULT_FOUNDING_CAP);
    expect(DEFAULT_FOUNDING_CAP).toBe(100);
  });

  it("reads a positive integer from the env", () => {
    process.env[KEY] = "250";
    expect(foundingCap()).toBe(250);
  });

  it("allows 0 to fully disable the founding offer", () => {
    process.env[KEY] = "0";
    expect(foundingCap()).toBe(0);
  });

  it("falls back to the default on junk / non-numeric values", () => {
    process.env[KEY] = "not-a-number";
    expect(foundingCap()).toBe(DEFAULT_FOUNDING_CAP);
  });

  it("falls back to the default on negative values", () => {
    process.env[KEY] = "-10";
    expect(foundingCap()).toBe(DEFAULT_FOUNDING_CAP);
  });
});

describe("resolvePlanKey", () => {
  it("maps the annual selector to the annual plan key", () => {
    expect(resolvePlanKey("annual")).toBe(PLAN_ANNUAL);
    expect(resolvePlanKey("university_annual")).toBe(PLAN_ANNUAL);
    expect(resolvePlanKey("ANNUAL")).toBe(PLAN_ANNUAL); // case-insensitive
    expect(resolvePlanKey("year")).toBe(PLAN_ANNUAL);
    expect(resolvePlanKey("yearly")).toBe(PLAN_ANNUAL);
  });

  it("maps the monthly selector (and the default/empty case) to the monthly plan key", () => {
    expect(resolvePlanKey("monthly")).toBe(PLAN_MONTHLY);
    expect(resolvePlanKey("university_monthly")).toBe(PLAN_MONTHLY);
    expect(resolvePlanKey("")).toBe(PLAN_MONTHLY);
    expect(resolvePlanKey(undefined)).toBe(PLAN_MONTHLY);
  });

  it("defaults unrecognized values to monthly (fail safe to the cheaper plan)", () => {
    expect(resolvePlanKey("garbage")).toBe(PLAN_MONTHLY);
    expect(resolvePlanKey("annual_lifetime_pro")).toBe(PLAN_MONTHLY);
  });

  it("exposes the stable plan-key constants", () => {
    expect(PLAN_MONTHLY).toBe("university_monthly");
    expect(PLAN_ANNUAL).toBe("university_annual");
  });
});
