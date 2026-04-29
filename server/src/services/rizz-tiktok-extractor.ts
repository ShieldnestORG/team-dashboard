// ---------------------------------------------------------------------------
// Rizz TikTok Extractor (V1.2)
//
// Stage 1 of the Rizz review pipeline. Triggered for each submission with
// formStatus='countersigned' AND pipelineStatus='queued'. The job:
//
//   1. Claim the submission by advancing pipelineStatus to 'scraping'.
//   2. Scrape the @-handle's public TikTok profile via Firecrawl.
//   3. Derive: ProfileSnapshot, video URL list, bio specificity score.
//   4. Insert tiktok_audits row with profile + URLs + bio score.
//   5. Advance pipelineStatus to 'drafting' so V1.3's draft router picks up.
//
// V1.2 deliberately does NOT compute per-video metadata (caption-length
// array, posting cadence, repeat-hook rate) — those require scraping each
// video page individually (~30 Firecrawl calls per submission), which is
// unverified at production scale. Those fields stay empty/null on the
// audit row. V1.3's draft router gracefully degrades on empty fields. A
// later V1.2.5 follow-up adds per-video scraping if V1.3 proves it needs
// the richer data.
//
// V1.2 also does NOT compute hookTimings — vosk-stt integration was
// deferred to V2 by the owner. The schema field stays at default [].
//
// Failure mode: scrape returns null OR no videos parsed → revert to
// 'queued' + file approval row of type 'rizz_pipeline_error'. The cron
// will not re-pick the submission until the human resolves the approval
// (since the approval is a separate gate; the cron filter only checks
// pipeline_status, so retry happens on the next cron tick automatically
// — the approval row is the human-visible signal that something broke).
// ---------------------------------------------------------------------------

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  agents,
  approvals,
  tiktokAudits,
  tiktokReviewSubmissions,
  type ProfileSnapshot,
  type RecentVideo,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
const FIRECRAWL_AUTH = process.env.FIRECRAWL_API_KEY
  ? `Bearer ${process.env.FIRECRAWL_API_KEY}`
  : "Bearer self-hosted";
const SCRAPE_TIMEOUT_MS = 60_000;
const MAX_SUBMISSIONS_PER_TICK = 5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TiktokProfileScrape {
  /** Raw markdown from Firecrawl (preserved on the audit row for re-derivation). */
  markdown: string;
  /** Parsed profile snapshot. Best-effort; missing fields are undefined. */
  profile: ProfileSnapshot;
  /** Recent video URLs found on the profile page, deduped by id. */
  videos: RecentVideo[];
}

export interface TiktokProfileSource {
  scrapeProfile(handle: string): Promise<TiktokProfileScrape | null>;
}

// ---------------------------------------------------------------------------
// Markdown parsing helpers
// ---------------------------------------------------------------------------

const VIDEO_URL_RE = /https:\/\/www\.tiktok\.com\/@[A-Za-z0-9._]+\/video\/(\d+)/g;

export function parseVideoUrls(markdown: string): RecentVideo[] {
  const seen = new Set<string>();
  const out: RecentVideo[] = [];
  for (const match of markdown.matchAll(VIDEO_URL_RE)) {
    const videoId = match[1];
    if (seen.has(videoId)) continue;
    seen.add(videoId);
    out.push({ videoId });
  }
  return out;
}

// "1.2M followers" / "1,234 Followers" / "987 followers" / "456 Following"
const FOLLOWERS_RE = /([\d.,]+\s*[KMB]?)\s*(?:followers|fans)\b/i;
const FOLLOWING_RE = /([\d.,]+\s*[KMB]?)\s*following\b/i;
const LIKES_RE = /([\d.,]+\s*[KMB]?)\s*likes\b/i;

