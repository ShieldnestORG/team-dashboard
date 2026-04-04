import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { readFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import { logger } from "../../middleware/logger.js";
import type {
  VisualBackend,
  VisualCapability,
  VisualGenerationOpts,
  VisualJobResult,
} from "./types.js";

const CANVA_API_KEY = process.env.CANVA_API_KEY || "";
const CANVA_SCRIPT_PATH = join(process.cwd(), "scripts", "canva-generator.py");

async function runCanvaScript(config: Record<string, unknown>): Promise<{ outputPath: string }> {
  return new Promise((resolve, reject) => {
    if (!existsSync(CANVA_SCRIPT_PATH)) {
      reject(new Error(`Canva script not found at ${CANVA_SCRIPT_PATH}. Create scripts/canva-generator.py first.`));
      return;
    }

    const proc = spawn("python3", [CANVA_SCRIPT_PATH], {
      env: { ...process.env, CANVA_API_KEY },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    // Send config as JSON on stdin
    proc.stdin.write(JSON.stringify(config));
    proc.stdin.end();

    proc.on("error", (err) => reject(new Error(`Canva script error: ${err.message}`)));
    proc.on("close", (code) => {
      if (code === 0) {
        const outputPath = stdout.trim();
        if (!outputPath || !existsSync(outputPath)) {
          reject(new Error(`Canva script completed but output file not found: ${outputPath}`));
          return;
        }
        resolve({ outputPath });
      } else {
        reject(new Error(`Canva script exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
  });
}

async function generateImage(opts: VisualGenerationOpts): Promise<VisualJobResult> {
  const jobId = randomUUID();

  try {
    const config = {
      action: "generate_image",
      prompt: opts.prompt,
      width: opts.width || 1080,
      height: opts.height || 1920,
      aspectRatio: opts.aspectRatio || "9:16",
      ...(opts.extra || {}),
    };

    const { outputPath } = await runCanvaScript(config);
    const buffer = readFileSync(outputPath);

    // Clean up temp file
    try { unlinkSync(outputPath); } catch {}

    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: "image/png",
      filename: `canva-image-${jobId}.png`,
      width: opts.width || 1080,
      height: opts.height || 1920,
    };
  } catch (err) {
    logger.error({ err, jobId }, "Canva image generation failed");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function generateVideo(opts: VisualGenerationOpts): Promise<VisualJobResult> {
  const jobId = randomUUID();

  try {
    const config = {
      action: "generate_video",
      prompt: opts.prompt,
      width: opts.width || 1080,
      height: opts.height || 1920,
      durationSec: opts.durationSec || 10,
      aspectRatio: opts.aspectRatio || "9:16",
      ...(opts.extra || {}),
    };

    const { outputPath } = await runCanvaScript(config);
    const buffer = readFileSync(outputPath);

    try { unlinkSync(outputPath); } catch {}

    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: "video/mp4",
      filename: `canva-video-${jobId}.mp4`,
      width: opts.width || 1080,
      height: opts.height || 1920,
      durationMs: (opts.durationSec || 10) * 1000,
    };
  } catch (err) {
    logger.error({ err, jobId }, "Canva video generation failed");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJob(_jobId: string): Promise<VisualJobResult> {
  // Canva script is synchronous (blocks until complete)
  return { jobId: _jobId, status: "failed", error: "Canva backend uses synchronous generation" };
}

export const canvaBackend: VisualBackend = {
  name: "canva",
  capabilities: ["image", "video"] as VisualCapability[],
  generateImage,
  generateVideo,
  checkJob,
};
