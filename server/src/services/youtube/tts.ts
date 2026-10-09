/**
 * YouTube Pipeline — Text-to-Speech service
 *
 * Providers (env YT_TTS_PROVIDER):
 *  - "elevenlabs" (default) — Mark's ElevenLabs clone, model eleven_multilingual_v2.
 *  - "grok" — Grok TTS (xAI), Rex voice.
 * Supports both single-call and chunked (per-slide) generation. Chunked output
 * is stitched as PCM WAV so every chunk duration is sample-exact.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, rename, readFile } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";
import { noteProviderFailure } from "../provider-alerts.js";
import { logApiUsage } from "../api-usage.js";
import { VOICE_REGISTRY } from "../voice-snippets.js";

const execAsync = promisify(exec);

const GROK_API_KEY = process.env.GROK_API_KEY || "";
const GROK_TTS_VOICE = process.env.GROK_TTS_VOICE || "rex";
const GROK_TTS_URL = "https://api.x.ai/v1/tts";

// ElevenLabs — Mark_new_2026 (VOICE_REGISTRY.mark), on eleven_v3 "Creative"
// (stability 0.0): the owner's pick on 2026-10-08 (take D) for energy — about
// 180 wpm vs about 156 on v2; a 12-beat test read back by Whisper had 1.4% word
// errors and no badly misread clip. The clone is fine-tuned for multilingual_v2 /
// turbo / flash, not v3 (GET /v1/voices/n45m…, 2026-10-07), and v3 REJECTS
// previous_text/next_text (HTTP 400 "not yet supported with the 'eleven_v3'
// model", measured 2026-10-08), so v3 beats are voiced without neighbours.
// YT_ELEVENLABS_MODEL=eleven_multilingual_v2 restores the steady v2 voice with
// the owner's ZeroEdit "v2" preset (tools/tts.py PRESETS["v2"]).
// The key is ELEVENLABS_VOICE_KEY, read at call time, with NO fallback to
// ELEVENLABS_API_KEY (a different account — see voice-snippets.ts header).
const ELEVENLABS_TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const ELEVENLABS_PRESETS = {
  eleven_v3: { stability: 0.0, similarity_boost: 0.9, style: 0.0 },
  eleven_multilingual_v2: { stability: 0.45, similarity_boost: 0.8, style: 0.0 },
} as const;
type ElevenLabsModel = keyof typeof ELEVENLABS_PRESETS;
const ELEVENLABS_OUTPUT_FORMAT = "mp3_44100_128";
const ELEVENLABS_RETRY_BACKOFF_MS = [1000, 3000]; // up to 2 retries on 429 / 5xx

/** YT_ELEVENLABS_MODEL (default eleven_v3); anything else fails loud. Read at call time. */
function elevenLabsModel(): ElevenLabsModel {
  const model = process.env.YT_ELEVENLABS_MODEL || "eleven_v3";
  if (!(model in ELEVENLABS_PRESETS)) {
    throw new Error(`Unknown YT_ELEVENLABS_MODEL "${model}" (use eleven_v3 or eleven_multilingual_v2)`);
  }
  return model as ElevenLabsModel;
}

const AUDIO_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "audio");

// Chunked output format: PCM s16le, 44.1 kHz, mono. Every provider clip is
// decoded to this immediately (Grok returns 24 kHz, ElevenLabs 44.1 kHz; the
// concat demuxer needs identical params and MP3 encoder padding would drift
// every boundary).
const WAV_RATE = 44100;
const SILENCE_GAP_SEC = 0.6;
const FADE_SEC = 0.03; // 30ms fade-in/out at chunk boundaries to suppress click artifacts

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
  /** Interleaved [content, silence, content, silence, ..., content]. Kept for back-compat. */
  chunkDurations: number[];
  /** Per-input-chunk content audio duration (no silence). Same length as input chunks. */
  contentDurations: number[];
  /** Silence inserted between content chunks, in seconds. */
  silenceGapSec: number;
  provider: string;
}

export interface ChunkedTTSOptions {
  /** A chunk that still fails after retries throws instead of becoming silence. */
  failOnChunkError?: boolean;
}

type TtsProvider = "elevenlabs" | "grok";

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