export function parseShortNumber(raw: string): number | undefined {
  const cleaned = raw.replace(/,/g, "").trim();
  const match = cleaned.match(/^([\d.]+)\s*([KMB]?)$/i);
  if (!match) return undefined;
  const base = parseFloat(match[1]);
  if (!Number.isFinite(base)) return undefined;
  const suffix = match[2]?.toUpperCase() ?? "";
  const mult = suffix === "K" ? 1_000 : suffix === "M" ? 1_000_000 : suffix === "B" ? 1_000_000_000 : 1;
  return Math.round(base * mult);
}

export function parseProfileFromMarkdown(markdown: string): ProfileSnapshot {
  const followersMatch = markdown.match(FOLLOWERS_RE);
  const followingMatch = markdown.match(FOLLOWING_RE);
  const likesMatch = markdown.match(LIKES_RE);

  const profile: ProfileSnapshot = {};
  if (followersMatch) {
    const n = parseShortNumber(followersMatch[1]);
    if (n !== undefined) profile.followers = n;
  }
  if (followingMatch) {
    const n = parseShortNumber(followingMatch[1]);
    if (n !== undefined) profile.following = n;
  }
  if (likesMatch) {
    const n = parseShortNumber(likesMatch[1]);
    if (n !== undefined) profile.totalLikes = n;
  }

  // Bio + link extraction is fragile across TikTok's markdown variations;
  // we capture the first non-empty short line that isn't an obvious nav
  // element. If unreliable in production, the raw markdown is preserved on
  // tiktok_audits.raw_json for re-derivation.
  const bioCandidate = extractBioCandidate(markdown);
  if (bioCandidate) profile.bio = bioCandidate;

  const linkMatch = markdown.match(/https?:\/\/(?!www\.tiktok\.com)[^\s)\]]+/);
  if (linkMatch) profile.link = linkMatch[0];

  return profile;
}

const NAV_TOKENS = ["For You", "Following", "Explore", "LIVE", "Profile", "Upload", "Inbox"];

function extractBioCandidate(markdown: string): string | undefined {
  for (const rawLine of markdown.split(/\n+/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("[") || line.startsWith("!")) continue;
    if (line.length < 4 || line.length > 280) continue;
    if (NAV_TOKENS.some((t) => line.includes(t))) continue;
    if (line.includes("@") && line.length < 30) continue; // skip handle lines
    return line;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Bio specificity score
//
// Heuristic, not a model. Intentionally simple so we can read the score
// and disagree with it without spelunking through ML weights.
//
//   +1 per specific signal: a number, a niche keyword, "for [audience]" phrase
//   -1 per generic signal: "creator" / "content" / "just" / vague filler
//   score = clamp(0, 1, (positives - negatives + 2) / 6)
//
// A bio like "what to post when you have 800 followers | growth-for-creators"
// scores high; "creator. lover of life. follow for more 💜" scores low.
// ---------------------------------------------------------------------------

const SPECIFIC_KEYWORDS = [
  "founder",
  "engineer",
  "lawyer",
  "designer",
  "coach",
  "teacher",
  "writer",
  "trainer",
  "developer",
  "investor",
  "musician",
  "chef",
  "agency",
  "consultant",
  "studio",
];

const GENERIC_TOKENS = [
  "creator",
  "content",
  "just",
  "life",
  "lover of",
  "follow for more",
  "vibes",
  "energy",
];

const FOR_AUDIENCE_RE = /\bfor\s+[a-z][a-z\s-]{3,}/i;

export function computeBioSpecificityScore(bio: string | undefined): number | null {
  if (!bio || bio.trim().length < 4) return null;
  const lower = bio.toLowerCase();
  let positives = 0;
  let negatives = 0;
  if (/\d/.test(bio)) positives += 1;
  if (FOR_AUDIENCE_RE.test(bio)) positives += 1;
  for (const kw of SPECIFIC_KEYWORDS) if (lower.includes(kw)) positives += 1;
  for (const tok of GENERIC_TOKENS) if (lower.includes(tok)) negatives += 1;
  // Long-but-substantive bios get a slight boost; pure-emoji bios stay low.
  const letters = bio.match(/[A-Za-z]/g)?.length ?? 0;
  if (letters >= 40) positives += 1;
  const raw = (positives - negatives + 2) / 6;
  return Math.max(0, Math.min(1, Number(raw.toFixed(2))));
}

// ---------------------------------------------------------------------------
// Firecrawl-backed profile source
// ---------------------------------------------------------------------------

interface FirecrawlScrapeResult {
  success?: boolean;
  data?: { markdown?: string };
}

async function firecrawlScrapeMarkdown(url: string): Promise<string | null> {
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
        waitFor: 4000,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS + 5_000),
    });
    if (!res.ok) {
      logger.warn({ url, status: res.status }, "rizz-extractor: Firecrawl returned non-ok");
      return null;
    }
    const data = (await res.json()) as FirecrawlScrapeResult;
    return data.success && data.data?.markdown ? data.data.markdown : null;
  } catch (err) {
    logger.warn({ err, url }, "rizz-extractor: Firecrawl scrape threw");
    return null;
  }
}

