import { logger } from "../../middleware/logger.js";
import type { PlatformPublisher, PublishOptions, PublishResult } from "./types.js";

const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

export const instagramPublisher: PlatformPublisher = {
  name: "instagram_reels",

  isConfigured() {
    return !!(INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID);
  },

  async publish(opts: PublishOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "Instagram API credentials not configured" };
    }

    try {
      // Instagram Reels require a publicly accessible video URL
      // The video must be hosted somewhere accessible before creating the container
      // This means we need to serve it via the public reels API first

      logger.warn("Instagram Reels publishing requires a publicly accessible video URL — use public reels API endpoint as the source");

      return {
        success: false,
        error: "Instagram Reels publishing requires the video to be hosted at a public URL first. Serve via /api/reels/:id/stream and use that URL.",
      };
    } catch (err) {
      logger.error({ err }, "Instagram publish failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
