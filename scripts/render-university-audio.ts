#!/usr/bin/env npx tsx
/**
 * Coherent Ones University — batch audio-render pipeline for the
 * "walk / breathe / learn" Presence lessons.
 *
 * Renders one MP3 per Presence lesson, keyed by the SAME slugs the text
 * lessons use (the-leak, regulate-before-you-speak, …), so audio and text
 * line up 1:1.
 *
 * ── Reuse note (read before editing) ──────────────────────────────────────
 * The audio core here is a faithful port of the YouTube pipeline's TTS, NOT a
 * reinvention:
 *   - server/src/services/youtube/tts.ts          → generateChunkedTTS():
 *       xAI Grok TTS, endpoint https://api.x.ai/v1/tts, voice `rex`, MP3
 *       24kHz / 128kbps, per-chunk 30ms edge fades + silence gaps + ffmpeg
 *       concat. Same request body, same params, same concat algorithm.
 *   - server/src/services/youtube/walkthrough-writer.ts → sanitizeTextForTTS():
 *       strips markdown, expands $/&/% etc., splits very long sentences.
 *       Replicated verbatim below.
 *
 * Why ported instead of imported: tts.ts pulls in middleware/logger.ts →
 * `pino`, which is not installed in this worktree (no node_modules), so a
 * direct import fails at runtime. And the YouTube silence gap is a hardcoded
 * const (0.6s) inside generateChunkedTTS with no override — the brand brief
 * needs a longer walking/breathing pace. Porting the exact logic keeps the
 * audio byte-equivalent to what the pipeline produces, lets the silence gap
 * become a tunable const, and keeps the script dependency-free (only fetch +
 * node stdlib + ffmpeg). Env var read is the SAME one tts.ts reads:
 * GROK_API_KEY.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   GROK_API_KEY=…  npx tsx scripts/render-university-audio.ts [slug …]
 *
 *   With no slug args: renders ALL 10 lessons.
 *   With slug args:    renders only those lessons (e.g. the-leak).
 *   --ab          also render the 3-voice A/B sample (rex / ElevenLabs / Google).
 *   --ab-only     render ONLY the A/B sample, skip lessons.
 *   --candidates  render naturalness A/B variants (v2 whole-lesson / v3 /
 *                 v2-chunked) for the given slug(s) — defaults to the-leak —
 *                 and skip the normal lesson render. Used to tune for the
 *                 least-robotic sentence-ends before batching all 10.
 *   --timings     render the CHOSEN natural read (whole-lesson, single request,
 *                 eleven_multilingual_v2, the tuned v2 settings) via the
 *                 /with-timestamps endpoint and emit EXACT per-sentence timings
 *                 so the on-screen transcript never drifts. For the given
 *                 slug(s), or ALL lessons with no slug args. Writes BOTH the
 *                 served MP3 (<slug>.mark.mp3) and <slug>.timings.json. Skips
 *                 the normal paragraph-concat lesson render.
 *
 *                 Why whole-lesson + with-timestamps: only one HTTP request, so
 *                 there are no concat seams to throw off the alignment, and
 *                 eleven_multilingual_v2 is the only timestamp-capable model
 *                 (eleven_v3 returns NO alignment). The returned char-level
 *                 alignment is mapped onto the portal reader's OWN sentence
 *                 segments (segmentLesson) so audio and transcript stay locked.
 *                 Mirrors the owner's tts.py with-timestamps handling.
 *
 * Output: <repo>/output/university-audio/<slug>.mp3   (gitignored; never committed)
 *         <repo>/output/university-audio/<slug>.mark.mp3        (ElevenLabs clone)
 *         <repo>/output/university-audio/<slug>.timings.json    (--timings)
 *         <repo>/output/university-audio/_ab-sample-{rex,elevenlabs,google}.mp3
 *
 * Timings JSON shape (shared across all slugs):
 *   { slug, voice, model, durationMs,
 *     segments: [{ i, text, startMs, endMs }] }
 *   Segments are SENTENCE-level (portal split), in order, contiguous (each
 *   endMs === next startMs), covering the entire narration; first startMs is 0,
 *   last endMs is the audio duration.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// portal-presence has no "type":"module", so Node treats its .ts as CommonJS.
// This worktree is "type":"module"; a cross-package *named* ESM import fails
// static analysis ("does not provide an export named PRESENCE_LESSONS"). Worse,
// from inside this ESM package the CJS module collapses to a single `default`
// export holding the named exports, while from outside it spreads onto the
// namespace. Handle both: prefer `default`, fall back to the namespace.
// (Behavior identical to the original named import; only the form changed.)
import * as presenceCurriculum from "/Users/exe/Downloads/Claude/portal-presence/lib/curriculum/presence.ts";
type PresenceLesson = { slug: string; title: string; order: number; markdown: string };
const presenceMod = presenceCurriculum as unknown as {
  default?: { PRESENCE_LESSONS: PresenceLesson[] };
  PRESENCE_LESSONS?: PresenceLesson[];
};
const PRESENCE_LESSONS: PresenceLesson[] =
  presenceMod.default?.PRESENCE_LESSONS ?? presenceMod.PRESENCE_LESSONS ?? [];
if (PRESENCE_LESSONS.length === 0) {
  throw new Error("Failed to load PRESENCE_LESSONS from portal-presence — import shape unexpected.");
}

// segmentLesson is the portal reader's OWN sentence/drill splitter — the single
// source of truth for how the on-screen transcript is chunked. We import it
// (same dual CJS/ESM shape handling as PRESENCE_LESSONS above) so the timings
// segments line up 1:1 with what the reader renders, instead of re-deriving a
// near-identical split that could silently drift. See lib/curriculum/segment.ts.
import * as presenceSegment from "/Users/exe/Downloads/Claude/portal-presence/lib/curriculum/segment.ts";
type LessonSegment = { index: number; kind: "prose" | "drill"; text: string };
const segmentMod = presenceSegment as unknown as {
  default?: { segmentLesson: (markdown: string) => LessonSegment[] };
  segmentLesson?: (markdown: string) => LessonSegment[];
};
const segmentLesson: (markdown: string) => LessonSegment[] =
  segmentMod.default?.segmentLesson ?? segmentMod.segmentLesson ??
  (() => {
    throw new Error("Failed to load segmentLesson from portal-presence — import shape unexpected.");
  });

const execAsync = promisify(exec);

// ───────────────────────────────────────────────────────────────────────────
// Config
// ───────────────────────────────────────────────────────────────────────────

const GROK_API_KEY = process.env.GROK_API_KEY || "";
const GROK_TTS_VOICE = process.env.GROK_TTS_VOICE || "rex";
const GROK_TTS_URL = "https://api.x.ai/v1/tts";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || "";
// Default voice: "Mark_new_2026" — the OWNER's cloned voice (professional,
// fine_tuned on eleven_multilingual_v2). This is the production voice for the
// University lessons. The account that owns this voice is the one whose key
// lives in 6-2026-new-youtube-automation/.env — use THAT key, not the
// team-dashboard key (different account). Override with ELEVENLABS_VOICE_ID.
// (Previous A/B default was the "Brian" premade voice nPczCjzI2devNBz1zQrb.)
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "n45mfBjBoGc0McY8O2Aw";
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
// Settings mirror the owner's own youtube tts.py "v2" profile.
const ELEVENLABS_STABILITY = Number(process.env.ELEVENLABS_STABILITY ?? 0.45);
const ELEVENLABS_SIMILARITY = Number(process.env.ELEVENLABS_SIMILARITY ?? 0.8);
const ELEVENLABS_STYLE = Number(process.env.ELEVENLABS_STYLE ?? 0.0);

// ── Naturalness candidates (--candidates mode) ──────────────────────────────
// The production renderLesson() above renders ONE ElevenLabs request per
// paragraph and concatenates with 1.4s gaps. Rendering each paragraph in
// isolation loses cross-sentence prosody, and the abrupt section ends + long
// gaps read as robotic. The candidate renderers below tackle that:
//   v2  — the WHOLE lesson in a single request (no seams at all → fully
//         connected prosody), eleven_multilingual_v2 at a LOWER stability for
//         more expressive, less flat sentence-ends.
//   v3  — eleven_v3 "Natural" profile (owner's tts.py v3 preset: stability
//         0.5 / similarity 0.9 / style 0.0, NO speaker_boost — v3 rejects it),
//         split into the fewest chunks under v3's ~3000-char request cap, with
//         SHORT (0.5s) softly-faded seams.
//   v2-chunked — middle ground: v2, paragraphs grouped into a few large chunks
//         (still big enough for connected prosody) with short 0.5s seams. A/B
//         reference if the single-request v2 ever hits a quality ceiling.
//
// ElevenLabs documented per-request text limits (as of 2026): multilingual_v2
// ~10,000 chars, eleven_v3 ~3,000 chars. The-leak is ~4,900 sanitized chars:
// fits v2 in one request; needs ~2 chunks for v3.
const ELEVENLABS_MODEL_V3 = "eleven_v3";
const CANDIDATE_V2_STABILITY = Number(process.env.CANDIDATE_V2_STABILITY ?? 0.35);
const CANDIDATE_V3_STABILITY = Number(process.env.CANDIDATE_V3_STABILITY ?? 0.5);
const CANDIDATE_V3_SIMILARITY = Number(process.env.CANDIDATE_V3_SIMILARITY ?? 0.9);
// Short, gently-faded seam for the candidates that DO concatenate (v3, chunked).
const CANDIDATE_SEAM_SILENCE_SEC = Number(process.env.CANDIDATE_SEAM_SILENCE_SEC ?? 0.5);
// Group paragraphs until a chunk would exceed this many chars (keeps each
// request large for prosody, but under the model's per-request cap).
const V3_MAX_CHUNK_CHARS = 2600;
const V2_CHUNKED_MAX_CHARS = 2400;

const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || "";
const GOOGLE_TTS_VOICE = process.env.GOOGLE_TTS_VOICE || "en-US-Neural2-D"; // calm male neural

// MP3 format — identical to tts.ts (24kHz mono, 128kbps).
const SAMPLE_RATE = 24000;
const BIT_RATE = 128000;

/**
 * Inter-section silence, in seconds. The YouTube pipeline uses 0.6s. For the
 * "walk / breathe / learn" brand we lengthen it to a walking/breathing pace so
 * each paragraph has room to land before the next begins.
 */
