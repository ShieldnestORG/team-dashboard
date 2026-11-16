// ---------------------------------------------------------------------------
// AEO CTAs — no CTA may point at a retired product (no network, no DB).
//
// Optimize Me stopped being its own product on 2026-11-15 (it is now the daily
// practice tools inside Coherent Education), and its old app is a 503. Every
// CTA here is appended to live Bluesky / X / blog / YouTube copy, so a dead
// link in this table is a dead link in public posts.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { AEO_CTAS, getAeoCta, pickBlueskyCta } from "../services/aeo-cta.js";

const RETIRED = /optimize-me\.coherencedaddy\.com|yourarchi\.com/i;

describe("aeo-cta", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("no CTA links to a retired product host", () => {
    for (const [key, cta] of Object.entries(AEO_CTAS)) {
      for (const text of Object.values(cta)) {
        expect(text, `AEO_CTAS.${key}`).not.toMatch(RETIRED);
      }
    }
  });

  it("every Bluesky pool pick is a real CTA with a live link", () => {
    // Walk every slot of the uniform pick by pinning Math.random.
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      vi.spyOn(Math, "random").mockReturnValue(i / 100);
      const cta = pickBlueskyCta();
      expect(cta).not.toBe(AEO_CTAS.default);
      expect(cta.tweetSuffix).not.toMatch(RETIRED);
      seen.add(cta.tweetSuffix);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the retired optimizeme key falls back to the default CTA", () => {
    expect(getAeoCta("optimizeme")).toBe(AEO_CTAS.default);
  });
});
