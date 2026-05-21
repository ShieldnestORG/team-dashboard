/**
 * YouTube Pipeline — Video Assembler
 *
 * Multi-scene FFmpeg assembly: audio + sequential images + captions → MP4
 * For full YouTube videos (1920x1080 landscape), not shorts.
 */

import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, readFile, mkdir } from "fs/promises";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";

const execAsync = promisify(exec);
const TEMP_DIR = join("/tmp", "yt-temp"); // truly ephemeral — intermediate files only
const VIDEO_DIR = join(process.env.YT_DATA_DIR || "/paperclip/youtube", "videos");

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export interface YtAssembleOptions {
  audioPath: string;
  audioDurationSec: number;
  /** Array of image paths (one per scene/slide) */
  visualAssets: string[];
  /** Word counts per slide for duration weighting (same length as visualAssets) */
  slideWordCounts?: number[];
  /** Exact per-slide durations in seconds (overrides word-count estimation if provided) */
  slideDurations?: number[];
  /** SRT captions file path (optional) */
  captionsPath?: string;
  /** Output filename (without dir) */
  outputFilename?: string;
  /** Metadata for embedding */
  metadata?: {
    title?: string;
    description?: string;
    copyright?: string;
  };
}

export interface YtAssembleResult {
  videoPath: string;
  durationSec: number;
  fileSizeBytes: number;
}

/**
 * Assemble a full YouTube video from images + audio + optional captions.
 */
export async function assembleYouTubeVideo(opts: YtAssembleOptions): Promise<YtAssembleResult> {
  ensureDir(TEMP_DIR);
  ensureDir(VIDEO_DIR);

  const {
    audioPath,
    audioDurationSec,
    visualAssets,
    captionsPath,
    outputFilename = `yt_${Date.now()}.mp4`,
    metadata,
  } = opts;

  const outputPath = join(VIDEO_DIR, outputFilename);

  if (visualAssets.length === 0) {
    throw new Error("No visual assets provided for video assembly");
  }

  // Calculate per-slide durations.
  // If exact slideDurations provided (from chunked TTS), use those directly.
  // Otherwise estimate from word counts.
  let slideDurations: number[];
  if (opts.slideDurations && opts.slideDurations.length === visualAssets.length) {
    slideDurations = opts.slideDurations;
  } else {
    const wordCounts = opts.slideWordCounts || visualAssets.map(() => 1);
    const MIN_SLIDE_SEC = 2.0;
    const totalWords = wordCounts.reduce((a, b) => a + b, 0) || 1;
    const reservedSec = MIN_SLIDE_SEC * visualAssets.length;
    const distributableSec = Math.max(0, audioDurationSec - reservedSec);
    slideDurations = wordCounts.map(
      (wc) => MIN_SLIDE_SEC + (distributableSec * wc) / totalWords,
    );
  }

  // Build concat file for ffmpeg
  const concatPath = join(TEMP_DIR, `concat_${Date.now()}.txt`);
  const lines = visualAssets.map((p, i) => `file '${p}'\nduration ${slideDurations[i].toFixed(3)}`);
  // ffmpeg concat requires repeating last file
  lines.push(`file '${visualAssets[visualAssets.length - 1]}'`);
  await writeFile(concatPath, lines.join("\n"));

  const silentVideo = join(TEMP_DIR, `silent_${Date.now()}.mp4`);
  const vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1";

  try {
    // Step 1: Build silent slideshow from images
    await execAsync(
      `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -vf "${vf}" -c:v libx264 -pix_fmt yuv420p -r 30 "${silentVideo}"`,
      { timeout: 300_000 },
    );

    // Step 2: Merge with audio
    let mergeCmd = `ffmpeg -y -i "${silentVideo}" -i "${audioPath}" -c:v copy -c:a aac -shortest`;

    // Step 3: Optionally burn in captions
    if (captionsPath && existsSync(captionsPath)) {
      // Re-encode video with subtitle filter instead of copy
      mergeCmd = `ffmpeg -y -i "${silentVideo}" -i "${audioPath}" -vf "subtitles=${captionsPath.replace(/'/g, "'\\''")}" -c:v libx264 -c:a aac -shortest`;
    }

    // Add metadata
    if (metadata?.title) mergeCmd += ` -metadata title="${metadata.title.replace(/"/g, '\\"')}"`;
    if (metadata?.copyright) mergeCmd += ` -metadata copyright="${metadata.copyright.replace(/"/g, '\\"')}"`;

    mergeCmd += ` "${outputPath}"`;
    await execAsync(mergeCmd, { timeout: 600_000 });

    // Get final file size
    const { stdout: sizeOut } = await execAsync(`stat -f%z "${outputPath}" 2>/dev/null || stat -c%s "${outputPath}"`);
    const fileSizeBytes = parseInt(sizeOut.trim(), 10) || 0;

    logger.info(
      { slides: visualAssets.length, duration: audioDurationSec, size: fileSizeBytes },
      "YouTube video assembled",
    );

    return { videoPath: outputPath, durationSec: audioDurationSec, fileSizeBytes };
  } finally {
    // Cleanup temp files
    await unlink(concatPath).catch(() => {});
    await unlink(silentVideo).catch(() => {});
  }
}

/**
 * Generate SRT captions from script text using word-rate estimation.
 */
