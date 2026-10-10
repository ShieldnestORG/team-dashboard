// ---------------------------------------------------------------------------
// Word timings for the animated mode: ElevenLabs forced-alignment mapping, the
// estimate used when alignment fails, and alignBeatWords end to end with a fake
// fetch (no network, no key) and real ffmpeg cutting a generated wav (skipped,
// loudly named, when ffmpeg is missing).
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { alignBeatWords, estimateWords, mapAlignedWords } from "../services/youtube/word-timings.js";

const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** The shape measured 2026-10-09: a 17-word sentence came back as 33 entries (words and " " between them). */
const SENTENCE = "Quick honesty break: we run a TX validator and build tokns.fi, so we gain when you stake.";

function faShape(display: string, startAt = 0.1, perWord = 0.3): { text: string; start: number; end: number }[] {
  const words = display.trim().split(/\s+/);
  const out: { text: string; start: number; end: number }[] = [];
  words.forEach((w, i) => {
    const s = startAt + i * perWord;
    out.push({ text: w, start: s, end: s + perWord * 0.8 });
    if (i < words.length - 1) out.push({ text: " ", start: s + perWord * 0.8, end: s + perWord });
  });
  return out;
}

describe("mapAlignedWords", () => {
  it("drops the whitespace entries and returns the display words (33 entries for 17 words)", () => {
    const words = SENTENCE.split(" ");
    expect(words).toHaveLength(17);
    const fa = faShape(SENTENCE);
    expect(fa).toHaveLength(33);
    const mapped = mapAlignedWords(SENTENCE, fa, 10, 8);
    expect(mapped).not.toBeNull();
    expect(mapped!.map((x) => x.w)).toEqual(words);
    // punctuation stays on the word; times are the clip time plus the beat start
    expect(mapped![2].w).toBe("break:");
    expect(mapped![0].s).toBeCloseTo(10.1, 6);
    expect(mapped![0].e).toBeCloseTo(10.1 + 0.24, 6);
    expect(mapped![16].s).toBeCloseTo(10.1 + 16 * 0.3, 6);
  });

  it("returns null when the word count differs from the display text", () => {
    const fa = faShape(SENTENCE).slice(0, -2); // last word lost
    expect(mapAlignedWords(SENTENCE, fa, 0, 10)).toBeNull();
    expect(mapAlignedWords("one two", faShape("one two three"), 0, 10)).toBeNull();
    expect(mapAlignedWords("   ", [], 0, 10)).toBeNull();
  });

  it("returns null on a malformed answer instead of throwing", () => {
    expect(mapAlignedWords("a b", [{ text: "a", start: 0, end: 1 }, { text: "b", start: NaN, end: 2 }], 0, 5)).toBeNull();
    expect(mapAlignedWords("a b", undefined as unknown as [], 0, 5)).toBeNull();
  });

  it("clamps into the beat, keeps s <= e and s non-decreasing", () => {
    const fa = [
      { text: "alpha", start: -0.4, end: 0.5 }, // starts before the clip
      { text: " ", start: 0.5, end: 0.6 },
      { text: "beta", start: 0.3, end: 0.2 }, // goes backwards and has e < s
      { text: "gamma", start: 4.8, end: 9.0 }, // runs past the beat
      { text: "delta", start: 6.0, end: 7.0 }, // starts after the beat is over
    ];
    const beatStart = 20;
    const beatDur = 5;
    const mapped = mapAlignedWords("alpha beta gamma delta", fa, beatStart, beatDur)!;
    expect(mapped).toHaveLength(4);
    for (const x of mapped) {
      expect(x.s).toBeGreaterThanOrEqual(beatStart);
      expect(x.e).toBeLessThanOrEqual(beatStart + beatDur);
      expect(x.s).toBeLessThanOrEqual(x.e);
    }
    for (let i = 1; i < mapped.length; i++) expect(mapped[i].s).toBeGreaterThanOrEqual(mapped[i - 1].s);
    expect(mapped[0].s).toBe(20);
    expect(mapped[2].e).toBe(25);
    expect(mapped[3].s).toBe(25);
    expect(mapped[3].e).toBe(25);
  });
});