/** Provider selected by YT_TTS_PROVIDER (default elevenlabs). Unknown values fail loud. */
function resolveProvider(): TtsProvider {
  const raw = (process.env.YT_TTS_PROVIDER || "").trim().toLowerCase();
  if (raw === "" || raw === "elevenlabs") return "elevenlabs";
  if (raw === "grok") return "grok";
  throw new Error(`Unknown YT_TTS_PROVIDER "${raw}" (expected "elevenlabs" or "grok")`);
}

// ---------------------------------------------------------------------------
// Grok TTS (xAI)
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
    noteProviderFailure({ provider: "xai", service: "youtube-tts", status: res.status, bodyText: errBody });
    throw new Error(`Grok TTS failed (${res.status}): ${errBody.slice(0, 500)}`);
  }

  // TTS responses are audio bytes, no token usage — log 0 tokens so the CALL
  // is still counted. The API takes a voice_id, not a model id; "grok-tts" is
  // our stable identifier for this endpoint.
  void logApiUsage({
    provider: "xai",
    service: "youtube-tts",
    model: "grok-tts",
    inputTokens: 0,
    outputTokens: 0,
  });

  const audioBuffer = Buffer.from(await res.arrayBuffer());
  await writeFile(outputPath, audioBuffer);

  const durationSec = await getAudioDuration(outputPath);
  logger.info({ provider: "grok", voice: GROK_TTS_VOICE, durationSec }, "Grok TTS complete");

  return { audioPath: outputPath, durationSec, provider: "grok" };
}

// ---------------------------------------------------------------------------
// ElevenLabs TTS (Mark's clone)
// ---------------------------------------------------------------------------

export interface ElevenLabsContext {
  /** Text of the previous beat (ElevenLabs continuity param). Omitted at the start. */
  previousText?: string;
  /** Text of the next beat (ElevenLabs continuity param). Omitted at the end. */
  nextText?: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function generateElevenLabsTTS(
  text: string,
  outputPath: string,
  ctx: ElevenLabsContext = {},
): Promise<TTSResult> {
  const apiKey = process.env.ELEVENLABS_VOICE_KEY;
  if (!apiKey) {
    throw new Error(
      "ElevenLabs TTS not configured. Set ELEVENLABS_VOICE_KEY in environment (ELEVENLABS_API_KEY is a different account and is not used).",
    );
  }

  const model = elevenLabsModel();
  const withNeighbours = model !== "eleven_v3"; // v3 answers 400 to previous_text/next_text
  const url = `${ELEVENLABS_TTS_BASE}/${VOICE_REGISTRY.mark.voiceId}?output_format=${ELEVENLABS_OUTPUT_FORMAT}`;
  const body = JSON.stringify({
    text,
    model_id: model,
    voice_settings: ELEVENLABS_PRESETS[model],
    ...(withNeighbours && ctx.previousText ? { previous_text: ctx.previousText } : {}),
    ...(withNeighbours && ctx.nextText ? { next_text: ctx.nextText } : {}),
  });

  logger.info({ voice: "mark", model, chars: text.length }, "ElevenLabs TTS: generating audio...");

  for (let attempt = 0; ; attempt++) {
    let res: Response | undefined;
    let netErr: unknown;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body,
        signal: AbortSignal.timeout(120_000), // 2 min timeout
      });
    } catch (err) {
      netErr = err;
    }

    if (res?.ok) {
      void logApiUsage({
        provider: "elevenlabs",
        service: "youtube-tts",
        model,
        inputTokens: 0,
        outputTokens: 0,
      });
      await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
      const durationSec = await getAudioDuration(outputPath);
      logger.info({ provider: "elevenlabs", voice: "mark", durationSec }, "ElevenLabs TTS complete");
      return { audioPath: outputPath, durationSec, provider: "elevenlabs" };
    }

    // Drain the body without reading or logging it (voice-snippets convention:
    // statuses only, never provider response bodies).
    if (res) await res.arrayBuffer().catch(() => undefined);

    const status = res ? res.status : null;
    const retryable = status === null || status === 429 || status >= 500;
    if (retryable && attempt < ELEVENLABS_RETRY_BACKOFF_MS.length) {
      logger.warn({ status, attempt: attempt + 1 }, "ElevenLabs TTS failed, retrying");
      await sleep(ELEVENLABS_RETRY_BACKOFF_MS[attempt]);
      continue;
    }

    noteProviderFailure({ provider: "elevenlabs", service: "youtube-tts", status, error: netErr });
    throw new Error(`ElevenLabs TTS failed (${status ?? "no response"})`);
  }
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

  if (resolveProvider() === "grok") return await generateGrokTTS(text, outputPath);
  return await generateElevenLabsTTS(text, outputPath);
}

