// ---------------------------------------------------------------------------
// YouTube metadata for script-v2 videos. The fixture is the first script-v2
// video (production d95fef7d, 2026-10-09). Its live metadata had chapters
// "NaN:NaN" (section durations are strings like "35s"), a title rewritten to
// "Powerful What Tx Staking Actually Is (2026)", no disclosure line in the
// description, and junk tags ("actually", "means", "does"). The voice spelled
// "tokns.fi" as "tokens dot F-Y-E" on eleven_v3; the owner picked "phi".
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBeats } from "../services/youtube/presentation-renderer.js";
import { DISCLOSURE_LINE, applyPronunciationFixes, type ScriptData } from "../services/youtube/script-writer.js";
import {
  chaptersFromBeats,
  generateChapters,
  generateDescription,
  generateTags,
  optimizeTitle,
  parseDurationSec,
  sanitizeTags,
  withChapters,
} from "../services/youtube/seo-optimizer.js";
import type { ContentStrategy } from "../services/youtube/content-strategy.js";

const here = dirname(fileURLToPath(import.meta.url));
const load = (name: string) => JSON.parse(readFileSync(join(here, "fixtures", name), "utf8"));
const txScript = load("yt-script-2026-10-09-tx-staking.json") as ScriptData;
const mindsetScript = load("yt-script-good-mindset.json") as ScriptData;
const { slideDurations } = load("yt-timeline-2026-10-09-tx-staking.json") as { slideDurations: number[] };

const txStrategy = {
  topic: "what staking on TX actually means, and what it does not",
  pillar: "tx_blockchain",
  contentType: "Explainer",
  angle: "the technical reality of tx staking: distinguishing network security from simple yield farming",
  keywords: ["staking", "actually", "means", "does"],
  targetAudience: "Tech enthusiasts, crypto investors, developers",
} as unknown as ContentStrategy;
const mindsetStrategy = {
  topic: "discipline beats motivation",
  pillar: "motivation",
  contentType: "Explainer",
  angle: "three small habits that make discipline stick",
  keywords: ["discipline", "motivation", "habits"],
  targetAudience: "People building better habits",
} as unknown as ContentStrategy;

const timestampLines = (desc: string): string[] => {
  const i = desc.indexOf("TIMESTAMPS:\n");
  if (i < 0) return [];
  const rest = desc.slice(i + "TIMESTAMPS:\n".length);
  const end = rest.indexOf("\n\n");
  return (end < 0 ? rest : rest.slice(0, end)).split("\n").filter(Boolean);
};

describe("tokns.fi pronunciation (owner pick 2026-10-09: 'phi')", () => {
  it("says tokens dot phi, never the spelled-out fye", () => {
    expect(applyPronunciationFixes("we build tokns.fi, so we gain")).toBe("we build tokens dot phi, so we gain");
    expect(applyPronunciationFixes("Tokns.fi is ours")).toBe("Tokens dot phi is ours");
    expect(applyPronunciationFixes("TOKNS.FI")).toBe("TOKENS DOT PHI");
    expect(applyPronunciationFixes("tokns.fi tokns.fi")).not.toMatch(/fye/i);
  });
});

describe("title: the script's honest title is kept", () => {
  it("keeps the script-v2 title exactly (no power word, no year, no title-casing)", () => {
    for (let i = 0; i < 8; i++) expect(optimizeTitle(txScript.title, txStrategy)).toBe("What TX Staking Actually Is");
  });
  it("cuts an over-long title at a word boundary, at most 100 characters", () => {
    const long = "Why the slow and boring path of steady discipline beats every motivation hack you have ever tried in your whole life so far";
    const t = optimizeTitle(long, mindsetStrategy);
    expect(t.length).toBeLessThanOrEqual(100);
    expect(t.endsWith("…")).toBe(true);
    const kept = t.slice(0, -1).trimEnd();
    expect(long.startsWith(kept)).toBe(true);
    expect(long.charAt(kept.length)).toBe(" ");
  });
});

