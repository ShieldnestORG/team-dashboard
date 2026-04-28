/**
 * YouTube Pipeline — Text-to-Speech service
 *
 * Primary provider: Grok TTS (xAI) — fast, high quality, Rex voice.
 * Supports both single-call and chunked (per-slide) generation.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";

const execAsync = promisify(exec);

const GROK_API_KEY = process.env.GROK_API_KEY || "";
const GROK_TTS_VOICE = process.env.GROK_TTS_VOICE || "rex";
const GROK_TTS_URL = "https://api.x.ai/v1/tts";

const AUDIO_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "audio");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TTSResult {
  audioPath: string;
  durationSec: number;
  timingsPath?: string;
  provider: string;
}

export interface ChunkedTTSResult {
  audioPath: string;
  durationSec: number;
  chunkDurations: number[];
  provider: string;
}

export interface ContinuousTTSResult {
  audioPath: string;
  durationSec: number;
  perSlideDurations: number[];
  provider: string;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function getAudioDuration(audioPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
    );
    return parseFloat(stdout.trim()) || 60;
  } catch {
    return 60;
  }
}

// ---------------------------------------------------------------------------
// Grok TTS (xAI) — primary provider
// ---------------------------------------------------------------------------

async function generateGrokTTS(text: string, outputPath: string): Promise<TTSResult> {
  if (!GROK_API_KEY) {
    throw new Error("Grok TTS not configured. Set GROK_API_KEY in environment.");
  }

  logger.info({ voice: GROK_TTS_VOICE, chars: text.length }, "Grok TTS: generating audio...");

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
      output_format: {
        codec: "mp3",
        sample_rate: 24000,
        bit_rate: 128000,
      },
    }),
    signal: AbortSignal.timeout(120_000), // 2 min timeout
  });

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Grok TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, audioBuffer);

  const durationSec = await getAudioDuration(outputPath);
  logger.info({ provider: "grok", voice: GROK_TTS_VOICE, durationSec }, "Grok TTS complete");

  return { audioPath: outputPath, durationSec, provider: "grok" };
}

// ---------------------------------------------------------------------------
// Public API — single text
// ---------------------------------------------------------------------------

/**
 * Generate TTS audio from text.
 */
export async function generateTTSAudio(
  text: string,
  outputFilename?: string,
): Promise<TTSResult> {
  ensureDir(AUDIO_DIR);
  const filename = outputFilename || `tts_${Date.now()}.mp3`;
  const outputPath = join(AUDIO_DIR, filename);

  return await generateGrokTTS(text, outputPath);
}

// ---------------------------------------------------------------------------
// Chunked TTS — generate per-section audio and concatenate
// ---------------------------------------------------------------------------

/**
 * Generate TTS for each text chunk separately, then concatenate into one file.
 * Returns per-chunk durations so slide timing can be exact.
 * Adds a brief silence gap between chunks for natural pacing.
 */
export async function generateChunkedTTS(
  chunks: string[],
  outputFilename?: string,
): Promise<ChunkedTTSResult> {
  ensureDir(AUDIO_DIR);
  const filename = outputFilename || `tts_chunked_${Date.now()}.mp3`;
  const outputPath = join(AUDIO_DIR, filename);

  if (!GROK_API_KEY) {
    throw new Error("Grok TTS not configured. Set GROK_API_KEY in environment.");
  }

  logger.info({ chunks: chunks.length, voice: GROK_TTS_VOICE }, "Grok chunked TTS starting...");

  const chunkPaths: string[] = [];
  const chunkDurations: number[] = [];
  const SILENCE_GAP_SEC = 0.6;

  // Generate a silence file for gaps
  const silencePath = join(AUDIO_DIR, `silence_${Date.now()}.mp3`);
  await execAsync(
    `ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${SILENCE_GAP_SEC} -codec:a libmp3lame -qscale:a 2 "${silencePath}"`,
  );

  // Invariant: emit exactly two entries per chunk for the first N-1 chunks
  // (content + gap) and one entry for the last chunk (content only). This
  // keeps chunkDurations.length === 2 * chunks.length - 1, which downstream
  // callers rely on to map back to per-slide durations. Empty/failing chunks
  // emit silence-as-content so the shape never breaks.
  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i].trim();
    const isLast = i === chunks.length - 1;

    if (!text) {
      chunkPaths.push(silencePath);
      chunkDurations.push(SILENCE_GAP_SEC);
    } else {
      const chunkFile = join(AUDIO_DIR, `chunk_${Date.now()}_${i}.mp3`);
      logger.info({ chunk: i + 1, total: chunks.length, chars: text.length }, "Generating TTS chunk...");
      try {
        const result = await generateGrokTTS(text, chunkFile);
        chunkPaths.push(chunkFile);
        chunkDurations.push(result.durationSec);
      } catch (err) {
        logger.warn({ err, chunk: i }, "Chunk TTS failed, substituting silence");
        chunkPaths.push(silencePath);
        chunkDurations.push(SILENCE_GAP_SEC);
      }
    }

    if (!isLast) {
      chunkPaths.push(silencePath);
      chunkDurations.push(SILENCE_GAP_SEC);
    }
  }

  // Concatenate all chunks with FFmpeg
  const concatList = join(AUDIO_DIR, `concat_${Date.now()}.txt`);
  const concatContent = chunkPaths.map((p) => `file '${p}'`).join("\n");
  await writeFile(concatList, concatContent);

  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${concatList}" -codec:a libmp3lame -qscale:a 2 "${outputPath}"`,
    { timeout: 120_000 },
  );

  const totalDuration = await getAudioDuration(outputPath);

  // Cleanup temp files
  for (const p of chunkPaths) {
    if (p !== silencePath) await unlink(p).catch(() => {});
  }
  await unlink(silencePath).catch(() => {});
  await unlink(concatList).catch(() => {});

  logger.info(
    { provider: "grok", voice: GROK_TTS_VOICE, chunks: chunks.length, totalDuration, chunkCount: chunkDurations.length },
    "Chunked TTS generation complete",
  );

  return { audioPath: outputPath, durationSec: totalDuration, chunkDurations, provider: "grok" };
}