const INTER_SECTION_SILENCE_SEC = 1.4;

/** 30ms edge fades to suppress click/pop at concat boundaries — same as tts.ts. */
const FADE_SEC = 0.03;

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, ".."); // scripts/ → repo root
const OUTPUT_DIR = join(REPO_ROOT, "output", "university-audio");
const TMP_DIR = join(OUTPUT_DIR, ".tmp");

// ───────────────────────────────────────────────────────────────────────────
// sanitizeTextForTTS — verbatim port of walkthrough-writer.ts
// ───────────────────────────────────────────────────────────────────────────

function sanitizeTextForTTS(text: string): string {
  let t = text;

  // Strip URLs entirely
  t = t.replace(/https?:\/\/[^\s)]+/g, "their website");

  // Strip markdown formatting
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1"); // bold
  t = t.replace(/\*([^*]+)\*/g, "$1"); // italic
  t = t.replace(/`([^`]+)`/g, "$1"); // inline code
  t = t.replace(/^[-*•]\s+/gm, ""); // bullet points
  t = t.replace(/^#+\s+/gm, ""); // heading markers

  // Expand common symbols
  t = t.replace(/&/g, " and ");
  t = t.replace(/%/g, " percent");
  t = t.replace(/\$/g, " dollars ");
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/@/g, " at ");
  t = t.replace(/#(\w)/g, "number $1");
  t = t.replace(/\//g, " ");

  // Expand common abbreviations
  t = t.replace(/\bNFTs?\b/g, "N-F-T");
  t = t.replace(/\bDeFi\b/gi, "de-fi");
  t = t.replace(/\bDAOs?\b/g, (m) => (m.endsWith("s") ? "dow-z" : "dow"));
  t = t.replace(/\bAPR\b/g, "A-P-R");
  t = t.replace(/\bAPY\b/g, "A-P-Y");
  t = t.replace(/\bAPI\b/g, "A-P-I");
  t = t.replace(/\bUI\b/g, "U-I");
  t = t.replace(/\bUX\b/g, "U-X");
  t = t.replace(/\bAI\b/g, "A-I");
  t = t.replace(/\bETH\b/g, "E-T-H");
  t = t.replace(/\bBTC\b/g, "B-T-C");

  // Numbers: simple conversions for common patterns
  t = t.replace(/(\d+)\+/g, "over $1");
  t = t.replace(/\b(\d{1,3}),(\d{3})\b/g, "$1$2"); // strip commas in numbers

  // Clean up domain-like patterns
  t = t.replace(/\b(\w+)\.(\w+)\.(\w+)\b/g, "$1 dot $2 dot $3");
  t = t.replace(/\b(\w+)\.(\w{2,6})\b/g, (match, name, tld) => {
    if (["com", "io", "fi", "org", "net", "co", "app", "dev", "xyz"].includes(tld.toLowerCase())) {
      return `${name} dot ${tld}`;
    }
    return match;
  });

  // Remove non-speakable characters
  t = t.replace(/[{}[\]<>|\\^~`]/g, "");
  t = t.replace(/[“”]/g, '"');
  t = t.replace(/[‘’]/g, "'");
  t = t.replace(/—/g, ", ");
  t = t.replace(/–/g, ", ");
  t = t.replace(/\.\.\./g, ". ");

  // Collapse excessive whitespace
  t = t.replace(/\s+/g, " ").trim();

  // Break up very long sentences (over 30 words) with natural pauses
  const sentences = t.split(/(?<=[.!?])\s+/);
  const cleaned = sentences.map((s) => {
    const words = s.split(/\s+/);
    if (words.length > 30) {
      const midpoint = Math.min(15, Math.floor(words.length / 2));
      for (let i = midpoint - 3; i <= midpoint + 3 && i < words.length; i++) {
        if (
          words[i].endsWith(",") ||
          ["and", "but", "or", "which", "that", "where"].includes(words[i].toLowerCase())
        ) {
          words[i] = words[i].replace(/,$/, ".") || words[i] + ".";
          break;
        }
      }
    }
    return words.join(" ");
  });
  t = cleaned.join(" ");

  return t;
}

