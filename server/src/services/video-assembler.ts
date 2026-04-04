import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { logger } from "../middleware/logger.js";

const TEMP_DIR = join(process.cwd(), "data", "video-temp");
const WATERMARK_PATH = join(process.cwd(), "server", "src", "assets", "watermark.png");

function ensureTempDir() {
  if (!existsSync(TEMP_DIR)) mkdirSync(TEMP_DIR, { recursive: true });
}

// Check if FFmpeg is available
export async function checkFfmpeg(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("ffmpeg", ["-version"]);
    proc.on("error", () => resolve(false));
    proc.on("close", (code) => resolve(code === 0));
  });
}

export interface AssembleOptions {
  /** Input asset buffer (image or video) */
  inputBuffer: Buffer;
  inputType: "image" | "video";
  inputContentType: string;
  /** Text overlays to burn in */
  textOverlays?: string[];
  /** Add watermark */
  watermark?: boolean;
  /** Output dimensions */
  width?: number;
  height?: number;
  /** Duration in seconds (for image→video conversion) */
  durationSec?: number;
  /** Aspect ratio */
  aspectRatio?: "9:16" | "16:9" | "1:1";
  /** Metadata to embed */
  metadata?: {
    title?: string;
    description?: string;
    comment?: string;
    copyright?: string;
    keywords?: string;
  };
}

export interface AssembleResult {
  buffer: Buffer;
  contentType: string;
  filename: string;
  width: number;
  height: number;
  durationMs: number;
}

function buildFfmpegArgs(opts: {
  inputPath: string;
  outputPath: string;
  inputType: "image" | "video";
  textOverlays?: string[];
  watermark: boolean;
  watermarkPath: string;
  width: number;
  height: number;
  durationSec: number;
  metadata?: AssembleOptions["metadata"];
}): string[] {
  const args: string[] = ["-y"]; // overwrite

  // Input
  if (opts.inputType === "image") {
    args.push("-loop", "1", "-t", String(opts.durationSec));
  }
  args.push("-i", opts.inputPath);

  // Watermark input
  if (opts.watermark && existsSync(opts.watermarkPath)) {
    args.push("-i", opts.watermarkPath);
  }

  // Build filter chain
  const filters: string[] = [];
  let lastLabel = "0:v";

  // Scale to target resolution
  filters.push(`[${lastLabel}]scale=${opts.width}:${opts.height}:force_original_aspect_ratio=decrease,pad=${opts.width}:${opts.height}:(ow-iw)/2:(oh-ih)/2:black[scaled]`);
  lastLabel = "scaled";

  // Text overlays
  if (opts.textOverlays && opts.textOverlays.length > 0) {
    const lineHeight = Math.floor(opts.height * 0.05);
    const fontSize = Math.floor(opts.height * 0.035);
    const startY = Math.floor(opts.height * 0.35);

    opts.textOverlays.forEach((text, i) => {
      const escapedText = text.replace(/'/g, "'\\''").replace(/:/g, "\\:");
      const y = startY + i * (lineHeight + 10);
      const outLabel = `txt${i}`;
      filters.push(
        `[${lastLabel}]drawtext=text='${escapedText}':fontsize=${fontSize}:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=${y}[${outLabel}]`
      );
      lastLabel = outLabel;
    });
  }

  // Watermark overlay (bottom-right, semi-transparent)
  if (opts.watermark && existsSync(opts.watermarkPath)) {
    const wmSize = Math.floor(opts.width * 0.15);
    filters.push(`[1:v]scale=${wmSize}:-1,format=rgba,colorchannelmixer=aa=0.5[wm]`);
    filters.push(`[${lastLabel}][wm]overlay=W-w-20:H-h-20[final]`);
    lastLabel = "final";
  }

  if (filters.length > 0) {
    args.push("-filter_complex", filters.join(";"));
    args.push("-map", `[${lastLabel}]`);
    // Map audio from input if it's a video
    if (opts.inputType === "video") {
      args.push("-map", "0:a?");
    }
  }

  // Output codec
  args.push("-c:v", "libx264", "-preset", "fast", "-crf", "23");
  args.push("-pix_fmt", "yuv420p");

  if (opts.inputType === "image") {
    args.push("-t", String(opts.durationSec));
  }

  // Metadata
  if (opts.metadata) {
    if (opts.metadata.title) args.push("-metadata", `title=${opts.metadata.title}`);
    if (opts.metadata.description) args.push("-metadata", `description=${opts.metadata.description}`);
    if (opts.metadata.comment) args.push("-metadata", `comment=${opts.metadata.comment}`);
    if (opts.metadata.copyright) args.push("-metadata", `copyright=${opts.metadata.copyright}`);
    if (opts.metadata.keywords) args.push("-metadata", `keywords=${opts.metadata.keywords}`);
  }

  args.push("-movflags", "+faststart");
  args.push(opts.outputPath);

  return args;
}

export async function assembleVideo(opts: AssembleOptions): Promise<AssembleResult> {
  ensureTempDir();

  const jobId = randomUUID();
  const ext = opts.inputType === "video" ? "mp4" : (opts.inputContentType.includes("png") ? "png" : "jpg");
  const inputPath = join(TEMP_DIR, `input-${jobId}.${ext}`);
  const outputPath = join(TEMP_DIR, `output-${jobId}.mp4`);

  const width = opts.width || 1080;
  const height = opts.height || 1920;
  const durationSec = opts.durationSec || 5;

  try {
    // Write input to temp file
    writeFileSync(inputPath, opts.inputBuffer);

    const ffmpegArgs = buildFfmpegArgs({
      inputPath,
      outputPath,
      inputType: opts.inputType,
      textOverlays: opts.textOverlays,
      watermark: opts.watermark ?? true,
      watermarkPath: WATERMARK_PATH,
      width,
      height,
      durationSec,
      metadata: opts.metadata,
    });

    logger.info({ jobId, args: ffmpegArgs.join(" ") }, "Starting FFmpeg assembly");

    await new Promise<void>((resolve, reject) => {
      const proc = spawn("ffmpeg", ffmpegArgs);
      let stderr = "";
      proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
      proc.on("error", (err) => reject(new Error(`FFmpeg spawn error: ${err.message}`)));
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      });
    });

    const outputBuffer = readFileSync(outputPath);

    logger.info({ jobId, size: outputBuffer.length }, "FFmpeg assembly complete");

    return {
      buffer: outputBuffer,
      contentType: "video/mp4",
      filename: `assembled-${jobId}.mp4`,
      width,
      height,
      durationMs: durationSec * 1000,
    };
  } finally {
    // Cleanup temp files
    try { unlinkSync(inputPath); } catch {}
    try { unlinkSync(outputPath); } catch {}
  }
}
