// ---------------------------------------------------------------------------
// X API — Media upload using OAuth 2.0 Bearer token
//
// Uses v1.1 chunked upload for images > 5MB or video.
// Simple upload for images < 5MB (most Canva exports).
//
// Endpoint: POST https://upload.twitter.com/1.1/media/upload.json
// Auth: OAuth 2.0 Bearer token (pay-per-use plan supports this)
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { getValidToken } from "./oauth.js";
import { logger } from "../../middleware/logger.js";

const UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const MAX_SIMPLE_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB — simple upload limit

/**
 * Upload media to X for attachment to tweets.
 * Returns the media_id_string on success, null on failure.
 *
 * Supports: PNG, JPG, GIF (images), MP4 (video via chunked upload).
 */
export async function uploadMedia(
  db: Db,
  companyId: string,
  buffer: Buffer,
  mimeType: string,
): Promise<string | null> {
  try {
    const token = await getValidToken(db, companyId);

    // Simple upload for small images
    if (buffer.length <= MAX_SIMPLE_UPLOAD_BYTES && !mimeType.startsWith("video/")) {
      return await simpleUpload(token, buffer, mimeType);
    }

    // Chunked upload for large files or video
    return await chunkedUpload(token, buffer, mimeType);
  } catch (err) {
    logger.error({ err, mimeType, size: buffer.length }, "X media upload failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Simple upload — base64 encoded, for images < 5MB
// ---------------------------------------------------------------------------

async function simpleUpload(token: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  const mediaData = buffer.toString("base64");

  // Determine media_category based on MIME type
  const category = mimeType.startsWith("video/") ? "tweet_video"
    : mimeType === "image/gif" ? "tweet_gif"
    : "tweet_image";

  const formBody = new URLSearchParams();
  formBody.set("media_data", mediaData);
  formBody.set("media_category", category);

  const res = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    logger.error({ status: res.status, error: errText }, "X media simple upload failed");
    return null;
  }

  const data = await res.json() as { media_id_string: string };
  logger.info({ mediaId: data.media_id_string, mimeType, size: buffer.length }, "X media uploaded (simple)");
  return data.media_id_string;
}

// ---------------------------------------------------------------------------
// Chunked upload — INIT → APPEND → FINALIZE
// For video or images > 5MB
// ---------------------------------------------------------------------------

async function chunkedUpload(token: string, buffer: Buffer, mimeType: string): Promise<string | null> {
  const category = mimeType.startsWith("video/") ? "tweet_video" : "tweet_image";
  const totalBytes = buffer.length;

  // INIT
  const initBody = new URLSearchParams();
  initBody.set("command", "INIT");
  initBody.set("total_bytes", String(totalBytes));
  initBody.set("media_type", mimeType);
  initBody.set("media_category", category);

  const initRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: initBody.toString(),
  });

  if (!initRes.ok) {
    const errText = await initRes.text().catch(() => "Unknown");
    logger.error({ status: initRes.status, error: errText }, "X media chunked INIT failed");
    return null;
  }

  const initData = await initRes.json() as { media_id_string: string };
  const mediaId = initData.media_id_string;

  // APPEND — send in 4MB chunks
  const chunkSize = 4 * 1024 * 1024;
  let segment = 0;

  for (let offset = 0; offset < totalBytes; offset += chunkSize) {
    const chunk = buffer.subarray(offset, Math.min(offset + chunkSize, totalBytes));

    const formData = new FormData();
    formData.append("command", "APPEND");
    formData.append("media_id", mediaId);
    formData.append("segment_index", String(segment));
    formData.append("media_data", chunk.toString("base64"));

    const appendRes = await fetch(UPLOAD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!appendRes.ok) {
      const errText = await appendRes.text().catch(() => "Unknown");
      logger.error({ status: appendRes.status, segment, error: errText }, "X media chunked APPEND failed");
      return null;
    }

    segment++;
  }

  // FINALIZE
  const finalBody = new URLSearchParams();
  finalBody.set("command", "FINALIZE");
  finalBody.set("media_id", mediaId);

  const finalRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: finalBody.toString(),
  });

  if (!finalRes.ok) {
    const errText = await finalRes.text().catch(() => "Unknown");
    logger.error({ status: finalRes.status, error: errText }, "X media chunked FINALIZE failed");
    return null;
  }

  const finalData = await finalRes.json() as { media_id_string: string; processing_info?: { state: string; check_after_secs?: number } };

  // For video, check processing status
  if (finalData.processing_info?.state === "pending" || finalData.processing_info?.state === "in_progress") {
    const waitSec = finalData.processing_info.check_after_secs || 5;
    logger.info({ mediaId, waitSec }, "X media processing, waiting...");
    await new Promise((resolve) => setTimeout(resolve, waitSec * 1000));

    // Check status
    const statusRes = await fetch(`${UPLOAD_URL}?command=STATUS&media_id=${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (statusRes.ok) {
      const statusData = await statusRes.json() as { processing_info?: { state: string } };
      if (statusData.processing_info?.state === "failed") {
        logger.error({ mediaId }, "X media processing failed");
        return null;
      }
    }
  }

  logger.info({ mediaId, mimeType, size: totalBytes }, "X media uploaded (chunked)");
  return mediaId;
}
