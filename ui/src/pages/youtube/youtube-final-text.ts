/**
 * Mirrors server/src/services/youtube/final-text.ts — the same four pure
 * functions and the SAME sentences, so the edit dialog's preview and the
 * upload can never drift apart. Only difference: `utf8Bytes` uses
 * TextEncoder (browser) instead of Buffer.byteLength.
 */

/** `#` + the tag with all whitespace removed (today's rule in publish-queue.ts). */
export function youtubeHashtags(tags: string[]): string[] {
  return tags.map((t) => `#${t.replace(/\s+/g, "")}`);
}

/** Description, a blank line, then the hashtags joined by one space (today's string in platform-publishers/youtube.ts). */
export function finalYoutubeDescription(description: string, hashtags: string[]): string {
  return `${description}\n\n${hashtags.join(" ")}`;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

/**
 * Returns null when the text is fine, else ONE plain sentence describing the
 * first failure. Only the fields that are given are checked, so a title-only
 * edit is never refused for a description it did not touch. `tags` are the
 * stored tags; the hashtag line is built from them exactly as the publisher
 * does. The server passes them through `sanitizeTags` first, which is not
 * mirrored here because tags are already stored sanitized (40 of 40 queue
 * rows identical, measured 2026-10-10).
 */
export function checkYoutubeText(input: {
  title?: string;
  description?: string;
  tags: string[];
}): string | null {
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length < 1 || title.length > 100) {
      return "Title must be 1-100 characters";
    }
  }
  if (/[<>]/.test(`${input.title ?? ""}${input.description ?? ""}`)) {
    return "Title and description cannot contain < or >";
  }
  if (input.description !== undefined) {
    const bytes = utf8Bytes(finalYoutubeDescription(input.description, youtubeHashtags(input.tags)));
    if (bytes > 5000) {
      return `Description is too long for YouTube by ${bytes - 5000} bytes`;
    }
  }
  return null;
}
