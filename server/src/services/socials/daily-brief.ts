/**
 * Daily AI Brief (Phase 3) — reads the last 7 days across every channel and
 * writes one plain-English brief a day, plus reviews the Inspiration board.
 *
 * Data gathered (cheap SQL, top-N capped per source — never inline raw HTML):
 *   - Zernio cross-platform posts + latest analytics snapshots
 *     (zernio_post_analytics / zernio_analytics_snapshots via the existing
 *     latestZernioSnapshots reader).
 *   - X (Twitter) top tweets by engagement (x_tweet_analytics). Kept in its
 *     OWN section — the codebase's hard line is Zernio numbers are never
 *     blended with X numbers, and that line holds here too.
 *   - Captured-lead counts per (account, keyword) — funnel performance
 *     (social_leads).
 *   - University email engagement counts (Brevo opens/clicks) via the
 *     existing getUniversityEmailStats reader.
 *   - Watchtower (LLM answer-engine brand mentions): v1 watchtower_subscriptions
 *     has no company_id — it's a customer-facing product keyed on a portal
 *     account, not on this team's own brand. There is no wired "our own
 *     brand" subscription to read cheaply, so this section is always a
 *     stub today rather than guessing at scoping that doesn't exist.
 *   - Every 'new' inspiration_items row for this company.
 *
 * ONE callLlmChat call turns that payload into the brief. The response MUST
 * be strict JSON; parseBriefResponse() is defensive — malformed/non-JSON
 * output never crashes the cron, it just produces a smaller "fallback"
 * section carrying the raw text so nothing is silently lost (Rule 10).
 */

import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  zernioPostAnalytics,
  socialLeads,
  xTweetAnalytics,
  inspirationItems,
  dailyBriefs,
} from "@paperclipai/db";
import { callLlmChat, type LlmChatMessage } from "../llm-client.js";
import { latestZernioSnapshots, type LatestSnapshotRow } from "./zernio-analytics.js";
import { getUniversityEmailStats, type UniversityEmailKindStats } from "../university-email-events.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

const LOOKBACK_DAYS = 7;
const MAX_ZERNIO_POSTS = 15;
const MAX_ZERNIO_SNAPSHOT_METRICS = new Set(["best-time", "posting-frequency", "follower-stats", "content-decay"]);
const MAX_TWEETS = 10;
const MAX_LEAD_GROUPS = 15;
const MAX_INSPIRATION_ITEMS = 15;
const METRICS_CHAR_CAP = 400;
const FALLBACK_RAW_TEXT_CAP = 4000;

// ---------------------------------------------------------------------------
// Defensive JSON payload capping — never inline an unbounded jsonb blob.
// ---------------------------------------------------------------------------

function capJson(value: unknown, maxChars: number): unknown {
  const str = JSON.stringify(value ?? {});
  if (str.length <= maxChars) return value;
  return { truncated: true, preview: str.slice(0, maxChars) };
}

// ---------------------------------------------------------------------------
// Data gathering
// ---------------------------------------------------------------------------

export interface BriefZernioPost {
  platform: string;
  content: string | null;
  publishedAt: string | null;
  metrics: unknown;
}

export interface BriefTweet {
  tweetText: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
  impressionCount: number;
  postedAt: string;
}

export interface BriefLeadGroup {
  zernioAccountId: string | null;
  keyword: string | null;
  count: number;
}

export interface BriefInspirationItem {
  id: string;
  url: string;
  note: string | null;
}

export interface BriefInputData {
  windowFrom: string;
  windowTo: string;
  zernioPosts: BriefZernioPost[];
  zernioSnapshots: LatestSnapshotRow[];
  topTweets: BriefTweet[];
  leadGroups: BriefLeadGroup[];
  universityEmailStats: UniversityEmailKindStats[];
  inspirationItems: BriefInspirationItem[];
  watchtowerAvailable: boolean;
}

