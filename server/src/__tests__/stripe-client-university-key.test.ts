// ---------------------------------------------------------------------------
// stripe-client.universityStripeKey() — fail-closed-in-production test.
//
// University bills on a SEPARATE Stripe account (Starwise). If
// UNIVERSITY_STRIPE_SECRET_KEY is unset, falling back to the shared
// STRIPE_SECRET_KEY would land University money in the wrong (Coherence Daddy /
// Exegesis) account. So in production the University key is REQUIRED and a
// missing one throws; outside production the shared-key fallback is preserved
// for single-account local/dev/test.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { universityStripeKey } from "../services/stripe-client.js";

describe("universityStripeKey", () => {
  const saved = {
    UNIVERSITY_STRIPE_SECRET_KEY: process.env.UNIVERSITY_STRIPE_SECRET_KEY,
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };

  beforeEach(() => {
    delete process.env.UNIVERSITY_STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
  });

  afterEach(() => {
    // Restore the original environment so we don't leak into other suites.
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns the University key when set (any environment)", () => {
    process.env.NODE_ENV = "production";
    process.env.UNIVERSITY_STRIPE_SECRET_KEY = "  rk_live_university  ";
    process.env.STRIPE_SECRET_KEY = "rk_live_shared";
    // Trimmed, and NOT the shared key.
    expect(universityStripeKey()).toBe("rk_live_university");
  });

  it("FAILS CLOSED in production: throws when the University key is missing (does NOT fall back to the shared key)", () => {
    process.env.NODE_ENV = "production";
    process.env.STRIPE_SECRET_KEY = "rk_live_shared";
    expect(() => universityStripeKey()).toThrowError(
      /UNIVERSITY_STRIPE_SECRET_KEY is required in production/,
    );
  });

  it("also fails closed in production when neither key is set", () => {
    process.env.NODE_ENV = "production";
    expect(() => universityStripeKey()).toThrowError(
      /UNIVERSITY_STRIPE_SECRET_KEY is required in production/,
    );
  });

  it("FAILS CLOSED when NODE_ENV is unset: throws and does NOT fall back to the shared key", () => {
    // The foot-gun this guards: an unset/empty NODE_ENV in a real deployment
    // must NOT silently fall back to the shared STRIPE_SECRET_KEY (which would
    // mischarge the wrong account). Only an explicit dev/test value unlocks it.
    delete process.env.NODE_ENV;
    process.env.STRIPE_SECRET_KEY = "rk_live_shared";
    expect(() => universityStripeKey()).toThrowError(
      /UNIVERSITY_STRIPE_SECRET_KEY is required in production/,
    );
  });

  it("dev/test: falls back to the shared STRIPE_SECRET_KEY when the University key is unset", () => {
    process.env.NODE_ENV = "development";
    process.env.STRIPE_SECRET_KEY = "  rk_test_shared  ";
    expect(universityStripeKey()).toBe("rk_test_shared");
  });

  it("dev/test: returns undefined when neither key is set", () => {
    process.env.NODE_ENV = "test";
    expect(universityStripeKey()).toBeUndefined();
  });
});
