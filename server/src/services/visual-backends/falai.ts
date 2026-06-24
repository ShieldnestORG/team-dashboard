/**
 * fal.ai visual generation backend.
 *
 * Single adapter into the fal.ai model zoo:
 *   - Images (default):           fal-ai/flux-pro/v1.1   — Flux Pro 1.1 text→image
 *   - Images (reference-cond.):   fal-ai/flux/dev/image-to-image
 *                                 (Flux Kontext / image-to-image; the most
 *                                  stable fal-documented endpoint that accepts
 *                                  a reference `image_url` for product shots)
 *   - Video:                      fal-ai/kling-video/v2/standard/text-to-video
 *                                 (async via the queue endpoint, polled in
 *                                  checkJob like grok's video flow)
 *
 * Auth: `Authorization: Key ${FAL_KEY}`.
 * Sync endpoint:  https://fal.run/<model>
 * Queue endpoint: https://queue.fal.run/<model>  (+ /requests/<id>/status, /requests/<id>)
 *
 * No SDK — plain fetch, matching the rest of the repo's backends. The caller
 * (visual-content / consumer) is responsible for uploading the returned
 * assetBuffer to storage; backends here only download and return bytes.
 *
 * Pass a reference image via `opts.extra.referenceImageUrl` (the existing
 * generic `extra` bag on VisualGenerationOpts — no type change needed).
 */

import { randomUUID } from "crypto";
import { logger } from "../../middleware/logger.js";
import type {
  VisualBackend,
  VisualCapability,
  VisualGenerationOpts,
  VisualJobResult,
} from "./types.js";

const FAL_KEY = process.env.FAL_KEY || "";
const FAL_SYNC_BASE = "https://fal.run";
const FAL_QUEUE_BASE = "https://queue.fal.run";

// Model IDs — kept as constants so they're easy to swap as fal's catalog evolves.
const FAL_IMAGE_MODEL = "fal-ai/flux-pro/v1.1";
// Reference-conditioned ("Flux Kontext"-style) image edit; image-to-image is the
// most stable documented fal endpoint that accepts an `image_url` reference.
const FAL_IMAGE_REF_MODEL = "fal-ai/flux/dev/image-to-image";
const FAL_VIDEO_MODEL = "fal-ai/kling-video/v2/standard/text-to-video";

/** In-flight video jobs keyed by our jobId → fal queue request_id + model. */
const pendingVideoJobs = new Map<
  string,
  { requestId: string; model: string; prompt: string }
>();

function falHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Key ${FAL_KEY}`,
  };
}

function resolveAspectRatio(opts: VisualGenerationOpts): string {
  if (opts.aspectRatio) return opts.aspectRatio;
  if (opts.width && opts.height && opts.width > opts.height) return "16:9";
  return "9:16";
}

function getReferenceImageUrl(opts: VisualGenerationOpts): string | undefined {
  const ref = opts.extra?.referenceImageUrl;
  return typeof ref === "string" && ref.length > 0 ? ref : undefined;
}

/**
 * POST to a fal endpoint with one retry on transient 5xx; hard-fail on 4xx.
 * Surfaces fal's error JSON in the thrown error.
 */
async function falPost(
  url: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: falHeaders(),
      body: JSON.stringify(body),
    });
    if (res.ok) return res.json();

    const text = await res.text().catch(() => "Unknown error");
    if (res.status >= 500 && attempt === 0) {
      logger.warn({ url, status: res.status, body: text }, "fal.ai 5xx — retrying once");
      continue;
    }
    throw new Error(`fal.ai API error (${res.status}) at ${url}: ${text}`);
  }
  throw new Error(`fal.ai API error: exhausted retries at ${url}`);
}

async function falGet(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Key ${FAL_KEY}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`fal.ai API error (${res.status}) at ${url}: ${text}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Image generation — synchronous via fal.run/<model>.
// Returns asset bytes in the same shape as grok/gemini.
// ---------------------------------------------------------------------------