export async function gatherBriefData(db: Db, companyId: string): Promise<BriefInputData> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 3600 * 1000);

  const zernioPostRows = await db
    .select({
      platform: zernioPostAnalytics.platform,
      content: zernioPostAnalytics.content,
      publishedAt: zernioPostAnalytics.publishedAt,
      metrics: zernioPostAnalytics.metrics,
    })
    .from(zernioPostAnalytics)
    .where(gte(zernioPostAnalytics.publishedAt, since))
    .orderBy(desc(zernioPostAnalytics.publishedAt))
    .limit(MAX_ZERNIO_POSTS);

  const allSnapshots = await latestZernioSnapshots(db);
  const zernioSnapshots = allSnapshots.filter((s) => MAX_ZERNIO_SNAPSHOT_METRICS.has(s.metric));

  const topTweetRows = await db
    .select({
      tweetText: xTweetAnalytics.tweetText,
      likeCount: xTweetAnalytics.likeCount,
      retweetCount: xTweetAnalytics.retweetCount,
      replyCount: xTweetAnalytics.replyCount,
      impressionCount: xTweetAnalytics.impressionCount,
      postedAt: xTweetAnalytics.postedAt,
    })
    .from(xTweetAnalytics)
    .where(and(eq(xTweetAnalytics.companyId, companyId), gte(xTweetAnalytics.postedAt, since)))
    .orderBy(
      desc(
        sql`${xTweetAnalytics.likeCount} + ${xTweetAnalytics.retweetCount} + ${xTweetAnalytics.replyCount} + ${xTweetAnalytics.quoteCount}`,
      ),
    )
    .limit(MAX_TWEETS);

  const leadRows = await db
    .select({
      zernioAccountId: socialLeads.zernioAccountId,
      keyword: socialLeads.keyword,
      count: sql<number>`count(*)::int`,
    })
    .from(socialLeads)
    .where(gte(socialLeads.lastEventAt, since))
    .groupBy(socialLeads.zernioAccountId, socialLeads.keyword)
    .orderBy(desc(sql`count(*)`))
    .limit(MAX_LEAD_GROUPS);

  const universityEmailStats = await getUniversityEmailStats(db, since);

  const inspirationRows = await db
    .select({ id: inspirationItems.id, url: inspirationItems.url, note: inspirationItems.note })
    .from(inspirationItems)
    .where(and(eq(inspirationItems.companyId, companyId), eq(inspirationItems.status, "new")))
    .orderBy(desc(inspirationItems.createdAt))
    .limit(MAX_INSPIRATION_ITEMS);

  return {
    windowFrom: since.toISOString(),
    windowTo: now.toISOString(),
    zernioPosts: zernioPostRows.map((r) => ({
      platform: r.platform,
      content: r.content,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
      metrics: capJson(r.metrics, METRICS_CHAR_CAP),
    })),
    zernioSnapshots,
    topTweets: topTweetRows.map((r) => ({ ...r, postedAt: r.postedAt.toISOString() })),
    leadGroups: leadRows,
    universityEmailStats,
    inspirationItems: inspirationRows,
    // See module comment — no cheap company-scoped Watchtower read exists yet.
    watchtowerAvailable: false,
  };
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the daily marketing analyst for a small team. You are given the last 7 days of raw data across every channel plus a list of links the team saved. Write a short, honest, plain-English daily brief.

Rules:
- Zernio (Instagram/cross-platform) numbers and X (Twitter) numbers measure different things — NEVER blend them into one claim or one number.
- If a data source is empty, say so plainly. Never invent numbers.
- Write exactly one inspirationReview entry per item in inspirationItems, echoing its "url" field exactly.
- Output STRICT JSON ONLY — no markdown fences, no prose before or after. Match this shape exactly:
{
  "whatWorked": string[],
  "underutilized": string[],
  "contentSuggestions": { "<accountHandleOrPlatform>": string[] },
  "funnelSuggestions": string[],
  "inspirationReview": [{ "url": string, "comment": string }],
  "llmVisibility": string,
  "summary": string[]
}
- "contentSuggestions" values must have at most 3 short ideas each.
- "summary" must have exactly 5 short, plain-English bullets (no jargon) — this is read first.
- "llmVisibility" is one short paragraph. If watchtowerAvailable is false, say brand-mention monitoring isn't wired up yet instead of guessing.`;

export function buildBriefPrompt(data: BriefInputData): LlmChatMessage[] {
  const payload = {
    windowFrom: data.windowFrom,
    windowTo: data.windowTo,
    zernio: { topPosts: data.zernioPosts, snapshots: data.zernioSnapshots },
    xTwitter: { topTweets: data.topTweets },
    capturedLeads: data.leadGroups,
    universityEmail: data.universityEmailStats,
    inspirationItems: data.inspirationItems.map((i) => ({ url: i.url, note: i.note })),
    watchtowerAvailable: data.watchtowerAvailable,
  };
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `Last 7 days of data (JSON):\n${JSON.stringify(payload)}` },
  ];
}

// ---------------------------------------------------------------------------
// Defensive response parsing — pure function, unit-tested directly.
// ---------------------------------------------------------------------------

export interface ParsedBrief {
  ok: boolean;
  sections: Record<string, unknown>;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string");
}

function asContentSuggestions(v: unknown): Record<string, string[]> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [key, val] of Object.entries(v as Record<string, unknown>)) {
    out[key] = asStringArray(val).slice(0, 3);
  }
  return out;
}

export interface InspirationReviewEntry {
  url: string;
  comment: string;
}

function asInspirationReview(v: unknown): InspirationReviewEntry[] {
  if (!Array.isArray(v)) return [];
  const out: InspirationReviewEntry[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const url = (item as Record<string, unknown>).url;
    const comment = (item as Record<string, unknown>).comment;
    // The LLM echoes `url` back from the prompt payload, but prompt-injected
    // note text could coax it into emitting a javascript:/data: URI instead
    // of the original http(s) link. Re-validate here — the insert-time
    // validateInspirationUrl() guard on the original pasted URL does NOT
    // cover this re-entry point, since the URL is passing through model
    // output before it reaches storage/rendering.
    if (typeof url === "string" && typeof comment === "string" && validateInspirationUrl(url)) {
      out.push({ url, comment });
    }
  }
  return out;
}

