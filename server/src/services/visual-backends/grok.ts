import { randomUUID } from "crypto";
import { logger } from "../../middleware/logger.js";
import type {
  VisualBackend,
  VisualCapability,
  VisualGenerationOpts,
  VisualJobResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Grok / xAI visual generation backend
// Images: grok-2-image (synchronous)
// Video:  grok-imagine-video (async — POST to start, GET to poll)
// ---------------------------------------------------------------------------

const GROK_API_KEY = process.env.GROK_API_KEY || "";
const GROK_BASE_URL = process.env.GROK_API_URL || "https://api.x.ai/v1";

/** In-flight video jobs keyed by our jobId → xAI request_id */
const pendingVideoJobs = new Map<string, { requestId: string; prompt: string }>();

function grokHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${GROK_API_KEY}`,
  };
}

// ---------------------------------------------------------------------------
// Aspect ratio helpers
// ---------------------------------------------------------------------------

function resolveAspectRatio(opts: VisualGenerationOpts): string {
  if (opts.aspectRatio) return opts.aspectRatio;
  if (opts.width && opts.height && opts.width > opts.height) return "16:9";
  return "9:16";
}

// ---------------------------------------------------------------------------
// Image generation — grok-2-image (synchronous)
// ---------------------------------------------------------------------------

async function generateImage(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const res = await fetch(`${GROK_BASE_URL}/images/generations`, {
      method: "POST",
      headers: grokHeaders(),
      body: JSON.stringify({
        model: "grok-2-image",
        prompt: opts.prompt,
        n: 1,
        response_format: "b64_json",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Grok image API error (${res.status}): ${text}`);
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
      width: opts.width || 1024,
      height: opts.height || 1024,
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

// ---------------------------------------------------------------------------
// Video generation — grok-imagine-video (async with polling)
// POST /v1/videos/generations → { request_id }
// GET  /v1/videos/{request_id} → { status, video: { url, duration } }
// ---------------------------------------------------------------------------

async function generateVideo(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const aspectRatio = resolveAspectRatio(opts);
    const duration = Math.min(opts.durationSec || 10, 15); // max 15s

    const res = await fetch(`${GROK_BASE_URL}/videos/generations`, {
      method: "POST",
      headers: grokHeaders(),
      body: JSON.stringify({
        model: "grok-imagine-video",
        prompt: opts.prompt,
        duration,
        aspect_ratio: aspectRatio,
        resolution: "720p",
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Grok video API error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { request_id?: string };
    if (!data.request_id) {
      return { jobId, status: "failed", error: "No request_id returned from Grok video API" };
    }

    pendingVideoJobs.set(jobId, {
      requestId: data.request_id,
      prompt: opts.prompt,
    });

    logger.info(
      { jobId, requestId: data.request_id },
      "Grok video generation started",
    );

    return { jobId, status: "generating" };
  } catch (err) {
    logger.error({ err, jobId }, "Grok video generation failed to start");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Poll a pending video job
// GET /v1/videos/{request_id}
// Status: pending | done | expired | failed
// ---------------------------------------------------------------------------

async function checkJob(jobId: string): Promise<VisualJobResult> {
  const pending = pendingVideoJobs.get(jobId);
  if (!pending) {
    return { jobId, status: "failed", error: "Unknown job" };
  }

  try {
    const res = await fetch(
      `${GROK_BASE_URL}/videos/${pending.requestId}`,
      { headers: { Authorization: `Bearer ${GROK_API_KEY}` } },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "Unknown error");
      throw new Error(`Grok video poll error (${res.status}): ${text}`);
    }

    const data = (await res.json()) as {
      status: "pending" | "done" | "expired" | "failed";
      video?: {
        url: string;
        duration?: number;
      };
      model?: string;
    };

    if (data.status === "done" && data.video?.url) {
      // Download the video from the temporary URL
      const videoRes = await fetch(data.video.url);
      if (!videoRes.ok) {
        throw new Error(`Failed to download Grok video: ${videoRes.status}`);
      }
      const buffer = Buffer.from(await videoRes.arrayBuffer());

      pendingVideoJobs.delete(jobId);

      return {
        jobId,
        status: "ready",
        assetBuffer: buffer,
        contentType: "video/mp4",
        filename: `grok-video-${jobId}.mp4`,
        width: 1280, // 720p
        height: 720,
        durationMs: data.video.duration ? data.video.duration * 1000 : undefined,
      };
    }

    if (data.status === "failed") {
      pendingVideoJobs.delete(jobId);
      return { jobId, status: "failed", error: "Grok video generation failed" };
    }

    if (data.status === "expired") {
      pendingVideoJobs.delete(jobId);
      return { jobId, status: "failed", error: "Grok video request expired" };
    }

    // Still pending
    return { jobId, status: "generating" };
  } catch (err) {
    logger.error({ err, jobId }, "Grok video job check failed");
    // Treat transient errors as still generating
    return { jobId, status: "generating" };
  }
}

// ---------------------------------------------------------------------------
// Export backend — now supports both image AND video
// ---------------------------------------------------------------------------

export const grokBackend: VisualBackend = {
  name: "grok",
  capabilities: ["image", "video"] as VisualCapability[],
  generateImage,
  generateVideo,
  checkJob,
};
