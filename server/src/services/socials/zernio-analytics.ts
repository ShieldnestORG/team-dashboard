// Zernio analytics client (Goal B).
//
// Read-side companion to services/platform-publishers/zernio.ts (the publish
// path). It pulls per-post + per-account analytics from Zernio so the
// zernio:analytics-poller cron can persist them into zernio_post_analytics /
// zernio_account_analytics. The READ API serves from those tables, NOT from here
// on every request.
//
// Auth & base mirror the publisher EXACTLY: per-account Bearer key via
// process.env["ZERNIO_KEY_" + zernioAccountId], base ZERNIO_API_BASE (default
// https://zernio.com/api/v1), read at call time.
//
// Add-on gating: Zernio returns HTTP 402 (payment required) or 403 (forbidden)
// for accounts WITHOUT the analytics add-on. We treat BOTH identically — return
// an "unavailable" marker so the poller skips + logs and never throws. Any other
// non-2xx is a genuine error surfaced to the caller.
//
// Response shapes from Zernio's analytics endpoints are UNVERIFIED (the only
// Zernio response parsed anywhere in-repo is GET /posts in ledger.py). Every
// parser here is defensive: it reads a small set of candidate field names and
// falls back to 0/undefined, so a shape drift degrades a metric to 0 rather than
// throwing. Field-name reconciliation is a TODO once a live add-on account
// exists.

import { logger } from "../../middleware/logger.js";

const ZERNIO_API_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

// 5s per request — same budget the system-health ping uses for liveness checks.
const REQUEST_TIMEOUT_MS = 5_000;

function zernioKeyFor(zernioAccountId: string): string | undefined {
  // Mirrors the publisher's zernioKeyFor — read at call time so newly
  // provisioned keys are picked up without restarting resolution logic.
  return process.env[`ZERNIO_KEY_${zernioAccountId}`];
}

export function parseZernioAccountId(oauthRef?: string | null): string | undefined {
  if (!oauthRef?.startsWith("zernio:")) return undefined;
  const id = oauthRef.slice("zernio:".length).trim();
  return id.length > 0 ? id : undefined;
}

// Returned when Zernio answers 402/403 — the analytics add-on is not on this
// account. The poller treats this as "skip + log", never an error.
export const ANALYTICS_UNAVAILABLE = Symbol("zernio-analytics-unavailable");
export type AnalyticsUnavailable = typeof ANALYTICS_UNAVAILABLE;

export function isUnavailable<T>(v: T | AnalyticsUnavailable): v is AnalyticsUnavailable {
  return v === ANALYTICS_UNAVAILABLE;
}

// ---------------------------------------------------------------------------
// Normalised result shapes (what the poller persists). Numbers only — the
// client absorbs Zernio's field-name uncertainty so the poller stays simple.
// ---------------------------------------------------------------------------

export interface ZernioPostMetric {
  zernioPostId?: string;
  platformPostId?: string;
  platformPostUrl?: string;
  contentPreview?: string;
  publishedAt?: string; // ISO
  impressions: number;
  reach: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  views: number;
  engagementRate: number;
  reelsAvgWatchTime: number;
}

export interface ZernioAccountInsights {
  reach: number;
  views: number;
  accountsEngaged: number;
  totalInteractions: number;
  followers: number;
  profileLinksTaps: number;
  windowStart?: string; // ISO date
  windowEnd?: string; // ISO date
}

export interface ZernioFollowerPoint {
  date: string; // ISO date
  value: number;
}

// ---------------------------------------------------------------------------
// Low-level fetch — shared timeout + add-on gating + defensive JSON parse.
// ---------------------------------------------------------------------------

type FetchOk = { kind: "ok"; data: unknown };
type FetchUnavailable = { kind: "unavailable"; status: number };

