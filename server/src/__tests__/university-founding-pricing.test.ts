// ---------------------------------------------------------------------------
// Coherent Ones University — Founding-100 PRICE SWITCH tests.
//
// 0129 gave us WHO is a founder (the `founding` flag + count); this suite
// covers the revenue-integrity layer added on top: WHAT gets charged.
//   1. resolveUniversityFoundingPrice returns the price id + unit_amount
//      (lookup path) and the documented default cents (env-id path)
//   2. resolveUniversityStandardPrice resolves university_monthly_standard by
//      lookup_key, falls back to UNIVERSITY_STRIPE_STANDARD_PRICE_ID, and
//      returns null (NOT the founding price) when neither is configured —
//      the checkout route fails closed on null
//   3. standard annual returns null until the owner prices it
//   4. the tier boundary semantics (count < cap) — member #100 is the last
//      founder, #101 pays standard (via isFoundingEligible, the same pure
//      gate the checkout route + webhook share)
//
// The Stripe REST client is mocked so no network is touched (mirrors
// university-checkout-plan.test.ts).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stripeRequestSpy = vi.fn();
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: (...args: unknown[]) => stripeRequestSpy(...args),
  stripeConfigured: () => true,
  verifyStripeSignature: () => true,
  universityStripeKey: () => "sk_test_university",
}));

import {
  resolveUniversityFoundingPrice,
  resolveUniversityStandardPrice,
} from "../routes/university-checkout.js";
import {
  PLAN_MONTHLY,
  PLAN_ANNUAL,
  isFoundingEligible,
} from "../services/university-founding.js";

const ENV_MONTHLY = "UNIVERSITY_STRIPE_PRICE_ID";
const ENV_STANDARD = "UNIVERSITY_STRIPE_STANDARD_PRICE_ID";
const ENV_ANNUAL_STANDARD = "UNIVERSITY_ANNUAL_STANDARD_PRICE_ID";
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  stripeRequestSpy.mockReset();
  for (const k of [ENV_MONTHLY, ENV_STANDARD, ENV_ANNUAL_STANDARD]) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterEach(() => {
  for (const k of [ENV_MONTHLY, ENV_STANDARD, ENV_ANNUAL_STANDARD]) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveUniversityFoundingPrice", () => {
  it("returns id + unit_amount from the lookup path", async () => {
    stripeRequestSpy.mockResolvedValueOnce({
      data: [
        {
          id: "price_founding",
          active: true,
          lookup_key: "university_monthly",
          unit_amount: 5000,
        },
      ],
    });
    const p = await resolveUniversityFoundingPrice(PLAN_MONTHLY, "sk_test");
    expect(p).toEqual({ id: "price_founding", unitAmountCents: 5000 });
  });

  it("env-id path records the documented default cents", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    process.env[ENV_MONTHLY] = "price_env_founding";
    const p = await resolveUniversityFoundingPrice(PLAN_MONTHLY, "sk_test");
    expect(p).toEqual({ id: "price_env_founding", unitAmountCents: 5000 });
  });
});

describe("resolveUniversityStandardPrice — the $79 tier", () => {
  it("resolves via the university_monthly_standard lookup_key", async () => {
    stripeRequestSpy.mockResolvedValueOnce({
      data: [
        {
          id: "price_standard",
          active: true,
          lookup_key: "university_monthly_standard",
          unit_amount: 7900,
        },
      ],
    });
    const p = await resolveUniversityStandardPrice(PLAN_MONTHLY, "sk_test");
    expect(p).toEqual({ id: "price_standard", unitAmountCents: 7900 });
    const url = stripeRequestSpy.mock.calls[0]![1] as string;
    expect(url).toContain("university_monthly_standard");
  });

  it("falls back to UNIVERSITY_STRIPE_STANDARD_PRICE_ID with $79 default cents", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    process.env[ENV_STANDARD] = "price_env_standard";
    const p = await resolveUniversityStandardPrice(PLAN_MONTHLY, "sk_test");
    expect(p).toEqual({ id: "price_env_standard", unitAmountCents: 7900 });
  });

  it("returns null when unconfigured — NEVER the founding price (fail-closed contract)", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    process.env[ENV_MONTHLY] = "price_env_founding"; // founding IS configured
    const p = await resolveUniversityStandardPrice(PLAN_MONTHLY, "sk_test");
    expect(p).toBeNull();
  });

  it("standard annual returns null until the owner prices it", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    const p = await resolveUniversityStandardPrice(PLAN_ANNUAL, "sk_test");
    expect(p).toBeNull();
  });

  it("standard annual resolves once the owner creates the lookup_key", async () => {
    stripeRequestSpy.mockResolvedValueOnce({
      data: [
        {
          id: "price_annual_standard",
          active: true,
          lookup_key: "university_annual_standard",
          unit_amount: 79000,
        },
      ],
    });
    const p = await resolveUniversityStandardPrice(PLAN_ANNUAL, "sk_test");
    expect(p).toEqual({ id: "price_annual_standard", unitAmountCents: 79000 });
  });
});

describe("founding tier boundary (count < cap)", () => {
  // The checkout route charges the founding price iff
  // isFoundingEligible(count, cap) — with cap=100, existingCount 0..99 are
  // founding (member #100 is the 100th founder); at existingCount=100 the
  // window is closed and member #101 pays the standard price.
  it("member #100 still gets the founding price, #101 does not", () => {
    expect(isFoundingEligible(99, 100)).toBe(true); // → the 100th founder
    expect(isFoundingEligible(100, 100)).toBe(false); // → #101 pays $79
  });
});