// ---------------------------------------------------------------------------
// Continuous TTS — single call + silence-split for per-slide durations
// ---------------------------------------------------------------------------

/** Marker we splice between slide texts. Five single-period "sentences" on
 * separate lines coerce most TTS engines to insert a sentence-end pause
 * after each, accumulating into a clearly-detectable gap. We do NOT rely on
 * this being the LONGEST silence in the audio though — natural emphatic
 * pauses in narration can be just as long. The detection algorithm uses
 * predicted-position matching instead (see assignBoundariesByPrediction). */
const SLIDE_BOUNDARY_MARKER = "\n\n.\n.\n.\n.\n.\n\n";

/** Minimum silence duration that counts as a candidate boundary, in seconds.
 * Set lower (0.3s) to capture all plausible boundaries; the assignment
 * algorithm picks among them using slide-character-weighted prediction. */
const SLIDE_BOUNDARY_MIN_SEC = 0.3;

/** Silence detection threshold in dB (audio below this is considered silent). */
const SLIDE_BOUNDARY_NOISE_DB = -30;

interface DetectedSilence {
  start: number;
  end: number;
  duration: number;
}

async function detectSilences(audioPath: string): Promise<DetectedSilence[]> {
  // ffmpeg silencedetect emits its findings on stderr regardless of -v flag,
  // so we capture stderr by setting maxBuffer high and merging streams.
  const cmd = `ffmpeg -i "${audioPath}" -af silencedetect=noise=${SLIDE_BOUNDARY_NOISE_DB}dB:duration=${SLIDE_BOUNDARY_MIN_SEC} -f null - 2>&1`;
  const { stdout } = await execAsync(cmd, { maxBuffer: 16 * 1024 * 1024 }).catch((e: { stdout?: string; stderr?: string }) => ({ stdout: (e.stdout || "") + (e.stderr || "") }));
  const text = stdout || "";
  const starts: number[] = [];
  const ends: number[] = [];
  for (const line of text.split("\n")) {
    const ms = line.match(/silence_start:\s*([\d.]+)/);
    const me = line.match(/silence_end:\s*([\d.]+)/);
    if (ms) starts.push(parseFloat(ms[1]));
    if (me) ends.push(parseFloat(me[1]));
  }
  const out: DetectedSilence[] = [];
  for (let i = 0; i < starts.length; i++) {
    const start = starts[i];
    const end = ends[i] ?? start;
    out.push({ start, end, duration: end - start });
  }
  return out;
}

/**
 * Generate one continuous TTS render for the entire video, then use
 * ffmpeg silencedetect to recover per-slide durations. This preserves
 * voice character consistency across the whole narration (a single Grok
 * call produces a single voice render, where chunked-per-slide produced
 * audibly different voice characters between slides).
 *
 * Slide boundaries are inserted via SLIDE_BOUNDARY_MARKER and detected
 * post-hoc. Each detected boundary midpoint becomes the slide transition
 * timestamp; per-slide durations are the deltas between consecutive midpoints.
 *
 * If silence detection finds fewer than N-1 boundaries (rare — usually
 * means the marker pauses didn't render long enough), falls back to
 * proportional distribution by character count and logs a warning so the
 * production guardrail can still measure drift on the final MP4.
 */
