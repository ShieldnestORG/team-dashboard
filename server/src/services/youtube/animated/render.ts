/**
 * YouTube Pipeline - Animated scenes renderer (PROTOTYPE)
 *
 * Voice first, picture fitted to the measured voice, recorded frame by frame:
 *  1. read a timeline (beats with startSec/durSec, optional audio and SRT captions),
 *  2. open scenes.html in headless Chromium at 1920x1080,
 *  3. for frame i, call window.seek(from + i / fps) and take a JPEG screenshot (every animation on the
 *     page is paused and set to that time, so frame i is the page at exactly that moment),
 *  4. pipe the frames into ffmpeg (libx264, yuv420p), then mux the timeline's audio if there is one.
 *
 * The page, its fonts and the cast scripts live beside this file (scenes.html, assets/fonts, cast/); the server build
 * copies them next to the compiled file.
 *
 * Cast (timeline.cast, off unless the production asks for it): three gears with faces react to the narration on the
 * same clock, and with `music` a synthesized bed is rendered by the page, set 12 LU under the voice and ducked
 * under it (sidechain), then mixed in. Without a cast nothing below changes.
 *
 * Chromium: uses Playwright's own build by default. Set YT_ANIMATED_CHROMIUM (or pass chromiumPath) to use
 * a different executable, e.g. when the cached browser build does not match the installed Playwright.
 */

import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Writable } from "node:stream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BeatType = "title" | "content" | "section_title" | "conclusion" | "hook" | "cta";

export interface Beat {
  type: BeatType;
  text: string;
  title?: string;
  subtitle?: string;
  items?: string[];
  highlight?: number;
  badge?: string;
  words?: { w: string; s: number; e: number }[];
  icon?: Icon;
  startSec: number;
  durSec: number;
}

export interface Timeline {
  width: number;
  height: number;
  fps: number;
  /** Audio file, relative to the timeline file (or absolute). */
  audio: string | null;
  /** Optional SRT file, relative to the timeline file (or absolute). Without it cues are derived from beat text. */
  captions?: string;
  beats: Beat[];
  /** The gears and (with music) the synthesized bed; absent = the classic look, unchanged. */
  cast?: CastOptions;
}

export interface CastOptions {
  /** Picks the bed's key, chords and tempo and varies the gears' moves; the same seed always gives the same video. */
  seed: number;
  /** Mix the synthesized music bed under the voice. */
  music: boolean;
}

export interface CastReport {
  places: Array<{ kind: string; start: number; anchor?: string; scale?: number; hidden?: boolean }>;
  actors: number;
  acts: number;
  bed: { bpm: number; key: number; notes: number; segments: number };
  warnings: string[];
}

export interface MusicReport {
  voiceLufs: number;
  bedLufs: number;
  /** dB applied to the bed before ducking: puts it BED_UNDER_VOICE_LU under the voice. */
  bedGainDb: number;
  /** Loudness of the finished soundtrack. */
  mixLufs: number;
}

export interface Cue {
  start: number;
  end: number;
  text: string;
}

export interface LoadedTimeline {
  timeline: Timeline;
  cues: Cue[];
  audioPath: string | null;
  /** End of the last beat, in seconds. */
  totalSec: number;
}

export interface RenderOptions {
  timelinePath: string;
  outPath: string;
  /** First second to render (default 0). */
  fromSec?: number;
  /** End second, exclusive (default: end of the last beat). */
  toSec?: number;
  chromiumPath?: string;
  log?: (line: string) => void;
}

export interface RenderResult {
  outPath: string;
  frames: number;
  /** Length of the rendered clip in seconds. */
  clipSec: number;
  /** Seconds spent in the screenshot loop (browser launch and mux excluded). */
  loopSec: number;
  /** Frames per wall-clock second achieved in the screenshot loop. */
  framesPerSec: number;
  /** Wall-clock seconds for everything: load, render, encode, mux. */
  wallSec: number;
  hasAudio: boolean;
  scenes: number;
  animations: number;
  /** Layout warnings from the page; the video was still rendered. */
  warnings: string[];
  /** What the cast did (null without a cast). */
  cast: CastReport | null;
  /** The music bed's levels (null without music). */
  music: MusicReport | null;
}

