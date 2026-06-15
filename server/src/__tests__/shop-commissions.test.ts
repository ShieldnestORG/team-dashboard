/**
 * Unit tests for the pure helpers in the shop-commissions service:
 *   - computeCommissionCents: rate math + guards
 *   - wooSignaturePayload / signWooPayload / verifyWooSignature: the HMAC
 *     contract the WooCommerce-side adapter signs.
 *
 * recordWooOrder (DB-touching, idempotent) is exercised at the route level.
 */

import { describe, expect, it } from "vitest";
import {
  computeCommissionCents,
  wooSignaturePayload,
  signWooPayload,
  verifyWooSignature,
} from "../services/shop-commissions.ts";

describe("computeCommissionCents", () => {
  it("applies the rate and rounds to the nearest cent", () => {
    expect(computeCommissionCents(3000, 0.1)).toBe(300);
    expect(computeCommissionCents(2999, 0.1)).toBe(300); // 299.9 → 300
    expect(computeCommissionCents(2994, 0.1)).toBe(299); // 299.4 → 299
  });

  it("returns 0 for non-positive or invalid gross / rate", () => {
    expect(computeCommissionCents(0, 0.1)).toBe(0);
    expect(computeCommissionCents(-100, 0.1)).toBe(0);
    expect(computeCommissionCents(3000, 0)).toBe(0);
    expect(computeCommissionCents(NaN, 0.1)).toBe(0);
    expect(computeCommissionCents(3000, NaN)).toBe(0);
  });
});

describe("woo signature", () => {
  const secret = "test-secret";
  const order = {
    orderRef: "wc_1234",
    referralCode: "remy",
    grossAmountCents: 3000,
    currency: "usd",
    status: "paid",
  };

  it("builds a stable canonical payload (field order is the contract)", () => {
    expect(wooSignaturePayload(order)).toBe("wc_1234|remy|3000|usd|paid");
  });

  it("verifies a correctly signed payload", () => {
    const payload = wooSignaturePayload(order);
    const sig = signWooPayload(payload, secret);
    expect(verifyWooSignature(payload, sig, secret)).toBe(true);
  });

  it("rejects a tampered payload (different amount → different sig)", () => {
    const sig = signWooPayload(wooSignaturePayload(order), secret);
    const tampered = wooSignaturePayload({ ...order, grossAmountCents: 9999 });
    expect(verifyWooSignature(tampered, sig, secret)).toBe(false);
  });

  it("rejects the wrong secret", () => {
    const payload = wooSignaturePayload(order);
    const sig = signWooPayload(payload, secret);
    expect(verifyWooSignature(payload, sig, "other-secret")).toBe(false);
  });

  it("rejects empty / malformed signatures without throwing", () => {
    const payload = wooSignaturePayload(order);
    expect(verifyWooSignature(payload, "", secret)).toBe(false);
    expect(verifyWooSignature(payload, "not-hex-zz", secret)).toBe(false);
    expect(verifyWooSignature(payload, signWooPayload(payload, secret), "")).toBe(false);
  });
});