export class FirecrawlTiktokProfileSource implements TiktokProfileSource {
  async scrapeProfile(handle: string): Promise<TiktokProfileScrape | null> {
    const cleanHandle = handle.replace(/^@/, "");
    const url = `https://www.tiktok.com/@${cleanHandle}`;
    const markdown = await firecrawlScrapeMarkdown(url);
    if (!markdown) return null;
    const videos = parseVideoUrls(markdown);
    const profile = parseProfileFromMarkdown(markdown);
    return { markdown, profile, videos };
  }
}

// ---------------------------------------------------------------------------
// Receipt-picking
//
// Without per-video engagement metrics, "top 3" is just the first 3 video
// URLs we see (TikTok's profile renders most-recent-first). When V1.2.5
// adds per-video scraping, this swaps to a real engagement-rank sort.
// ---------------------------------------------------------------------------

export function pickTop3Receipts(videos: RecentVideo[]): string[] {
  return videos.slice(0, 3).map((v) => v.videoId);
}

// ---------------------------------------------------------------------------
// Rizz agent id lookup (cached per process)
// ---------------------------------------------------------------------------

let cachedRizzAgentId: string | null = null;

async function getRizzAgentId(db: Db, companyId: string): Promise<string | null> {
  if (cachedRizzAgentId) return cachedRizzAgentId;
  const row = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.name, "Rizz")))
    .then((rows) => rows[0] ?? null);
  cachedRizzAgentId = row?.id ?? null;
  return cachedRizzAgentId;
}