// ───────────────────────────────────────────────────────────────────────────
// FFmpeg helpers
// ───────────────────────────────────────────────────────────────────────────

async function ensureDir(dir: string) {
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
  );
  return parseFloat(stdout.trim()) || 0;
}

/** Apply 30ms fade-in/out in place — verbatim behavior from tts.ts. */
async function applyEdgeFades(audioPath: string, durationSec: number): Promise<void> {
  const fadeOutStart = Math.max(0, durationSec - FADE_SEC);
  const tmpPath = `${audioPath}.faded.mp3`;
  await execAsync(
    `ffmpeg -y -i "${audioPath}" -af "afade=t=in:st=0:d=${FADE_SEC},afade=t=out:st=${fadeOutStart.toFixed(
      3,
    )}:d=${FADE_SEC}" -codec:a libmp3lame -qscale:a 2 "${tmpPath}"`,
    { timeout: 60_000 },
  );
  await execAsync(`mv "${tmpPath}" "${audioPath}"`);
}

// ───────────────────────────────────────────────────────────────────────────
// Grok TTS (xAI) — single chunk. Same request shape as tts.ts generateGrokTTS.
// ───────────────────────────────────────────────────────────────────────────

async function generateGrokChunk(text: string, outputPath: string): Promise<void> {
  if (!GROK_API_KEY) throw new Error("GROK_API_KEY is not set.");

  const res = await fetch(GROK_TTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      voice_id: GROK_TTS_VOICE,
      language: "en",
      output_format: { codec: "mp3", sample_rate: SAMPLE_RATE, bit_rate: BIT_RATE },
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Grok TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, audioBuffer);
}

// ───────────────────────────────────────────────────────────────────────────
// ElevenLabs TTS — single chunk. Same request shape as abElevenLabs, used as
// the production voice path (owner's cloned "Mark_new_2026" voice by default).
// ───────────────────────────────────────────────────────────────────────────

