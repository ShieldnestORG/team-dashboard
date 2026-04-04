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
  /** Publish content to the platform */
  publish(opts: PublishOptions): Promise<PublishResult>;
}
