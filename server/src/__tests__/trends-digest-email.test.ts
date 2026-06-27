// ---------------------------------------------------------------------------
// Email envelope mapping test — proves provenance badges (Rule 5) and stats
// carry into the email payload. Pure mapping; no network.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { toEmailData } from "../services/trends-digest/whats-hot-email-callback.js";
import type { DigestItem, TrendDigest } from "../services/trends-digest/types.js";

const src = {
  url: "https://news.ycombinator.com/item?id=1",
  publisher: "Hacker News",
  fetchedAt: "2026-06-25T12:00:00.000Z",
  dateline: null,
};

function item(over: Partial<DigestItem>): DigestItem {
  return {
    id: "x",
    title: "T",
    category: "AI/ML",
    whatsHot: { text: "what", source: src },
    whyItsHot: { text: "why", sources: [src], fallback: false },
    stats: [{ label: "HN points", value: 240, display: "240", unit: "points", source: src }],
    saturation: {
      score: 20,
      bucket: "OPEN",
      momentum: "RISING",
      verdict: "RIDE",
      evidence: "ev",
      inputsUsed: ["velocity"],
    },
    provenance: "unverified",
    ...over,
  };
}

describe("toEmailData", () => {
  it("maps provenance to badges and carries stats + ad-friendly ids", () => {
    const digest: TrendDigest = {
      digestDate: "2026-06-25",
      generatedAt: "2026-06-25T12:00:00.000Z",
      status: "approved",
      items: [
        item({ id: "a", provenance: "independent" }),
        item({ id: "b", provenance: "single_source" }),
        item({ id: "c", provenance: "unverified" }),
      ],
      adFriendlyItemIds: ["a"],
    };
    const data = toEmailData(digest);
    expect(data.itemCount).toBe(3);
    expect(data.items[0]!.provenanceBadge).toBe("✅");
    expect(data.items[1]!.provenanceBadge).toBe("🟡");
    expect(data.items[2]!.provenanceBadge).toBe("⚠");
    expect(data.items[0]!.stats).toEqual([{ label: "HN points", display: "240" }]);
    expect(data.items[0]!.verdict).toBe("RIDE");
    expect(data.adFriendlyItemIds).toEqual(["a"]);
  });
});