describe("chapters", () => {
  it("parses script-v2 duration strings", () => {
    expect(parseDurationSec(35)).toBe(35);
    expect(parseDurationSec("35s")).toBe(35);
    expect(parseDurationSec("35")).toBe(35);
    expect(parseDurationSec("1:05")).toBe(65);
    expect(parseDurationSec("abc")).toBe(60);
    expect(parseDurationSec(undefined)).toBe(60);
  });
  it("estimated chapters are numbers, never NaN", () => {
    const ch = generateChapters(txScript);
    expect(ch.map((c) => c.seconds)).toEqual([0, 20, 55, 90, 125, 160]);
    for (const c of ch) expect(c.time).toMatch(/^\d{2}:\d{2}$/);
  });
  it("measured chapters come from the real beat timings", () => {
    const beats = buildBeats(txScript);
    expect(beats.length).toBe(slideDurations.length);
    const ch = chaptersFromBeats(beats, slideDurations);
    expect(ch.map((c) => `${c.time} ${c.title}`)).toEqual([
      "00:00 Introduction",
      "00:25 The Security Engine",
      "00:54 Staking vs Yield Farming",
      "01:23 The Role of Validators",
      "01:50 The Real Risks",
      "02:17 Takeaways",
    ]);
  });
  it("drops a chapter closer than 10 s to the previous one, and returns [] below 3 chapters", () => {
    const beats = [
      { type: "title", req: { type: "title", title: "T" } },
      { type: "section_title", req: { type: "section_title", title: "Too soon" } },
      { type: "content", req: { type: "content" } },
      { type: "section_title", req: { type: "section_title", title: "Second" } },
      { type: "content", req: { type: "content" } },
      { type: "conclusion", req: { type: "conclusion" } },
    ];
    const ch = chaptersFromBeats(beats as never, [5, 30, 20, 30, 20, 10]);
    expect(ch.map((c) => c.title)).toEqual(["Introduction", "Second", "Takeaways"]);
    expect(chaptersFromBeats(beats.slice(0, 3) as never, [5, 30, 20])).toEqual([]);
  });
  it("withChapters swaps the TIMESTAMPS block and leaves the rest untouched", () => {
    const desc = generateDescription(txScript, txStrategy);
    const ch = chaptersFromBeats(buildBeats(txScript), slideDurations);
    const out = withChapters(desc, ch);
    expect(timestampLines(out)).toEqual(ch.map((c) => `${c.time} ${c.title}`));
    const before = desc.slice(0, desc.indexOf("TIMESTAMPS:"));
    expect(out.startsWith(before)).toBe(true);
    expect(out.endsWith(desc.slice(desc.indexOf("\n\n", desc.indexOf("TIMESTAMPS:"))))).toBe(true);
  });
  it("withChapters removes the block when there are no valid chapters", () => {
    const out = withChapters(generateDescription(txScript, txStrategy), []);
    expect(out).not.toContain("TIMESTAMPS");
    expect(out).not.toContain("\n\n\n");
  });
});

describe("description", () => {
  const desc = generateDescription(txScript, txStrategy);
  it("has no NaN and only valid chapter lines", () => {
    expect(desc).not.toContain("NaN");
    const lines = timestampLines(desc);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const l of lines) expect(l).toMatch(/^\d{2}:\d{2} \S/);
  });
  it("puts the stake disclosure near the top of a TX video (FTC: hard to miss)", () => {
    const i = desc.indexOf(DISCLOSURE_LINE);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(i).toBeLessThan(400);
  });
  it("says not financial advice on a crypto video", () => {
    expect(desc.toLowerCase()).toContain("not financial advice");
  });
  it("has no template filler", () => {
    expect(desc).not.toMatch(/valuable insights|comprehensive guide|everything you need to know/i);
  });
  it("a mindset video carries no stake disclosure", () => {
    expect(generateDescription(mindsetScript, mindsetStrategy)).not.toContain(DISCLOSURE_LINE);
  });
});

describe("tags", () => {
  it("drops stopword tags, sentence-length topic tags and the squashed toknsfi", () => {
    const tags = sanitizeTags(generateTags(txScript, txStrategy));
    for (const junk of ["actually", "means", "does", "toknsfi"]) expect(tags).not.toContain(junk);
    for (const t of tags) expect(t.split(" ").length).toBeLessThanOrEqual(5);
    expect(tags).toContain("tokns");
    expect(tags).toContain("staking");
  });
  it("a mindset video gets no TX/tokns tags", () => {
    const tags = sanitizeTags(generateTags(mindsetScript, mindsetStrategy));
    expect(tags).not.toContain("tokns");
    expect(tags).not.toContain("tx ecosystem");
  });
});
