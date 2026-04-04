import { logger } from "../../middleware/logger.js";
import type { PlatformPublisher, PublishOptions, PublishResult } from "./types.js";

const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || "";
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || "";
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN || "";

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: YOUTUBE_CLIENT_ID,
      client_secret: YOUTUBE_CLIENT_SECRET,
      refresh_token: YOUTUBE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${res.status}`);
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export const youtubePublisher: PlatformPublisher = {
  name: "youtube_shorts",

  isConfigured() {
    return !!(YOUTUBE_CLIENT_ID && YOUTUBE_CLIENT_SECRET && YOUTUBE_REFRESH_TOKEN);
  },

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "YouTube API credentials not configured" };
    }

    try {
      const accessToken = await getAccessToken();
      const tags = opts.hashtags.map((t) => t.replace(/^#/, "")).join(",");

      // Step 1: Initialize resumable upload
      const initRes = await fetch(
        "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-Upload-Content-Type": opts.contentType,
            "X-Upload-Content-Length": String(opts.assetBuffer.length),
          },
          body: JSON.stringify({
            snippet: {
              title: opts.title.slice(0, 100),
              description: `${opts.description}\n\n${opts.hashtags.join(" ")}`,
              tags: tags.split(",").slice(0, 30),
              categoryId: "28", // Science & Technology
            },
            status: {
              privacyStatus: "public",
              selfDeclaredMadeForKids: false,
              madeForKids: false,
            },
          }),
        },
      );

      if (!initRes.ok) {
        const err = await initRes.text();
        throw new Error(`YouTube upload init failed (${initRes.status}): ${err}`);
      }

      const uploadUrl = initRes.headers.get("location");
      if (!uploadUrl) throw new Error("No upload URL returned");

      // Step 2: Upload the video
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": opts.contentType,
          "Content-Length": String(opts.assetBuffer.length),
        },
        body: new Uint8Array(opts.assetBuffer),
      });

      if (!uploadRes.ok) {
        const err = await uploadRes.text();
        throw new Error(`YouTube upload failed (${uploadRes.status}): ${err}`);
      }

      const video = (await uploadRes.json()) as { id: string };
      const videoUrl = `https://youtube.com/shorts/${video.id}`;

      logger.info({ videoId: video.id, url: videoUrl }, "Published to YouTube Shorts");

      return {
        success: true,
        platformPostId: video.id,
        platformUrl: videoUrl,
      };
    } catch (err) {
      logger.error({ err }, "YouTube publish failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
