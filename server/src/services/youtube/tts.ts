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

const AUDIO_DIR = join("/tmp", "yt-audio");

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
    temperature: 0.6,
    top_p: 0.95,
    repetition_penalty: 1.2,
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

/**
 * Check which TTS providers are currently configured.
 */
export function getTTSProviderStatus(): Array<{ name: string; configured: boolean }> {
  return [
    { name: "Chatterbox (voice clone)", configured: !!CHATTERBOX_API_URL },
  ];
}
