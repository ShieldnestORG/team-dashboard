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
  /** Drift between video stream and audio stream in the final MP4, in seconds.
   * Positive = slideshow overruns narration. Used by the post-assembly guardrail
   * to fail productions whose timing math is off before they hit the publish queue. */
  driftSec: number;
}

/** Maximum allowed drift between video and audio streams, in seconds.
 * Calibrated against tests/fixtures/yt-drift/drift-baseline-2026-04-27.json:
 * the one passing baseline sample drifted 25ms; broken samples drifted 0.6s–2.1s.
 * 100ms gives a 4x safety margin over the clean reference without flagging it. */
const MAX_DRIFT_SEC = 0.1;

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

    // Step 2: Merge with audio. Force output to exact audio duration via
    // `-t` — `-shortest` alone is unreliable when video is re-encoded
    // (the re-encoder picks up the silent-video's pre-truncation frame count,
    // leaving the output video stream up to ~25ms/slide longer than the audio
    // due to per-slide frame quantization in concat). `-t` clamps the muxer
    // output to a precise wall-clock duration regardless of encoder behaviour.
    const tFlag = `-t ${audioDurationSec.toFixed(3)}`;
    let mergeCmd = `ffmpeg -y -i "${silentVideo}" -i "${audioPath}" -c:v copy -c:a aac -shortest ${tFlag}`;

    // Step 3: Optionally burn in captions
    if (captionsPath && existsSync(captionsPath)) {
      // Re-encode video with subtitle filter instead of copy
      mergeCmd = `ffmpeg -y -i "${silentVideo}" -i "${audioPath}" -vf "subtitles=${captionsPath.replace(/'/g, "'\\''")}" -c:v libx264 -c:a aac -shortest ${tFlag}`;
    }

    // Add metadata
    if (metadata?.title) mergeCmd += ` -metadata title="${metadata.title.replace(/"/g, '\\"')}"`;
    if (metadata?.copyright) mergeCmd += ` -metadata copyright="${metadata.copyright.replace(/"/g, '\\"')}"`;

    mergeCmd += ` "${outputPath}"`;
    await execAsync(mergeCmd, { timeout: 600_000 });

    // Get final file size
    const { stdout: sizeOut } = await execAsync(`stat -f%z "${outputPath}" 2>/dev/null || stat -c%s "${outputPath}"`);
    const fileSizeBytes = parseInt(sizeOut.trim(), 10) || 0;

    // Post-assembly drift guardrail. Probe the final MP4 — if the video and
    // audio streams disagree by more than MAX_DRIFT_SEC, the timing math is
    // broken and this production must NOT advance to the publish queue.
    const driftSec = await measureDrift(outputPath);

    logger.info(
      { slides: visualAssets.length, duration: audioDurationSec, size: fileSizeBytes, driftSec },
      "YouTube video assembled",
    );

    if (Math.abs(driftSec) > MAX_DRIFT_SEC) {
      throw new Error(
        `sync_drift exceeded threshold: |${driftSec.toFixed(3)}s| > ${MAX_DRIFT_SEC}s (video and audio streams in ${outputPath} disagree by more than ${MAX_DRIFT_SEC * 1000}ms)`,
      );
    }

    return { videoPath: outputPath, durationSec: audioDurationSec, fileSizeBytes, driftSec };
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

/** Probe a finished MP4 and return (videoStreamSec - audioStreamSec). */
async function measureDrift(mp4Path: string): Promise<number> {
  const probe = async (selector: "v:0" | "a:0") => {
    const { stdout } = await execAsync(
      `ffprobe -v error -select_streams ${selector} -show_entries stream=duration -of default=nw=1:nk=1 "${mp4Path}"`,
    );
    return parseFloat(stdout.trim()) || 0;
  };
  const [videoSec, audioSec] = await Promise.all([probe("v:0"), probe("a:0")]);
  return videoSec - audioSec;
}

function formatSrtTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")},${ms.toString().padStart(3, "0")}`;
}