interface PageReport {
  scenes: Array<{ kind: string; start: number; end: number; exitAt: number | null; beats: number; fitSize: string | null }>;
  animations: number;
  pageAnimations: number;
  animatedProperties: string[];
  counters: number;
  cues: number;
  /** Things that did not fit (text taller than its room, caption cues that would be cut off). */
  warnings: string[];
  cast: CastReport | null;
  fonts: Array<{ family: string; status: string }>;
}

interface PageApi {
  loadTimeline(timeline: Timeline, cues: Cue[]): Promise<PageReport>;
  seek(tSec: number): void;
  renderCastBed(sampleRate: number): Promise<{ frames: number; sampleRate: number; peak: number }>;
  castBedChunk(start: number, count: number): string;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SCENES_HTML = path.join(HERE, "scenes.html");

const BEAT_TYPES: readonly BeatType[] = ["title", "content", "section_title", "conclusion", "hook", "cta"];
const STAGE = { width: 1920, height: 1080 } as const;

export const ICONS = [
  "chart-up",
  "chart-down",
  "coins",
  "shield",
  "calendar",
  "brain",
  "heart",
  "people",
  "lightbulb",
  "scale",
  "clock",
  "network",
  "lock",
  "server",
  "check",
  "alert",
  "swap",
  "vote",
  "hourglass",
] as const;
export type Icon = typeof ICONS[number];

// ---------------------------------------------------------------------------
// Timeline: validation, captions
// ---------------------------------------------------------------------------

function bad(message: string): never {
  throw new Error(`Invalid timeline: ${message}`);
}

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) bad(`${label} must be a finite number`);
  return value;
}

// The icon for one sentence: the FIRST rule whose words appear in it wins, so the rules run from the most
// specific idea to the most generic. Specific (what the sentence is about) comes first, then the older
// general rules, and coins is the fallback for money words when nothing else matched.
export function pickIcon(text: string): Icon | undefined {
  const lower = text.toLowerCase();
  const rules: Array<[RegExp, Icon]> = [
    // specific ideas
    [/\b(waits?|waiting|periods?|days|delays?|cooldown)\b/, "hourglass"],
    [/\b(lock|locks|locked|locking|unlock\w*|unbond\w*|withdraw\w*)\b/, "lock"],
    [/\b(vot(?:e|es|ed|ing|er|ers)|delegat\w*|governance)\b/, "vote"],
    // risks(?!...manage): "risk management" stays a shield (below), every other risk is an alert
    [/\b(risks?\b(?!.*manage)|slash(?:es|ed|ing)?|penalt(?:y|ies)|malicious(?:ly)?|attack(?:s|ed|er|ers)?|scams?|loss|losses)\b/, "alert"],
    [/\b(valid|verif(?:y|ies|ied|ication)|honest(?:y|ly)?|agree(?:s|d|ment)?|consensus)\b/, "check"],
    [/\b(farming|liquidity|pools?|trading|swaps?|swapping|pair|pairs|paired)\b/, "swap"],
    [/\b(validators?|nodes?|uptime|hardware|blocks?|servers?)\b/, "server"],
    // general rules (unchanged order)
    [/\b(grow|growth|up|gain|outperform)\b/, "chart-up"],
    [/\b(drop|crash|lose|fail)\b/, "chart-down"],
    [/\b(risk|safe|safety|protect|principal)\b/, "shield"],
    [/\b(week|month|quarter|year|date|calendar|schedule)\b/, "calendar"],
    [/\b(mind|mindset|brain|think|focus|discipline)\b/, "brain"],
    [/\b(body|health|heart|breath|sleep)\b/, "heart"],
    [/\b(people|community|friend|family|team)\b/, "people"],
    [/\b(idea|learn|guide|tip|explain)\b/, "lightbulb"],
    [/\b(balance|rule|allocation|split)\b/, "scale"],
    [/\b(time|patient|daily|clock)\b/, "clock"],
    [/\b(network|ecosystem|chain|infrastructure|developers)\b/, "network"],
    // money words, only when nothing more specific matched
    [/\b(coins?|tokens?|crypto|yields?|stakes?|staked|staking|rewards?|earn(?:s|ed|ing)?|portfolio|defi)\b/, "coins"],
  ];
  for (const [re, icon] of rules) {
    if (re.test(lower)) return icon;
  }
  return undefined;
}

