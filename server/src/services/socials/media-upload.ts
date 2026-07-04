// ---------------------------------------------------------------------------
// Compose media uploads (POST /api/socials/media). A marketing user attaches
// a photo/video in Compose; this stores it via the existing company-scoped
// StorageService and hands back the internal objectKey. That objectKey goes
// straight into social_posts.mediaUrls exactly the way
// services/socials/content-bridge.ts's `mediaObjectKeys` already does — the
// relayer's resolveMediaUrls (social-relayer.ts) stages any non-public entry
// to the public R2 bucket at publish time. No new public-serving route is
// needed: nothing renders these objectKeys as <img>/<video> src before then
// (the Queue view only shows an attachment count).
//
// Separate allowlist/size caps from server/src/attachment-types.ts on
// purpose: that module is a GLOBAL default for the general asset-upload
// surface (images only, 10MB) used across the app. Compose additionally
// needs video, at a much larger size ceiling — widening the global default
// would loosen every other upload surface too.
// ---------------------------------------------------------------------------

export type SocialMediaKind = "image" | "video";

export interface SniffedSocialMedia {
  kind: SocialMediaKind;
  contentType: string;
}

export const SOCIAL_MEDIA_MAX_IMAGE_BYTES =
  Number(process.env.SOCIALS_MEDIA_IMAGE_MAX_BYTES) || 10 * 1024 * 1024; // 10MB, matches attachment-types.ts default
export const SOCIAL_MEDIA_MAX_VIDEO_BYTES =
  Number(process.env.SOCIALS_MEDIA_VIDEO_MAX_BYTES) || 200 * 1024 * 1024; // 200MB
export const SOCIAL_MEDIA_MAX_FILES = 4; // matches MAX_COMPOSE_MEDIA_ITEMS (@paperclipai/shared)

function detectContainer(buf: Buffer): "jpeg" | "png" | "webp" | "isobmff" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "png";
  }
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    return "webp";
  }
  // ISO base media file format box (used by both MP4 and QuickTime/MOV) —
  // a 4-byte box size followed by the ASCII tag "ftyp" at offset 4.
  if (buf.length >= 12 && buf.toString("ascii", 4, 8) === "ftyp") return "isobmff";
  return null;
}

/**
 * Sniff the real file type from magic bytes (not just the declared MIME type
 * or filename extension) and classify it as image or video. Returns an error
 * string when the bytes don't match a supported container, or when an
 * ISOBMFF container's extension doesn't resolve to mp4 vs mov.
 */
export function sniffSocialMedia(
  buffer: Buffer,
  originalFilename: string,
): SniffedSocialMedia | { error: string } {
  const container = detectContainer(buffer);
  const extMatch = /\.([a-z0-9]+)$/i.exec(originalFilename.trim());
  const ext = extMatch ? extMatch[1].toLowerCase() : "";

  if (container === "jpeg") return { kind: "image", contentType: "image/jpeg" };
  if (container === "png") return { kind: "image", contentType: "image/png" };
  if (container === "webp") return { kind: "image", contentType: "image/webp" };
  if (container === "isobmff") {
    if (ext === "mov") return { kind: "video", contentType: "video/quicktime" };
    if (ext === "mp4" || ext === "m4v") return { kind: "video", contentType: "video/mp4" };
    return {
      error: `file looks like a video container but its extension ('.${ext || "none"}') isn't .mp4 or .mov`,
    };
  }
  return {
    error: "file content doesn't match a supported image (jpg/png/webp) or video (mp4/mov) format",
  };
}

export function maxBytesFor(kind: SocialMediaKind): number {
  return kind === "video" ? SOCIAL_MEDIA_MAX_VIDEO_BYTES : SOCIAL_MEDIA_MAX_IMAGE_BYTES;
}
