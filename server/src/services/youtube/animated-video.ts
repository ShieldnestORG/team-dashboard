/**
 * YouTube Pipeline — animated video (production wiring for animated/render.ts).
 *
 * Takes the same beats, measured slide durations and voice track the presentation mode uses, adds per-word
 * timings, writes the timeline JSON the scenes page reads, renders it frame by frame and returns the finished
 * mp4. The caller (production.ts) decides what to do when this throws.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { renderAnimated, type Timeline } from "./animated/render.js";
import type { Beat } from "./presentation-renderer.js";
import { alignBeatWords, type AlignBeatInput, type AlignResult, type TimedWord } from "./word-timings.js";

const nonEmpty = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v : undefined);

/**
 * The timeline the scenes page plays. startSec is the running sum of the slide durations (the measured clip
 * length plus the gap that follows it), so a scene starts exactly where its voice clip starts.
 */
export function buildAnimatedTimeline(
  beats: Beat[],
  slideDurations: number[],
  audioPath: string,
  words?: (TimedWord[] | undefined)[],
): Timeline {
  if (beats.length !== slideDurations.length) {
    throw new Error(`animated timeline: ${beats.length} beats but ${slideDurations.length} slide durations`);
  }
  let startSec = 0;
  const out: Timeline["beats"] = beats.map((beat, i) => {
    const durSec = slideDurations[i];
    const item: Timeline["beats"][number] = { type: beat.type, text: beat.text, startSec, durSec };
    startSec += durSec;

    const title = nonEmpty(beat.req.title);
    const subtitle = nonEmpty(beat.req.subtitle);
    const badge = nonEmpty(beat.req.badge);
    if (title) item.title = title;
    if (subtitle) item.subtitle = subtitle;
    if (badge) item.badge = badge;

    const content = beat.req.content;
    if (Array.isArray(content) && content.length > 0 && content.every((c) => typeof c === "string")) {
      item.items = content;
      const h = beat.req.highlightIndex;
      if (typeof h === "number" && Number.isInteger(h) && h >= 0 && h < content.length) item.highlight = h;
    }

    const w = words?.[i];
    if (w && w.length > 0) item.words = w;
    return item;
  });
  return { width: 1920, height: 1080, fps: 30, audio: path.resolve(audioPath), beats: out };
}

export interface RenderAnimatedVideoOptions {
  productionId: string;
  beats: Beat[];
  /** Per beat: speech + the gap that follows it (the last beat has no gap). */
  slideDurations: number[];
  /** Per beat: the measured length of its voice clip. */
  speechDurations: number[];
  audioPath: string;
  /** Where video_<productionId>.mp4 and its timeline JSON are written. */
  outDir: string;
  chromiumPath?: string;
  /** Replaces the ElevenLabs forced alignment (tests, offline runs). */
  aligner?: (audioPath: string, beats: AlignBeatInput[]) => Promise<AlignResult>;
  log?: (line: string) => void;
}

export interface RenderAnimatedVideoResult {
  videoPath: string;
  durationSec: number;
  fileSizeBytes: number;
  warnings: string[];
  aligned: number;
  estimated: number;
  /** Everything: alignment, render, encode, mux. */
  wallSec: number;
}

export async function renderAnimatedVideo(opts: RenderAnimatedVideoOptions): Promise<RenderAnimatedVideoResult> {
  const t0 = performance.now();
  const { productionId, beats, slideDurations, speechDurations, audioPath, outDir } = opts;
  const log = opts.log ?? (() => undefined);
  if (speechDurations.length !== beats.length) {
    throw new Error(`animated video: ${beats.length} beats but ${speechDurations.length} speech durations`);
  }

  // Word timings first: they need the beats' start times, which are the running sum of the slide durations.
  let startSec = 0;
  const alignInput: AlignBeatInput[] = beats.map((beat, i) => {
    const input = { text: beat.text, startSec, speechSec: speechDurations[i], durSec: slideDurations[i] };
    startSec += slideDurations[i];
    return input;
  });
  const aligner = opts.aligner ?? ((a: string, b: AlignBeatInput[]) => alignBeatWords(a, b, { log }));
  const { words, aligned, estimated } = await aligner(audioPath, alignInput);

  const timeline = buildAnimatedTimeline(beats, slideDurations, audioPath, words);
  await mkdir(outDir, { recursive: true });
  const timelinePath = path.join(outDir, `timeline_${productionId}.json`);
  await writeFile(timelinePath, JSON.stringify(timeline, null, 2));

  const videoPath = path.join(outDir, `video_${productionId}.mp4`);
  const rendered = await renderAnimated({ timelinePath, outPath: videoPath, chromiumPath: opts.chromiumPath, log });
  const { size } = await stat(videoPath);

  return {
    videoPath,
    durationSec: rendered.clipSec,
    fileSizeBytes: size,
    warnings: rendered.warnings,
    aligned,
    estimated,
    wallSec: (performance.now() - t0) / 1000,
  };
}
