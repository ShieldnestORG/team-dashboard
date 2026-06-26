// ---------------------------------------------------------------------------
// Digest assembler integration tests — proves the whole method composes:
// fetched numbers become code-inserted stats (Rule 1), saturation is computed
// (Rule 3), prose is grounded (Rule 2), the gate tags provenance + ad-friendly
// (Rules 4, 5), and the digest is born `pending` (Rule 7). All leaf models are
// injected — no network.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { assembleDigest } from "../services/trends-digest/assemble.js";
import { computeSerpInputs } from "../services/trends-digest/serper.js";
import type { CitationJudge } from "../services/trends-digest/citation-gate.js";
import type { ProseModel } from "../services/trends-digest/why-its-hot.js";
import type { TrendSignals } from "../services/trend-scanner.js";

const signals: TrendSignals = {
  timestamp: "2026-06-25T12:00:00.000Z",
  crypto_movers: [
    { coin: "dogwifhat", change_24h: 18.4, price: 0.0000123, volume: 9500000 },
    { coin: "solana", change_24h: -7.2, price: 142.5, volume: 880000000 },
  ],
  trending_tech: [
    {
      title: "Show HN: An open-source agent framework",
      score: 240,
      category: "AI/ML",
      url: "https://news.ycombinator.com/item?id=1",
      comments: 88,
    },
  ],
  google_trends: [
    { keyword: "agent framework", traffic: "20K+", related: ["AI agents"], region: "US" },
  ],
  bing_news: [],
};

// A grounded model that restates the source (passes the number guard).
const groundedModel: ProseModel = async (_sys, user) => {
  if (/agent framework/i.test(user))
    return "An open-source agent framework is being discussed on Hacker News.";
  if (/dogwifhat/i.test(user)) return "dogwifhat moved sharply over the last day, per CoinGecko.";
  return "A topic is drawing attention.";
};
const supportedJudge: CitationJudge = async () => ({ supported: true });

describe("assembleDigest", () => {
  it("produces a pending digest with code-inserted stats and computed verdicts", async () => {
    const digest = await assembleDigest(signals, {
      proseModels: [groundedModel],
      judge: supportedJudge,
      now: new Date("2026-06-25T12:05:00.000Z"),
    });

    expect(digest.status).toBe("pending");
    expect(digest.digestDate).toBe("2026-06-25");
    expect(digest.items.length).toBeGreaterThan(0);

    const tech = digest.items.find((i) => i.category === "AI/ML")!;
    expect(tech).toBeTruthy();
    // Rule 1: the HN score is a code-inserted stat carrying the raw number.
    const points = tech.stats.find((s) => s.label === "HN points")!;
    expect(points.value).toBe(240);
    expect(points.display).toBe("240");
    expect(points.source.url).toBe("https://news.ycombinator.com/item?id=1");
    // Rule 3: verdict computed.
    expect(["RIDE", "COATTAIL", "DIFFERENTIATE", "AVOID"]).toContain(
      tech.saturation.verdict,
    );
    // Rule 2: prose carries a source and is grounded.
    expect(tech.whyItsHot.sources).toHaveLength(1);
    expect(tech.whyItsHot.fallback).toBe(false);
    expect(tech.reuseAngle).toBeTruthy();
  });

  it("crypto stats carry the raw fetched numbers, formatted by code", async () => {
    const digest = await assembleDigest(signals, {
      proseModels: [groundedModel],
      judge: supportedJudge,
    });
    const wif = digest.items.find((i) => i.title === "dogwifhat")!;
    expect(wif).toBeTruthy();
    const chg = wif.stats.find((s) => s.label === "24h change")!;
    expect(chg.value).toBe(18.4);
    expect(chg.display).toBe("+18.4%");
    const price = wif.stats.find((s) => s.label === "price")!;
    expect(price.value).toBe(0.0000123);
  });

  it("forwards enrichment into the saturation score and exposes ad-friendly ids", async () => {
    const digest = await assembleDigest(signals, {
      proseModels: [groundedModel],
      judge: supportedJudge,
      // High concentration/difficulty for every item.
      enrichSaturation: async () => ({
        domainConcentration: 0.9,
        keywordDifficulty: 0.9,
        aiAnswerConcentration: 0.9,
      }),
    });
    const tech = digest.items.find((i) => i.category === "AI/ML")!;
    expect(tech.saturation.inputsUsed).toContain("domainConcentration");
    expect(tech.saturation.inputsUsed).toContain("aiAnswerConcentration");
    // adFriendlyItemIds is exactly the independent-provenance items.
    const independent = digest.items
      .filter((i) => i.provenance === "independent")
      .map((i) => i.id);
    expect(digest.adFriendlyItemIds).toEqual(independent);
  });

  it("a model that invents a number is rejected → grounded fallback line ships", async () => {
    const lyingModel: ProseModel = async () =>
      "This framework already has 50000 GitHub stars and a $910B valuation.";
    const digest = await assembleDigest(signals, {
      proseModels: [lyingModel],
      judge: supportedJudge,
    });
    const tech = digest.items.find((i) => i.category === "AI/ML")!;
    expect(tech.whyItsHot.fallback).toBe(true);
    expect(tech.whyItsHot.text).not.toMatch(/910|50000/);
  });
});

describe("computeSerpInputs (Rule 1 — numbers from the SERP response)", () => {
  it("derives domain concentration from organic result domains", () => {
    const inputs = computeSerpInputs({
      organic: [
        { link: "https://a.com/1" },
        { link: "https://a.com/2" },
        { link: "https://a.com/3" },
        { link: "https://b.com/1" },
      ],
      ads: [{}, {}],
    });
    // 4 results, 2 unique domains → concentration 0.5
    expect(inputs.domainConcentration).toBeCloseTo(0.5, 5);
    expect(inputs.keywordDifficulty).toBeGreaterThan(0);
  });

  it("returns nothing when there are no organic results", () => {
    expect(computeSerpInputs({ organic: [] })).toEqual({});
  });
});
