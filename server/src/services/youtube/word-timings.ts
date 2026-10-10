/**
 * YouTube Pipeline — word timings for the animated mode.
 *
 * The animated scenes light each word up as it is spoken, so every beat needs
 * {w, s, e} per display word in absolute seconds. Two sources, best first:
 *  1. ElevenLabs forced alignment (POST /v1/forced-alignment: the beat's audio + its DISPLAY text);
 *  2. an estimate that spreads the beat's measured speech length over its words.
 * Any failure of (1) for a beat falls back to (2) for that beat only, so a day never loses its video to this step.
 */

import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ALIGN_URL = "https://api.elevenlabs.io/v1/forced-alignment";
const ALIGN_CONCURRENCY = 4;
const ALIGN_TIMEOUT_MS = 30_000;

export interface TimedWord {
  w: string;
  s: number;
  e: number;
}

export interface AlignedWordInput {
  text: string;
  start: number;
  end: number;
}

function displayWords(displayText: string): string[] {
  return displayText.trim().split(/\s+/).filter(Boolean);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Map a forced-alignment answer onto the beat's display words.
 *
 * The API returns one entry per word AND one per whitespace run (text " "); those are dropped. The words
 * left must be exactly the display words, one for one, or the mapping is refused (null) rather than guessed.
 * Times are relative to the clip; the result is absolute, clamped into the beat, with s <= e and s
 * non-decreasing.
 */
export function mapAlignedWords(
  displayText: string,
  faWords: AlignedWordInput[],
  beatStartSec: number,
  beatDurSec: number,
): TimedWord[] | null {
  const display = displayWords(displayText);
  if (display.length === 0 || !Array.isArray(faWords)) return null;
  const kept = faWords.filter((x) => x && typeof x.text === "string" && x.text.trim() !== "");
  if (kept.length !== display.length) return null;
  if (kept.some((x) => !Number.isFinite(x.start) || !Number.isFinite(x.end))) return null;

  const lo = beatStartSec;
  const hi = beatStartSec + beatDurSec;
  let prevS = lo;
  return display.map((w, i) => {
    const s = Math.max(clamp(kept[i].start + beatStartSec, lo, hi), prevS);
    const e = Math.max(clamp(kept[i].end + beatStartSec, lo, hi), s);
    prevS = s;
    return { w, s, e };
  });
}

// Pause after a word, in characters' worth of time: a comma-ish stop is short, a sentence end longer.
const SOFT_PAUSE_CHARS = 2;
const HARD_PAUSE_CHARS = 4;

/**
 * Fallback timing: the beat's speech length spread over its words in proportion to their length, with a
 * little extra time after a word that ends in , ; : . ! ? (not after the last word: speech ends with it).
 * Words stay inside [beatStartSec, beatStartSec + beatDurSec], s <= e and s ascending.
 */
export function estimateWords(
  displayText: string,
  beatStartSec: number,
  speechSec: number,
  beatDurSec: number,
): TimedWord[] {
  const display = displayWords(displayText);
  if (display.length === 0) return [];

  const speech = Number.isFinite(speechSec) && speechSec > 0 ? Math.min(speechSec, beatDurSec) : beatDurSec;
  const pauseAfter = (w: string, i: number): number => {
    if (i === display.length - 1) return 0;
    if (/[.!?]$/.test(w)) return HARD_PAUSE_CHARS;
    if (/[,;:]$/.test(w)) return SOFT_PAUSE_CHARS;
    return 0;
  };
  const total = display.reduce((sum, w, i) => sum + w.length + pauseAfter(w, i), 0);
  const perChar = speech / total;

  const lo = beatStartSec;
  const hi = beatStartSec + beatDurSec;
  let cursor = beatStartSec;
  let prevS = lo;
  return display.map((w, i) => {
    const s = Math.max(clamp(cursor, lo, hi), prevS);
    const e = Math.max(clamp(cursor + w.length * perChar, lo, hi), s);
    cursor += (w.length + pauseAfter(w, i)) * perChar;
    prevS = s;
    return { w, s, e };
  });
}

export interface AlignBeatInput {
  /** The beat's display text (what the viewer reads), not the pronunciation-respelled TTS text. */
  text: string;
  startSec: number;
  /** Length of the spoken clip inside the beat (the gap that follows is not speech). */
  speechSec: number;
  durSec: number;
}

export interface AlignOptions {
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

export interface AlignResult {
  words: TimedWord[][];
  aligned: number;
  estimated: number;
}

/** Cut [startSec, startSec + speechSec] out of the full track as a 16 kHz mono wav (argument array, no shell). */
async function cutClip(audioPath: string, beat: AlignBeatInput, outPath: string): Promise<void> {
  await execFileAsync(
    "ffmpeg",
    [
      "-y", "-hide_banner", "-loglevel", "error",
      "-ss", beat.startSec.toFixed(3), "-t", beat.speechSec.toFixed(3),
      "-i", audioPath,
      "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le",
      outPath,
    ],
    { timeout: 60_000 },
  );
}

async function requestAlignment(clipPath: string, text: string, apiKey: string, fetchImpl: typeof fetch): Promise<AlignedWordInput[]> {
  const form = new FormData();
  form.append("file", new Blob([await readFile(clipPath)], { type: "audio/wav" }), "beat.wav");
  form.append("text", text);
  const res = await fetchImpl(ALIGN_URL, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: form,
    signal: AbortSignal.timeout(ALIGN_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`forced alignment answered HTTP ${res.status}`);
  const json = (await res.json()) as { words?: unknown };
  if (!Array.isArray(json.words)) throw new Error("forced alignment answer has no words array");
  return json.words as AlignedWordInput[];
}

/**
 * Per-beat word timings for the whole track: forced alignment where it works, the estimate where it does not.
 * Up to four beats are in flight at once. The ElevenLabs key (ELEVENLABS_VOICE_KEY, the same account the voice
 * uses) is read here and never logged.
 */
export async function alignBeatWords(
  audioPath: string,
  beats: AlignBeatInput[],
  opts: AlignOptions = {},
): Promise<AlignResult> {
  const log = opts.log ?? (() => undefined);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiKey = process.env.ELEVENLABS_VOICE_KEY;
  if (!apiKey) log("word timings: ELEVENLABS_VOICE_KEY is not set, every beat is estimated");

  const words: TimedWord[][] = new Array(beats.length);
  let aligned = 0;
  let estimated = 0;
  const tmp = await mkdtemp(path.join(tmpdir(), "yt-align-"));
  try {
    const doBeat = async (i: number): Promise<void> => {
      const beat = beats[i];
      let mapped: TimedWord[] | null = null;
      let why = "no API key";
      if (apiKey && beat.speechSec > 0) {
        const clip = path.join(tmp, `beat_${i}.wav`);
        try {
          await cutClip(audioPath, beat, clip);
          const fa = await requestAlignment(clip, beat.text, apiKey, fetchImpl);
          mapped = mapAlignedWords(beat.text, fa, beat.startSec, beat.durSec);
          if (!mapped) why = `alignment returned ${fa.filter((x) => x?.text?.trim()).length} words for ${displayWords(beat.text).length} display words`;
        } catch (err) {
          why = err instanceof Error ? err.message.split("\n")[0] : String(err);
        } finally {
          await rm(clip, { force: true });
        }
      } else if (apiKey) {
        why = "beat has no speech";
      }
      if (mapped) {
        words[i] = mapped;
        aligned++;
      } else {
        words[i] = estimateWords(beat.text, beat.startSec, beat.speechSec, beat.durSec);
        estimated++;
        log(`word timings: beat ${i} estimated (${why})`);
      }
    };

    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < beats.length) await doBeat(next++);
    };
    await Promise.all(Array.from({ length: Math.min(ALIGN_CONCURRENCY, beats.length) }, worker));
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
  log(`word timings: ${aligned} beats aligned, ${estimated} estimated`);
  return { words, aligned, estimated };
}
