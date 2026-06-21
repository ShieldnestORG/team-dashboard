// ---------------------------------------------------------------------------
// Coherent Ones University — checkout route referral-attribution test.
//
// Proves the landing-page `ref` (referral code) is plumbed end-to-end into the
// Stripe checkout session:
//   - when the body includes `ref`, the session is created with
//     client_reference_id = ref AND metadata.referral_code = ref;
//   - when `ref` is absent, NEITHER is set.
//
// Strategy (mirrors commission-webhook.test.ts): mount universityCheckoutRoutes
// on a minimal Express app with supertest and stub every boundary —
//   - ../services/stripe-client.js  — stripeConfigured()=true,
//     universityStripeKey()=a fake key, stripeRequest() returns a price whose
//     lookup_key matches so resolveUniversityPriceId resolves without env vars.
//   - ../services/stripe-checkout.js — createCheckoutSession is a spy that
//     captures the options it was called with (we assert on those).
// No DB is touched (the route only does `void db`); a bare {} stub suffices.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

const LOOKUP_KEY = "university_monthly";

vi.mock("../services/stripe-client.js", () => ({
  stripeConfigured: vi.fn(() => true),
  universityStripeKey: vi.fn(() => "rk_test_university"),
  // resolveUniversityPriceId calls this to look up the price by lookup_key.
  stripeRequest: vi.fn(async () => ({
    data: [{ id: "price_uni_test", active: true, lookup_key: LOOKUP_KEY }],
  })),
  verifyStripeSignature: vi.fn(() => true),
}));

// createCheckoutSession is the boundary we assert on — capture its options.
// vi.hoisted so the spy exists before the hoisted vi.mock factory runs.
const { checkoutSpy } = vi.hoisted(() => ({
  checkoutSpy: vi.fn(async () => ({
    checkoutUrl: "https://checkout.stripe.test/session",
    sessionId: "cs_test_123",
  })),
}));
vi.mock("../services/stripe-checkout.js", () => ({
  createCheckoutSession: checkoutSpy,
}));

// Import AFTER the mocks so the route module binds the mocked services.
// eslint-disable-next-line import/first
import { universityCheckoutRoutes } from "../routes/university-checkout.ts";

function makeApp() {
  const app = express();
  app.use(express.json());
  // The route never touches db (it only does `void db`); a bare stub is fine.
  app.use("/api/university", universityCheckoutRoutes({} as unknown as Db));
  return app;
}

describe("POST /api/university/checkout — referral attribution", () => {
  beforeEach(() => {
    checkoutSpy.mockClear();
  });

  it("plumbs `ref` into client_reference_id AND metadata.referral_code", async () => {
    const res = await request(makeApp())
      .post("/api/university/checkout")
      .send({ email: "Member@Example.com", ref: "ABC123" });

    expect(res.status).toBe(200);
    expect(checkoutSpy).toHaveBeenCalledTimes(1);
    const opts = checkoutSpy.mock.calls[0][0] as {
      clientReferenceId?: string;
      metadata: Record<string, string>;
    };
    expect(opts.clientReferenceId).toBe("ABC123");
    expect(opts.metadata.referral_code).toBe("ABC123");
  });

  it("sets NEITHER client_reference_id NOR metadata.referral_code when `ref` is absent", async () => {
    const res = await request(makeApp())
      .post("/api/university/checkout")
      .send({ email: "Member@Example.com" });

    expect(res.status).toBe(200);
    expect(checkoutSpy).toHaveBeenCalledTimes(1);
    const opts = checkoutSpy.mock.calls[0][0] as {
      clientReferenceId?: string;
      metadata: Record<string, string>;
    };
    expect(opts.clientReferenceId).toBeUndefined();
    expect(opts.metadata.referral_code).toBeUndefined();
  });
});
