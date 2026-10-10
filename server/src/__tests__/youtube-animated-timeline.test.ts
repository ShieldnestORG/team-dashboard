// ---------------------------------------------------------------------------
// buildAnimatedTimeline: presentation beats + measured durations -> the timeline
// the animated renderer plays. The fixture is the real 2026-10-06 script; the
// durations are made up. validateTimeline() is the renderer's own gate.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateTimeline } from "../services/youtube/animated/render.js";
import { buildAnimatedTimeline } from "../services/youtube/animated-video.js";
import { buildBeats, type Beat } from "../services/youtube/presentation-renderer.js";
import { sanitizeScript, type ScriptData } from "../services/youtube/script-writer.js";
import { estimateWords } from "../services/youtube/word-timings.js";

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "yt-script-2026-10-06.json");

function loadScript(): ScriptData {
  const raw = JSON.parse(readFileSync(FIXTURE, "utf8")) as ScriptData & { _source?: string };
  delete raw._source;
  return sanitizeScript(raw);
}

const beats = buildBeats(loadScript());
// made-up but plausible: 3.0 s + a little per beat, so every start is a distinct, non-round sum
const speech = beats.map((_, i) => 2.4 + (i % 7) * 0.35);
const GAP = 0.6;
const durations = speech.map((s, i) => s + (i < speech.length - 1 ? GAP : 0));
const AUDIO = "/data/youtube/audio/audio_test.wav";

describe("buildAnimatedTimeline (fixture: 2026-10-06 script, made-up durations)", () => {
  const timeline = buildAnimatedTimeline(beats, durations, AUDIO);

  it("is accepted by the renderer's validateTimeline, also after a JSON round trip", () => {
    expect(() => validateTimeline(timeline)).not.toThrow();
    const parsed = validateTimeline(JSON.parse(JSON.stringify(timeline)));
    expect(parsed.beats).toHaveLength(beats.length);
    expect(parsed.width).toBe(1920);
    expect(parsed.height).toBe(1080);
    expect(parsed.fps).toBe(30);
    expect(parsed.audio).toBe(AUDIO);
  });

  it("startSec is the running sum of the slide durations and the last beat ends at the total", () => {
    let acc = 0;
    timeline.beats.forEach((b, i) => {
      expect(b.startSec).toBeCloseTo(acc, 9);
      expect(b.durSec).toBe(durations[i]);
      acc += durations[i];
    });
    const last = timeline.beats[timeline.beats.length - 1];
    expect(last.startSec + last.durSec).toBeCloseTo(durations.reduce((a, b) => a + b, 0), 9);
  });

  it("keeps each beat's type and spoken text, and takes title/subtitle/badge from req only when non-empty", () => {
    timeline.beats.forEach((b, i) => {
      expect(b.type).toBe(beats[i].type);
      expect(b.text).toBe(beats[i].text);
      if (beats[i].req.title) expect(b.title).toBe(beats[i].req.title);
      else expect(b.title).toBeUndefined();
      if (beats[i].req.badge) expect(b.badge).toBe(beats[i].req.badge);
      else expect(b.badge).toBeUndefined();
    });
    expect(timeline.beats[0].type).toBe("title");
    expect(timeline.beats[0].title).toBe(loadScript().title);
    expect(timeline.beats[0].subtitle).toBeTruthy();
    expect(timeline.beats.some((b) => b.type === "section_title" && b.badge)).toBe(true);
  });

  it("items = the req content; highlight only when it is an integer inside the items", () => {
    let withItems = 0;
    timeline.beats.forEach((b, i) => {
      const content = beats[i].req.content;
      if (Array.isArray(content) && content.length > 0) {
        withItems++;
        expect(b.items).toEqual(content);
        if (beats[i].req.highlightIndex !== undefined) expect(b.highlight).toBe(beats[i].req.highlightIndex);
        if (b.highlight !== undefined) expect(b.highlight).toBeLessThan(b.items!.length);
      } else {
        expect(b.items).toBeUndefined();
        expect(b.highlight).toBeUndefined();
      }
      if (b.type === "content" || b.type === "conclusion") expect(b.items!.length).toBeGreaterThan(0);
    });
    expect(withItems).toBeGreaterThan(10);
    // the fixture has list slides that highlight their own line
    expect(timeline.beats.some((b) => b.type === "content" && b.highlight === 2)).toBe(true);
  });

  it("carries words per beat when given, and the renderer accepts them (the estimate stays inside the beat)", () => {
    let start = 0;
    const words = beats.map((b, i) => {
      const w = estimateWords(b.text, start, speech[i], durations[i]);
      start += durations[i];
      return w;
    });
    const withWords = buildAnimatedTimeline(beats, durations, AUDIO, words);
    const parsed = validateTimeline(JSON.parse(JSON.stringify(withWords)));
    parsed.beats.forEach((b, i) => {
      expect(b.words).toHaveLength(beats[i].text.trim().split(/\s+/).length);
      expect(b.words!.map((x) => x.w).join(" ")).toBe(beats[i].text.trim().split(/\s+/).join(" "));
    });
  });

  it("leaves words off for a beat whose entry is missing or empty", () => {
    const some = buildAnimatedTimeline(beats.slice(0, 3), durations.slice(0, 3), AUDIO, [undefined, [], [{ w: "x", s: 5, e: 6 }]]);
    expect(some.beats[0].words).toBeUndefined();
    expect(some.beats[1].words).toBeUndefined();
    expect(some.beats[2].words).toEqual([{ w: "x", s: 5, e: 6 }]);
  });

  it("refuses beats and durations of different lengths", () => {
    expect(() => buildAnimatedTimeline(beats, durations.slice(1), AUDIO)).toThrow(/beats but/);
  });

  it("makes the audio path absolute", () => {
    expect(buildAnimatedTimeline(beats.slice(0, 1), [3], "relative/audio.wav").audio).toMatch(/^\/.*relative\/audio\.wav$/);
  });
});

