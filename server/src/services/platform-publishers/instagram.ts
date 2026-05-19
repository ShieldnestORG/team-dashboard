import { logger } from "../../middleware/logger.js";
import {
  createMediaContainer,
  pollContainerUntilReady,
  publishMedia,
  getMediaPermalink,
  GraphApiError,
} from "../instagram/graph-client.js";
import type { PlatformPublisher, PublishOptions, PublishResult } from "./types.js";

const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

const MAX_CAPTION_CHARS = 2200;

interface ReelsPublishOptions extends PublishOptions {
  publicVideoUrl?: string;
  shareToFeed?: boolean;
  thumbOffset?: number;
}

function buildCaption(opts: PublishOptions): string {
  const parts: string[] = [];
  if (opts.title) parts.push(opts.title);
  if (opts.description) parts.push(opts.description);
  if (opts.hashtags?.length) parts.push(opts.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)).join(" "));
  return parts.join("\n\n").slice(0, MAX_CAPTION_CHARS);
}

function toErrorMessage(err: unknown): string {
  if (err instanceof GraphApiError) {
    if (err.authExpired) return `IG auth expired (code ${err.code}) — re-authorize the page token`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export const instagramPublisher: PlatformPublisher = {
  name: "instagram_reels",

  isConfigured() {
    return !!(INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID);
  },

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Instagram credentials not configured (INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID)",
      };
    }

    const reelsOpts = opts as ReelsPublishOptions;
    const videoUrl = reelsOpts.publicVideoUrl;
    if (!videoUrl) {
      return {
        success: false,
        error: "instagram_reels needs publicVideoUrl — host the video at /api/reels/:id/stream and pass the absolute URL",
      };
    }

    const caption = buildCaption(opts);
    const igUserId = INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const token = INSTAGRAM_ACCESS_TOKEN;

    try {
      const container = await createMediaContainer({
        igUserId,
        accessToken: token,
        videoUrl,
        mediaType: "REELS",
        caption,
        shareToFeed: reelsOpts.shareToFeed ?? true,
        thumbOffset: reelsOpts.thumbOffset,
      });

      await pollContainerUntilReady(container.id, token, { intervalMs: 10000, maxAttempts: 30 });
      const published = await publishMedia(igUserId, container.id, token);
      const permalink = await getMediaPermalink(published.id, token);

      logger.info({ mediaId: published.id, permalink }, "instagram_reels post published");

      return {
        success: true,
        platformPostId: published.id,
        platformUrl: permalink || `https://www.instagram.com/reel/${published.id}`,
      };
    } catch (err) {
      logger.error({ err }, "Instagram reels publish failed");
      return { success: false, error: toErrorMessage(err) };
    }
  },
};