describe("estimateWords", () => {
  const check = (text: string, start: number, speech: number, dur: number) => {
    const out = estimateWords(text, start, speech, dur);
    expect(out.map((x) => x.w)).toEqual(text.trim().split(/\s+/));
    for (const x of out) {
      expect(x.s).toBeGreaterThanOrEqual(start);
      expect(x.e).toBeLessThanOrEqual(start + dur + 1e-9);
      expect(x.s).toBeLessThanOrEqual(x.e);
    }
    for (let i = 1; i < out.length; i++) {
      expect(out[i].s).toBeGreaterThanOrEqual(out[i - 1].s);
      expect(out[i].s).toBeGreaterThanOrEqual(out[i - 1].e - 1e-9); // words do not overlap
    }
    return out;
  };

  it("spreads the speech over the beat: first word at the start, last word ends with the speech", () => {
    const out = check(SENTENCE, 30, 6.4, 7);
    expect(out[0].s).toBeCloseTo(30, 9);
    expect(out[out.length - 1].e).toBeCloseTo(36.4, 9);
  });

  it("gives longer words more time and leaves a gap after punctuation", () => {
    const out = check("a incredible, a incredible", 0, 4, 4);
    expect(out[1].e - out[1].s).toBeGreaterThan(out[0].e - out[0].s);
    expect(out[2].s - out[1].e).toBeGreaterThan(0); // pause after the comma
    expect(out[1].e - out[0].e).toBeGreaterThan(0);
    expect(out[1].s - out[0].e).toBeCloseTo(0, 9); // no pause after a plain word
  });

  it("stays inside the beat when the reported speech is longer than the beat, zero or not a number", () => {
    check(SENTENCE, 5, 99, 6);
    check(SENTENCE, 5, 0, 6);
    check(SENTENCE, 5, Number.NaN, 6);
  });

  it("handles one word and no words", () => {
    expect(check("Hello", 1, 2, 3)).toHaveLength(1);
    expect(estimateWords("   ", 0, 1, 1)).toEqual([]);
  });
});

