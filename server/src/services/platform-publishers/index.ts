import type { PlatformPublisher, PublishResult } from "./types.js";
import { youtubePublisher } from "./youtube.js";
import { tiktokPublisher } from "./tiktok.js";
import { twitterVideoPublisher } from "./twitter-video.js";
import { instagramPublisher } from "./instagram.js";
import { blueskyPublisher } from "./bluesky.js";
import { zernioPublisher } from "./zernio.js";
import { logger } from "../../middleware/logger.js";

const ALL_PUBLISHERS: PlatformPublisher[] = [
  youtubePublisher,
  tiktokPublisher,
  twitterVideoPublisher,
  instagramPublisher,
  blueskyPublisher,
  // Routes social_accounts.platform === "instagram" to Zernio (the working IG
  // publish path). The native `instagramPublisher` above (name "instagram_reels")
  // is the dead Meta-Graph stub and answers to a different platform string.
  zernioPublisher,
];

export function getPublisher(platform: string): PlatformPublisher | undefined {
  return ALL_PUBLISHERS.find((p) => p.name === platform);
}

/**
 * Resolve the publisher for a queued post based on how its account is connected.
 *
 * Accounts connected through Zernio (oauthRef "zernio:<id>") publish via the
 * Zernio publisher for EVERY platform — Instagram, TikTok, YouTube, X — because
 * a single Zernio per-account key speaks all of them. That means NO per-platform
 * OAuth needs to live in this app for Zernio-backed accounts; the relayer
 * forwards the row's platform so Zernio targets the right network.
 *
 * Non-Zernio accounts fall back to the native per-platform publisher (matched by
 * `name`), preserving existing behavior.
 */
export function resolvePublisher(
  platform: string,
  oauthRef?: string | null,
): PlatformPublisher | undefined {
  if (oauthRef?.startsWith("zernio:")) return zernioPublisher;
  return getPublisher(platform);
}

export function getConfiguredPublishers(): PlatformPublisher[] {
  return ALL_PUBLISHERS.filter((p) => p.isConfigured());
}

export function getPublisherSummary(): Array<{
  name: string;
  configured: boolean;
}> {
  return ALL_PUBLISHERS.map((p) => ({
    name: p.name,
    configured: p.isConfigured(),
  }));
}

export function logConfiguredPublishers(): void {
  const configured = getConfiguredPublishers();
  if (configured.length === 0) {
    logger.info("No platform publishers configured (set platform API keys to enable auto-publishing)");
  } else {
    logger.info(
      { publishers: configured.map((p) => p.name) },
      `Platform publishers configured: ${configured.map((p) => p.name).join(", ")}`,
    );
  }
}

export type { PlatformPublisher, PublishResult } from "./types.js";
