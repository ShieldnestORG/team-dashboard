import { logger } from "../../middleware/logger.js";
import type { PlatformPublisher, PublishOptions, PublishResult } from "./types.js";

const TIKTOK_ACCESS_TOKEN = process.env.TIKTOK_ACCESS_TOKEN || "";

export const tiktokPublisher: PlatformPublisher = {
  name: "tiktok",

  isConfigured() {
    return !!TIKTOK_ACCESS_TOKEN;
  },

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "TikTok access token not configured" };
    }

    try {
      // Step 1: Initialize upload
      const initRes = await fetch("https://open.tiktokapis.com/v2/post/publish/video/init/", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TIKTOK_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: opts.title.slice(0, 150),
            privacy_level: "PUBLIC_TO_EVERYONE",
            disable_duet: false,
            disable_comment: false,
            disable_stitch: false,
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_size: opts.assetBuffer.length,
          },
        }),
      });

      if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`TikTok init failed (${initRes.status}): ${err}`);
      }

      const initData = (await initRes.json()) as {
        data?: { publish_id: string; upload_url: string };
        error?: { code: string; message: string };
      };

      if (initData.error || !initData.data) {
        throw new Error(`TikTok init error: ${initData.error?.message || "No upload URL"}`);
      }

      // Step 2: Upload video
      const uploadRes = await fetch(initData.data.upload_url, {
        method: "PUT",
        headers: {
          "Content-Type": opts.contentType,
          "Content-Range": `bytes 0-${opts.assetBuffer.length - 1}/${opts.assetBuffer.length}`,
        },
        body: new Uint8Array(opts.assetBuffer),
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`TikTok upload failed (${uploadRes.status}): ${err}`);
      }

      logger.info({ publishId: initData.data.publish_id }, "Published to TikTok");

      return {
        success: true,
        platformPostId: initData.data.publish_id,
      };
    } catch (err) {
      logger.error({ err }, "TikTok publish failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
