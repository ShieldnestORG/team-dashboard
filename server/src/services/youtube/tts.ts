/**
 * YouTube Pipeline — Text-to-Speech service
 *
 * Primary provider: Grok TTS (xAI) — fast, high quality, Rex voice.
 * Supports both single-call and chunked (per-slide) generation.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, readFile } from "fs/promises";
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

/** Path to the whisper.cpp binary baked into the production Docker image
 * (see Dockerfile whisper-build stage). When present, slide boundaries are
 * derived from word-level timestamps instead of silence detection — much
 * more accurate on short-bullet decks where natural and inter-slide pauses
 * are similar in length. Falls through to silence-based assignment if the
 * binary isn't present (dev/test environments without whisper installed). */
const WHISPER_BIN = process.env.WHISPER_BIN || "/opt/whisper/whisper";
const WHISPER_MODEL = process.env.WHISPER_MODEL || "/opt/whisper/ggml-tiny.en.bin";

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

interface WhisperWord {
  text: string;       // normalized lowercase, alphanum only
  start: number;      // seconds from audio start
  end: number;        // seconds from audio start
}

/** Normalize a word for matching: lowercase, strip non-alphanumeric.
 * Whisper output may include leading/trailing whitespace and the source
 * slide text often has punctuation that doesn't appear in the transcription. */
function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Extract per-word timestamps from rendered audio via whisper.cpp.
 * Returns null if whisper isn't installed or invocation fails — caller falls
 * back to silence-detection-based boundary assignment. */
async function transcribeWithWhisper(audioPath: string): Promise<WhisperWord[] | null> {
  if (!existsSync(WHISPER_BIN) || !existsSync(WHISPER_MODEL)) {
    logger.info({ bin: WHISPER_BIN, model: WHISPER_MODEL }, "whisper not installed; using silence-based alignment");
    return null;
  }
  try {
    // -ml 1: max one word per segment (gives word-level timestamps directly)
    // -oj : output JSON
    // -of <prefix> : output filename prefix (whisper appends .json)
    // -nt : no timestamps in plaintext output (we want JSON)
    const outPrefix = `${audioPath}.whisper`;
    const cmd = `${WHISPER_BIN} -m ${WHISPER_MODEL} -f "${audioPath}" -ml 1 -oj -of "${outPrefix}" -nt`;
    await execAsync(cmd, { maxBuffer: 32 * 1024 * 1024, timeout: 180_000 });
    const jsonPath = `${outPrefix}.json`;
    const raw = await readFile(jsonPath, "utf-8");
    await unlink(jsonPath).catch(() => {});
    const parsed = JSON.parse(raw) as { transcription?: Array<{ text?: string; offsets?: { from: number; to: number } }> };
    const segs = parsed.transcription || [];
    const words: WhisperWord[] = [];
    for (const seg of segs) {
      const text = normalizeWord(seg.text || "");
      if (!text) continue;
      const off = seg.offsets;
      if (!off) continue;
      // whisper.cpp offsets are in milliseconds
      words.push({ text, start: off.from / 1000, end: off.to / 1000 });
    }
    if (words.length === 0) {
      logger.warn("whisper returned no words; falling back to silence-based alignment");
      return null;
    }
    return words;
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err) }, "whisper invocation failed; falling back to silence-based alignment");
    return null;
  }
}

/** Walk slide texts in order and locate the END timestamp of each slide's
 * last word in the whisper transcript. Returns N-1 boundary timestamps
 * (between consecutive slides) plus a parallel array of per-boundary status
 * ("whisper" if locked via word matching, "predicted" if it fell back to
 * char-weighted prediction for that one boundary). Returns null only if
 * whisper output is empty. Per-slide fallback prevents one stubborn slide
 * (e.g. a 3-word title that whisper transcribes slightly differently from
 * the script) from killing alignment for the whole video. */