async function generateElevenLabsChunk(text: string, outputPath: string): Promise<void> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set.");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: ELEVENLABS_STABILITY,
          similarity_boost: ELEVENLABS_SIMILARITY,
          style: ELEVENLABS_STYLE,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }

  // ElevenLabs returns 44.1kHz/128k; re-encode to the pipeline's 24kHz mono so
  // the silence gaps and concat below stay format-consistent with the Grok path.
  const raw = `${outputPath}.raw.mp3`;
  await writeFile(raw, Buffer.from(await res.arrayBuffer()));
  await normalizeMp3(raw, outputPath);
  await unlink(raw).catch(() => {});
}

// ───────────────────────────────────────────────────────────────────────────
// ElevenLabs TTS — parametrized single chunk (for naturalness candidates).
// Same request shape as generateElevenLabsChunk but lets the caller pick the
// model + voice settings instead of reading the module-level env globals, so a
// single run can compare v2 vs v3 profiles. eleven_v3 rejects use_speaker_boost
// (mirrors the owner's tts.py NO_SPEAKER_BOOST_MODELS), so it's omitted for v3.
// ───────────────────────────────────────────────────────────────────────────

interface ElevenSettings {
  model: string;
  stability: number;
  similarity: number;
  style: number;
}

function makeElevenGenerator(s: ElevenSettings): ChunkGenerator {
  const isV3 = s.model === ELEVENLABS_MODEL_V3;
  return async (text: string, outputPath: string): Promise<void> => {
    if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set.");

    const voiceSettings: Record<string, number | boolean> = {
      stability: s.stability,
      similarity_boost: s.similarity,
      style: s.style,
    };
    // v3 rejects use_speaker_boost; v2 keeps it (matches production path).
    if (!isV3) voiceSettings.use_speaker_boost = true;

    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: s.model, voice_settings: voiceSettings }),
        signal: AbortSignal.timeout(180_000),
      },
    );

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS failed (${res.status}) [${s.model}]: ${errBody.slice(0, 500)}`);
    }

    // Re-encode 44.1kHz/128k → pipeline 24kHz mono so any concat stays consistent.
    const raw = `${outputPath}.raw.mp3`;
    await writeFile(raw, Buffer.from(await res.arrayBuffer()));
    await normalizeMp3(raw, outputPath);
    await unlink(raw).catch(() => {});
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Chunked TTS — port of generateChunkedTTS with a tunable silence gap and a
// pluggable per-chunk generator (Grok or ElevenLabs).
// ───────────────────────────────────────────────────────────────────────────

interface ChunkedResult {
  audioPath: string;
  durationSec: number;
  sections: number;
  silenceGapSec: number;
}

type ChunkGenerator = (text: string, outputPath: string) => Promise<void>;

async function generateChunkedTTS(
  chunks: string[],
  outputPath: string,
  silenceGapSec: number,
  generateChunk: ChunkGenerator,
): Promise<ChunkedResult> {
  await ensureDir(TMP_DIR);

  const stamp = Date.now();
  const silencePath = join(TMP_DIR, `silence_${stamp}.mp3`);
  await execAsync(
    `ffmpeg -y -f lavfi -i anullsrc=r=${SAMPLE_RATE}:cl=mono -t ${silenceGapSec} -codec:a libmp3lame -qscale:a 2 "${silencePath}"`,
  );

  const concatPaths: string[] = [];
  const chunkFiles: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i].trim();
    if (!text) continue;

    const chunkFile = join(TMP_DIR, `chunk_${stamp}_${i}.mp3`);
    process.stdout.write(`    section ${i + 1}/${chunks.length} (${text.length} chars)… `);
    await generateChunk(text, chunkFile);
    const dur = await getAudioDuration(chunkFile);
    await applyEdgeFades(chunkFile, dur);
    process.stdout.write(`${dur.toFixed(1)}s\n`);

    chunkFiles.push(chunkFile);
    concatPaths.push(chunkFile);
    if (i < chunks.length - 1) concatPaths.push(silencePath);
  }

  if (concatPaths.length === 0) throw new Error("No non-empty sections to render.");

  const concatList = join(TMP_DIR, `concat_${stamp}.txt`);
  await writeFile(concatList, concatPaths.map((p) => `file '${p}'`).join("\n"));
  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${concatList}" -codec:a libmp3lame -qscale:a 2 "${outputPath}"`,
    { timeout: 180_000 },
  );

  const totalDuration = await getAudioDuration(outputPath);

  // Cleanup temp files
  for (const f of chunkFiles) await unlink(f).catch(() => {});
  await unlink(silencePath).catch(() => {});
  await unlink(concatList).catch(() => {});

  return {
    audioPath: outputPath,
    durationSec: totalDuration,
    sections: chunkFiles.length,
    silenceGapSec,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Lesson rendering
// ───────────────────────────────────────────────────────────────────────────

/** Split a lesson's markdown into per-paragraph sections, sanitized for TTS. */
function lessonToSections(markdown: string): string[] {
  return markdown
    .split(/\n\n+/)
    .map((p) => sanitizeTextForTTS(p))
    .filter((p) => p.length > 0);
}

/**
 * Lesson TTS engine. Default is "elevenlabs" — the owner's cloned
 * "Mark_new_2026" voice, the production voice for the University. Set
 * LESSON_TTS_ENGINE=grok to fall back to the xAI Grok `rex` path.
 * The output filename suffix keeps engines from overwriting each other:
 * ElevenLabs lessons write <slug>.mark.mp3; Grok lessons write <slug>.mp3.
 */
const LESSON_TTS_ENGINE = (process.env.LESSON_TTS_ENGINE || "elevenlabs").toLowerCase();

async function renderLesson(slug: string): Promise<void> {
  const lesson = PRESENCE_LESSONS.find((l) => l.slug === slug);
  if (!lesson) throw new Error(`Unknown lesson slug: ${slug}`);

  const sections = lessonToSections(lesson.markdown);

  const useEleven = LESSON_TTS_ENGINE === "elevenlabs";
  const generateChunk: ChunkGenerator = useEleven ? generateElevenLabsChunk : generateGrokChunk;
  const engineLabel = useEleven
    ? `ElevenLabs ${ELEVENLABS_VOICE_ID} (${ELEVENLABS_MODEL})`
    : `Grok ${GROK_TTS_VOICE}`;
  // ElevenLabs (production clone) → <slug>.mark.mp3; Grok → <slug>.mp3.
  const outputPath = join(OUTPUT_DIR, useEleven ? `${slug}.mark.mp3` : `${slug}.mp3`);

  console.log(`\n▶ ${lesson.order}. ${slug} — "${lesson.title}"`);
  console.log(`  engine: ${engineLabel}`);
  console.log(`  ${sections.length} sections, ${INTER_SECTION_SILENCE_SEC}s walking-pace gaps`);

  const result = await generateChunkedTTS(
    sections,
    outputPath,
    INTER_SECTION_SILENCE_SEC,
    generateChunk,
  );
  console.log(`  ✓ ${outputPath}  (${result.durationSec.toFixed(1)}s)`);
}

// ───────────────────────────────────────────────────────────────────────────
// Naturalness candidates — A/B different chunking + model/settings for ONE
// lesson, so the owner can pick the least-robotic read before batching all 10.
// Writes <slug>.mark-v2.mp3 / .mark-v3.mp3 / .mark-v2-chunked.mp3 alongside the
// existing baseline <slug>.mark.mp3 (which is left untouched).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sanitize the WHOLE lesson as one blob (paragraph breaks preserved as ". "
 * sentence boundaries) so it can go out in a single request with fully
 * connected prosody. sanitizeTextForTTS already collapses whitespace, so we
 * sanitize per-paragraph then rejoin with a paragraph pause marker.
 */