export async function generateContinuousTTS(
  slideTexts: string[],
  outputFilename?: string,
): Promise<ContinuousTTSResult> {
  ensureDir(AUDIO_DIR);
  const filename = outputFilename || `tts_continuous_${Date.now()}.mp3`;
  const outputPath = join(AUDIO_DIR, filename);

  if (!GROK_API_KEY) {
    throw new Error("Grok TTS not configured. Set GROK_API_KEY in environment.");
  }

  const N = slideTexts.length;
  if (N === 0) throw new Error("generateContinuousTTS called with no slide texts");

  const cleaned = slideTexts.map((t) => (t || "").trim() || ".");
  const combined = cleaned.join(SLIDE_BOUNDARY_MARKER);

  logger.info({ slides: N, totalChars: combined.length, voice: GROK_TTS_VOICE }, "Continuous TTS: generating single render...");
  await generateGrokTTS(combined, outputPath);
  const totalDuration = await getAudioDuration(outputPath);

  let perSlideDurations: number[];
  if (N === 1) {
    perSlideDurations = [totalDuration];
  } else {
    const silences = await detectSilences(outputPath);
    const needed = N - 1;

    // Predicted boundary timestamps based on slide character counts. The
    // working assumption is that TTS speech rate is roughly constant, so the
    // proportion of total audio devoted to each slide is approximately the
    // slide's share of total characters (boundary marker text included so
    // the prediction matches what's actually rendered).
    const segmentChars = cleaned.map((t) => t.length + SLIDE_BOUNDARY_MARKER.length);
    const totalChars = segmentChars.reduce((a, b) => a + b, 0);
    const predicted: number[] = [];
    let cumChars = 0;
    for (let i = 0; i < N - 1; i++) {
      cumChars += segmentChars[i];
      predicted.push((totalDuration * cumChars) / totalChars);
    }

    if (silences.length < needed) {
      // Fewer detected silences than slide boundaries — fall back directly
      // to the predicted positions. The post-assembly drift guardrail still
      // catches any total-duration mismatch on the final MP4.
      logger.warn(
        { detected: silences.length, expected: needed, totalDuration },
        "Continuous TTS: silence detection found fewer boundaries than slides — falling back to char-weighted split",
      );
      perSlideDurations = [];
      let prev = 0;
      for (const p of predicted) {
        perSlideDurations.push(p - prev);
        prev = p;
      }
      perSlideDurations.push(totalDuration - prev);
    } else {
      // Pick the silence closest to each predicted boundary, walking left to
      // right and never reusing a silence (so two predicted boundaries can't
      // collapse onto the same silence). This is more robust than picking
      // the longest N-1 silences because it doesn't assume the marker pauses
      // are longer than every emphatic in-narration pause — only that they
      // exist somewhere near the predicted positions.
      const sortedSilences = [...silences].sort((a, b) => a.start - b.start);
      const used = new Set<number>();
      const chosen: number[] = [];
      for (const p of predicted) {
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let i = 0; i < sortedSilences.length; i++) {
          if (used.has(i)) continue;
          const mid = (sortedSilences[i].start + sortedSilences[i].end) / 2;
          if (mid <= (chosen[chosen.length - 1] ?? 0)) continue; // no going backwards
          const dist = Math.abs(mid - p);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx === -1) {
          // No usable silence remaining for this boundary — use predicted as fallback.
          chosen.push(p);
        } else {
          used.add(bestIdx);
          chosen.push((sortedSilences[bestIdx].start + sortedSilences[bestIdx].end) / 2);
        }
      }

      perSlideDurations = [];
      let prev = 0;
      for (const m of chosen) {
        perSlideDurations.push(Math.max(0.1, m - prev));
        prev = m;
      }
      perSlideDurations.push(Math.max(0.1, totalDuration - prev));

      const maxDeviation = Math.max(...predicted.map((p, i) => Math.abs(p - chosen[i])));
      logger.info(
        { detectedSilences: silences.length, slideBoundaries: chosen.length, maxDeviationSec: maxDeviation.toFixed(3) },
        "Continuous TTS: slide boundaries assigned via predicted-position matching",
      );
    }
  }

  logger.info(
    { slides: N, totalDuration, perSlideSum: perSlideDurations.reduce((a, b) => a + b, 0) },
    "Continuous TTS complete",
  );

  return { audioPath: outputPath, durationSec: totalDuration, perSlideDurations, provider: "grok" };
}

// ---------------------------------------------------------------------------
// Provider status
// ---------------------------------------------------------------------------

/**
 * Check which TTS providers are currently configured.
 */
export function getTTSProviderStatus(): Array<{ name: string; configured: boolean }> {
  return [
    { name: `Grok TTS (${GROK_TTS_VOICE})`, configured: !!GROK_API_KEY },
  ];
}