describe("items / highlight rules on hand-made beats", () => {
  const mk = (req: Beat["req"], type: Beat["type"] = "content"): Beat => ({ type, req, fallbackHtml: "", text: "Some spoken text." });

  it("drops a highlight that is out of range, negative, fractional or has no items", () => {
    const list = ["a", "b", "c"];
    const t = buildAnimatedTimeline(
      [
        mk({ type: "content", content: list, highlightIndex: 3 }),
        mk({ type: "content", content: list, highlightIndex: -1 }),
        mk({ type: "content", content: list, highlightIndex: 1.5 }),
        mk({ type: "content", content: list, highlightIndex: 2 }),
        mk({ type: "title", title: "T", highlightIndex: 0 }, "title"),
      ],
      [2, 2, 2, 2, 2],
      AUDIO,
    );
    expect(t.beats.map((b) => b.highlight)).toEqual([undefined, undefined, undefined, 2, undefined]);
    expect(t.beats[4].items).toBeUndefined();
  });

  it("ignores empty or whitespace-only strings and empty or non-string content", () => {
    const t = buildAnimatedTimeline(
      [
        mk({ type: "title", title: "  ", subtitle: "", badge: "" }, "title"),
        mk({ type: "hook", content: [] }, "hook"),
        mk({ type: "hook", content: ["fine", 7 as unknown as string] }, "hook"),
        mk({ type: "hook", content: ["A quote."] }, "hook"),
      ],
      [2, 2, 2, 2],
      AUDIO,
    );
    expect(t.beats[0].title).toBeUndefined();
    expect(t.beats[0].subtitle).toBeUndefined();
    expect(t.beats[0].badge).toBeUndefined();
    expect(t.beats[1].items).toBeUndefined();
    expect(t.beats[2].items).toBeUndefined();
    expect(t.beats[3].items).toEqual(["A quote."]);
    expect(() => validateTimeline(JSON.parse(JSON.stringify(t)))).not.toThrow();
  });
});