function alignSlideBoundariesViaWhisper(
  slideTexts: string[],
  words: WhisperWord[],
  totalDuration: number,
): { boundaries: number[]; statuses: Array<"whisper" | "predicted"> } | null {
  if (words.length === 0 || slideTexts.length < 2) return null;
  const N = slideTexts.length;
  const boundaries: number[] = [];
  const statuses: Array<"whisper" | "predicted"> = [];
  let wordIdx = 0;

  // Char-weighted predicted positions (used when an individual slide's
  // boundary can't be locked via word matching — the rest of the video
  // still benefits from whisper's word-perfect anchors).
  const segmentChars = slideTexts.map((t) => t.length + SLIDE_BOUNDARY_MARKER.length);
  const totalChars = segmentChars.reduce((a, b) => a + b, 0);
  const predictedBoundaries: number[] = [];
  let cumChars = 0;
  for (let i = 0; i < N - 1; i++) {
    cumChars += segmentChars[i];
    predictedBoundaries.push((totalDuration * cumChars) / totalChars);
  }

  for (let s = 0; s < N - 1; s++) {
    // Split on whitespace AND hyphens so compound words like "long-term"
    // produce ["long", "term"] (whisper transcribes hyphenated words as
    // separate tokens). Drop pure-digit tokens — whisper transcribes "2026"
    // as "twenty twenty six" so digit tokens never match. Drop very short
    // (<=2 char) and common stopwords so probes are distinctive.
    const STOPWORDS = new Set(["the", "and", "for", "you", "are", "but", "not", "all", "any", "can", "has", "had", "her", "his", "its", "our", "out", "she", "was", "way", "who", "why", "how", "now", "yes", "yet"]);
    const slideTokens = slideTexts[s]
      .split(/[\s-]+/)
      .map(normalizeWord)
      .filter((t) => t.length > 0 && !/^\d+$/.test(t));

    // Try progressively shorter probe-token sets so a near-miss on the longest
    // tail doesn't kill the whole match. Prefer length>=4 distinctive
    // tokens (skip stopwords); fall back to last 2-1 raw tokens if needed.
    const distinctive = slideTokens.filter((t) => t.length >= 4 && !STOPWORDS.has(t));
    const probeAttempts: string[][] = [];
    if (distinctive.length >= 3) probeAttempts.push(distinctive.slice(-3));
    if (distinctive.length >= 2) probeAttempts.push(distinctive.slice(-2));
    if (distinctive.length >= 1) probeAttempts.push(distinctive.slice(-1));
    if (slideTokens.length >= 2) probeAttempts.push(slideTokens.slice(-2));
    if (slideTokens.length >= 1) probeAttempts.push(slideTokens.slice(-1));

    let anchorWordIdx = -1;
    for (const probeTokens of probeAttempts) {
      let cursor = wordIdx;
      let attemptAnchor = -1;
      for (const probe of probeTokens) {
        let found = -1;
        const searchEnd = Math.min(cursor + 80, words.length);
        for (let w = cursor; w < searchEnd; w++) {
          if (words[w].text === probe) {
            found = w;
            break;
          }
        }
        if (found === -1) { attemptAnchor = -1; break; }
        attemptAnchor = found;
        cursor = found + 1;
      }
      if (attemptAnchor !== -1) {
        anchorWordIdx = attemptAnchor;
        break;
      }
    }

    if (anchorWordIdx === -1) {
      // This single slide couldn't lock. Use predicted for THIS boundary
      // and DO NOT advance wordIdx — keep searching the next slide from
      // the same position. Earlier we tried to advance wordIdx to predicted,
      // but predicted is char-weighted (assumes uniform speech rate) and
      // can overshoot the real audio position; that caused cascade failures
      // where every slide AFTER the first failure couldn't lock because
      // their content was now BEHIND the cursor. Leaving wordIdx alone
      // preserves the option for the next slide to find its content
      // downstream of the last SUCCESSFUL anchor.
      boundaries.push(predictedBoundaries[s]);
      statuses.push("predicted");
      logger.warn({ slideIdx: s, probeTokens: probeAttempts[0] || [] }, "whisper alignment couldn't lock this slide; using predicted for this boundary only");
    } else {
      boundaries.push(words[anchorWordIdx].end);
      statuses.push("whisper");
      wordIdx = anchorWordIdx + 1;
    }
  }

  return { boundaries, statuses };
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
    // Try word-level whisper alignment first — it's word-perfect when it
    // works, so we don't have the silence-detection-vs-prediction tradeoff
    // that produces 1-2s timing errors on short-bullet decks. Per-slide
    // fallback inside the aligner means a single hard-to-match slide
    // doesn't kill alignment for the rest of the video.
    const whisperWords = await transcribeWithWhisper(outputPath);
    const whisperResult = whisperWords ? alignSlideBoundariesViaWhisper(cleaned, whisperWords, totalDuration) : null;

    if (whisperResult && whisperResult.boundaries.length === N - 1) {
      // Add breathing room: hold each slide on screen for a beat after its
      // last spoken word, AND enforce a minimum display time per slide.
      // Without this, slide transitions land exactly on the last spoken
      // word — no visual buffer, slides "skip to the next one quick"
      // particularly on short bullets.
      //
      // Bumped to 0.6/3.5 from 0.4/2.5 after user feedback that slides still
      // felt fast halfway through the video. The 3.5s floor in particular
      // protects predicted-fallback slides where char-weighted prediction
      // would otherwise compress slide N below the duration of its actual
      // narration (since prediction can be 1-2s earlier than truth).
      const HOLD_AFTER_NARRATION_SEC = 0.6;
      const MIN_SLIDE_DISPLAY_SEC = 3.5;
      const adjusted: number[] = [];
      let prev = 0;
      for (let i = 0; i < whisperResult.boundaries.length; i++) {
        const wantedStart = Math.max(
          whisperResult.boundaries[i] + HOLD_AFTER_NARRATION_SEC,
          prev + MIN_SLIDE_DISPLAY_SEC,
        );
        adjusted.push(wantedStart);
        prev = wantedStart;
      }
      // Constrain rightward — the LAST slide also needs MIN_SLIDE_DISPLAY,
      // and total can't exceed totalDuration. Cap last boundary so the
      // tail slide gets its minimum, walking back through earlier
      // boundaries if necessary.
      const maxLastBoundary = totalDuration - MIN_SLIDE_DISPLAY_SEC;
      for (let i = adjusted.length - 1; i >= 0; i--) {
        const ceiling = i === adjusted.length - 1
          ? maxLastBoundary
          : adjusted[i + 1] - MIN_SLIDE_DISPLAY_SEC;
        if (adjusted[i] > ceiling) adjusted[i] = ceiling;
      }

      perSlideDurations = [];
      prev = 0;
      for (const b of adjusted) {
        perSlideDurations.push(Math.max(0.1, b - prev));
        prev = b;
      }
      perSlideDurations.push(Math.max(0.1, totalDuration - prev));

      const lockedViaWhisper = whisperResult.statuses.filter((s) => s === "whisper").length;
      const fellThroughToPredicted = whisperResult.statuses.length - lockedViaWhisper;
      const minSlide = Math.min(...perSlideDurations);
      const maxSlide = Math.max(...perSlideDurations);
      logger.info(
        { slides: N, totalDuration, alignedVia: "whisper", whisperWords: whisperWords?.length ?? 0, lockedViaWhisper, fellThroughToPredicted, minSlideDurSec: minSlide.toFixed(2), maxSlideDurSec: maxSlide.toFixed(2) },
        "Continuous TTS: slide boundaries assigned via whisper word alignment",
      );
      return { audioPath: outputPath, durationSec: totalDuration, perSlideDurations, provider: "grok" };
    }

    // Fall through: silence detection + predicted-position matching.
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
      // right, never reusing a silence, never going backwards. CRITICAL:
      // also reject any silence more than MAX_SILENCE_DEVIATION_SEC away
      // from predicted — when the inter-slide marker pause is similar in
      // length to natural mid-bullet emphatic pauses (which happens on
      // short-bullet decks), the algorithm can pick a sentence-end silence
      // INSIDE slide N's narration as a "boundary," which causes slide N+1
      // to pop in while slide N is still being spoken. This was producing
      // 1.5-1.9s deviations and the user-perceptible "slide jumps too
      // early" failure mode. Falling back to predicted in those cases
      // bounds the worst-case error to speech-rate variance (~15% × slide
      // duration), which is much smaller than the silence-misassignment
      // risk it replaces.
      const MAX_SILENCE_DEVIATION_SEC = 0.5;
      const sortedSilences = [...silences].sort((a, b) => a.start - b.start);
      const used = new Set<number>();
      const chosen: number[] = [];
      let snapped = 0;
      let fellThrough = 0;
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
        if (bestIdx === -1 || bestDist > MAX_SILENCE_DEVIATION_SEC) {
          // No silence within tolerance — use predicted directly. Bounded by
          // character-rate variance instead of unbounded mismatch.
          chosen.push(p);
          fellThrough++;
        } else {
          used.add(bestIdx);
          chosen.push((sortedSilences[bestIdx].start + sortedSilences[bestIdx].end) / 2);
          snapped++;
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
        { detectedSilences: silences.length, slideBoundaries: chosen.length, snapped, fellThroughToPredicted: fellThrough, maxDeviationSec: maxDeviation.toFixed(3) },
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