// ---------------------------------------------------------------------------
// WAV helpers — exact timing
// ---------------------------------------------------------------------------

/** Duration of an audio file via ffprobe. Unlike getAudioDuration it never guesses. */
async function probeDurationStrict(audioPath: string): Promise<number> {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
  );
  const sec = parseFloat(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) throw new Error(`ffprobe returned no duration for ${audioPath}`);
  return sec;
}

/** Decode any provider clip to PCM s16le / 44.1 kHz / mono WAV. */
export async function decodeToWav(inputPath: string, wavPath: string): Promise<void> {
  await execAsync(
    `ffmpeg -y -hide_banner -loglevel error -i "${inputPath}" -ac 1 -ar ${WAV_RATE} -c:a pcm_s16le "${wavPath}"`,
    { timeout: 60_000 },
  );
}

/**
 * Apply 30ms fade-in and fade-out to a WAV in place to suppress click/pop
 * artifacts at concat boundaries. Stays PCM, so the length does not change.
 */
export async function applyEdgeFadesWav(wavPath: string, durationSec: number, fadeSec: number): Promise<void> {
  const fadeOutStart = Math.max(0, durationSec - fadeSec);
  const tmpPath = `${wavPath}.faded.wav`;
  await execAsync(
    `ffmpeg -y -hide_banner -loglevel error -i "${wavPath}" -af "afade=t=in:st=0:d=${fadeSec},afade=t=out:st=${fadeOutStart.toFixed(3)}:d=${fadeSec}" -ac 1 -ar ${WAV_RATE} -c:a pcm_s16le "${tmpPath}"`,
    { timeout: 60_000 },
  );
  await rename(tmpPath, wavPath);
}

export const BREATH_TRIM = { onsetDb: -32, tailDb: -40, windowSec: 0.02, prerollSec: 0.06, postrollSec: 0.12 };

/** Trim breath/room tone from both ends of one decoded clip WAV, in place. Returns seconds removed. */
export async function trimClipEdgesWav(wavPath: string): Promise<{ trimmedStartSec: number; trimmedEndSec: number }> {
  const buf = await readFile(wavPath);

  // Walk RIFF chunks to find the `fmt ` sample rate and the `data` payload. Do
  // NOT assume a 44-byte header: ffmpeg may write a LIST chunk before `data`.
  let sampleRate = WAV_RATE;
  let dataOffset = -1;
  let dataLen = 0;
  let offset = 12; // past "RIFF" + chunk size + "WAVE"
  while (offset + 8 <= buf.length) {
    const id = buf.toString("ascii", offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === "fmt ") {
      sampleRate = buf.readUInt32LE(offset + 12);
    } else if (id === "data") {
      dataOffset = offset + 8;
      dataLen = size;
    }
    offset += 8 + size + (size & 1); // chunks are word-aligned
  }

  if (dataOffset < 0 || dataLen < 2) return { trimmedStartSec: 0, trimmedEndSec: 0 };

  const totalSamples = Math.floor(dataLen / 2);
  const duration = totalSamples / sampleRate;
  const winSamples = Math.max(1, Math.round(sampleRate * BREATH_TRIM.windowSec));

  // RMS of one window in dBFS = 20*log10(rms/32768); silence -> -Infinity.
  const windowDb = (startSample: number): number => {
    let sum = 0;
    const end = Math.min(startSample + winSamples, totalSamples);
    for (let i = startSample; i < end; i++) {
      const s = buf.readInt16LE(dataOffset + i * 2);
      sum += s * s;
    }
    const rms = Math.sqrt(sum / (end - startSample));
    return 20 * Math.log10(rms / 32768);
  };

  const numWindows = Math.floor(totalSamples / winSamples);
  if (numWindows < 1) return { trimmedStartSec: 0, trimmedEndSec: 0 };

  let onsetSec = -1;
  for (let w = 0; w < numWindows; w++) {
    if (windowDb(w * winSamples) >= BREATH_TRIM.onsetDb) {
      onsetSec = (w * winSamples) / sampleRate;
      break;
    }
  }

  // No window reached the onset level -> nothing to trim.
  if (onsetSec < 0) return { trimmedStartSec: 0, trimmedEndSec: 0 };

  let endSec = -1;
  for (let w = numWindows - 1; w >= 0; w--) {
    if (windowDb(w * winSamples) >= BREATH_TRIM.tailDb) {
      endSec = ((w + 1) * winSamples) / sampleRate;
      break;
    }
  }

  if (endSec < 0 || endSec - onsetSec < 0.1) return { trimmedStartSec: 0, trimmedEndSec: 0 };

  const keepStart = Math.max(0, onsetSec - BREATH_TRIM.prerollSec);
  const keepEnd = Math.min(duration, endSec + BREATH_TRIM.postrollSec);

  if (keepStart < 0.005 && duration - keepEnd < 0.005) return { trimmedStartSec: 0, trimmedEndSec: 0 };

  const tmpPath = `${wavPath}.trim.wav`;
  await execAsync(
    `ffmpeg -y -hide_banner -loglevel error -i "${wavPath}" -af "atrim=start=${keepStart.toFixed(3)}:end=${keepEnd.toFixed(3)},asetpts=PTS-STARTPTS" -ac 1 -ar ${WAV_RATE} -c:a pcm_s16le "${tmpPath}"`,
    { timeout: 60_000 },
  );
  await rename(tmpPath, wavPath);

  const round3 = (v: number): number => Math.round(v * 1000) / 1000;
  return { trimmedStartSec: round3(keepStart), trimmedEndSec: round3(duration - keepEnd) };
}

