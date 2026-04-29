// ---------------------------------------------------------------------------
// Rizz Comment Monitor
//
// Polls @coherencedaddy's recent TikTok videos and extracts @-mentions from
// their comments. Each unique @-handle becomes a row in
// tiktok_review_submissions with form_status='mentioned' (form_id null) so
// the owner can prompt the submitter to fill out the consent form.
//
// Dedupe is enforced by the unique index
// (company_id, lower(submitter_handle)) — see migration 0101.
//
// V1.1 scope: monitor + insert only. No auto-reply (week-1 manual) and no
// pipeline advancement until the consent form arrives + is countersigned.
//
// Comment source is abstracted behind TiktokCommentSource so the Firecrawl
// scrape path can be swapped for the official TikTok Display API (or a
// Playwright runner) without touching the orchestrator.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { tiktokReviewSubmissions } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
const FIRECRAWL_AUTH = process.env.FIRECRAWL_API_KEY
  ? `Bearer ${process.env.FIRECRAWL_API_KEY}`
  : "Bearer self-hosted";
const SCRAPE_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RawTiktokVideo {
  videoId: string;
  videoUrl: string;
}

export interface RawTiktokComment {
  videoId: string;
  body: string;
}

export interface TiktokCommentSource {
  /** List the most recent N video URLs for a public TikTok handle. */
  listRecentVideos(handle: string, limit: number): Promise<RawTiktokVideo[]>;
  /** Fetch comments for a single video URL. May be lossy / paginated. */
  fetchComments(videoUrl: string): Promise<RawTiktokComment[]>;
}

// ---------------------------------------------------------------------------
// @-mention extraction
// ---------------------------------------------------------------------------

// TikTok handles: 2-24 chars, [a-z0-9._], case-insensitive. Stored mixed-case.
// Trailing punctuation (., ?, !, ,) is stripped — TikTok renders the handle
// as a link so users often type "@foo." or "@foo?" naturally.
const AT_MENTION_RE = /@([A-Za-z0-9._]{2,24})/g;
const TRAILING_PUNCT_RE = /[.!?,;:]+$/;

export function extractAtMentions(body: string, ownHandle: string): string[] {
  const ownLower = ownHandle.replace(/^@/, "").toLowerCase();
  // Map keyed by lowercase handle preserves first-seen casing while
  // case-insensitively deduping (matches the DB's lower(submitter_handle)
  // unique index — see migration 0101).
  const seen = new Map<string, string>();
  for (const match of body.matchAll(AT_MENTION_RE)) {
    const raw = match[1].replace(TRAILING_PUNCT_RE, "");
    if (raw.length < 2) continue;
    const key = raw.toLowerCase();
    if (key === ownLower) continue;
    if (!seen.has(key)) seen.set(key, raw);
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------------------------
// Firecrawl-based comment source
// ---------------------------------------------------------------------------

interface FirecrawlScrapeResult {
  success?: boolean;
  data?: { markdown?: string };
}

async function firecrawlScrapeMarkdown(url: string, waitMs = 4000): Promise<string | null> {
  try {
    const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: FIRECRAWL_AUTH,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: false,
        waitFor: waitMs,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS + 5_000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "rizz-comment-monitor: Firecrawl returned non-ok");
      return null;
    }
    const data = (await res.json()) as FirecrawlScrapeResult;
    return data.success && data.data?.markdown ? data.data.markdown : null;
  } catch (err) {
    logger.warn({ err, url }, "rizz-comment-monitor: Firecrawl scrape threw");
    return null;
  }
}

// TikTok video URL pattern: tiktok.com/@handle/video/<numeric-id>
const VIDEO_URL_RE = /https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]+\/video\/(\d+)/g;

export function parseVideoUrlsFromMarkdown(markdown: string): RawTiktokVideo[] {
  const seen = new Map<string, string>();
  for (const match of markdown.matchAll(VIDEO_URL_RE)) {
    const videoId = match[1];
    if (!seen.has(videoId)) seen.set(videoId, match[0]);
  }
  return Array.from(seen.entries()).map(([videoId, videoUrl]) => ({ videoId, videoUrl }));
}

export class FirecrawlTiktokCommentSource implements TiktokCommentSource {
  async listRecentVideos(handle: string, limit: number): Promise<RawTiktokVideo[]> {
    const cleanHandle = handle.replace(/^@/, "");
    const profileUrl = `https://www.tiktok.com/@${cleanHandle}`;
    const markdown = await firecrawlScrapeMarkdown(profileUrl);
    if (!markdown) return [];
    return parseVideoUrlsFromMarkdown(markdown).slice(0, limit);
  }

  async fetchComments(videoUrl: string): Promise<RawTiktokComment[]> {
    const markdown = await firecrawlScrapeMarkdown(videoUrl, 6000);
    if (!markdown) return [];
    const videoId = videoUrl.match(/\/video\/(\d+)/)?.[1] ?? "";
    // For V1.1 first-pass we treat the entire markdown body as the comment
    // surface — TikTok renders comments inline below the video and Firecrawl's
    // markdown will include them as plain text. Our @-mention regex is the
    // signal; we don't need per-comment structure to seed the queue.
    return [{ videoId, body: markdown }];
  }
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface PollOpts {
  companyId: string;
  /** TikTok handle to monitor, no @-prefix. */
  ownHandle: string;
  /** Most recent N videos to scan. */
  videoLimit: number;
  /** Optional override for tests. */
  source?: TiktokCommentSource;
}

export interface PollResult {
  videosScanned: number;
  commentsScanned: number;
  uniqueHandlesFound: number;
  inserted: number;
  insertedHandles: string[];
}

export async function pollTiktokMentions(db: Db, opts: PollOpts): Promise<PollResult> {
  const source = opts.source ?? new FirecrawlTiktokCommentSource();
  const result: PollResult = {
    videosScanned: 0,
    commentsScanned: 0,
    uniqueHandlesFound: 0,
    inserted: 0,
    insertedHandles: [],
  };

  const videos = await source.listRecentVideos(opts.ownHandle, opts.videoLimit);
  result.videosScanned = videos.length;

  const seenHandles = new Set<string>();
  for (const video of videos) {
    const comments = await source.fetchComments(video.videoUrl);
    result.commentsScanned += comments.length;
    for (const comment of comments) {
      for (const handle of extractAtMentions(comment.body, opts.ownHandle)) {
        seenHandles.add(handle);
      }
    }
  }
  result.uniqueHandlesFound = seenHandles.size;

  for (const handle of seenHandles) {
    const inserted = await db
      .insert(tiktokReviewSubmissions)
      .values({
        companyId: opts.companyId,
        brand: "rizz",
        submitterEmail: `unknown+${handle.toLowerCase()}@placeholder.invalid`,
        submitterHandle: handle,
        formStatus: "mentioned",
        notesInternal: "Discovered via @-mention in @coherencedaddy comments.",
      })
      // The unique index on (company_id, lower(submitter_handle)) is an
      // expression index, which Drizzle's typed `target` cannot reference
      // directly. The no-target form is unambiguous here because this is the
      // only unique constraint on the table.
      .onConflictDoNothing()
      .returning({ id: tiktokReviewSubmissions.id });
    if (inserted[0]?.id) {
      result.inserted += 1;
      result.insertedHandles.push(handle);
    }
  }

  return result;
}