export function validateTimeline(raw: unknown): Timeline {
  if (typeof raw !== "object" || raw === null) bad("not a JSON object");
  const r = raw as Record<string, unknown>;
  const width = finite(r.width, "width");
  const height = finite(r.height, "height");
  if (width !== STAGE.width || height !== STAGE.height) {
    bad(`the scenes page is ${STAGE.width}x${STAGE.height} only, got ${width}x${height}`);
  }
  const fps = finite(r.fps, "fps");
  if (!Number.isInteger(fps) || fps < 1 || fps > 120) bad("fps must be an integer from 1 to 120");
  if (r.audio !== null && r.audio !== undefined && typeof r.audio !== "string") bad("audio must be a path string or null");
  if (r.captions !== undefined && typeof r.captions !== "string") bad("captions must be a path string");
  let cast: CastOptions | undefined;
  if (r.cast !== undefined) {
    if (typeof r.cast !== "object" || r.cast === null) bad("cast must be an object");
    const c = r.cast as Record<string, unknown>;
    if (typeof c.seed !== "number" || !Number.isInteger(c.seed) || c.seed < 0 || c.seed > 2 ** 31) bad("cast.seed must be an integer from 0 to 2^31");
    if (typeof c.music !== "boolean") bad("cast.music must be true or false");
    cast = { seed: c.seed, music: c.music };
  }
  if (!Array.isArray(r.beats) || r.beats.length === 0) bad("beats must be a non-empty array");

  const beats: Beat[] = r.beats.map((b: unknown, i: number) => {
    if (typeof b !== "object" || b === null) bad(`beat ${i} is not an object`);
    const x = b as Record<string, unknown>;
    if (!BEAT_TYPES.includes(x.type as BeatType)) bad(`beat ${i} has unknown type ${JSON.stringify(x.type)}`);
    if (typeof x.text !== "string") bad(`beat ${i} needs a text string`);
    const startSec = finite(x.startSec, `beat ${i} startSec`);
    const durSec = finite(x.durSec, `beat ${i} durSec`);
    if (startSec < 0 || durSec <= 0) bad(`beat ${i} needs startSec >= 0 and durSec > 0`);
    for (const key of ["title", "subtitle", "badge"] as const) {
      if (x[key] !== undefined && typeof x[key] !== "string") bad(`beat ${i} ${key} must be a string`);
    }
    let items: string[] | undefined;
    if (x.items !== undefined) {
      if (!Array.isArray(x.items) || x.items.some((s) => typeof s !== "string")) bad(`beat ${i} items must be strings`);
      items = x.items as string[];
    }
    if ((x.type === "content" || x.type === "conclusion") && (!items || items.length === 0)) {
      bad(`beat ${i} (${String(x.type)}) needs a non-empty items array`);
    }
    let highlight: number | undefined;
    if (x.highlight !== undefined) {
      highlight = finite(x.highlight, `beat ${i} highlight`);
      if (!Number.isInteger(highlight) || highlight < 0 || (items && highlight >= items.length)) {
        bad(`beat ${i} highlight ${highlight} is outside its ${items?.length ?? 0} items`);
      }
    }
    // Words validation
    let words: { w: string; s: number; e: number }[] | undefined;
    if (x.words !== undefined) {
      if (!Array.isArray(x.words)) bad(`beat ${i} words must be an array`);
      words = (x.words as unknown[]).map((wObj, wi) => {
        if (typeof wObj !== "object" || wObj === null) bad(`beat ${i} words[${wi}] must be an object`);
        const wo = wObj as Record<string, unknown>;
        const w = wo.w;
        const s = wo.s;
        const e = wo.e;
        if (typeof w !== "string" || w.length === 0) bad(`beat ${i} words[${wi}].w must be a non-empty string`);
        if (typeof s !== "number" || !Number.isFinite(s)) bad(`beat ${i} words[${wi}].s must be a finite number`);
        if (typeof e !== "number" || !Number.isFinite(e)) bad(`beat ${i} words[${wi}].e must be a finite number`);
        if (s > e) bad(`beat ${i} words[${wi}] s (${s}) > e (${e})`);
        if (s < startSec - 0.5 || e > startSec + durSec + 0.5) {
          bad(`beat ${i} words[${wi}] timestamps out of beat span`);
        }
        return { w: w as string, s, e };
      });
      // Ensure ascending order of start times
      for (let wi = 1; wi < words.length; wi++) {
        if (words[wi].s < words[wi - 1].s) {
          bad(`beat ${i} words are not in ascending order`);
        }
      }
    }
    // Icon handling
    let icon: Icon | undefined;
    if (x.icon !== undefined) {
      if (typeof x.icon !== "string") bad(`beat ${i} icon must be a string`);
      if (!ICONS.includes(x.icon as Icon)) bad(`beat ${i} has unknown icon ${x.icon}`);
      icon = x.icon as Icon;
    } else {
      const derived = pickIcon(x.text);
      if (derived) icon = derived;
    }
    return {
      type: x.type as BeatType,
      text: x.text,
      title: x.title as string | undefined,
      subtitle: x.subtitle as string | undefined,
      items,
      highlight,
      badge: x.badge as string | undefined,
      words,
      icon,
      startSec,
      durSec,
    };
  });
  for (let i = 1; i < beats.length; i++) {
    if (beats[i].startSec < beats[i - 1].startSec) bad(`beat ${i} starts before beat ${i - 1}`);
  }
  return {
    width,
    height,
    fps,
    audio: typeof r.audio === "string" ? r.audio : null,
    captions: r.captions as string | undefined,
    beats,
    ...(cast ? { cast } : {}),
  };
}