function lessonToSingleBlob(markdown: string): string {
  return markdown
    .split(/\n\n+/)
    .map((p) => sanitizeTextForTTS(p))
    .filter((p) => p.length > 0)
    .join("\n\n"); // ElevenLabs reads a blank line as a natural paragraph pause
}

/** Greedily pack sanitized paragraphs into chunks under maxChars (for prosody). */
function groupParagraphs(markdown: string, maxChars: number): string[] {
  const paras = markdown
    .split(/\n\n+/)
    .map((p) => sanitizeTextForTTS(p))
    .filter((p) => p.length > 0);

  const chunks: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + p.length + 2 > maxChars) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

async function reportCandidate(label: string, outputPath: string, charCost: number): Promise<void> {
  const dur = await getAudioDuration(outputPath);
  const { stdout: probe } = await execAsync(
    `ffprobe -v error -show_entries format=format_name,duration,size,bit_rate -of default=noprint_wrappers=1 "${outputPath}"`,
  );
  console.log(`  ✓ ${label}`);
  console.log(`    file: ${outputPath}`);
  console.log(`    duration: ${dur.toFixed(1)}s | chars sent (cost): ${charCost}`);
  console.log(`    ffprobe: ${probe.trim().replace(/\n/g, " | ")}`);
}

async function renderCandidates(slug: string): Promise<void> {
  const lesson = PRESENCE_LESSONS.find((l) => l.slug === slug);
  if (!lesson) throw new Error(`Unknown lesson slug: ${slug}`);

  console.log(`\n▶ Naturalness candidates for ${slug} — "${lesson.title}"`);
  console.log(`  voice: ${ELEVENLABS_VOICE_ID} | baseline left intact: ${slug}.mark.mp3`);

  // ── Candidate 1: whole-lesson single request, v2, lower stability ─────────
  // No concatenation seams at all → maximal cross-sentence prosody.
  const blob = lessonToSingleBlob(lesson.markdown);
  const v2Gen = makeElevenGenerator({
    model: ELEVENLABS_MODEL,
    stability: CANDIDATE_V2_STABILITY,
    similarity: ELEVENLABS_SIMILARITY,
    style: ELEVENLABS_STYLE,
  });
  const v2Out = join(OUTPUT_DIR, `${slug}.mark-v2.mp3`);
  console.log(
    `\n  [v2] whole-lesson single request · ${ELEVENLABS_MODEL} · stab ${CANDIDATE_V2_STABILITY} ` +
      `· sim ${ELEVENLABS_SIMILARITY} · style ${ELEVENLABS_STYLE} · 1 chunk (${blob.length} chars) · no seams`,
  );
  try {
    await v2Gen(blob, v2Out);
    await reportCandidate("v2 (whole-lesson, expressive)", v2Out, blob.length);
  } catch (err) {
    console.log(`  ✗ v2 FAILED: ${(err as Error).message}`);
  }

  // ── Candidate 2: v3 "Natural", fewest chunks under the v3 cap, short seams ─
  const v3Chunks = groupParagraphs(lesson.markdown, V3_MAX_CHUNK_CHARS);
  const v3CharCost = v3Chunks.reduce((n, c) => n + c.length, 0);
  const v3Gen = makeElevenGenerator({
    model: ELEVENLABS_MODEL_V3,
    stability: CANDIDATE_V3_STABILITY,
    similarity: CANDIDATE_V3_SIMILARITY,
    style: ELEVENLABS_STYLE,
  });
  const v3Out = join(OUTPUT_DIR, `${slug}.mark-v3.mp3`);
  console.log(
    `\n  [v3] ${ELEVENLABS_MODEL_V3} "Natural" · stab ${CANDIDATE_V3_STABILITY} · sim ${CANDIDATE_V3_SIMILARITY} ` +
      `· style ${ELEVENLABS_STYLE} · ${v3Chunks.length} chunk(s) · ${CANDIDATE_SEAM_SILENCE_SEC}s seams`,
  );
  try {
    await generateChunkedTTS(v3Chunks, v3Out, CANDIDATE_SEAM_SILENCE_SEC, v3Gen);
    await reportCandidate("v3 (Natural, large chunks)", v3Out, v3CharCost);
  } catch (err) {
    console.log(`  ✗ v3 FAILED: ${(err as Error).message}`);
  }

  // ── Candidate 3: v2, paragraphs grouped into few large chunks, short seams ─
  const chunked = groupParagraphs(lesson.markdown, V2_CHUNKED_MAX_CHARS);
  const chunkedCharCost = chunked.reduce((n, c) => n + c.length, 0);
  const v2ChunkedOut = join(OUTPUT_DIR, `${slug}.mark-v2-chunked.mp3`);
  console.log(
    `\n  [v2-chunked] ${ELEVENLABS_MODEL} · stab ${CANDIDATE_V2_STABILITY} · sim ${ELEVENLABS_SIMILARITY} ` +
      `· style ${ELEVENLABS_STYLE} · ${chunked.length} chunk(s) · ${CANDIDATE_SEAM_SILENCE_SEC}s seams`,
  );
  try {
    // Reuse the same lower-stability v2 generator as candidate 1.
    await generateChunkedTTS(chunked, v2ChunkedOut, CANDIDATE_SEAM_SILENCE_SEC, v2Gen);
    await reportCandidate("v2-chunked (large chunks)", v2ChunkedOut, chunkedCharCost);
  } catch (err) {
    console.log(`  ✗ v2-chunked FAILED: ${(err as Error).message}`);
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Exact per-sentence timings (--timings) — the production transcript-sync path.
//
// Renders the CHOSEN natural read (the same whole-lesson, single-request v2
// profile as candidate [v2] above: eleven_multilingual_v2, the tuned settings)
// through the /with-timestamps endpoint, then maps the returned char-level
// alignment onto the portal reader's OWN sentence segments (segmentLesson). The
// served MP3 IS this render, so the timings describe the exact bytes shipped.
//
// Reference: 6-2026-new-youtube-automation/tools/tts.py — synth() hits
// {voice}/with-timestamps and segs_from_alignment() walks the char arrays. We
// reuse its arrays (characters / character_start_times_seconds /
// character_end_times_seconds) but segment with the PORTAL splitter instead of
// a naive .!? scan, so the timing boundaries match the on-screen taps exactly.
// ───────────────────────────────────────────────────────────────────────────

// The chosen natural settings: same as the [v2] candidate (whole-lesson, single
// request, lower stability for expressive sentence-ends), which the owner picked
// as the served read. Speaker_boost stays on (v2 accepts it).
const TIMINGS_STABILITY = CANDIDATE_V2_STABILITY; // 0.35
const TIMINGS_SIMILARITY = ELEVENLABS_SIMILARITY; // 0.8
const TIMINGS_STYLE = ELEVENLABS_STYLE; // 0.0

interface SegmentTiming {
  i: number;
  text: string;
  startMs: number;
  endMs: number;
}

interface LessonTimings {
  slug: string;
  voice: string;
  model: string;
  durationMs: number;
  segments: SegmentTiming[];
}

interface ElevenAlignment {
  characters: string[];
  character_start_times_seconds: number[];
  character_end_times_seconds: number[];
}

/**
 * Call the with-timestamps endpoint for the whole-lesson blob in ONE request.
 * Returns the raw MP3 bytes + the char-level alignment. eleven_multilingual_v2
 * only (the timestamp-capable model); speaker_boost on (v2 accepts it).
 */
async function synthWithTimestamps(
  text: string,
): Promise<{ audio: Buffer; alignment: ElevenAlignment }> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set.");

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL, // eleven_multilingual_v2 — the only model with alignment
        voice_settings: {
          stability: TIMINGS_STABILITY,
          similarity_boost: TIMINGS_SIMILARITY,
          style: TIMINGS_STYLE,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(180_000),
    },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`ElevenLabs with-timestamps failed (${res.status}): ${errBody.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    audio_base64?: string;
    alignment?: ElevenAlignment;
    normalized_alignment?: ElevenAlignment;
  };
  if (!data.audio_base64) throw new Error("with-timestamps returned no audio_base64.");
  // Prefer `alignment` (literal input chars, joins back to the sent blob exactly)
  // over normalized_alignment, matching tts.py's preference order.
  const alignment = data.alignment ?? data.normalized_alignment;
  if (!alignment) throw new Error("with-timestamps returned no alignment.");

  return { audio: Buffer.from(data.audio_base64, "base64"), alignment };
}

/**
 * Map the portal reader's sentence segments onto the char-level alignment.
 *
 * The alignment's `characters` array joins back to EXACTLY the blob we sent
 * (verified: alignment chars are the literal input). So blob char index i ↔
 * alignment index i. For each portal segment we sanitize its raw-markdown text
 * the SAME way the blob was built, then locate that sanitized text in the blob
 * (sequentially, cursor-advanced — segments are in document order). The first
 * matched char gives startMs; the last gives endMs.
 *
 * Output segments are forced contiguous: each segment's startMs is snapped to
 * the previous segment's endMs (no gaps, no overlaps), the first starts at 0,
 * and the last endMs is pinned to the audio duration — so the on-screen
 * transcript can binary-search the current time with no dead zones.
 */
function alignmentToSegments(
  markdown: string,
  blob: string,
  alignment: ElevenAlignment,
  durationMs: number,
): SegmentTiming[] {
  const chars = alignment.characters;
  const starts = alignment.character_start_times_seconds;
  const ends = alignment.character_end_times_seconds;

  // Sanity: the alignment must describe the blob we sent, char-for-char.
  const joined = chars.join("");
  if (joined !== blob) {
    throw new Error(
      `Alignment chars (${joined.length}) do not match sent blob (${blob.length}); ` +
        `cannot map timings reliably.`,
    );
  }

  const portalSegments = segmentLesson(markdown);

  const raw: Array<{ text: string; startSec: number; endSec: number }> = [];
  let cursor = 0;
  for (const seg of portalSegments) {
    const san = sanitizeTextForTTS(seg.text);
    if (!san) continue;
    const idx = blob.indexOf(san, cursor);
    if (idx === -1) {
      throw new Error(
        `Segment ${seg.index} not found in blob after cursor ${cursor}: "${san.slice(0, 80)}…"`,
      );
    }
    const startChar = idx;
    const endChar = idx + san.length - 1; // inclusive index of the last char
    raw.push({ text: seg.text, startSec: starts[startChar], endSec: ends[endChar] });
    cursor = idx + san.length;
  }

  if (raw.length === 0) throw new Error("No segments produced from alignment.");

  // Force contiguity: startMs of each = endMs of the previous; first = 0; last
  // endMs = audio duration. Boundaries come straight from the alignment, only
  // snapped so the timeline has no gaps/overlaps for the reader.
  const segments: SegmentTiming[] = raw.map((r, i) => ({
    i,
    text: r.text,
    startMs: i === 0 ? 0 : Math.round(raw[i - 1].endSec * 1000),
    endMs: Math.round(r.endSec * 1000),
  }));
  // Pin the last segment to the true audio duration so endMs ≈ duration exactly.
  segments[segments.length - 1].endMs = durationMs;
  // Re-snap starts to the (possibly adjusted) previous endMs, and guard against
  // any non-monotonic boundary (clamp so start ≤ end and start ≥ prev end).
  for (let i = 1; i < segments.length; i++) {
    segments[i].startMs = segments[i - 1].endMs;
    if (segments[i].endMs < segments[i].startMs) segments[i].endMs = segments[i].startMs;
  }

  return segments;
}

/**
 * Full --timings render for one slug: synth whole-lesson with timestamps, write
 * the served MP3 (<slug>.mark.mp3), compute sentence timings, write the JSON.
 */
async function renderTimings(slug: string): Promise<void> {
  const lesson = PRESENCE_LESSONS.find((l) => l.slug === slug);
  if (!lesson) throw new Error(`Unknown lesson slug: ${slug}`);

  const blob = lessonToSingleBlob(lesson.markdown);
  const mp3Path = join(OUTPUT_DIR, `${slug}.mark.mp3`);
  const jsonPath = join(OUTPUT_DIR, `${slug}.timings.json`);

  console.log(`\n▶ ${lesson.order}. ${slug} — "${lesson.title}" (timings)`);
  console.log(
    `  voice: ${ELEVENLABS_VOICE_ID} | model: ${ELEVENLABS_MODEL} | ` +
      `stab ${TIMINGS_STABILITY} · sim ${TIMINGS_SIMILARITY} · style ${TIMINGS_STYLE} · boost on`,
  );
  console.log(`  whole-lesson single request · ${blob.length} chars (cost) · /with-timestamps`);

  const { audio, alignment } = await synthWithTimestamps(blob);
  await writeFile(mp3Path, audio);

  const durationSec = await getAudioDuration(mp3Path);
  const durationMs = Math.round(durationSec * 1000);

  const segments = alignmentToSegments(lesson.markdown, blob, alignment, durationMs);

  const timings: LessonTimings = {
    slug,
    voice: ELEVENLABS_VOICE_ID,
    model: ELEVENLABS_MODEL,
    durationMs,
    segments,
  };
  await writeFile(jsonPath, `${JSON.stringify(timings, null, 2)}\n`);

  console.log(`  ✓ ${mp3Path}  (${durationSec.toFixed(1)}s)`);
  console.log(
    `  ✓ ${jsonPath}  (${segments.length} segments, last endMs ${segments[segments.length - 1].endMs} ≈ ${durationMs}ms)`,
  );
}

// ───────────────────────────────────────────────────────────────────────────
// A/B voice sample — same excerpt, three providers.
// ───────────────────────────────────────────────────────────────────────────

/** First ~30-45s of "The Leak" — the same text fed to all three providers. */
function abSampleText(): string {
  const leak = PRESENCE_LESSONS.find((l) => l.slug === "the-leak")!;
  // First two paragraphs = the opening ~35s of narration.
  const firstTwo = leak.markdown.split(/\n\n+/).slice(0, 2).join("\n\n");
  return sanitizeTextForTTS(firstTwo);
}

/** Re-encode any input to the common A/B format so the comparison is fair. */
async function normalizeMp3(inPath: string, outPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -y -i "${inPath}" -ar ${SAMPLE_RATE} -ac 1 -codec:a libmp3lame -b:a 128k "${outPath}"`,
    { timeout: 60_000 },
  );
}

