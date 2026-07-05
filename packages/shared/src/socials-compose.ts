// ---------------------------------------------------------------------------
// Compose-time posting guards shared between the UI (SocialsCompose.tsx) and
// the server (routes/socials.ts POST /posts). Pure and framework-free so both
// sides run the EXACT same checks — the submit button in Compose must never
// be enabled for a state the server would reject.
//
// See docs/products/socials-hub.md "Posting with media" for the product-level
// writeup of why these platforms/limits were chosen.
// ---------------------------------------------------------------------------

/** Platforms Compose can post text to today. Bluesky is native; Instagram and
 *  TikTok publish through a Zernio-routed account (see server's `routing`
 *  field on GET /socials/accounts) — a non-Zernio account for either platform
 *  has no working publisher in this app, so it is deliberately NOT unlocked
 *  here (would only fail later, at relay time). */
export const COMPOSABLE_PLATFORMS: ReadonlySet<string> = new Set(["bluesky", "instagram", "tiktok"]);

/** Platforms that reject a caption-only post — Zernio/Meta/TikTok require at
 *  least one photo or video attached. */
export const MEDIA_REQUIRED_PLATFORMS: ReadonlySet<string> = new Set(["instagram", "tiktok"]);

/** Platforms whose attached media must include an actual video (a still photo
 *  alone is not postable there). */
export const VIDEO_REQUIRED_PLATFORMS: ReadonlySet<string> = new Set(["tiktok"]);

/** Caption length ceilings, in characters. Platforms absent from this map have
 *  no enforced limit here. */
export const PLATFORM_CAPTION_LIMITS: Record<string, number> = {
  bluesky: 300,
  instagram: 2200,
  tiktok: 2200,
};

/** Hard cap on attachments per post — raised to 10 to match Zernio's
 *  Instagram carousel limit (10 images per carousel, per Zernio's OpenAPI spec). */
export const MAX_COMPOSE_MEDIA_ITEMS = 10;

/** Video container extensions recognized by the Zernio publisher's own
 *  mediaType() classifier (server/src/services/platform-publishers/zernio.ts)
 *  — reused here so Compose's video-required check agrees with what actually
 *  gets sent to Zernio. */
export const VIDEO_FILENAME_RE = /\.(mp4|mov|webm|m4v)(\?|$)/i;

export function isVideoRef(value: string): boolean {
  return VIDEO_FILENAME_RE.test(value);
}

const PLATFORM_LABELS: Record<string, string> = {
  bluesky: "Bluesky",
  instagram: "Instagram",
  tiktok: "TikTok",
};

export function composePlatformLabel(platform: string): string {
  return PLATFORM_LABELS[platform] ?? platform;
}

export interface ComposeMediaRef {
  /** Internal storage objectKey OR an already-public URL — the same two
   *  shapes social_posts.mediaUrls accepts (see social-relayer.ts). */
  value: string;
  /** True when this attachment is classified as a video. */
  isVideo: boolean;
}

export interface ComposePlatformCheckInput {
  /** social_accounts.platform value, e.g. "bluesky" | "instagram" | "tiktok". */
  platform: string;
  textLength: number;
  media: ComposeMediaRef[];
}

/**
 * Validate one draft against one platform's requirements. Returns a
 * plain-English problem string, or null when the draft is postable there.
 * Callers running a multi-account fan-out should call this once per selected
 * account's platform — each account's requirements are independent (e.g. a
 * Bluesky + Instagram mixed selection validates each leg separately).
 */
export function checkComposeForPlatform(input: ComposePlatformCheckInput): string | null {
  const label = composePlatformLabel(input.platform);

  if (input.media.length > MAX_COMPOSE_MEDIA_ITEMS) {
    return `At most ${MAX_COMPOSE_MEDIA_ITEMS} media files are allowed (you attached ${input.media.length}).`;
  }

  const limit = PLATFORM_CAPTION_LIMITS[input.platform];
  if (limit !== undefined && input.textLength > limit) {
    return `${label} captions are limited to ${limit} characters (this one is ${input.textLength}).`;
  }

  if (MEDIA_REQUIRED_PLATFORMS.has(input.platform) && input.media.length === 0) {
    return `${label} needs a photo or video attached before you can post.`;
  }

  if (
    VIDEO_REQUIRED_PLATFORMS.has(input.platform) &&
    input.media.length > 0 &&
    !input.media.some((m) => m.isVideo)
  ) {
    return `${label} posts need a video — none of the attached file${
      input.media.length === 1 ? " is" : "s are"
    } recognized as one (.mp4/.mov/.webm/.m4v).`;
  }

  return null;
}
