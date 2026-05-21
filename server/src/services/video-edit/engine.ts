/**
 * Video Edit Engine — invokes browser-use/video-use as a subprocess.
 *
 * video-use is a Python tool that reads a folder of raw clips + a natural-
 * language edit brief and produces edit/final.mp4. We exec it under a
 * configured working directory, watch for the output file, and capture
 * stdout/stderr for debugging.
 *
 * Requires:
 *   VIDEO_USE_BIN          — path to the video-use entry script or wrapper
 *   VIDEO_EDIT_DATA_DIR    — base dir for raw-input folders + outputs (default /paperclip/video-edit)
 *   ELEVENLABS_API_KEY     — Scribe transcription, video-use's hard dep
 */

import { exec } from "child_process";
import { promisify } from "util";
import { existsSync, statSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";
import type { VideoEditOptions } from "@paperclipai/db";

const execAsync = promisify(exec);

const VIDEO_USE_BIN = process.env.VIDEO_USE_BIN || "";
const VIDEO_EDIT_DATA_DIR = process.env.VIDEO_EDIT_DATA_DIR || "/paperclip/video-edit";

export interface VideoEditRunOptions {
  inputDir: string;
  editBrief: string;
  options?: VideoEditOptions;
  jobId: string;
}

export interface VideoEditRunResult {
  outputPath: string;
  durationSec: number;
  fileSizeBytes: number;
}

export function isEngineConfigured(): boolean {
  return !!VIDEO_USE_BIN && existsSync(VIDEO_USE_BIN);
}

export function getEnginePaths() {
  return { VIDEO_USE_BIN, VIDEO_EDIT_DATA_DIR };
}

/**
 * Run the video-use engine on a job. Throws on failure.
 */
export async function runVideoUseEngine(opts: VideoEditRunOptions): Promise<VideoEditRunResult> {
  if (!isEngineConfigured()) {
    throw new Error(`video-use engine not configured. Set VIDEO_USE_BIN to an executable path. Got: "${VIDEO_USE_BIN}"`);
  }
  if (!existsSync(opts.inputDir)) {
    throw new Error(`Input directory does not exist: ${opts.inputDir}`);
  }

  const briefArg = JSON.stringify(opts.editBrief);
  const optsArg = JSON.stringify(opts.options || {});
  const cmd = `"${VIDEO_USE_BIN}" --input "${opts.inputDir}" --brief ${briefArg} --options ${optsArg} --job-id "${opts.jobId}"`;

  logger.info({ jobId: opts.jobId, inputDir: opts.inputDir }, "video-use: starting subprocess");

  let stdout = "";
  let stderr = "";
  try {
    const result = await execAsync(cmd, {
      timeout: 2 * 60 * 60 * 1000, // 2hr cap
      maxBuffer: 50 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    stderr = e.stderr || "";
    throw new Error(
      `video-use exited non-zero: ${e.message || "unknown"}. stderr: ${stderr.slice(0, 1000)}`,
    );
  }

  // Convention: video-use writes its final to `<inputDir>/edit/final.mp4`
  const outputPath = join(opts.inputDir, "edit", "final.mp4");
  if (!existsSync(outputPath)) {
    throw new Error(
      `video-use completed but final.mp4 not found at ${outputPath}. stdout tail: ${stdout.slice(-500)}`,
    );
  }

  const stats = statSync(outputPath);
  const duration = await probeDuration(outputPath);

  logger.info(
    { jobId: opts.jobId, outputPath, bytes: stats.size, duration },
    "video-use: complete",
  );

  return { outputPath, durationSec: duration, fileSizeBytes: stats.size };
}

async function probeDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}