export async function generateCaptions(
  ttsText: string,
  totalDurationSec: number,
  outputFilename?: string,
): Promise<string> {
  ensureDir(TEMP_DIR);
  const filename = outputFilename || `captions_${Date.now()}.srt`;
  const outputPath = join(TEMP_DIR, filename);

  const words = ttsText.split(/\s+/).filter(Boolean);
  const wordsPerSecond = words.length / totalDurationSec;
  const wordsPerCaption = Math.max(3, Math.min(8, Math.ceil(wordsPerSecond * 3)));

  let srt = "";
  let index = 1;
  let wordIdx = 0;

  while (wordIdx < words.length) {
    const chunk = words.slice(wordIdx, wordIdx + wordsPerCaption);
    const startSec = (wordIdx / words.length) * totalDurationSec;
    const endSec = Math.min(((wordIdx + chunk.length) / words.length) * totalDurationSec, totalDurationSec);

    srt += `${index}\n`;
    srt += `${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n`;
    srt += `${chunk.join(" ")}\n\n`;

    index++;
    wordIdx += wordsPerCaption;
  }

  await writeFile(outputPath, srt);
  return outputPath;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}

/**
 * Generate SRT captions chunk-aware: distribute words proportionally inside
 * each chunk's measured content duration, leaving silence gaps caption-free.
 *
 * Eliminates the uniform-rate drift in generateCaptions when slides have
 * varying speaking rates (the 2026-04-27 council issue).
 */
export async function generateChunkedCaptions(
  chunks: string[],
  contentDurations: number[],
  silenceGapSec: number,
  outputFilename?: string,
): Promise<string> {
  ensureDir(TEMP_DIR);
  const filename = outputFilename || `captions_${Date.now()}.srt`;
  const outputPath = join(TEMP_DIR, filename);

  if (chunks.length !== contentDurations.length) {
    throw new Error(`Caption chunks (${chunks.length}) and durations (${contentDurations.length}) length mismatch`);
  }

  let srt = "";
  let index = 1;
  let cursorSec = 0;

  for (let chunkIdx = 0; chunkIdx < chunks.length; chunkIdx++) {
    const text = chunks[chunkIdx].trim();
    const chunkDur = contentDurations[chunkIdx];

    if (!text || chunkDur <= 0) {
      cursorSec += chunkDur + (chunkIdx < chunks.length - 1 ? silenceGapSec : 0);
      continue;
    }

    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      cursorSec += chunkDur + (chunkIdx < chunks.length - 1 ? silenceGapSec : 0);
      continue;
    }

    const wordsPerSecond = words.length / chunkDur;
    const wordsPerCaption = Math.max(3, Math.min(8, Math.ceil(wordsPerSecond * 3)));

    let wordIdx = 0;
    while (wordIdx < words.length) {
      const chunkWords = words.slice(wordIdx, wordIdx + wordsPerCaption);
      const startSec = cursorSec + (wordIdx / words.length) * chunkDur;
      const endSec = cursorSec + Math.min(((wordIdx + chunkWords.length) / words.length) * chunkDur, chunkDur);

      srt += `${index}\n`;
      srt += `${formatSrtTime(startSec)} --> ${formatSrtTime(endSec)}\n`;
      srt += `${chunkWords.join(" ")}\n\n`;

      index++;
      wordIdx += wordsPerCaption;
    }

    cursorSec += chunkDur;
    if (chunkIdx < chunks.length - 1) cursorSec += silenceGapSec;
  }

  await writeFile(outputPath, srt);
  return outputPath;
}

export interface CaptionValidationResult {
  ok: boolean;
  srtEndSec: number;
  audioDurationSec: number;
  driftSec: number;
  entries: number;
  issues: string[];
}

/**
 * Self-evaluate caption/audio alignment before publish.
 * Checks the SRT's last end-time against actual audio duration and flags drift.
 */
export async function validateCaptions(
  captionsPath: string,
  audioDurationSec: number,
): Promise<CaptionValidationResult> {
  const issues: string[] = [];
  const srt = await readFile(captionsPath, "utf8");

  // Parse SRT timestamps: HH:MM:SS,mmm --> HH:MM:SS,mmm
  const timeRe = /(\d{2}):(\d{2}):(\d{2}),(\d{3})\s+-->\s+(\d{2}):(\d{2}):(\d{2}),(\d{3})/g;
  const matches: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = timeRe.exec(srt)) !== null) {
    const start = +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
    const end = +m[5] * 3600 + +m[6] * 60 + +m[7] + +m[8] / 1000;
    matches.push({ start, end });
  }

  if (matches.length === 0) {
    issues.push("No caption entries parsed from SRT");
    return { ok: false, srtEndSec: 0, audioDurationSec, driftSec: 0, entries: 0, issues };
  }

  const srtEndSec = matches[matches.length - 1].end;
  const driftSec = srtEndSec - audioDurationSec;

  if (driftSec > 0.5) issues.push(`SRT ends ${driftSec.toFixed(2)}s after audio`);
  if (driftSec < -2.0) issues.push(`SRT ends ${Math.abs(driftSec).toFixed(2)}s before audio (under-captioned tail)`);

  for (let i = 0; i < matches.length; i++) {
    if (matches[i].end < matches[i].start) issues.push(`Entry ${i + 1}: end < start`);
    if (i > 0 && matches[i].start < matches[i - 1].end - 0.05) {
      issues.push(`Entry ${i + 1}: overlaps previous`);
    }
  }

  return {
    ok: Math.abs(driftSec) <= 0.5 && issues.length === 0,
    srtEndSec,
    audioDurationSec,
    driftSec,
    entries: matches.length,
    issues,
  };
}
