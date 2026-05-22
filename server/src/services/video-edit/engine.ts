/**
 * Video Edit Engine — invokes browser-use/video-use as a subprocess.
 *
 * Uses execFile (argv array) — never a shell — to eliminate command injection
 * on user-supplied edit briefs and input paths. Input dir is also confined
 * to VIDEO_EDIT_DATA_DIR (realpath-resolved to defeat symlink escapes).
 *
 * Requires:
 *   VIDEO_USE_BIN          — path to the video-use entry script or wrapper
 *   VIDEO_EDIT_DATA_DIR    — base dir for raw-input folders + outputs (default /paperclip/video-edit)
 *   ELEVENLABS_API_KEY     — Scribe transcription, video-use's hard dep
 *   VIDEO_EDIT_ENABLED     — set to "false" to keep the pipeline dormant (default: enabled)
 */

import { execFile } from "child_process";
import { promisify } from "util";
import { existsSync, statSync, realpathSync } from "fs";
import { isAbsolute, join } from "path";
import { logger } from "../../middleware/logger.js";
import type { VideoEditOptions } from "@paperclipai/db";

const execFileAsync = promisify(execFile);

const VIDEO_USE_BIN = process.env.VIDEO_USE_BIN || "";
const VIDEO_EDIT_DATA_DIR = process.env.VIDEO_EDIT_DATA_DIR || "/paperclip/video-edit";
const VIDEO_EDIT_ENABLED = (process.env.VIDEO_EDIT_ENABLED ?? "true").toLowerCase() !== "false";

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

export function isPipelineEnabled(): boolean {
  return VIDEO_EDIT_ENABLED;
}

export function isEngineConfigured(): boolean {
  return VIDEO_EDIT_ENABLED && !!VIDEO_USE_BIN && existsSync(VIDEO_USE_BIN);
}

export function getEnginePaths() {
  return { VIDEO_USE_BIN, VIDEO_EDIT_DATA_DIR, VIDEO_EDIT_ENABLED };
}

/**
 * Verify inputDir is absolute, exists, and resolves under VIDEO_EDIT_DATA_DIR.
 * realpath defeats `/paperclip/video-edit/raw/foo/../../../etc` and symlink escapes.
 */
export function assertInputDirSafe(inputDir: string): string {
  if (!isAbsolute(inputDir)) {
    throw new Error(`inputDir must be an absolute path. Got: ${inputDir}`);
  }
  if (!existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }
  const resolved = realpathSync(inputDir);
  const dataRoot = realpathSync(VIDEO_EDIT_DATA_DIR);
  if (resolved !== dataRoot && !resolved.startsWith(dataRoot + "/")) {
    throw new Error(
      `inputDir (${resolved}) must be under VIDEO_EDIT_DATA_DIR (${dataRoot})`,
    );
  }
  return resolved;
}

/**
 * Run the video-use engine on a job. Throws on failure.
 * Uses execFile (no shell) — opts.editBrief and opts.options are passed as
 * argv elements, immune to shell metacharacter injection.
 */
export async function runVideoUseEngine(opts: VideoEditRunOptions): Promise<VideoEditRunResult> {
  if (!VIDEO_EDIT_ENABLED) {
    throw new Error("video-edit pipeline disabled (VIDEO_EDIT_ENABLED=false)");
  }
  if (!isEngineConfigured()) {
    throw new Error(`video-use engine not configured. Set VIDEO_USE_BIN to an executable path. Got: "${VIDEO_USE_BIN}"`);
  }

  const safeInputDir = assertInputDirSafe(opts.inputDir);

  const args = [
    "--input", safeInputDir,
    "--brief", opts.editBrief,
    "--options", JSON.stringify(opts.options || {}),
    "--job-id", opts.jobId,
  ];

  logger.info({ jobId: opts.jobId, inputDir: safeInputDir }, "video-use: starting subprocess");

  let stdout = "";
  let stderr = "";
  try {
    const result = await execFileAsync(VIDEO_USE_BIN, args, {
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
  const outputPath = join(safeInputDir, "edit", "final.mp4");
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
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}
