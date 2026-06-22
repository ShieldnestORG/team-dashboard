// ---------------------------------------------------------------------------
// Coherent Ones University — checkout route ad-attribution test (M2).
//
// Proves the optional `attribution` object on the checkout payload is plumbed
// end-to-end:
//   - the per-lead attribution row is upserted (best-effort) keyed on email;
//   - the click ids / UTM / landing context land in the Stripe Checkout Session
//     METADATA under SHORT `at_*` keys — and NOT in client_reference_id
//     (the referral branch owns that for its `ref` code);
//   - when `attribution` is absent, behaviour is byte-for-byte as before:
//     no upsert, no `at_*` metadata keys.
//
// Strategy mirrors university-checkout-referral.test.ts — mount the route on a
// minimal Express app with supertest and stub every boundary. The attribution
// upsert service is mocked so no DB is touched.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@paperclipai/db";

const LOOKUP_KEY = "university_monthly";

vi.mock("../services/stripe-client.js", () => ({
  stripeConfigured: vi.fn(() => true),
  universityStripeKey: vi.fn(() => "rk_test_university"),
  stripeRequest: vi.fn(async () => ({
    data: [{ id: "price_uni_test", active: true, lookup_key: LOOKUP_KEY }],
  })),
  verifyStripeSignature: vi.fn(() => true),
}));

const { checkoutSpy, upsertSpy } = vi.hoisted(() => ({
  checkoutSpy: vi.fn(async () => ({
    checkoutUrl: "https://checkout.stripe.test/session",
    sessionId: "cs_test_123",
  })),
  upsertSpy: vi.fn(async () => true),
}));
vi.mock("../services/stripe-checkout.js", () => ({
  createCheckoutSession: checkoutSpy,
}));
vi.mock("../services/university-attribution.js", () => ({
  upsertAttribution: upsertSpy,
}));

// eslint-disable-next-line import/first
import { universityCheckoutRoutes } from "../routes/university-checkout.ts";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/university", universityCheckoutRoutes({} as unknown as Db));
  return app;
}

describe("POST /api/university/checkout — ad attribution (M2)", () => {
  beforeEach(() => {
    checkoutSpy.mockClear();
    upsertSpy.mockClear();
  });

  it("upserts the attribution row and flattens fields into at_* metadata (NOT client_reference_id)", async () => {
    const res = await request(makeApp())
      .post("/api/university/checkout")
      .send({
        email: "Member@Example.com",
        attribution: {
          fbclid: "fb.1.123",
          fbc: "fb.1.123.abc",
          fbp: "fb.1.111.def",
          ttclid: "ttclid-xyz",
          gclid: "gclid-789",
          utm_source: "facebook",
          utm_medium: "cpc",
          utm_campaign: "summer",
          utm_content: "ad-a",
          utm_term: "coherence",
          landing_url: "https://coherencedaddy.com/university?x=1",
          referrer: "https://l.facebook.com/",
        },
      });

    expect(res.status).toBe(200);

    // (a) attribution row upserted, keyed on the lowercased email.
    expect(upsertSpy).toHaveBeenCalledTimes(1);
    const [, upsertEmail, upsertInput] = upsertSpy.mock.calls[0] as [
      unknown,
      string,
      Record<string, string>,
    ];
    expect(upsertEmail).toBe("member@example.com");
    expect(upsertInput.utmSource).toBe("facebook");
    expect(upsertInput.landingUrl).toBe(
      "https://coherencedaddy.com/university?x=1",
    );

    // (b) fields flattened into SHORT at_* metadata keys.
    const opts = checkoutSpy.mock.calls[0][0] as {
      clientReferenceId?: string;
      metadata: Record<string, string>;
    };
    expect(opts.metadata.at_fbclid).toBe("fb.1.123");
    expect(opts.metadata.at_utm_campaign).toBe("summer");
    expect(opts.metadata.at_landing_url).toBe(
      "https://coherencedaddy.com/university?x=1",
    );
    // Existing product metadata still present.
    expect(opts.metadata.product).toBe("university");

    // (c) attribution must NEVER touch client_reference_id (referral owns it).
    expect(opts.clientReferenceId).toBeUndefined();
  });

  it("only emits at_* keys for present fields; absent attribution is fully backward-compatible", async () => {
    // Partial attribution.
    const partial = await request(makeApp())
      .post("/api/university/checkout")
      .send({
        email: "a@b.com",
        attribution: { utm_source: "ig", fbclid: "" },
      });
    expect(partial.status).toBe(200);
    const partialOpts = checkoutSpy.mock.calls[0][0] as {
      metadata: Record<string, string>;
    };
    expect(partialOpts.metadata.at_utm_source).toBe("ig");
    // Empty-string field is dropped, not emitted as "".
    expect(partialOpts.metadata.at_fbclid).toBeUndefined();

    checkoutSpy.mockClear();
    upsertSpy.mockClear();

    // No attribution at all — no upsert, no at_* keys.
    const none = await request(makeApp())
      .post("/api/university/checkout")
      .send({ email: "a@b.com" });
    expect(none.status).toBe(200);
    expect(upsertSpy).not.toHaveBeenCalled();
    const noneOpts = checkoutSpy.mock.calls[0][0] as {
      metadata: Record<string, string>;
    };
    const atKeys = Object.keys(noneOpts.metadata).filter((k) =>
      k.startsWith("at_"),
    );
    expect(atKeys).toEqual([]);
  });
});