/** Silence WAV with the same params as the decoded clips. */
export async function makeSilenceWav(wavPath: string, durationSec: number): Promise<void> {
  await execAsync(
    `ffmpeg -y -hide_banner -loglevel error -f lavfi -i anullsrc=r=${WAV_RATE}:cl=mono -t ${durationSec} -c:a pcm_s16le "${wavPath}"`,
    { timeout: 60_000 },
  );
}

export interface WavTrackResult {
  contentDurations: number[];
  chunkDurations: number[];
  durationSec: number;
}

/**
 * Stitch decoded clip WAVs into one WAV with a silence gap between consecutive
 * chunks. `clipWavs[i]` is null when chunk i has no audio (empty text or a
 * failed chunk): it contributes 0 s of content but still gets its gap, so slide
 * durations (content + gap) always add up to the audio length. Durations are
 * measured from the WAV files, which ffprobe reports sample-exact for PCM.
 */
export async function assembleWavTrack(
  clipWavs: Array<string | null>,
  outputPath: string,
  gapSec: number,
  tmpStamp: string,
): Promise<WavTrackResult> {
  ensureDir(AUDIO_DIR);
  const silencePath = join(AUDIO_DIR, `silence_${tmpStamp}.wav`);
  const concatList = join(AUDIO_DIR, `concat_${tmpStamp}.txt`);
  try {
    await makeSilenceWav(silencePath, gapSec);

    const contentDurations: number[] = [];
    const chunkDurations: number[] = [];
    const parts: string[] = [];
    for (let i = 0; i < clipWavs.length; i++) {
      const clip = clipWavs[i];
      if (clip) {
        const d = await probeDurationStrict(clip);
        contentDurations.push(d);
        chunkDurations.push(d);
        parts.push(clip);
      } else {
        contentDurations.push(0);
        chunkDurations.push(0);
      }
      if (i < clipWavs.length - 1) {
        chunkDurations.push(gapSec);
        parts.push(silencePath);
      }
    }
    if (parts.length === 0) throw new Error("No audio produced: every chunk was empty");

    await writeFile(concatList, parts.map((p) => `file '${p}'`).join("\n"));
    await execAsync(
      `ffmpeg -y -hide_banner -loglevel error -f concat -safe 0 -i "${concatList}" -c copy "${outputPath}"`,
      { timeout: 120_000 },
    );
    const durationSec = await probeDurationStrict(outputPath);
    return { contentDurations, chunkDurations, durationSec };
  } finally {
    await unlink(silencePath).catch(() => {});
    await unlink(concatList).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Chunked TTS — generate per-section audio and concatenate
// ---------------------------------------------------------------------------

/**
 * Generate TTS for each text chunk separately, then concatenate into one WAV.
 * Returns per-chunk durations so slide timing can be exact.
 * Adds a brief silence gap between chunks for natural pacing.
 */
export async function generateChunkedTTS(
  chunks: string[],
  outputFilename?: string,
  opts: ChunkedTTSOptions = {},
): Promise<ChunkedTTSResult> {
  ensureDir(AUDIO_DIR);
  const provider = resolveProvider();
  // The output is WAV regardless of what the caller named it.
  const baseName = outputFilename || `tts_chunked_${Date.now()}.wav`;
  const filename = baseName.toLowerCase().endsWith(".wav") ? baseName : `${baseName.replace(/\.[^./]+$/, "")}.wav`;
  const outputPath = join(AUDIO_DIR, filename);

  if (provider === "grok" && !GROK_API_KEY) {
    throw new Error("Grok TTS not configured. Set GROK_API_KEY in environment.");
  }
  if (provider === "elevenlabs" && !process.env.ELEVENLABS_VOICE_KEY) {
    throw new Error(
      "ElevenLabs TTS not configured. Set ELEVENLABS_VOICE_KEY in environment (ELEVENLABS_API_KEY is a different account and is not used).",
    );
  }

  logger.info({ chunks: chunks.length, provider }, "Chunked TTS starting...");

  const stamp = String(Date.now());
  const clipWavs: Array<string | null> = [];
  const tempFiles: string[] = [];

  try {
    for (let i = 0; i < chunks.length; i++) {
      const text = chunks[i].trim();
      if (!text) {
        clipWavs.push(null);
        continue;
      }

      const rawFile = join(AUDIO_DIR, `chunk_${stamp}_${i}.mp3`);
      const wavFile = join(AUDIO_DIR, `chunk_${stamp}_${i}.wav`);
      tempFiles.push(rawFile, wavFile);
      logger.info({ chunk: i + 1, total: chunks.length, chars: text.length }, "Generating TTS chunk...");

      try {
        if (provider === "grok") {
          await generateGrokTTS(text, rawFile);
        } else {
          await generateElevenLabsTTS(text, rawFile, {
            previousText: chunks[i - 1]?.trim() || undefined,
            nextText: chunks[i + 1]?.trim() || undefined,
          });
        }
        await decodeToWav(rawFile, wavFile);
        const trimmed = await trimClipEdgesWav(wavFile);
        if (trimmed.trimmedStartSec > 0 || trimmed.trimmedEndSec > 0) {
          logger.info({ chunk: i, ...trimmed }, "Trimmed breath/room tone from chunk");
        }
        await applyEdgeFadesWav(wavFile, await probeDurationStrict(wavFile), FADE_SEC);
        clipWavs.push(wavFile);
      } catch (err) {
        if (opts.failOnChunkError) {
          throw new Error(
            `TTS chunk ${i + 1}/${chunks.length} failed: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        if (provider === "grok") noteProviderFailure({ provider: "xai", service: "youtube-tts", error: err });
        logger.warn({ err, chunk: i }, "Chunk TTS failed, adding silence");
        clipWavs.push(null);
      }
    }

    const track = await assembleWavTrack(clipWavs, outputPath, SILENCE_GAP_SEC, stamp);

    logger.info(
      { provider, chunks: chunks.length, totalDuration: track.durationSec, chunkCount: track.chunkDurations.length },
      "Chunked TTS generation complete",
    );

    return {
      audioPath: outputPath,
      durationSec: track.durationSec,
      chunkDurations: track.chunkDurations,
      contentDurations: track.contentDurations,
      silenceGapSec: SILENCE_GAP_SEC,
      provider,
    };
  } finally {
    for (const p of tempFiles) await unlink(p).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Provider status
// ---------------------------------------------------------------------------

/**
 * Check which TTS providers are currently configured, and which one is active.
 */
export function getTTSProviderStatus(): Array<{ name: string; configured: boolean; active: boolean }> {
  let active: TtsProvider | null = null;
  try {
    active = resolveProvider();
  } catch {
    // Unknown YT_TTS_PROVIDER: nothing is active; the pipeline itself fails loud.
  }
  return [
    {
      name: `ElevenLabs (Mark, ${(() => { try { return elevenLabsModel(); } catch { return "invalid YT_ELEVENLABS_MODEL"; } })()})`,
      configured: !!process.env.ELEVENLABS_VOICE_KEY,
      active: active === "elevenlabs",
    },
    { name: `Grok TTS (${GROK_TTS_VOICE})`, configured: !!GROK_API_KEY, active: active === "grok" },
  ];
}
