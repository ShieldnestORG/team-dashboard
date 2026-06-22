import { logger } from "../../middleware/logger.js";
import {
  createMediaContainer,
  pollContainerUntilReady,
  publishMedia,
  getMediaPermalink,
  GraphApiError,
} from "../instagram/graph-client.js";
import type {
  PlatformPublisher,
  PublishOptions,
  PublishResult,
  PublishTextOptions,
} from "./types.js";

const INSTAGRAM_ACCESS_TOKEN = process.env.INSTAGRAM_ACCESS_TOKEN || "";
const INSTAGRAM_BUSINESS_ACCOUNT_ID = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID || "";

const MAX_CAPTION_CHARS = 2200;
const MAX_HASHTAGS = 30;
const MAX_CAROUSEL_ITEMS = 10;

function validateCaption(text: string): string | null {
  if (text.length > MAX_CAPTION_CHARS) {
    return `caption exceeds ${MAX_CAPTION_CHARS} chars (got ${text.length})`;
  }
  const tagCount = (text.match(/#\w+/g) || []).length;
  if (tagCount > MAX_HASHTAGS) {
    return `caption has ${tagCount} hashtags, IG max is ${MAX_HASHTAGS}`;
  }
  return null;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof GraphApiError) {
    if (err.authExpired) return `IG auth expired (code ${err.code}) — re-authorize the page token`;
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

export const instagramFeedPublisher: PlatformPublisher = {
  name: "instagram_feed",

  isConfigured() {
    return !!(INSTAGRAM_ACCESS_TOKEN && INSTAGRAM_BUSINESS_ACCOUNT_ID);
  },

  async publish(_opts: PublishOptions): Promise<PublishResult> {
    return {
      success: false,
      error: "instagram_feed handles text+image posts only — for video use instagram_reels",
    };
  },

  async publishText(opts: PublishTextOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: "Instagram credentials not configured (INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_BUSINESS_ACCOUNT_ID)",
      };
    }

    const mediaUrls = (opts.mediaUrls || []).slice(0, MAX_CAROUSEL_ITEMS);
    if (mediaUrls.length === 0) {
      return {
        success: false,
        error: "Instagram feed posts require at least one image — text-only posts are not supported by the Graph API",
      };
    }

    const caption = opts.text || "";
    const captionErr = validateCaption(caption);
    if (captionErr) return { success: false, error: captionErr };

    const igUserId = INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const token = INSTAGRAM_ACCESS_TOKEN;

    try {
      let creationId: string;

      if (mediaUrls.length === 1) {
        const container = await createMediaContainer({
          igUserId,
          accessToken: token,
          imageUrl: mediaUrls[0],
          caption,
        });
        creationId = container.id;
      } else {
        const childIds: string[] = [];
        for (const url of mediaUrls) {
          const child = await createMediaContainer({
            igUserId,
            accessToken: token,
            imageUrl: url,
            isCarouselItem: true,
          });
          await pollContainerUntilReady(child.id, token);
          childIds.push(child.id);
        }
        const parent = await createMediaContainer({
          igUserId,
          accessToken: token,
          mediaType: "CAROUSEL",
          children: childIds,
          caption,
        });
        creationId = parent.id;
      }

      await pollContainerUntilReady(creationId, token);
      const published = await publishMedia(igUserId, creationId, token);
      const permalink = await getMediaPermalink(published.id, token);

      logger.info({ mediaId: published.id, permalink }, "instagram_feed post published");

      return {
        success: true,
        platformPostId: published.id,
        platformUrl: permalink || `https://www.instagram.com/p/${published.id}`,
      };
    } catch (err) {
      logger.error({ err }, "instagram_feed publishText failed");
      return { success: false, error: toErrorMessage(err) };
    }
  },
};
