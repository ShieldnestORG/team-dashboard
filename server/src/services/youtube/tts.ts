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