async function abGrok(text: string, outPath: string): Promise<void> {
  await ensureDir(TMP_DIR);
  const raw = join(TMP_DIR, `ab_grok_${Date.now()}.mp3`);
  await generateGrokChunk(text, raw);
  await normalizeMp3(raw, outPath);
  await unlink(raw).catch(() => {});
}

async function abElevenLabs(text: string, outPath: string): Promise<void> {
  if (!ELEVENLABS_API_KEY) throw new Error("ELEVENLABS_API_KEY is not set.");
  await ensureDir(TMP_DIR);
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": ELEVENLABS_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ELEVENLABS_MODEL,
        voice_settings: {
          stability: ELEVENLABS_STABILITY,
          similarity_boost: ELEVENLABS_SIMILARITY,
          style: ELEVENLABS_STYLE,
          use_speaker_boost: true,
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }
  const raw = join(TMP_DIR, `ab_el_${Date.now()}.mp3`);
  await writeFile(raw, Buffer.from(await res.arrayBuffer()));
  await normalizeMp3(raw, outPath);
  await unlink(raw).catch(() => {});
}

async function abGoogle(text: string, outPath: string): Promise<void> {
  if (!GOOGLE_TTS_API_KEY) throw new Error("GOOGLE_TTS_API_KEY is not set.");
  await ensureDir(TMP_DIR);
  const res = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: "en-US", name: GOOGLE_TTS_VOICE },
        // Slow, low — a meditative read.
        audioConfig: { audioEncoding: "MP3", sampleRateHertz: SAMPLE_RATE, speakingRate: 0.88, pitch: -2.0 },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Google TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }
  const data = (await res.json()) as { audioContent?: string };
  if (!data.audioContent) throw new Error("Google TTS returned no audioContent.");
  const raw = join(TMP_DIR, `ab_g_${Date.now()}.mp3`);
  await writeFile(raw, Buffer.from(data.audioContent, "base64"));
  await normalizeMp3(raw, outPath);
  await unlink(raw).catch(() => {});
}

