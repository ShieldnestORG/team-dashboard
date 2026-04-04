import type { PlatformPublisher, PublishResult } from "./types.js";
import { youtubePublisher } from "./youtube.js";
import { tiktokPublisher } from "./tiktok.js";
import { twitterVideoPublisher } from "./twitter-video.js";
import { instagramPublisher } from "./instagram.js";
import { logger } from "../../middleware/logger.js";

const ALL_PUBLISHERS: PlatformPublisher[] = [
  youtubePublisher,
  tiktokPublisher,
  twitterVideoPublisher,
  instagramPublisher,
];

export function getPublisher(platform: string): PlatformPublisher | undefined {
  return ALL_PUBLISHERS.find((p) => p.name === platform);
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
