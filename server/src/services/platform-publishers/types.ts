export interface PublishOptions {
  /** Video/image buffer to upload */
  assetBuffer: Buffer;
  contentType: string;
  /** Title for the post */
  title: string;
  /** Description/caption */
  description: string;
  /** Hashtags */
  hashtags: string[];
  /** Duration in seconds (video) */
  durationSec?: number;
}

/**
 * Text-first post payload used by the socials relayer for platforms like
 * Bluesky, X (text), LinkedIn, IG-feed, Mastodon. Image-only or text+image.
 */
export interface PublishTextOptions {
  text: string;
  /** Public URLs (or local paths the publisher can fetch) for images. */
  mediaUrls?: string[];
  /** Per-image alt text, parallel-indexed to mediaUrls. */
  altTexts?: string[];
  /** URL of post being replied to, when applicable. */
  replyToUrl?: string;
  /** social_accounts.id — publisher uses this to resolve credentials. */
  socialAccountId: string;
  /** Platform-specific extras (link card, langs, visibility, etc.). */
  payload?: Record<string, unknown>;
}

export interface PublishResult {
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}

export interface PlatformPublisher {
  name: string;
  /** Check if this publisher is configured (API keys set) */
  isConfigured(): boolean;
  /** Publish video/asset content (existing path used by reels pipelines). */
  publish(opts: PublishOptions): Promise<PublishResult>;
  /** Publish a text-first post (used by the socials relayer). Optional — only text-capable platforms implement this. */
  publishText?(opts: PublishTextOptions): Promise<PublishResult>;
}
