import { randomUUID } from "crypto";
import { logger } from "../../middleware/logger.js";
import type {
  VisualBackend,
  VisualCapability,
  VisualGenerationOpts,
  VisualJobResult,
} from "./types.js";

const GROK_API_KEY = process.env.GROK_API_KEY || "";
const GROK_BASE_URL = process.env.GROK_API_URL || "https://api.x.ai/v1";

async function generateImage(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const isLandscape = opts.aspectRatio === "16:9";
    const res = await fetch(`${GROK_BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${GROK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "grok-2-image",
        prompt: opts.prompt,
        n: 1,
        size: isLandscape ? "1344x768" : "768x1344",
        response_format: "b64_json",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Grok API error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };

    const imageData = data.data?.[0];
    if (!imageData) {
      return { jobId, status: "failed", error: "No image data in response" };
    }

    let buffer: Buffer;
    if (imageData.b64_json) {
      buffer = Buffer.from(imageData.b64_json, "base64");
    } else if (imageData.url) {
      const imgRes = await fetch(imageData.url);
      buffer = Buffer.from(await imgRes.arrayBuffer());
    } else {
      return { jobId, status: "failed", error: "No image content returned" };
    }

    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: "image/png",
      filename: `grok-image-${jobId}.png`,
      width: isLandscape ? 1344 : 768,
      height: isLandscape ? 768 : 1344,
    };
  } catch (err) {
    logger.error({ err, jobId }, "Grok image generation failed");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function generateVideo(
  _opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  return {
    jobId: randomUUID(),
    status: "failed",
    error: "Grok backend does not support video generation",
  };
}

async function checkJob(_jobId: string): Promise<VisualJobResult> {
  return {
    jobId: _jobId,
    status: "failed",
    error: "Grok backend uses synchronous generation; no jobs to poll",
  };
}

export const grokBackend: VisualBackend = {
  name: "grok",
  capabilities: ["image"] as VisualCapability[],
  generateImage,
  generateVideo,
  checkJob,
};
