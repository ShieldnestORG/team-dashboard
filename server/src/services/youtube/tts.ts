/**
 * YouTube Pipeline — Text-to-Speech service
 *
 * Provider cascade: Chatterbox (self-hosted voice clone) → Google Cloud TTS → macOS built-in
 * Replaces Anthropic/OpenAI TTS from the standalone project.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, mkdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";

const execAsync = promisify(exec);

const CHATTERBOX_API_URL = process.env.CHATTERBOX_API_URL || "";
const CHATTERBOX_API_KEY = process.env.CHATTERBOX_API_KEY || "";
const CHATTERBOX_VOICE_REF = process.env.CHATTERBOX_VOICE_REF || "default";
const GOOGLE_TTS_API_KEY = process.env.GOOGLE_TTS_API_KEY || "";
const GOOGLE_TTS_VOICE = process.env.GOOGLE_TTS_VOICE || "en-US-Neural2-J";
const GOOGLE_TTS_LANGUAGE = process.env.GOOGLE_TTS_LANGUAGE || "en-US";

const AUDIO_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "audio");

export interface TTSResult {
  audioPath: string;
  durationSec: number;
  timingsPath?: string;
  provider: string;
}

function ensureDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate TTS audio from text with provider cascade.
 */
export async function generateTTSAudio(
  text: string,
  outputFilename?: string,
): Promise<TTSResult> {
  ensureDir(AUDIO_DIR);
  const filename = outputFilename || `tts_${Date.now()}.mp3`;
  const outputPath = join(AUDIO_DIR, filename);

  // Chatterbox only — self-hosted voice clone, no fallback to Google/macOS
  if (CHATTERBOX_API_URL) {
    return await generateChatterboxTTS(text, outputPath);
  }

  throw new Error("Chatterbox TTS not configured. Set CHATTERBOX_API_URL in environment.");
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
// Chatterbox TTS (self-hosted voice clone on VPS)
// ---------------------------------------------------------------------------

async function generateChatterboxTTS(text: string, outputPath: string): Promise<TTSResult> {
  // Health check — fail fast if VPS is down
  const healthRes = await fetch(`${CHATTERBOX_API_URL}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!healthRes.ok) throw new Error(`Chatterbox health check failed: ${healthRes.status}`);
  logger.info("Chatterbox health check passed, starting TTS generation (this may take 5-10 min on CPU)...");

  // Chatterbox on CPU takes 5-10 min for a full 4-5 min script.
  // Node.js undici has a default headersTimeout that can kill long requests.
  // Use http module directly to avoid undici timeout issues.
  const url = new URL(`${CHATTERBOX_API_URL}/v1/tts`);
  const requestBody = JSON.stringify({
    text,
    voice_ref: CHATTERBOX_VOICE_REF,
    // Lower temperature = less random artifacts, cleaner tone, less nasal.
    // Higher repetition_penalty = reduces repetitive nasal patterns.
    temperature: parseFloat(process.env.CHATTERBOX_TEMPERATURE || "0.4"),
    top_p: parseFloat(process.env.CHATTERBOX_TOP_P || "0.85"),
    repetition_penalty: parseFloat(process.env.CHATTERBOX_REP_PENALTY || "1.35"),
  });

  const httpModule = url.protocol === "https:" ? await import("https") : await import("http");

  const arrayBuf = await new Promise<Buffer>((resolve, reject) => {
    const req = httpModule.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": CHATTERBOX_API_KEY,
          "Content-Length": Buffer.byteLength(requestBody),
        },
        timeout: 1_800_000, // 30 min socket timeout
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`Chatterbox TTS failed: ${res.statusCode}`));
          res.resume();
          return;
        }
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy(new Error("Chatterbox TTS request timed out after 30 minutes"));
    });
    req.write(requestBody);
    req.end();
  });

  const wavPath = outputPath.replace(/\.mp3$/, "_raw.wav");
  await writeFile(wavPath, arrayBuf);

  // Convert WAV → MP3
  await execAsync(`ffmpeg -y -i "${wavPath}" -codec:a libmp3lame -qscale:a 2 "${outputPath}"`);
  await unlink(wavPath).catch(() => {});

  const durationSec = await getAudioDuration(outputPath);
  logger.info({ provider: "chatterbox", durationSec }, "TTS generation complete (voice clone)");

  return { audioPath: outputPath, durationSec, provider: "chatterbox" };
}

// ---------------------------------------------------------------------------
// Google Cloud TTS
// ---------------------------------------------------------------------------

async function generateGoogleTTS(text: string, outputPath: string): Promise<TTSResult> {
  const url = `https://texttospeech.googleapis.com/v1/text:synthesize?key=${GOOGLE_TTS_API_KEY}`;
  const CHUNK_SIZE = 4500; // Google TTS limit is 5000 bytes

  // Split at sentence boundaries
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > CHUNK_SIZE) {
    let splitAt = remaining.lastIndexOf(". ", CHUNK_SIZE);
    if (splitAt === -1) splitAt = remaining.lastIndexOf(" ", CHUNK_SIZE);
    if (splitAt === -1) splitAt = CHUNK_SIZE;
    chunks.push(remaining.slice(0, splitAt + 1).trim());
    remaining = remaining.slice(splitAt + 1).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);

  const audioBuffers: Buffer[] = [];
  for (const chunk of chunks) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { text: chunk },
        voice: { languageCode: GOOGLE_TTS_LANGUAGE, name: GOOGLE_TTS_VOICE, ssmlGender: "MALE" },
        audioConfig: { audioEncoding: "MP3", speakingRate: 1.0, pitch: 0, volumeGainDb: 0 },
      }),
    });
    if (!res.ok) throw new Error(`Google TTS failed: ${res.status}`);
    const data = (await res.json()) as { audioContent: string };
    audioBuffers.push(Buffer.from(data.audioContent, "base64"));
  }

  await writeFile(outputPath, Buffer.concat(audioBuffers));
  const durationSec = await getAudioDuration(outputPath);
  logger.info({ provider: "google", chunks: chunks.length, durationSec }, "Google TTS complete");

  return { audioPath: outputPath, durationSec, provider: "google" };
}