/** Split words into groups of 3-8 words, preferring to cut after punctuation within 2 words of an even split. */
function groupWords(words: string[]): string[][] {
  const n = words.length;
  if (n <= 8) return [words];
  const minGroups = Math.ceil(n / 8);
  const maxGroups = Math.floor(n / 3);
  const g = Math.min(maxGroups, Math.max(minGroups, Math.round(n / 5.5)));
  const cuts = [0];
  for (let j = 1; j < g; j++) {
    const ideal = Math.round((j * n) / g);
    let pick = ideal;
    for (const d of [0, -1, 1, -2, 2]) {
      const q = ideal + d;
      const left = q - cuts[j - 1];
      const rest = n - q;
      if (left < 3 || left > 8 || rest < 3 * (g - j) || rest > 8 * (g - j)) continue;
      if (/[.,;:!?]$/.test(words[q - 1])) {
        pick = q;
        break;
      }
    }
    cuts.push(pick);
  }
  cuts.push(n);
  const sizes = cuts.slice(1).map((c, i) => c - cuts[i]);
  if (sizes.some((s) => s < 3 || s > 8)) {
    // punctuation snapping broke a limit: fall back to an even split, which always keeps every group in 3-8
    const even: number[] = [0];
    for (let j = 1; j <= g; j++) even.push(Math.round((j * n) / g));
    return even.slice(1).map((c, i) => words.slice(even[i], c));
  }
  return cuts.slice(1).map((c, i) => words.slice(cuts[i], c));
}

