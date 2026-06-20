// ---------------------------------------------------------------------------
// Coherent Ones University — referral program UNIT tests (pure helpers + the
// money-critical floor math). No Postgres, no network.
//
// The end-to-end money paths (attribution first-touch lock, earn-on-
// invoice.paid, apply-with-floor, refund reversal, webhook-replay idempotency)
// are proven against a REAL embedded Postgres in
// university-referrals-integration.test.ts. THIS file pins the deterministic
// pieces: code generation format/uniqueness and the apply-amount/floor
// arithmetic — the single place a bug spends real money via under/over-credit.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  generateReferralCode,
  computeApplyAmountCents,
  REFERRAL_REWARD_CENTS,
  CREDIT_FLOOR_CENTS,
} from "../services/university-referrals.js";

describe("referral constants", () => {
  it("reward is $10 and floor is $5 (per the spec)", () => {
    expect(REFERRAL_REWARD_CENTS).toBe(1000);
    expect(CREDIT_FLOOR_CENTS).toBe(500);
  });
});

describe("generateReferralCode", () => {
  it("produces an 8-char uppercase Crockford base32 code", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateReferralCode();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/); // Crockford: no I, L, O, U
    }
  });

  it("does not collide across many generations (random, not derived)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) seen.add(generateReferralCode());
    // 32^8 space — 5000 draws should be unique with overwhelming probability.
    expect(seen.size).toBe(5000);
  });
});

describe("computeApplyAmountCents — the floor guard", () => {
  const bill = 5000; // $50 monthly dues
  const floor = CREDIT_FLOOR_CENTS; // $5

  it("applies the full balance when it stays above the floor", () => {
    // $30 credit on a $50 bill → bill becomes $20, still ≥ $5. Apply all $30.
    expect(
      computeApplyAmountCents({ balanceCents: 3000, billCents: bill, floorCents: floor }),
    ).toBe(3000);
  });

  it("caps the applied amount so the bill never drops below the floor", () => {
    // $60 credit on a $50 bill would zero it. Floor caps the apply at $45
    // (bill → $5). The unused $15 stays in the ledger (rolls forward).
    expect(
      computeApplyAmountCents({ balanceCents: 6000, billCents: bill, floorCents: floor }),
    ).toBe(4500);
  });

  it("worked example from the spec: combined $55 desired → applies $45", () => {
    // §3 worked example. Balance $55 (referral $30 + repost $25), bill $50,
    // floor $5 → apply $45, $10 rolls forward.
    expect(
      computeApplyAmountCents({ balanceCents: 5500, billCents: bill, floorCents: floor }),
    ).toBe(4500);
  });

  it("never returns a negative apply (zero/negative balance → 0)", () => {
    expect(
      computeApplyAmountCents({ balanceCents: 0, billCents: bill, floorCents: floor }),
    ).toBe(0);
    expect(
      computeApplyAmountCents({ balanceCents: -1000, billCents: bill, floorCents: floor }),
    ).toBe(0);
  });

  it("never returns a negative apply when the bill is already at/below the floor", () => {
    // A $4 bill is already under the $5 floor — apply nothing (don't push the
    // bill, and never go negative).
    expect(
      computeApplyAmountCents({ balanceCents: 9999, billCents: 400, floorCents: floor }),
    ).toBe(0);
    // Exactly at the floor → headroom is 0.
    expect(
      computeApplyAmountCents({ balanceCents: 9999, billCents: 500, floorCents: floor }),
    ).toBe(0);
  });

  it("applies exactly down to the floor, not a cent past", () => {
    // $46 credit, $50 bill, $5 floor → headroom is $45, so apply $45 (not $46).
    expect(
      computeApplyAmountCents({ balanceCents: 4600, billCents: bill, floorCents: floor }),
    ).toBe(4500);
  });
});
