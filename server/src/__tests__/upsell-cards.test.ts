import { describe, expect, it } from "vitest";
import {
  isUpsellContext,
  selectUpsellCards,
  withUtm,
  type UpsellUserSignal,
} from "../services/upsell-cards.js";

// ---------------------------------------------------------------------------
// Tests for the V1 upsell-card selector.
//
// Two invariants we lock in here:
//   1. The catalog never triggers on result-derived signals — only entitlement
//      presence + account tenure. Each test passes only those two facets.
//   2. Every returned cta_href carries the 3 portal-attribution UTM params.
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<UpsellUserSignal> = {}): UpsellUserSignal {
  return {
    hasWatchtower: false,
    hasCreditscore: false,
    hasAeoGrowthBundle: false,
    hasAeoScaleBundle: false,
    hasIntelApi: false,
    hasAgents: false,
    tenureDays: 0,
    ...overrides,
  };
}

describe("isUpsellContext", () => {
  it("accepts known contexts", () => {
    expect(isUpsellContext("dashboard")).toBe(true);
    expect(isUpsellContext("watchtower")).toBe(true);
    expect(isUpsellContext("billing")).toBe(true);
  });
  it("rejects unknown contexts", () => {
    expect(isUpsellContext("admin")).toBe(false);
    expect(isUpsellContext("")).toBe(false);
  });
});

describe("withUtm", () => {
  it("appends the three required UTM params", () => {
    const url = withUtm(
      "https://coherencedaddy.com/tools/creditscore",
      "creditscore-upsell-v1",
      "watchtower",
    );
    const u = new URL(url);
    expect(u.searchParams.get("utm_source")).toBe("portal-upsell");
    expect(u.searchParams.get("utm_campaign")).toBe("creditscore-upsell-v1");
    expect(u.searchParams.get("utm_medium")).toBe("watchtower");
  });
  it("overwrites existing utm params rather than duplicating", () => {
    const url = withUtm(
      "https://example.com/x?utm_source=other",
      "card-1",
      "dashboard",
    );
    const u = new URL(url);
    // URL.searchParams.set overwrites, so we get exactly one occurrence.
    expect(u.searchParams.getAll("utm_source")).toEqual(["portal-upsell"]);
  });
});

describe("selectUpsellCards", () => {
  it("Watchtower-only user in dashboard → CreditScore at priority 60, no bundle (entitlement boundary)", () => {
    const cards = selectUpsellCards(
      makeUser({ hasWatchtower: true }),
      "dashboard",
    );
    const cs = cards.find((c) => c.id === "creditscore-upsell-v1");
    expect(cs).toBeDefined();
    expect(cs?.priority).toBe(60);
    // No bundle eligibility — user doesn't have CreditScore yet, so AEO
    // Growth's entitlement gate (Watchtower + CreditScore) blocks it.
    expect(cards.find((c) => c.product === "bundle-aeo-growth")).toBeUndefined();
    expect(cards.find((c) => c.product === "bundle-aeo-scale")).toBeUndefined();
  });

  it("Watchtower + CreditScore, tenure ≥ 14d, watchtower context → AEO Growth Bundle present", () => {
    const cards = selectUpsellCards(
      makeUser({
        hasWatchtower: true,
        hasCreditscore: true,
        tenureDays: 20,
      }),
      "watchtower",
    );
    const bundle = cards.find((c) => c.id === "aeo-growth-bundle-v1");
    expect(bundle).toBeDefined();
    expect(bundle?.priority).toBe(80);
    expect(bundle?.product).toBe("bundle-aeo-growth");
  });

  it("user with everything → zero cards", () => {
    const cards = selectUpsellCards(
      makeUser({
        hasWatchtower: true,
        hasCreditscore: true,
        hasAeoGrowthBundle: true,
        hasAeoScaleBundle: true,
        hasIntelApi: true,
        hasAgents: true,
        tenureDays: 365,
      }),
      "dashboard",
    );
    expect(cards).toEqual([]);
  });

  it("brand-new user (tenure 0d) → only no-tenure-gated cards (CreditScore for the Watchtower persona)", () => {
    // Brand-new account with only Watchtower (the typical "I just bought
    // Watchtower, now show me the dashboard" path).
    const cards = selectUpsellCards(
      makeUser({ hasWatchtower: true, tenureDays: 0 }),
      "dashboard",
    );
    // The only card without a tenure gate (when Watchtower is held but
    // CreditScore isn't) is CreditScore Starter — Intel API gates ≥7d,
    // bundles gate ≥14d, agents gates ≥7d.
    expect(cards.map((c) => c.id)).toEqual(["creditscore-upsell-v1"]);
  });

  it("every returned cta_href carries the 3 UTM params", () => {
    // Mix of personas → exercise multiple cards in one call.
    const cards = selectUpsellCards(
      makeUser({
        hasWatchtower: true,
        hasCreditscore: true,
        tenureDays: 45,
      }),
      "watchtower",
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const u = new URL(card.cta_href);
      expect(u.searchParams.get("utm_source")).toBe("portal-upsell");
      expect(u.searchParams.get("utm_campaign")).toBe(card.id);
      expect(u.searchParams.get("utm_medium")).toBe("watchtower");
    }
  });

  it("caps at 3 cards even if more are eligible", () => {
    // Tenure-rich account with Growth bundle but not Scale + Watchtower (no
    // CreditScore upsell, because Growth grants CreditScore Pro → caller
    // should set hasCreditscore=true). We construct the maximally-eligible
    // user the catalog allows.
    const cards = selectUpsellCards(
      makeUser({
        hasWatchtower: true,
        hasCreditscore: true,
        hasAeoGrowthBundle: true,
        hasAeoScaleBundle: false,
        hasIntelApi: false,
        hasAgents: false,
        tenureDays: 60,
      }),
      "dashboard",
    );
    expect(cards.length).toBeLessThanOrEqual(3);
    // Sorted DESC by priority.
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i - 1].priority).toBeGreaterThanOrEqual(cards[i].priority);
    }
  });

  it("suppresses cards whose product the user already owns (entitlement boundary)", () => {
    // CreditScore-only Watchtower customer who already has Intel API
    // shouldn't see the Intel API card.
    const cards = selectUpsellCards(
      makeUser({
        hasWatchtower: true,
        hasIntelApi: true,
        tenureDays: 30,
      }),
      "watchtower",
    );
    expect(cards.find((c) => c.product === "intel-api")).toBeUndefined();
  });
});