// ---------------------------------------------------------------------------
// macOS built-in TTS (free, offline fallback)
// ---------------------------------------------------------------------------

async function generateMacOSTTS(text: string, outputPath: string): Promise<TTSResult> {
  const aiffPath = outputPath.replace(/\.[^.]+$/, ".aiff");
  const escaped = text.replace(/"/g, '\\"');
  await execAsync(`say -o "${aiffPath}" "${escaped}"`);
  await execAsync(`ffmpeg -y -i "${aiffPath}" "${outputPath}"`);
  await unlink(aiffPath).catch(() => {});

  const durationSec = await getAudioDuration(outputPath);
  logger.info({ provider: "macos", durationSec }, "macOS TTS complete");

  return { audioPath: outputPath, durationSec, provider: "macos" };
}

// ---------------------------------------------------------------------------
// Chunked TTS — generate per-section audio and concatenate
// ---------------------------------------------------------------------------

export interface ChunkedTTSResult {
  audioPath: string;
  durationSec: number;
  chunkDurations: number[]; // per-chunk durations for slide timing
  provider: string;
}

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

  if (!CHATTERBOX_API_URL) {
    throw new Error("Chatterbox TTS not configured. Set CHATTERBOX_API_URL in environment.");
  }

  // Health check once
  const healthRes = await fetch(`${CHATTERBOX_API_URL}/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!healthRes.ok) throw new Error(`Chatterbox health check failed: ${healthRes.status}`);
  logger.info({ chunks: chunks.length }, "Chatterbox chunked TTS starting...");

  const chunkPaths: string[] = [];
  const chunkDurations: number[] = [];
  const SILENCE_GAP_SEC = 0.6; // brief pause between sections

  // Generate a silence file for gaps
  const silencePath = join(AUDIO_DIR, `silence_${Date.now()}.mp3`);
  await execAsync(
    `ffmpeg -y -f lavfi -i anullsrc=r=24000:cl=mono -t ${SILENCE_GAP_SEC} -codec:a libmp3lame -qscale:a 2 "${silencePath}"`,
  );

  for (let i = 0; i < chunks.length; i++) {
    const text = chunks[i].trim();
    if (!text) {
      chunkDurations.push(SILENCE_GAP_SEC);
      continue;
    }

    const chunkFile = join(AUDIO_DIR, `chunk_${Date.now()}_${i}.mp3`);
    logger.info({ chunk: i + 1, total: chunks.length, words: text.split(/\s+/).length }, "Generating TTS chunk...");

    try {
      const result = await generateChatterboxTTS(text, chunkFile);
      chunkPaths.push(chunkFile);
      chunkDurations.push(result.durationSec);

      // Add silence gap after each chunk except the last
      if (i < chunks.length - 1) {
        chunkPaths.push(silencePath);
        chunkDurations.push(SILENCE_GAP_SEC);
      }
    } catch (err) {
      logger.warn({ err, chunk: i }, "Chunk TTS failed, adding silence");
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

  // Cleanup temp chunk files (not silence, it may be reused)
  for (const p of chunkPaths) {
    if (p !== silencePath) await unlink(p).catch(() => {});
  }
  await unlink(silencePath).catch(() => {});
  await unlink(concatList).catch(() => {});

  logger.info(
    { provider: "chatterbox", chunks: chunks.length, totalDuration, chunkCount: chunkDurations.length },
    "Chunked TTS generation complete",
  );

  return { audioPath: outputPath, durationSec: totalDuration, chunkDurations, provider: "chatterbox" };
}

/**
 * Check which TTS providers are currently configured.
 */
export function getTTSProviderStatus(): Array<{ name: string; configured: boolean }> {
  return [
    { name: "Chatterbox (voice clone)", configured: !!CHATTERBOX_API_URL },
  ];
}
