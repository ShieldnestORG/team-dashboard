// ---------------------------------------------------------------------------
// Presentation beats: one slide = one voice clip. The fixture is the real
// 2026-10-06 script (production c6e0b897) reconstructed from the measured video.
// The coverage test is the one that would have caught the original bug: the
// title was "spoken" (counted) while the intro and finalThought were spoken but
// had no slide, so every slide after the intro appeared early.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildBeats, buildSlidesFromScript } from "../services/youtube/presentation-renderer.js";
import { EVNTRACE_CTA_LINE, sanitizeScript, type ScriptData } from "../services/youtube/script-writer.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "yt-script-2026-10-06.json");

function loadScript(): ScriptData {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as ScriptData & { _source?: string };
  delete raw._source;
  return sanitizeScript(raw);
}

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** The spoken words, built straight from the script's fields — not from buildBeats. */
function expectedSpokenWords(script: ScriptData): string[] {
  const parts: string[] = [
    script.hook.text,
    script.introduction.greeting,
    script.introduction.topicIntro,
    script.introduction.valueProposition,
    script.introduction.credibility,
  ];
  for (const section of script.mainContent.sections) {
    parts.push(section.title);
    for (const line of section.content) if (!line.startsWith("[")) parts.push(line);
  }
  parts.push(...script.conclusion.recap, script.conclusion.finalThought);
  parts.push(script.callToAction.subscribe, script.callToAction.like, script.callToAction.comment, EVNTRACE_CTA_LINE);
  return words(parts.join(" "));
}

describe("buildBeats (fixture: 2026-10-06 script)", () => {
  const script = loadScript();
  const beats = buildBeats(script);

  it("makes 28 beats: 1 title + 3 intro + 21 section + conclusion + finalThought + cta", () => {
    expect(beats).toHaveLength(1 + 3 + (4 + 5 + 4 + 4 + 4) + 1 + 1 + 1);
    expect(beats).toHaveLength(28);
  });

  it("speaks every spoken word exactly once, in order (and nothing else)", () => {
    expect(words(beats.map((b) => b.text).join(" "))).toEqual(expectedSpokenWords(script));
  });

  it("never reads the title aloud (the title card shows while the hook is spoken)", () => {
    expect(beats[0].type).toBe("title");
    expect(beats[0].text).toBe(script.hook.text);
    expect(beats[0].req.title).toBe(script.title);
  });

  it("has no empty beat and no beat starting with [", () => {
    for (const b of beats) {
      expect(b.text.trim()).not.toBe("");
      expect(b.text.startsWith("[")).toBe(false);
    }
  });

  it("ends with the cta beat, which ends with the fixed evntrace line", () => {
    const last = beats[beats.length - 1];
    expect(last.type).toBe("cta");
    expect(last.text.endsWith(EVNTRACE_CTA_LINE)).toBe(true);
  });

  it("puts the greeting in front of the first intro beat, and names Coherence Daddy", () => {
    expect(beats[1].text).toBe(`${script.introduction.greeting} ${script.introduction.topicIntro}`);
    expect(beats[1].text).toMatch(/Coherence Daddy/);
    expect(beats[1].req.title).toBe("In this video");
  });

  it("closes with recap, then the final thought as a quote slide", () => {
    const n = beats.length;
    expect(beats[n - 3].type).toBe("conclusion");
    expect(beats[n - 2].type).toBe("hook");
    expect(beats[n - 2].text).toBe(script.conclusion.finalThought);
  });

  it("buildSlidesFromScript is 1:1 with the beats (same length, order, spokenText)", () => {
    const slides = buildSlidesFromScript(script);
    expect(slides).toHaveLength(beats.length);
    slides.forEach((s, i) => {
      expect(s.type).toBe(beats[i].type);
      expect(s.spokenText).toBe(beats[i].text);
      expect(s.html).toContain("<!DOCTYPE html>"); // random particles make exact html differ per call
    });
  });

  it("neither shows nor speaks a [stage direction] line", () => {
    const copy = structuredClone(script);
    copy.mainContent.sections[0].content.splice(2, 0, "[B-roll: chart]");
    const withDirection = buildBeats(copy);
    expect(withDirection).toHaveLength(beats.length);
    for (const b of withDirection) {
      expect(b.text).not.toContain("B-roll");
      expect(JSON.stringify(b.req)).not.toContain("B-roll");
      expect(b.fallbackHtml).not.toContain("B-roll");
    }
  });

  it("puts the greeting on the title beat when there are no intro items", () => {
    const copy = structuredClone(script);
    copy.introduction.topicIntro = "";
    copy.introduction.valueProposition = "";
    copy.introduction.credibility = "";
    const b = buildBeats(copy);
    expect(b).toHaveLength(beats.length - 3);
    expect(b[0].text).toBe(`${script.hook.text} ${script.introduction.greeting}`);
  });
});