/**
 * Caption cues without an SRT: each beat's text is cut into groups of 3-8 words, spread over the beat's
 * spoken part (durSec - 0.6, except on the last beat) in proportion to their word counts.
 */
export function deriveCues(beats: Beat[]): Cue[] {
  const cues: Cue[] = [];
  beats.forEach((beat, i) => {
    if (beat.words && beat.words.length > 0) return; // skip beats with word annotations
    const words = beat.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return;
    const spoken = i === beats.length - 1 ? beat.durSec : Math.max(beat.durSec - 0.6, 0.1);
    let done = 0;
    for (const group of groupWords(words)) {
      const start = beat.startSec + (spoken * done) / words.length;
      done += group.length;
      cues.push({ start, end: beat.startSec + (spoken * done) / words.length, text: group.join(" ") });
    }
  });
  return cues;
}

const SRT_TIME = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/;

export function parseSrt(source: string): Cue[] {
  const toSec = (h: string, m: string, s: string, ms: string): number =>
    Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, "0")) / 1000;
  const cues: Cue[] = [];
  for (const block of source.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim());
    const at = lines.findIndex((l) => SRT_TIME.test(l));
    if (at < 0) continue;
    const m = SRT_TIME.exec(lines[at]);
    if (!m) continue;
    const text = lines
      .slice(at + 1)
      .join(" ")
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (text) cues.push({ start: toSec(m[1], m[2], m[3], m[4]), end: toSec(m[5], m[6], m[7], m[8]), text });
  }
  return cues.sort((a, b) => a.start - b.start);
}

