// ---------------------------------------------------------------------------
// X API — Media upload STUB
//
// Media upload requires the v1.1 chunked upload endpoint which uses OAuth 1.0a
// request signing (not OAuth 2.0 Bearer tokens). This needs the `oauth-1.0a`
// npm package for proper HMAC-SHA1 signing of each request.
//
// Implement when upgrading to Basic tier or when media posting is needed.
// Free tier posting is text-only initially.
//
// Endpoint: POST https://upload.twitter.com/1.1/media/upload.json
// Docs: https://developer.x.com/en/docs/x-api/v1/media/upload-media/api-reference/post-media-upload
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";

/**
 * Upload media to X for attachment to tweets.
 *
 * Currently a STUB — returns null and logs a warning.
 * Media upload requires OAuth 1.0a signing (oauth-1.0a npm package).
 */
export async function uploadMedia(
  _buffer: Buffer,
  _mimeType: string,
): Promise<string | null> {
  logger.warn(
    "X media upload called but not yet implemented — requires OAuth 1.0a signing. " +
    "Install the oauth-1.0a package and implement chunked upload when needed.",
  );
  return null;
}