async function zernioGet(
  path: string,
  key: string,
): Promise<FetchOk | FetchUnavailable> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${ZERNIO_API_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
      signal: controller.signal,
    });

    // 402 (payment required) AND 403 (forbidden) → analytics add-on not on this
    // account. Treated identically: not an error, just "no data here".
    if (res.status === 402 || res.status === 403) {
      return { kind: "unavailable", status: res.status };
    }

    const txt = await res.text();
    if (!res.ok) {
      // Genuine failure — surface it so the poller logs and the circuit breaker
      // can see repeated trouble.
      throw new Error(`Zernio GET ${path} -> ${res.status}: ${txt.slice(0, 300)}`);
    }

    let data: unknown = {};
    try {
      data = txt ? JSON.parse(txt) : {};
    } catch {
      // non-JSON 2xx — degrade to empty object; parsers will yield zeros.
      data = {};
    }
    return { kind: "ok", data };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Defensive readers (field names UNVERIFIED — see header TODO).
// ---------------------------------------------------------------------------

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function num(...candidates: unknown[]): number {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string" && c.trim() !== "" && Number.isFinite(Number(c))) {
      return Number(c);
    }
  }
  return 0;
}

function str(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return undefined;
}

// Pull the array of items out of a few common envelope shapes.
function asArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.map(rec);
  const d = rec(data);
  for (const k of ["data", "posts", "items", "results", "analytics"]) {
    if (Array.isArray(d[k])) return (d[k] as unknown[]).map(rec);
  }
  return [];
}

// Build one ZernioPostMetric from a post's shared fields + a single platform
// entry's metrics. The real Zernio /v1/analytics shape carries metrics PER
// platform under posts[].platforms[].analytics; the unique persist key is
// (zernio_account_id, platform_post_id), so each platform entry is its own row.
function toPostMetricForPlatform(
  raw: Record<string, unknown>,
  platform: Record<string, unknown>,
): ZernioPostMetric {
  // Metrics live under platforms[].analytics (per-platform); fall back to the
  // post-level analytics aggregate, then legacy candidate keys.
  const m = rec(platform.analytics ?? raw.analytics ?? raw.metrics ?? raw.insights ?? raw);
  return {
    zernioPostId: str(raw._id, raw.id, raw.postId),
    platformPostId: str(platform.platformPostId, platform.platform_post_id, raw.platformPostId, raw.platform_post_id),
    platformPostUrl: str(platform.platformPostUrl, platform.platform_post_url, raw.platformPostUrl, raw.url),
    contentPreview: str(raw.content, raw.caption, raw.text)?.slice(0, 280),
    publishedAt: str(raw.publishedAt, raw.published_at, raw.createdAt, raw.created_at),
    impressions: num(m.impressions, m.impressionCount),
    reach: num(m.reach),
    likes: num(m.likes, m.likeCount),
    comments: num(m.comments, m.commentCount),
    shares: num(m.shares, m.shareCount),
    saves: num(m.saves, m.saved, m.saveCount),
    views: num(m.views, m.videoViews, m.plays),
    engagementRate: num(m.engagementRate, m.engagement_rate),
    reelsAvgWatchTime: num(m.igReelsAvgWatchTime, m.avgWatchTime, m.reelsAvgWatchTime, m.averageWatchTime),
  };
}

// Expand one Zernio post into one metric per platform entry (each carrying its
// own platformPostId/url/analytics). Posts with no platforms[] still yield a
// single best-effort row from the post-level fields.
function toPostMetrics(raw: Record<string, unknown>): ZernioPostMetric[] {
  const platforms = Array.isArray(raw.platforms) ? raw.platforms.map(rec) : [];
  if (platforms.length === 0) {
    return [toPostMetricForPlatform(raw, {})];
  }
  return platforms.map((p) => toPostMetricForPlatform(raw, p));
}

// ---------------------------------------------------------------------------
// Public client functions. Each returns ANALYTICS_UNAVAILABLE on 402/403.
// ---------------------------------------------------------------------------

// GET /v1/analytics?accountId=&limit= — per-post metrics for one account.
export async function fetchPostAnalytics(
  zernioAccountId: string,
  opts: { limit?: number } = {},
): Promise<ZernioPostMetric[] | AnalyticsUnavailable> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) {
    logger.warn({ zernioAccountId }, "zernio-analytics: no ZERNIO_KEY — skipping post analytics");
    return ANALYTICS_UNAVAILABLE;
  }
  const limit = Math.min(200, Math.max(1, opts.limit ?? 100));
  const result = await zernioGet(
    `/analytics?accountId=${encodeURIComponent(zernioAccountId)}&limit=${limit}`,
    key,
  );
  if (result.kind === "unavailable") {
    logger.info(
      { zernioAccountId, status: result.status },
      "zernio-analytics: add-on unavailable (post analytics) — skipping",
    );
    return ANALYTICS_UNAVAILABLE;
  }
  return asArray(result.data).flatMap(toPostMetrics);
}

