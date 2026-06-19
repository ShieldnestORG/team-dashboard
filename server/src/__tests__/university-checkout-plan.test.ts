// ---------------------------------------------------------------------------
// Coherent Ones University — annual-plan price resolution tests.
//
// resolveUniversityPriceId(plan, secretKey) picks the right Stripe price for
// the chosen plan. We assert:
//   1. monthly resolves via the university_monthly lookup_key
//   2. annual resolves via the university_annual lookup_key
//   3. each falls back to its OWN env var (UNIVERSITY_STRIPE_PRICE_ID /
//      UNIVERSITY_ANNUAL_PRICE_ID) when the lookup_key returns nothing
//   4. annual throws a clear error naming UNIVERSITY_ANNUAL_PRICE_ID when
//      neither resolves (so a missing annual price surfaces, not a silent
//      fall-through to the monthly price)
//
// The Stripe REST client is mocked so no network is touched and we can inspect
// which lookup_key each call requested.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stripeRequestSpy = vi.fn();
vi.mock("../services/stripe-client.js", () => ({
  stripeRequest: (...args: unknown[]) => stripeRequestSpy(...args),
  stripeConfigured: () => true,
  verifyStripeSignature: () => true,
  universityStripeKey: () => "sk_test_university",
}));

import { resolveUniversityPriceId } from "../routes/university-checkout.js";
import { PLAN_MONTHLY, PLAN_ANNUAL } from "../services/university-founding.js";

const ENV_MONTHLY = "UNIVERSITY_STRIPE_PRICE_ID";
const ENV_ANNUAL = "UNIVERSITY_ANNUAL_PRICE_ID";
const origMonthly = process.env[ENV_MONTHLY];
const origAnnual = process.env[ENV_ANNUAL];

beforeEach(() => {
  stripeRequestSpy.mockReset();
  delete process.env[ENV_MONTHLY];
  delete process.env[ENV_ANNUAL];
});
afterEach(() => {
  if (origMonthly === undefined) delete process.env[ENV_MONTHLY];
  else process.env[ENV_MONTHLY] = origMonthly;
  if (origAnnual === undefined) delete process.env[ENV_ANNUAL];
  else process.env[ENV_ANNUAL] = origAnnual;
});

describe("resolveUniversityPriceId — lookup_key path", () => {
  it("monthly resolves via the university_monthly lookup_key", async () => {
    stripeRequestSpy.mockResolvedValueOnce({
      data: [{ id: "price_monthly", active: true, lookup_key: "university_monthly" }],
    });
    const id = await resolveUniversityPriceId(PLAN_MONTHLY, "sk_test");
    expect(id).toBe("price_monthly");
    const url = stripeRequestSpy.mock.calls[0]![1] as string;
    expect(url).toContain("university_monthly");
  });

  it("annual resolves via the university_annual lookup_key", async () => {
    stripeRequestSpy.mockResolvedValueOnce({
      data: [{ id: "price_annual", active: true, lookup_key: "university_annual" }],
    });
    const id = await resolveUniversityPriceId(PLAN_ANNUAL, "sk_test");
    expect(id).toBe("price_annual");
    const url = stripeRequestSpy.mock.calls[0]![1] as string;
    expect(url).toContain("university_annual");
  });
});

describe("resolveUniversityPriceId — env-var fallback", () => {
  it("monthly falls back to UNIVERSITY_STRIPE_PRICE_ID", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] }); // no lookup match
    process.env[ENV_MONTHLY] = "price_env_monthly";
    const id = await resolveUniversityPriceId(PLAN_MONTHLY, "sk_test");
    expect(id).toBe("price_env_monthly");
  });

  it("annual falls back to UNIVERSITY_ANNUAL_PRICE_ID", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] }); // no lookup match
    process.env[ENV_ANNUAL] = "price_env_annual";
    const id = await resolveUniversityPriceId(PLAN_ANNUAL, "sk_test");
    expect(id).toBe("price_env_annual");
  });

  it("annual does NOT fall back to the monthly env var", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    process.env[ENV_MONTHLY] = "price_env_monthly"; // only monthly env set
    await expect(resolveUniversityPriceId(PLAN_ANNUAL, "sk_test")).rejects.toThrow(
      /UNIVERSITY_ANNUAL_PRICE_ID/,
    );
  });

  it("defaults to the monthly plan when called with no plan arg", async () => {
    stripeRequestSpy.mockResolvedValueOnce({ data: [] });
    process.env[ENV_MONTHLY] = "price_env_monthly";
    const id = await resolveUniversityPriceId(undefined, "sk_test");
    expect(id).toBe("price_env_monthly");
  });
});