async function generateImage(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const refUrl = getReferenceImageUrl(opts);
    const model = refUrl ? FAL_IMAGE_REF_MODEL : FAL_IMAGE_MODEL;
    const aspectRatio = resolveAspectRatio(opts);

    // fal flux models accept `image_size` either as an enum string or {width,height}.
    // Use the enum where possible (more stable across models).
    const image_size =
      opts.width && opts.height
        ? { width: opts.width, height: opts.height }
        : aspectRatio === "16:9"
          ? "landscape_16_9"
          : aspectRatio === "1:1"
            ? "square_hd"
            : "portrait_9_16";

    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      image_size,
      num_images: 1,
      enable_safety_checker: true,
    };
    if (refUrl) body.image_url = refUrl;

    const data = (await falPost(`${FAL_SYNC_BASE}/${model}`, body)) as {
      images?: Array<{ url?: string; width?: number; height?: number; content_type?: string }>;
      error?: unknown;
    };

    const imageMeta = data.images?.[0];
    if (!imageMeta?.url) {
      return {
        jobId,
        status: "failed",
        error: `No image URL returned from fal (${model})`,
      };
    }

    const imgRes = await fetch(imageMeta.url);
    if (!imgRes.ok) {
      throw new Error(`Failed to download fal image: ${imgRes.status}`);
    }
    const buffer = Buffer.from(await imgRes.arrayBuffer());

    return {
      jobId,
      status: "ready",
      assetBuffer: buffer,
      contentType: imageMeta.content_type || "image/png",
      filename: `falai-image-${jobId}.png`,
      width: imageMeta.width || opts.width || 1024,
      height: imageMeta.height || opts.height || 1024,
    };
  } catch (err) {
    logger.error({ err, jobId }, "fal.ai image generation failed");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Video generation — async via queue.fal.run.
// POST  /<model>           → { request_id, status_url, response_url }
// GET   /<model>/requests/<request_id>/status → { status }
// GET   /<model>/requests/<request_id>        → final payload
// Mirrors grok's pendingVideoJobs map; checkJob polls and returns bytes on done.
// ---------------------------------------------------------------------------

async function generateVideo(
  opts: VisualGenerationOpts,
): Promise<VisualJobResult> {
  const jobId = randomUUID();
  try {
    const aspectRatio = resolveAspectRatio(opts);
    const durationSec = Math.min(Math.max(opts.durationSec || 5, 5), 10); // Kling: 5 or 10s

    const body: Record<string, unknown> = {
      prompt: opts.prompt,
      duration: String(durationSec),
      aspect_ratio: aspectRatio,
    };

    const data = (await falPost(
      `${FAL_QUEUE_BASE}/${FAL_VIDEO_MODEL}`,
      body,
    )) as { request_id?: string; status?: string };

    if (!data.request_id) {
      return {
        jobId,
        status: "failed",
        error: "No request_id returned from fal.ai video queue",
      };
    }

    pendingVideoJobs.set(jobId, {
      requestId: data.request_id,
      model: FAL_VIDEO_MODEL,
      prompt: opts.prompt,
    });

    logger.info(
      { jobId, requestId: data.request_id, model: FAL_VIDEO_MODEL },
      "fal.ai video generation queued",
    );

    return { jobId, status: "generating" };
  } catch (err) {
    logger.error({ err, jobId }, "fal.ai video generation failed to start");
    return {
      jobId,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkJob(jobId: string): Promise<VisualJobResult> {
  const pending = pendingVideoJobs.get(jobId);
  if (!pending) {
    return { jobId, status: "failed", error: "Unknown job" };
  }

  try {
    const statusUrl = `${FAL_QUEUE_BASE}/${pending.model}/requests/${pending.requestId}/status`;
    const status = (await falGet(statusUrl)) as {
      status?: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED" | "FAILED" | string;
      logs?: unknown;
    };

    if (status.status === "COMPLETED") {
      const resultUrl = `${FAL_QUEUE_BASE}/${pending.model}/requests/${pending.requestId}`;
      const result = (await falGet(resultUrl)) as {
        video?: { url?: string; content_type?: string };
      };

      const videoUrl = result.video?.url;
      if (!videoUrl) {
        pendingVideoJobs.delete(jobId);
        return {
          jobId,
          status: "failed",
          error: "fal.ai video completed but no url in response",
        };
      }

      const videoRes = await fetch(videoUrl);
      if (!videoRes.ok) {
        throw new Error(`Failed to download fal video: ${videoRes.status}`);
      }
      const buffer = Buffer.from(await videoRes.arrayBuffer());

      pendingVideoJobs.delete(jobId);

      return {
        jobId,
        status: "ready",
        assetBuffer: buffer,
        contentType: result.video?.content_type || "video/mp4",
        filename: `falai-video-${jobId}.mp4`,
      };
    }

    if (status.status === "FAILED") {
      pendingVideoJobs.delete(jobId);
      return { jobId, status: "failed", error: "fal.ai video generation failed" };
    }

    // IN_QUEUE / IN_PROGRESS / anything else → still working
    return { jobId, status: "generating" };
  } catch (err) {
    logger.error({ err, jobId }, "fal.ai video job check failed");
    // Treat transient errors as still generating (matches grok's behavior).
    return { jobId, status: "generating" };
  }
}

export const falaiBackend: VisualBackend = {
  name: "falai",
  capabilities: ["image", "video"] as VisualCapability[],
  generateImage,
  generateVideo,
  checkJob,
};