export async function loadTimeline(timelinePath: string): Promise<LoadedTimeline> {
  const abs = path.resolve(timelinePath);
  const dir = path.dirname(abs);
  const timeline = validateTimeline(JSON.parse(await readFile(abs, "utf8")));
  const audioPath = timeline.audio ? path.resolve(dir, timeline.audio) : null;
  const cues = timeline.captions
    ? parseSrt(await readFile(path.resolve(dir, timeline.captions), "utf8"))
    : deriveCues(timeline.beats);
  const last = timeline.beats[timeline.beats.length - 1];
  return { timeline, cues, audioPath, totalSec: last.startSec + last.durSec };
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

interface Encoder {
  stdin: Writable;
  done: Promise<void>;
  kill: () => void;
  /** Why ffmpeg failed, once it has (its own stderr), else null. */
  failure: () => Error | null;
}

function runFfmpeg(args: string[], what: string): Encoder {
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  let failure: Error | null = null;
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });
  const done = new Promise<void>((resolve, reject) => {
    // the first failure wins: a failed spawn emits "error" and then "close" with a meaningless code
    const fail = (err: Error): void => {
      failure ??= err;
      reject(failure);
    };
    child.on("error", (err) => fail(new Error(`could not start ffmpeg for ${what}: ${err.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else fail(new Error(`ffmpeg ${what} exited with ${code}: ${stderr.trim()}`));
    });
  });
  // a dead ffmpeg also closes stdin with EPIPE; `failure` carries the real reason
  child.stdin.on("error", () => undefined);
  done.catch(() => undefined);
  return { stdin: child.stdin, done, kill: () => child.kill("SIGKILL"), failure: () => failure };
}

/** ffmpeg's stdin closed: ffmpeg exited. Its exit status and stderr (the reason) arrive a moment later. */
class PipeClosedError extends Error {}

// ---------------------------------------------------------------------------
// Music bed (cast with music only)
// ---------------------------------------------------------------------------

/**
 * The bed sits this many LU under the voice before ducking, and the voice ducks it further while Mark speaks. Measured on
 * episode 787084c8 (2026-11-16, 400 ms loudness frames of the ducked bed against the voice): the bed is a median 20.7 LU
 * under the voice while he speaks and 14.4 LU under the voice's level in the pauses. The first setting (18 LU, ratio 6,
 * threshold 0.02) measured 35.0 and 21.7 LU there: a bed nobody would hear.
 */
export const BED_UNDER_VOICE_LU = 12;

/** Integrated loudness (EBU R128, LUFS) of a file or a window of it. NaN for silence. */
export async function measureLufs(file: string, fromSec?: number, durSec?: number): Promise<number> {
  const args = ["-hide_banner", "-nostats"];
  if (fromSec !== undefined) args.push("-ss", String(fromSec));
  if (durSec !== undefined) args.push("-t", String(durSec));
  args.push("-i", file, "-af", "ebur128=framelog=quiet", "-f", "null", "-");
  const stderr = await new Promise<string>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => {
      err = (err + d.toString()).slice(-8000);
    });
    child.on("error", (e) => reject(new Error(`could not start ffmpeg for loudness: ${e.message}`)));
    child.on("close", (code) => (code === 0 ? resolve(err) : reject(new Error(`ffmpeg loudness exited with ${code}: ${err.trim()}`))));
  });
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const m = /I:\s+(-?[\d.]+|-inf)\s+LUFS/.exec(summary);
  return m && m[1] !== "-inf" ? Number(m[1]) : Number.NaN;
}

/** 16-bit stereo PCM WAV header for `frames` frames. */
function wavHeader(frames: number, sampleRate: number): Buffer {
  const data = frames * 4;
  const b = Buffer.alloc(44);
  b.write("RIFF", 0, "ascii");
  b.writeUInt32LE(36 + data, 4);
  b.write("WAVE", 8, "ascii");
  b.write("fmt ", 12, "ascii");
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(2, 22); // stereo
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(sampleRate * 4, 28);
  b.writeUInt16LE(4, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36, "ascii");
  b.writeUInt32LE(data, 40);
  return b;
}

/**
 * The mux filter with a bed: voice untouched; bed at `bedGainDb`, ducked by the voice (sidechaincompress), summed with no
 * normalisation, then a peak limiter with auto-level off (so the voice keeps the loudness it has without a bed).
 */
export function bedMixFilter(bedGainDb: number): string {
  const st = "aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo";
  return (
    `[1:a]${st},asplit=2[voice][key];` +
    `[2:a]${st},volume=${bedGainDb.toFixed(2)}dB[bed];` +
    "[bed][key]sidechaincompress=threshold=0.05:ratio=3:attack=20:release=500[ducked];" +
    "[voice][ducked]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97:level=disabled[mix]"
  );
}

function writeFrame(stream: Writable, chunk: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.destroyed || stream.writableEnded) {
      reject(new PipeClosedError("ffmpeg stdin is closed"));
      return;
    }
    const onClose = (): void => reject(new PipeClosedError("ffmpeg stdin closed while writing"));
    stream.once("close", onClose);
    const finish = (): void => {
      stream.off("close", onClose);
      resolve();
    };
    if (stream.write(chunk)) finish();
    else stream.once("drain", finish);
  });
}

// JPEG frames are BT.601 full range YUV; the file is BT.709 limited range (what players assume for HD). Go through RGB
// so each step has one meaning: a YUV-to-YUV `scale` ignores the matrix options, and the brand colours then come out a
// few levels off (measured: Raised Surface rgb(24,24,27) played back as rgb(21,24,23), a green cast; through RGB it
// plays back exact). Then tag the frames so the stream says what it is.
const VIDEO_FILTER =
  "format=rgb24,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p," +
  "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv";

function encodeArgs(fps: number, outFile: string): string[] {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "pipe:0",
    "-an", "-vf", VIDEO_FILTER,
    "-c:v", "libx264", "-profile:v", "high", "-crf", "20", "-pix_fmt", "yuv420p",
    "-r", String(fps), "-movflags", "+faststart",
    outFile,
  ];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export async function renderAnimated(opts: RenderOptions): Promise<RenderResult> {
  const log = opts.log ?? (() => undefined);
  const wallStart = performance.now();
  const { timeline, cues, audioPath, totalSec } = await loadTimeline(opts.timelinePath);
  const fps = timeline.fps;
  const from = opts.fromSec ?? 0;
  const to = Math.min(opts.toSec ?? totalSec, totalSec);
  if (!(from >= 0) || !(to > from)) {
    throw new Error(`nothing to render: from=${from}, to=${to} (timeline is ${totalSec.toFixed(3)} s)`);
  }
  const frames = Math.round((to - from) * fps);
  const outPath = path.resolve(opts.outPath);
  await mkdir(path.dirname(outPath), { recursive: true });
  const videoFile = audioPath ? `${outPath}.video.tmp.mp4` : outPath;
  // the bed needs a voice to sit under; a timeline without audio gets the gears only
  const bedFile = timeline.cast?.music && audioPath ? `${outPath}.bed.tmp.wav` : null;

  const { chromium } = await import("playwright");
  const executablePath = opts.chromiumPath ?? process.env.YT_ANIMATED_CHROMIUM ?? undefined;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath, args: ["--force-color-profile=srgb"] });
  } catch (err) {
    throw new Error(
      `could not start Chromium (${err instanceof Error ? err.message.split("\n")[0] : String(err)}). ` +
        "Run `npx playwright install chromium` or set YT_ANIMATED_CHROMIUM to a Chromium executable.",
    );
  }

  const encoder = runFfmpeg(encodeArgs(fps, videoFile), "encode");
  const pageErrors: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: STAGE.width, height: STAGE.height }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") pageErrors.push(m.text());
    });
    await page.goto(pathToFileURL(SCENES_HTML).href);
    const report = await page.evaluate(
      ([tl, cu]) => (window as unknown as PageApi).loadTimeline(tl, cu),
      [timeline, cues] as [Timeline, Cue[]],
    );
    // refuse to record a page that fell back to a system font or animates anything but transform and opacity
    const missing = ["Geist", "Geist Mono"].filter((f) => !report.fonts.some((x) => x.family === f && x.status === "loaded"));
    if (missing.length) throw new Error(`fonts not loaded: ${missing.join(", ")}; a fallback font would be recorded`);
    const extra = report.animatedProperties.filter((p) => p !== "opacity" && p !== "transform");
    if (extra.length) throw new Error(`scenes animate more than transform and opacity: ${extra.join(", ")}`);
    log(
      `${report.scenes.length} scenes, ${report.animations} animations, ${report.counters} counting numbers, ` +
        `${report.cues} caption cues; rendering ${frames} frames (${from}s to ${to.toFixed(3)}s at ${fps} fps)`,
    );
    for (const w of report.warnings) log(`WARNING: ${w}`);
    if (report.cast) {
      const shown = report.cast.places.filter((p) => !p.hidden).length;
      log(
        `cast: ${report.cast.actors} gears, ${report.cast.acts} acts, shown in ${shown} of ${report.cast.places.length} scenes; ` +
          `bed ${report.cast.bed.bpm} bpm, ${report.cast.bed.notes} notes${bedFile ? "" : " (not mixed)"}`,
      );
    }

    const loopStart = performance.now();
    let nextLog = loopStart + 5000;
    for (let i = 0; i < frames; i++) {
      await page.evaluate((t) => (window as unknown as PageApi).seek(t), from + i / fps);
      const jpeg = await page.screenshot({ type: "jpeg", quality: 92 });
      await writeFrame(encoder.stdin, jpeg);
      const now = performance.now();
      if (now >= nextLog) {
        nextLog = now + 5000;
        log(`frame ${i + 1}/${frames} (${((i + 1) / ((now - loopStart) / 1000)).toFixed(1)} fps)`);
      }
    }
    const loopSec = (performance.now() - loopStart) / 1000;
    if (pageErrors.length) throw new Error(`page errors: ${pageErrors.slice(0, 3).join(" | ")}`);

    if (bedFile) {
      const bed = await page.evaluate((sr) => (window as unknown as PageApi).renderCastBed(sr), 48000);
      if (!(bed.peak > 0)) throw new Error("the music bed rendered silent");
      const chunks: Buffer[] = [wavHeader(bed.frames, bed.sampleRate)];
      const step = bed.sampleRate * 10;
      for (let at = 0; at < bed.frames; at += step) {
        const b64 = await page.evaluate(([a, n]) => (window as unknown as PageApi).castBedChunk(a, n), [at, step] as [number, number]);
        chunks.push(Buffer.from(b64, "base64"));
      }
      await writeFile(bedFile, Buffer.concat(chunks));
    }

    encoder.stdin.end();
    await encoder.done;
    await browser.close();
    browser = undefined;

    let music: MusicReport | null = null;
    if (audioPath && bedFile) {
      // level the bed against this video's own voice, then duck it under the voice and mix
      const voiceLufs = await measureLufs(audioPath, from, to - from);
      const bedLufs = await measureLufs(bedFile, from, to - from);
      if (!Number.isFinite(voiceLufs) || !Number.isFinite(bedLufs)) {
        throw new Error(`music bed: loudness not measurable (voice ${voiceLufs}, bed ${bedLufs})`);
      }
      const bedGainDb = voiceLufs - BED_UNDER_VOICE_LU - bedLufs;
      const mux = runFfmpeg(
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", videoFile,
          "-ss", String(from), "-t", String(to - from), "-i", audioPath,
          "-ss", String(from), "-t", String(to - from), "-i", bedFile,
          "-filter_complex", bedMixFilter(bedGainDb),
          "-map", "0:v:0", "-map", "[mix]",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
          outPath,
        ],
        "audio mux with music bed",
      );
      mux.stdin.end();
      await mux.done;
      await rm(videoFile, { force: true });
      await rm(bedFile, { force: true });
      music = { voiceLufs, bedLufs, bedGainDb, mixLufs: await measureLufs(outPath) };
      log(`music bed: voice ${voiceLufs} LUFS, bed ${bedLufs} LUFS, bed gain ${bedGainDb.toFixed(1)} dB, mix ${music.mixLufs} LUFS`);
    } else if (audioPath) {
      const mux = runFfmpeg(
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", videoFile,
          "-ss", String(from), "-t", String(to - from), "-i", audioPath,
          "-map", "0:v:0", "-map", "1:a:0",
          "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
          outPath,
        ],
        "audio mux",
      );
      mux.stdin.end();
      await mux.done;
      await rm(videoFile, { force: true });
    }
    const wallSec = (performance.now() - wallStart) / 1000;
    return {
      outPath,
      frames,
      clipSec: to - from,
      loopSec,
      framesPerSec: frames / loopSec,
      wallSec,
      hasAudio: audioPath !== null,
      scenes: report.scenes.length,
      animations: report.animations,
      warnings: report.warnings,
      cast: report.cast ?? null,
      music,
    };
  } catch (err) {
    if (err instanceof PipeClosedError) {
      // the pipe closes before ffmpeg's exit status arrives: give it a moment to say why
      await Promise.race([encoder.done.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, 3000))]);
    }
    const encoderFailure = encoder.failure(); // read before our own kill() changes it
    encoder.kill();
    await browser?.close().catch(() => undefined);
    await rm(videoFile, { force: true });
    if (bedFile) await rm(bedFile, { force: true });
    if (audioPath) await rm(outPath, { force: true });
    throw encoderFailure ?? err;
  }
}