// GET /v1/analytics/instagram/account-insights?accountId= — account-level rollup.
export async function fetchInstagramAccountInsights(
  zernioAccountId: string,
): Promise<ZernioAccountInsights | AnalyticsUnavailable> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) return ANALYTICS_UNAVAILABLE;
  const result = await zernioGet(
    `/analytics/instagram/account-insights?accountId=${encodeURIComponent(zernioAccountId)}`,
    key,
  );
  if (result.kind === "unavailable") {
    logger.info(
      { zernioAccountId, status: result.status },
      "zernio-analytics: add-on unavailable (account insights) — skipping",
    );
    return ANALYTICS_UNAVAILABLE;
  }
  // Real shape: { metrics: { '<name>': { total, values? } }, dateRange: { since, until } }.
  // Each metric is an object keyed by its snake_case name; the scalar is under .total.
  const d = rec(result.data);
  const metrics = rec(d.metrics);
  const dateRange = rec(d.dateRange ?? d.window);
  return {
    reach: num(rec(metrics.reach).total),
    views: num(rec(metrics.views).total),
    accountsEngaged: num(rec(metrics.accounts_engaged).total),
    totalInteractions: num(rec(metrics.total_interactions).total),
    // No followers metric on account-insights — comes from follower-history; the
    // poller falls back to that, so this stays 0 here by design.
    followers: 0,
    profileLinksTaps: num(rec(metrics.profile_links_taps).total),
    windowStart: str(dateRange.since, dateRange.start),
    windowEnd: str(dateRange.until, dateRange.end),
  };
}

// GET /v1/analytics/instagram/follower-history?accountId= — follower time series.
export async function fetchFollowerHistory(
  zernioAccountId: string,
): Promise<ZernioFollowerPoint[] | AnalyticsUnavailable> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) return ANALYTICS_UNAVAILABLE;
  const result = await zernioGet(
    `/analytics/instagram/follower-history?accountId=${encodeURIComponent(zernioAccountId)}`,
    key,
  );
  if (result.kind === "unavailable") {
    logger.info(
      { zernioAccountId, status: result.status },
      "zernio-analytics: add-on unavailable (follower history) — skipping",
    );
    return ANALYTICS_UNAVAILABLE;
  }
  // Same envelope as account-insights: { metrics: { '<name>': { total, values:[{date,value}] } } }.
  // The daily follower series is the metric whose values[] is populated (prefer a
  // followers-named metric, else the first metric that carries a values array).
  const metrics = rec(rec(result.data).metrics);
  const named = ["followers", "follower_count", "followers_count", "follower_history"];
  let series: unknown[] = [];
  for (const k of named) {
    const v = rec(metrics[k]).values;
    if (Array.isArray(v) && v.length > 0) {
      series = v;
      break;
    }
  }
  if (series.length === 0) {
    for (const key of Object.keys(metrics)) {
      const v = rec(metrics[key]).values;
      if (Array.isArray(v) && v.length > 0) {
        series = v;
        break;
      }
    }
  }
  return series
    .map(rec)
    .map((r) => ({
      date: str(r.date, r.day, r.timestamp) ?? "",
      value: num(r.value, r.followers, r.count),
    }))
    .filter((p) => p.date !== "");
}

// Best-times and posting-frequency are DERIVED in the read API from stored post
// rows (publishedAt + engagementRate), so there is no live Zernio call for them
// in v1. Exposed here as thin helpers the read API can reuse for shape parity.
// TODO(verify): if Zernio exposes a native best-time endpoint, prefer it.
export interface BestTime { day: number; hour: number; score: number }
export interface PostingFrequencyBucket { period: string; count: number }