async function fileRizzPipelineError(
  db: Db,
  opts: { companyId: string; submissionId: string; handle: string; stage: string; error: string },
): Promise<void> {
  const requestedByAgentId = await getRizzAgentId(db, opts.companyId);
  await db.insert(approvals).values({
    companyId: opts.companyId,
    type: "rizz_pipeline_error",
    requestedByAgentId,
    status: "pending",
    payload: {
      submissionId: opts.submissionId,
      submitterHandle: opts.handle,
      stage: opts.stage,
      errorMessage: opts.error,
    },
  });
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface RunOpts {
  companyId: string;
  /** Optional override for tests; defaults to FirecrawlTiktokProfileSource. */
  source?: TiktokProfileSource;
  /** Cap submissions processed per tick (DB lock contention safety). */
  maxPerTick?: number;
}

export interface RunResult {
  picked: number;
  audited: number;
  errored: number;
  auditedSubmissionIds: string[];
}

export async function runExtractor(db: Db, opts: RunOpts): Promise<RunResult> {
  const source = opts.source ?? new FirecrawlTiktokProfileSource();
  const maxPerTick = opts.maxPerTick ?? MAX_SUBMISSIONS_PER_TICK;
  const result: RunResult = { picked: 0, audited: 0, errored: 0, auditedSubmissionIds: [] };

  const queued = await db
    .select()
    .from(tiktokReviewSubmissions)
    .where(
      and(
        eq(tiktokReviewSubmissions.companyId, opts.companyId),
        eq(tiktokReviewSubmissions.formStatus, "countersigned"),
        eq(tiktokReviewSubmissions.pipelineStatus, "queued"),
      ),
    )
    .limit(maxPerTick);

  result.picked = queued.length;

  for (const submission of queued) {
    // Claim the row by advancing to 'scraping'. If a parallel worker
    // already claimed it, the WHERE-clause guard means the update affects
    // 0 rows and we skip.
    const claimed = await db
      .update(tiktokReviewSubmissions)
      .set({ pipelineStatus: "scraping", updatedAt: sql`now()` })
      .where(
        and(
          eq(tiktokReviewSubmissions.id, submission.id),
          eq(tiktokReviewSubmissions.pipelineStatus, "queued"),
        ),
      )
      .returning({ id: tiktokReviewSubmissions.id });
    if (claimed.length === 0) continue;

    try {
      const scrape = await source.scrapeProfile(submission.submitterHandle);
      if (!scrape) {
        await fileRizzPipelineError(db, {
          companyId: opts.companyId,
          submissionId: submission.id,
          handle: submission.submitterHandle,
          stage: "scrape",
          error: "Firecrawl returned no markdown for the @-handle profile.",
        });
        await db
          .update(tiktokReviewSubmissions)
          .set({ pipelineStatus: "queued", updatedAt: sql`now()` })
          .where(eq(tiktokReviewSubmissions.id, submission.id));
        result.errored += 1;
        continue;
      }

      if (scrape.videos.length === 0) {
        await fileRizzPipelineError(db, {
          companyId: opts.companyId,
          submissionId: submission.id,
          handle: submission.submitterHandle,
          stage: "parse-videos",
          error: "Profile scrape succeeded but no video URLs were found in the markdown.",
        });
        await db
          .update(tiktokReviewSubmissions)
          .set({ pipelineStatus: "queued", updatedAt: sql`now()` })
          .where(eq(tiktokReviewSubmissions.id, submission.id));
        result.errored += 1;
        continue;
      }

      const bioSpecificity = computeBioSpecificityScore(scrape.profile.bio);

      await db.insert(tiktokAudits).values({
        submissionId: submission.id,
        companyId: opts.companyId,
        profileSnapshot: scrape.profile,
        recentVideos: scrape.videos,
        // Per-video metadata (captions, cadence, repeat rate) and
        // hookTimings stay at their schema defaults until V1.2.5 / V2.
        captionLengths: [],
        hookTimings: [],
        bioSpecificityScore: bioSpecificity != null ? bioSpecificity.toFixed(2) : null,
        top3ReceiptVideoIds: pickTop3Receipts(scrape.videos),
        rawJson: { markdown: scrape.markdown.slice(0, 50_000) },
      });

      await db
        .update(tiktokReviewSubmissions)
        .set({ pipelineStatus: "drafting", updatedAt: sql`now()` })
        .where(eq(tiktokReviewSubmissions.id, submission.id));

      result.audited += 1;
      result.auditedSubmissionIds.push(submission.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error({ err, submissionId: submission.id }, "rizz-extractor: pipeline threw");
      await fileRizzPipelineError(db, {
        companyId: opts.companyId,
        submissionId: submission.id,
        handle: submission.submitterHandle,
        stage: "extractor",
        error: errorMessage,
      }).catch(() => {});
      await db
        .update(tiktokReviewSubmissions)
        .set({ pipelineStatus: "queued", updatedAt: sql`now()` })
        .where(eq(tiktokReviewSubmissions.id, submission.id))
        .catch(() => {});
      result.errored += 1;
    }
  }

  return result;
}