async function renderABSample(): Promise<void> {
  const text = abSampleText();
  console.log(`\n▶ A/B voice sample — identical excerpt (opening of "The Leak"), 3 providers`);
  console.log(`  excerpt chars: ${text.length}`);

  const targets: Array<{ name: string; fn: () => Promise<void>; out: string }> = [
    { name: "Grok rex", fn: () => abGrok(text, join(OUTPUT_DIR, "_ab-sample-rex.mp3")), out: "_ab-sample-rex.mp3" },
    {
      name: `ElevenLabs (${ELEVENLABS_VOICE_ID})`,
      fn: () => abElevenLabs(text, join(OUTPUT_DIR, "_ab-sample-elevenlabs.mp3")),
      out: "_ab-sample-elevenlabs.mp3",
    },
    {
      name: `Google (${GOOGLE_TTS_VOICE})`,
      fn: () => abGoogle(text, join(OUTPUT_DIR, "_ab-sample-google.mp3")),
      out: "_ab-sample-google.mp3",
    },
  ];

  for (const t of targets) {
    process.stdout.write(`  ${t.name}… `);
    try {
      await t.fn();
      const dur = await getAudioDuration(join(OUTPUT_DIR, t.out));
      console.log(`✓ ${t.out} (${dur.toFixed(1)}s)`);
    } catch (err) {
      console.log(`✗ FAILED: ${(err as Error).message}`);
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const doAB = args.includes("--ab") || args.includes("--ab-only");
  const abOnly = args.includes("--ab-only");
  // --candidates: render naturalness A/B variants (v2 whole-lesson / v3 /
  // v2-chunked) for the given slug(s) instead of the production lesson render.
  const doCandidates = args.includes("--candidates");
  // --timings: render the chosen natural read with /with-timestamps and emit
  // exact per-sentence timings (the production transcript-sync path).
  const doTimings = args.includes("--timings");
  const slugArgs = args.filter((a) => !a.startsWith("--"));

  await ensureDir(OUTPUT_DIR);

  if (doTimings) {
    const slugs = slugArgs.length > 0 ? slugArgs : PRESENCE_LESSONS.map((l) => l.slug);
    console.log("Coherent Ones University — timed render (whole-lesson + with-timestamps)");
    console.log(`  output: ${OUTPUT_DIR}`);
    for (const slug of slugs) await renderTimings(slug);
    console.log("\nDone (timings).");
    return;
  }

  if (doCandidates) {
    const slugs = slugArgs.length > 0 ? slugArgs : ["the-leak"];
    console.log("Coherent Ones University — naturalness candidate render (A/B)");
    for (const slug of slugs) await renderCandidates(slug);
    console.log("\nDone (candidates).");
    return;
  }

  const lessonVoice =
    LESSON_TTS_ENGINE === "elevenlabs"
      ? `ElevenLabs ${ELEVENLABS_VOICE_ID} (${ELEVENLABS_MODEL})`
      : `Grok ${GROK_TTS_VOICE}`;
  console.log("Coherent Ones University — walk/breathe/learn audio render");
  console.log(`  lesson voice: ${lessonVoice} | format: MP3 ${SAMPLE_RATE / 1000}kHz ${BIT_RATE / 1000}kbps`);
  console.log(`  silence gap: ${INTER_SECTION_SILENCE_SEC}s | output: ${OUTPUT_DIR}`);

  if (!abOnly) {
    const slugs = slugArgs.length > 0 ? slugArgs : PRESENCE_LESSONS.map((l) => l.slug);
    for (const slug of slugs) {
      await renderLesson(slug);
    }
  }

  if (doAB) await renderABSample();

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("\nFATAL:", err.message);
  process.exit(1);
});
