// ---------------------------------------------------------------------------
// Citation-gate tests — Rule 4. Judge is injected; no network.
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from "vitest";
import {
  adFriendlyIds,
  runCitationGate,
  type CitationJudge,
  type GateInput,
} from "../services/trends-digest/citation-gate.js";
import type { DigestItem } from "../services/trends-digest/types.js";

const source = {
  url: "https://news.ycombinator.com/item?id=1",
  publisher: "Hacker News",
  fetchedAt: "2026-06-25T12:00:00.000Z",
  dateline: null,
};

function makeItem(over: Partial<DigestItem> = {}): DigestItem {
  return {
    id: over.id ?? "item-1",
    title: "Open-source agent framework",
    category: "AI/ML",
    whatsHot: { text: "Show HN: agent framework", source },
    whyItsHot: {
      text: "An open-source agent framework is being discussed on Hacker News.",
      sources: [source],
      fallback: false,
    },
    stats: [],
    saturation: {
      score: 20,
      bucket: "OPEN",
      momentum: "RISING",
      verdict: "RIDE",
      evidence: "x",
      inputsUsed: ["velocity"],
    },
    provenance: "unverified",
    ...over,
  };
}

const supportedJudge: CitationJudge = async () => ({ supported: true });
const unsupportedJudge: CitationJudge = async () => ({ supported: false });
const unavailableJudge: CitationJudge = async () => null;

describe("runCitationGate — provenance", () => {
  it("supported claim + 2 sources → ✅ independent, prose unchanged", async () => {
    const input: GateInput = {
      item: makeItem(),
      groundingText: "An open-source agent framework is being discussed on Hacker News.",
      sourceCount: 2,
    };
    const [out] = await runCitationGate([input], { judge: supportedJudge });
    expect(out!.provenance).toBe("independent");
    expect(out!.whyItsHot.fallback).toBe(false);
  });

  it("supported claim + 1 source → 🟡 single_source", async () => {
    const input: GateInput = {
      item: makeItem(),
      groundingText: "An open-source agent framework is being discussed on Hacker News.",
      sourceCount: 1,
    };
    const [out] = await runCitationGate([input], { judge: supportedJudge });
    expect(out!.provenance).toBe("single_source");
  });
});

describe("runCitationGate — stripping + fail-soft", () => {
  it("unsupported claim is stripped to the grounded template", async () => {
    const input: GateInput = {
      item: makeItem({
        whyItsHot: {
          text: "It already dominates the entire market.",
          sources: [source],
          fallback: false,
        },
      }),
      groundingText: "Show HN: agent framework.",
      sourceCount: 2,
    };
    const [out] = await runCitationGate([input], { judge: unsupportedJudge });
    expect(out!.whyItsHot.fallback).toBe(true);
    expect(out!.whyItsHot.text).not.toMatch(/dominates/i);
    expect(out!.provenance).not.toBe("independent");
  });

  it("judge UNAVAILABLE → keep prose but cap at ⚠ unverified (never blank the feed)", async () => {
    const input: GateInput = {
      item: makeItem(),
      groundingText: "An open-source agent framework is being discussed on Hacker News.",
      sourceCount: 2,
    };
    const [out] = await runCitationGate([input], { judge: unavailableJudge });
    expect(out!.whyItsHot.fallback).toBe(false); // prose kept
    expect(out!.provenance).toBe("unverified");
  });

  it("skips the judge for an already-fallback line", async () => {
    const judge = vi.fn(supportedJudge);
    const input: GateInput = {
      item: makeItem({
        whyItsHot: { text: "x is drawing attention.", sources: [source], fallback: true },
      }),
      groundingText: "x",
      sourceCount: 2,
    };
    const [out] = await runCitationGate([input], { judge });
    expect(judge).not.toHaveBeenCalled();
    expect(out!.provenance).toBe("single_source");
  });
});

describe("runCitationGate — superlative downgrade", () => {
  it("unranked superlative cannot be ✅ even with 2 sources + supported judge", async () => {
    const input: GateInput = {
      item: makeItem({
        whyItsHot: {
          text: "It is the biggest agent framework around.",
          sources: [source],
          fallback: false,
        },
      }),
      // source does NOT contain "biggest"
      groundingText: "An agent framework is being discussed.",
      sourceCount: 2,
    };
    const [out] = await runCitationGate([input], { judge: supportedJudge });
    expect(out!.provenance).not.toBe("independent");
  });
});

describe("adFriendlyIds", () => {
  it("returns only ✅ independent items (Rule 5)", () => {
    const items = [
      makeItem({ id: "a", provenance: "independent" }),
      makeItem({ id: "b", provenance: "single_source" }),
      makeItem({ id: "c", provenance: "unverified" }),
      makeItem({ id: "d", provenance: "independent" }),
    ];
    expect(adFriendlyIds(items)).toEqual(["a", "d"]);
  });
});
