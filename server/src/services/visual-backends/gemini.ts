import { randomUUID } from "crypto";
import { logger } from "../../middleware/logger.js";
import type {
  VisualBackend,
  VisualCapability,
  VisualGenerationOpts,
  VisualJobResult,
} from "./types.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

const pendingJobs = new Map<
  string,
  { operationName?: string; type: "image" | "video"; prompt: string }
>();

async function geminiRequest(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const url = `${GEMINI_BASE_URL}${endpoint}?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function geminiGet(endpoint: string): Promise<unknown> {
  const url = `${GEMINI_BASE_URL}${endpoint}?key=${GEMINI_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Gemini API error (${res.status}): ${text}`);
  }
  return res.json();
}

async function generateImage(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const body: Record<string, unknown> = {
      instances: [{ prompt: opts.prompt }],
      parameters: {
        sampleCount: 1,
        aspectRatio: opts.aspectRatio || "9:16",
      },
    };

    const data = (await geminiRequest(
      "/models/imagen-3.0-generate-002:predict",
      body,
    )) as {
      predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
    };

    const prediction = data.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      return { jobId, status: "failed", error: "No image data in response" };
    }

    const buffer = Buffer.from(prediction.bytesBase64Encoded, "base64");
    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: prediction.mimeType || "image/png",
      filename: `gemini-image-${jobId}.png`,
      width: opts.width || 1080,
      height: opts.height || 1920,
    };
  } catch (err) {
    logger.error({ err, jobId }, "Gemini image generation failed");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function generateVideo(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const body: Record<string, unknown> = {
      instances: [{ prompt: opts.prompt }],
      parameters: {
        aspectRatio: opts.aspectRatio || "9:16",
        durationSeconds: opts.durationSec || 8,
      },
    };

    const data = (await geminiRequest(
      "/models/veo-2.0-generate-001:predictLongRunning",
      body,
    )) as { name?: string };

    if (!data.name) {
      return { jobId, status: "failed", error: "No operation name returned" };
    }

    pendingJobs.set(jobId, {
      operationName: data.name,
      type: "video",
      prompt: opts.prompt,
    });

    logger.info(
      { jobId, operationName: data.name },
      "Gemini video generation started",
    );
    return { jobId, status: "generating" };
  } catch (err) {
    logger.error({ err, jobId }, "Gemini video generation failed to start");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJob(jobId: string): Promise<VisualJobResult> {
  const pending = pendingJobs.get(jobId);
  if (!pending) {
    return { jobId, status: "failed", error: "Unknown job" };
  }
  if (!pending.operationName) {
    return { jobId, status: "failed", error: "No operation to poll" };
  }

  try {
    const data = (await geminiGet(
      `/operations/${pending.operationName}`,
    )) as {
      done?: boolean;
      error?: { message: string };
      response?: {
        predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
      };
    };

    if (data.error) {
      pendingJobs.delete(jobId);
      return { jobId, status: "failed", error: data.error.message };
    }
    if (!data.done) {
      return { jobId, status: "generating" };
    }

    const prediction = data.response?.predictions?.[0];
    if (!prediction?.bytesBase64Encoded) {
      pendingJobs.delete(jobId);
      return { jobId, status: "failed", error: "Operation completed but no video data" };
    }

    pendingJobs.delete(jobId);
    const buffer = Buffer.from(prediction.bytesBase64Encoded, "base64");
    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: prediction.mimeType || "video/mp4",
      filename: `gemini-video-${jobId}.mp4`,
      width: 1080,
      height: 1920,
    };
  } catch (err) {
    logger.error({ err, jobId }, "Gemini job check failed");
    return { jobId, status: "generating" };
  }
}

export const geminiBackend: VisualBackend = {
  name: "gemini",
  capabilities: ["image", "video"] as VisualCapability[],
  generateImage,
  generateVideo,
  checkJob,
};