/**
 * Extracts the first {...} JSON object out of free-form text — handles a
 * ```json fenced block or stray prose the model adds despite instructions.
 */
function extractJsonBlock(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  return candidate.slice(start, end + 1);
}

/**
 * Tolerant parse of the LLM's brief response. Never throws — on any failure
 * (invalid JSON, non-object top level) returns ok:false with a fallback
 * section carrying the capped raw text, so the cron can still store
 * *something* rather than crashing or losing the response.
 */
export function parseBriefResponse(raw: string): ParsedBrief {
  const candidate = extractJsonBlock(raw) ?? raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (err) {
    return {
      ok: false,
      sections: {
        fallback: {
          rawText: raw.slice(0, FALLBACK_RAW_TEXT_CAP),
          parseError: err instanceof Error ? err.message : String(err),
        },
      },
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      sections: {
        fallback: {
          rawText: raw.slice(0, FALLBACK_RAW_TEXT_CAP),
          parseError: "top-level LLM response is not a JSON object",
        },
      },
    };
  }
  const p = parsed as Record<string, unknown>;
  return {
    ok: true,
    sections: {
      whatWorked: asStringArray(p.whatWorked),
      underutilized: asStringArray(p.underutilized),
      contentSuggestions: asContentSuggestions(p.contentSuggestions),
      funnelSuggestions: asStringArray(p.funnelSuggestions),
      inspirationReview: asInspirationReview(p.inspirationReview),
      llmVisibility: typeof p.llmVisibility === "string" ? p.llmVisibility : "",
      summary: asStringArray(p.summary),
    },
  };
}

// ---------------------------------------------------------------------------
// URL validation for the Inspiration board — pure function, unit-tested.
// ---------------------------------------------------------------------------

/** http(s) URL only, with a real host. Trims first so pasted whitespace is forgiven. */
export function validateInspirationUrl(url: unknown): url is string {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.length === 0) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.hostname.length > 0;
}

// ---------------------------------------------------------------------------
// Orchestration — gather, call the LLM, parse, upsert, mark inspiration
// items reviewed.
// ---------------------------------------------------------------------------

export interface DailyBriefRunResult {
  ok: boolean;
  briefDate: string;
  parseOk: boolean;
  provider: string;
  model: string;
  inspirationReviewed: number;
  error?: string;
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function runDailyBriefTick(db: Db): Promise<DailyBriefRunResult> {
  const briefDate = todayDateString();
  if (!COMPANY_ID) {
    logger.warn("socials:daily-brief — TEAM_DASHBOARD_COMPANY_ID not configured, skipping");
    return {
      ok: false,
      briefDate,
      parseOk: false,
      provider: "",
      model: "",
      inspirationReviewed: 0,
      error: "TEAM_DASHBOARD_COMPANY_ID not configured",
    };
  }

  const data = await gatherBriefData(db, COMPANY_ID);
  const messages = buildBriefPrompt(data);

  let provider = "";
  let model = "";
  let parsed: ParsedBrief;
  try {
    const result = await callLlmChat(messages, { maxTokens: 2000 });
    provider = result.provider;
    model = result.model;
    parsed = parseBriefResponse(result.content);
  } catch (err) {
    // The LLM call itself failed (both providers down/unconfigured) — store a
    // minimal fallback brief rather than losing the day entirely.
    logger.error({ err }, "socials:daily-brief — LLM call failed");
    parsed = {
      ok: false,
      sections: {
        fallback: {
          rawText: "",
          parseError: err instanceof Error ? err.message : String(err),
        },
      },
    };
  }

  await db
    .insert(dailyBriefs)
    .values({
      companyId: COMPANY_ID,
      briefDate,
      sections: parsed.sections,
      model: model || null,
    })
    .onConflictDoUpdate({
      target: [dailyBriefs.companyId, dailyBriefs.briefDate],
      set: { sections: parsed.sections, model: model || null },
    });

  // Mark every inspiration item that was sent to the LLM as reviewed, using
  // its matched comment when the parse succeeded and found one, else a
  // generic fallback comment — items must not pile up forever waiting on a
  // perfect LLM match.
  const reviewByUrl = new Map<string, string>();
  if (parsed.ok) {
    const review = (parsed.sections.inspirationReview as InspirationReviewEntry[] | undefined) ?? [];
    for (const entry of review) reviewByUrl.set(entry.url, entry.comment);
  }
  let inspirationReviewed = 0;
  for (const item of data.inspirationItems) {
    const comment =
      reviewByUrl.get(item.url) ??
      (parsed.ok
        ? "Reviewed in today's brief — no specific note returned for this link."
        : "Reviewed, but today's brief couldn't be parsed — see the raw response in the brief's fallback section.");
    await db
      .update(inspirationItems)
      .set({ status: "reviewed", aiComment: comment })
      .where(eq(inspirationItems.id, item.id));
    inspirationReviewed += 1;
  }

  logger.info(
    { briefDate, parseOk: parsed.ok, provider, model, inspirationReviewed },
    "socials:daily-brief tick",
  );

  return {
    ok: true,
    briefDate,
    parseOk: parsed.ok,
    provider,
    model,
    inspirationReviewed,
  };
}
