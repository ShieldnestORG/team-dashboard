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
    // Use Gemini 2.5 Flash (Nano Banana) for image generation — fast, free-tier friendly.
    // The model uses generateContent with responseModalities including "image".
    // Gemini image models (configurable via GEMINI_IMAGE_MODEL env):
    // gemini-2.5-flash-image         — Nano Banana (default, fast, free tier)
    // gemini-3-pro-image-preview     — Nano Banana Pro (best quality)
    // gemini-3.1-flash-image-preview — Nano Banana 2 (efficient)
    // imagen-4.0-generate-001        — Imagen 4.0 (highest quality, paid)
    const model = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
    const aspectRatio = opts.aspectRatio || (opts.width && opts.height && opts.width > opts.height ? "16:9" : "9:16");

    const body = {
      contents: [
        {
          parts: [{ text: `Generate an image: ${opts.prompt}. Aspect ratio: ${aspectRatio}. High quality, professional.` }],
        },
      ],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    };

    const data = (await geminiRequest(
      `/models/${model}:generateContent`,
      body,
    )) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{
            text?: string;
            inlineData?: { mimeType: string; data: string };
          }>;
        };
      }>;
    };

    // Find the image part in the response
    const parts = data.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find((p) => p.inlineData?.mimeType?.startsWith("image/"));

    if (!imagePart?.inlineData) {
      return { jobId, status: "failed", error: "No image data in Gemini response" };
    }

    const buffer = Buffer.from(imagePart.inlineData.data, "base64");
    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: imagePart.inlineData.mimeType || "image/png",
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