describe.skipIf(!hasFfmpeg)("alignBeatWords (fake fetch, real ffmpeg cutting a generated wav)", () => {
  const FAKE_KEY = "test-key-not-a-real-elevenlabs-key";
  let dir: string;
  let audio: string;
  const savedKey = process.env.ELEVENLABS_VOICE_KEY;

  // 3 beats on a 9 s track: beat i starts at 3 * i, speech 2 s, then a 1 s gap.
  const beats = [
    { text: "First beat is short.", startSec: 0, speechSec: 2, durSec: 3 },
    { text: "Second beat, the one the fake API breaks.", startSec: 3, speechSec: 2, durSec: 3 },
    { text: "Third beat goes through, fine.", startSec: 6, speechSec: 2, durSec: 3 },
  ];

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "yt-wordtimings-test-"));
    audio = join(dir, "track.wav");
    execFileSync("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=9",
      "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", audio,
    ]);
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  afterEach(() => {
    if (savedKey === undefined) delete process.env.ELEVENLABS_VOICE_KEY;
    else process.env.ELEVENLABS_VOICE_KEY = savedKey;
  });

  it("aligns beats the API answers for, estimates the one it fails on, and never logs the key", async () => {
    process.env.ELEVENLABS_VOICE_KEY = FAKE_KEY;
    const calls: { text: string; key: string | null; bytes: number; riff: boolean }[] = [];
    const fetchImpl = (async (_url: unknown, init?: RequestInit) => {
      const body = init!.body as FormData;
      const text = String(body.get("text"));
      const file = body.get("file") as Blob;
      const head = Buffer.from(await file.arrayBuffer());
      calls.push({
        text,
        key: new Headers(init!.headers).get("xi-api-key"),
        bytes: head.length,
        riff: head.subarray(0, 4).toString("latin1") === "RIFF",
      });
      if (text.startsWith("Second")) return new Response("boom", { status: 500 });
      return new Response(JSON.stringify({ characters: [], words: faShape(text, 0.1, 0.25), loss: 0.1 }), { status: 200 });
    }) as unknown as typeof fetch;

    const logs: string[] = [];
    const result = await alignBeatWords(audio, beats, { fetchImpl, log: (m) => logs.push(m) });

    expect(result.aligned).toBe(2);
    expect(result.estimated).toBe(1);
    expect(result.words).toHaveLength(3);
    // aligned beats: absolute times = clip time + beat start
    expect(result.words[0].map((x) => x.w)).toEqual(["First", "beat", "is", "short."]);
    expect(result.words[0][0].s).toBeCloseTo(0.1, 6);
    expect(result.words[2][0].s).toBeCloseTo(6.1, 6);
    // the failed beat still has timings for every display word, inside its beat
    expect(result.words[1].map((x) => x.w)).toEqual(beats[1].text.split(" "));
    expect(result.words[1][0].s).toBeGreaterThanOrEqual(3);
    expect(result.words[1][result.words[1].length - 1].e).toBeLessThanOrEqual(6);
    // what was sent: the DISPLAY text, the key header, a ~2 s 16 kHz mono wav
    expect(calls.map((c) => c.text).sort()).toEqual(beats.map((b) => b.text).sort());
    for (const c of calls) {
      expect(c.key).toBe(FAKE_KEY);
      expect(c.riff).toBe(true);
      expect(c.bytes).toBeGreaterThan(2 * 32000 * 0.9);
      expect(c.bytes).toBeLessThan(2 * 32000 * 1.1 + 200);
    }
    // the key never reaches the log
    expect(logs.join("\n")).not.toContain(FAKE_KEY);
    expect(logs.join("\n")).toMatch(/beat 1 estimated \(forced alignment answered HTTP 500\)/);
  });

  it("estimates a beat whose alignment comes back with the wrong word count", async () => {
    process.env.ELEVENLABS_VOICE_KEY = FAKE_KEY;
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ words: [{ text: "only", start: 0, end: 1 }] }), { status: 200 })) as unknown as typeof fetch;
    const result = await alignBeatWords(audio, beats.slice(0, 1), { fetchImpl });
    expect(result.aligned).toBe(0);
    expect(result.estimated).toBe(1);
    expect(result.words[0]).toHaveLength(4);
  });

  it("estimates every beat, without calling the API, when the key is not set", async () => {
    delete process.env.ELEVENLABS_VOICE_KEY;
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await alignBeatWords(audio, beats, { fetchImpl });
    expect(called).toBe(0);
    expect(result.aligned).toBe(0);
    expect(result.estimated).toBe(3);
    expect(result.words.every((w) => w.length > 0)).toBe(true);
  });

  it("estimates when the network call itself throws", async () => {
    process.env.ELEVENLABS_VOICE_KEY = FAKE_KEY;
    const fetchImpl = (async () => {
      throw new Error("socket hang up");
    }) as unknown as typeof fetch;
    const result = await alignBeatWords(audio, beats.slice(0, 2), { fetchImpl });
    expect(result.estimated).toBe(2);
  });

  it("keeps at most 4 requests in flight", async () => {
    process.env.ELEVENLABS_VOICE_KEY = FAKE_KEY;
    const many = Array.from({ length: 9 }, () => ({ text: "Same words here.", startSec: 0, speechSec: 1, durSec: 1.5 }));
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = (async (_u: unknown, init?: RequestInit) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight--;
      const text = String((init!.body as FormData).get("text"));
      return new Response(JSON.stringify({ words: faShape(text) }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await alignBeatWords(audio, many, { fetchImpl });
    expect(result.aligned).toBe(9);
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
  });
});
