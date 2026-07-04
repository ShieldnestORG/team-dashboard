/**
 * Zernio analytics ingestion + read models (CONTROLLER-AUDIT Goal B, lanes
 * 2B/3B; adopted as lever L6 in plan-zernio-leverage §1).
 *
 * Daily cron pulls the core analytics surfaces per connected account into
 * zernio_analytics_snapshots (whole responses) and zernio_post_analytics
 * (flattened per post × platform, correlated to social_posts). The 402/403
 * add-on gate is RECORDED as a snapshot row (addon_missing=true), never
 * treated as a crash — both statuses mean the same thing (audit Area 4).
 *
 * HARD LINE: these numbers are Zernio cross-platform analytics. The X engine's
 * x_engagement_log is a different dataset with different coverage — never
 * blend the two in one panel/response.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  allZernioKeys,
  fetchZernioAnalytics,
  ZernioAddonMissingError,
} from "../platform-publishers/zernio.js";
import { logger } from "../../middleware/logger.js";

// Metrics snapshotted per account each tick. Windowed metrics get a 30-day
// lookback — wide enough to absorb the IG ~48h / YouTube 2-3d data delays the
// audit flags, small enough to stay cheap.
const SNAPSHOT_METRICS: Array<{ metric: string; windowDays?: number }> = [
  { metric: "daily-metrics", windowDays: 30 },
  { metric: "best-time" },
  { metric: "content-decay" },
  { metric: "posting-frequency" },
  { metric: "follower-stats", windowDays: 30 },
  { metric: "accounts-health" },
  { metric: "inbox-volume", windowDays: 30 },
];

const SNAPSHOT_RETENTION_DAYS = 180;
const POSTS_PAGE_LIMIT = 100;

function isoDateDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface ZernioAnalyticsIngestResult {
  accounts: number;
  snapshots: number;
  addonGates: number;
  postRowsUpserted: number;
  errors: string[];
}

async function connectedZernioAccountIds(db: Db): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT zernio_account_id AS "zid"
    FROM social_accounts
    WHERE zernio_account_id IS NOT NULL
      AND archived = false
  `);
  const fromDb = (rows as unknown as Array<{ zid: string }>).map((r) => r.zid);
  // Union with configured keys so an account keyed in env but not yet rowed
  // in social_accounts still gets ingested (honest totals need every account).
  const fromEnv = allZernioKeys().map((k) => k.zernioAccountId);
  return [...new Set([...fromDb, ...fromEnv])];
}

async function insertSnapshot(
  db: Db,
  opts: {
    metric: string;
    zernioAccountId: string;
    windowDays?: number;
    addonMissing: boolean;
    data: Record<string, unknown>;
  },
): Promise<void> {
  const windowFrom = opts.windowDays ? `${isoDateDaysAgo(opts.windowDays)}T00:00:00Z` : null;
  await db.execute(sql`
    INSERT INTO zernio_analytics_snapshots (
      metric, zernio_account_id, window_from, window_to, addon_missing, data
    )
    VALUES (
      ${opts.metric},
      ${opts.zernioAccountId},
      ${windowFrom}::timestamptz,
      now(),
      ${opts.addonMissing},
      ${JSON.stringify(opts.data)}::jsonb
    )
  `);
}

// Posts with no platforms[] breakdown still carry top-level platform data —
// synthesize a single-entry list from the top-level fields in that case.
// Exported for the backfill-matching unit test.
export function buildPlatformEntries(post: Record<string, unknown>): Array<Record<string, unknown>> {
  const platformEntries = Array.isArray(post.platforms)
    ? (post.platforms as Array<Record<string, unknown>>)
    : [];
  return platformEntries.length
    ? platformEntries
    : [
        {
          platform: post.platform,
          platformPostUrl: post.platformPostUrl,
          analytics: post.analytics,
        } as Record<string, unknown>,
      ];
}

// Exported for the backfill-matching unit test.
export function extractPlatformPostIds(entry: Record<string, unknown>): {
  platformPostId: string | null;
  platformPostUrl: string | null;
} {
  return {
    platformPostId: typeof entry.platformPostId === "string" ? entry.platformPostId : null,
    platformPostUrl: typeof entry.platformPostUrl === "string" ? entry.platformPostUrl : null,
  };
}

/**
 * posted_url ends up in an <a href> in the Queue UI, and platformPostUrl
 * comes from a third-party API — only ever store a value that parses as
 * plain http(s), so a hostile javascript:/data: value can never become a
 * clickable link (render side is double-guarded by ui/src/lib/safe-href).
 * Exported for the backfill unit test.
 */
export function sanitizePostedUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

/**
 * Backfill social_posts.posted_url from the analytics ingest once we have a
 * verified platformPostUrl (Zernio's publish response doesn't reliably carry
 * one — see the TODO in platform-publishers/zernio.ts — but the /v1/analytics
 * posts list does). Matches on platform_post_id, the field the relayer always
 * sets at publish time, scoped to the ingesting account's own posts via
 * social_accounts.zernio_account_id (platform_post_id has no unique
 * constraint, so an id collision across accounts must never cross-wire
 * posts); never clobbers a posted_url that's already set.
 */
async function backfillPostedUrl(
  db: Db,
  zernioAccountId: string,
  platformPostId: string,
  platformPostUrl: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE social_posts sp
       SET posted_url = ${platformPostUrl},
           updated_at = now()
      FROM social_accounts sa
     WHERE sa.id = sp.social_account_id
       AND sa.zernio_account_id = ${zernioAccountId}
       AND sp.platform_post_id = ${platformPostId}
       AND sp.posted_url IS NULL
  `);
}

/** Flatten one /v1/analytics list item into per-platform rows and upsert.
 *  Exported for the hostile-URL backfill unit test. */
export async function upsertPostAnalytics(
  db: Db,
  zernioAccountId: string,
  post: Record<string, unknown>,
): Promise<number> {
  const externalPostId = typeof post._id === "string" ? post._id : null;
  if (!externalPostId) return 0;
  const zernioPostId = typeof post.latePostId === "string" ? post.latePostId : null;
  const content = typeof post.content === "string" ? post.content.slice(0, 500) : null;
  const publishedAt = typeof post.publishedAt === "string" ? post.publishedAt : null;
  const entries = buildPlatformEntries(post);
  let upserted = 0;
  for (const entry of entries) {
    const platform = typeof entry.platform === "string" ? entry.platform : null;
    if (!platform) continue;
    const { platformPostId, platformPostUrl } = extractPlatformPostIds(entry);
    const metrics = (entry.analytics ?? post.analytics ?? {}) as Record<string, unknown>;
    await db.execute(sql`
      INSERT INTO zernio_post_analytics (
        external_post_id, zernio_post_id, zernio_account_id, platform,
        platform_post_id, platform_post_url, social_post_id, content,
        published_at, metrics, fetched_at
      )
      VALUES (
        ${externalPostId},
        ${zernioPostId},
        ${zernioAccountId},
        ${platform},
        ${platformPostId},
        ${platformPostUrl},
        (
          -- External-Post-ID correlation back to our queue (Goal B): the
          -- relayer records platform_post_id / posted_url at publish time.
          SELECT sp.id FROM social_posts sp
          WHERE (${platformPostId}::text IS NOT NULL AND sp.platform_post_id = ${platformPostId})
             OR (${platformPostUrl}::text IS NOT NULL AND sp.posted_url = ${platformPostUrl})
          LIMIT 1
        ),
        ${content},
        ${publishedAt}::timestamptz,
        ${JSON.stringify(metrics)}::jsonb,
        now()
      )
      ON CONFLICT (external_post_id, platform) DO UPDATE SET
        metrics = EXCLUDED.metrics,
        platform_post_id = COALESCE(EXCLUDED.platform_post_id, zernio_post_analytics.platform_post_id),
        platform_post_url = COALESCE(EXCLUDED.platform_post_url, zernio_post_analytics.platform_post_url),
        social_post_id = COALESCE(zernio_post_analytics.social_post_id, EXCLUDED.social_post_id),
        published_at = COALESCE(EXCLUDED.published_at, zernio_post_analytics.published_at),
        fetched_at = now()
    `);
    upserted += 1;
    const safePostedUrl = sanitizePostedUrl(platformPostUrl);
    if (platformPostId && safePostedUrl) {
      await backfillPostedUrl(db, zernioAccountId, platformPostId, safePostedUrl);
    }
  }
  return upserted;
}

export async function runZernioAnalyticsIngestTick(db: Db): Promise<ZernioAnalyticsIngestResult> {
  const result: ZernioAnalyticsIngestResult = {
    accounts: 0,
    snapshots: 0,
    addonGates: 0,
    postRowsUpserted: 0,
    errors: [],
  };
  const zids = await connectedZernioAccountIds(db);
  result.accounts = zids.length;
  if (zids.length === 0) return result; // nothing connected (local/dev) — quiet no-op

  for (const zid of zids) {
    // Endpoint snapshots.
    for (const { metric, windowDays } of SNAPSHOT_METRICS) {
      const query: Record<string, string | number | undefined> = {};
      if (windowDays) query.fromDate = isoDateDaysAgo(windowDays);
      try {
        const data = await fetchZernioAnalytics(zid, metric, query);
        await insertSnapshot(db, { metric, zernioAccountId: zid, windowDays, addonMissing: false, data });
        result.snapshots += 1;
      } catch (err) {
        if (err instanceof ZernioAddonMissingError) {
          await insertSnapshot(db, {
            metric,
            zernioAccountId: zid,
            windowDays,
            addonMissing: true,
            data: { status: err.status, body: err.body.slice(0, 300) },
          });
          result.addonGates += 1;
        } else {
          result.errors.push(`${zid}/${metric}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    // Per-post analytics (default 90-day API window).
    try {
      const data = await fetchZernioAnalytics(zid, "posts", { limit: POSTS_PAGE_LIMIT });
      const posts = Array.isArray(data.posts) ? (data.posts as Array<Record<string, unknown>>) : [];
      for (const post of posts) {
        result.postRowsUpserted += await upsertPostAnalytics(db, zid, post);
      }
    } catch (err) {
      if (err instanceof ZernioAddonMissingError) {
        await insertSnapshot(db, {
          metric: "posts",
          zernioAccountId: zid,
          addonMissing: true,
          data: { status: err.status, body: err.body.slice(0, 300) },
        });
        result.addonGates += 1;
      } else {
        result.errors.push(`${zid}/posts: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Bounded storage: snapshots are point-in-time pulls, not a ledger.
  await db.execute(sql`
    DELETE FROM zernio_analytics_snapshots
    WHERE fetched_at < now() - interval '${sql.raw(String(SNAPSHOT_RETENTION_DAYS))} days'
  `);

  logger.info(
    {
      accounts: result.accounts,
      snapshots: result.snapshots,
      addonGates: result.addonGates,
      postRows: result.postRowsUpserted,
      errors: result.errors.length,
    },
    "zernio-analytics ingest tick",
  );
  return result;
}

// ----- read models for /api/socials/zernio/analytics/* ----- //

export interface LatestSnapshotRow {
  metric: string;
  zernioAccountId: string | null;
  addonMissing: boolean;
  data: Record<string, unknown>;
  fetchedAt: string;
}

/** Latest snapshot per (metric, account) — the drill-down + summary source. */
export async function latestZernioSnapshots(
  db: Db,
  opts: { zernioAccountId?: string; metric?: string } = {},
): Promise<LatestSnapshotRow[]> {
  const rows = await db.execute(sql`
    SELECT DISTINCT ON (metric, zernio_account_id)
      metric,
      zernio_account_id AS "zernioAccountId",
      addon_missing     AS "addonMissing",
      data,
      fetched_at        AS "fetchedAt"
    FROM zernio_analytics_snapshots
    WHERE (${opts.zernioAccountId ?? null}::text IS NULL OR zernio_account_id = ${opts.zernioAccountId ?? null})
      AND (${opts.metric ?? null}::text IS NULL OR metric = ${opts.metric ?? null})
    ORDER BY metric, zernio_account_id, fetched_at DESC
  `);
  return rows as unknown as LatestSnapshotRow[];
}

// Zernio's follower-stats JSONB is opaque (field name unverified) — probed
// defensively like GreenlightRow.stats in routes/socials.ts. Null means "not
// reported", never zero. Exported for the serializer unit test.
const FOLLOWER_COUNT_KEYS = [
  "followers",
  "followerCount",
  "follower_count",
  "totalFollowers",
  "total_followers",
];

export function probeFollowerCount(entry: Record<string, unknown> | null | undefined): number | null {
  if (!entry || typeof entry !== "object") return null;
  for (const key of FOLLOWER_COUNT_KEYS) {
    const value = entry[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      return Number(value);
    }
  }
  return null;
}

/**
 * Latest follower count per zernio account, keyed by zernio_account_id.
 * Reuses latestZernioSnapshots' single DISTINCT ON query (no N+1) filtered to
 * the follower-stats metric. Accounts with no snapshot are simply absent from
 * the map — never backfilled with 0.
 */
export async function latestFollowerCounts(db: Db): Promise<Map<string, number>> {
  const snapshots = await latestZernioSnapshots(db, { metric: "follower-stats" });
  const out = new Map<string, number>();
  for (const snap of snapshots) {
    if (!snap.zernioAccountId) continue;
    const accounts = Array.isArray(snap.data.accounts)
      ? (snap.data.accounts as Array<Record<string, unknown>>)
      : [];
    for (const a of accounts) {
      const count = probeFollowerCount(a);
      if (count !== null) {
        out.set(snap.zernioAccountId, count);
        break;
      }
    }
  }
  return out;
}

export interface ZernioRecommendation {
  zernioAccountId: string;
  kind: string;
  message: string;
  evidence: Record<string, unknown>;
}

const TARGET_POSTS_PER_WEEK = 5; // playbook cadence (plan §2: 5 posts/wk)

/**
 * Deterministic recommendations from the latest snapshots (Goal B:
 * "recommendations from deterministic thresholds ... LLM only for phrasing" —
 * we skip the LLM phrasing entirely; the rule IS the message).
 */
export async function buildZernioRecommendations(db: Db): Promise<ZernioRecommendation[]> {
  const snapshots = await latestZernioSnapshots(db);
  const recs: ZernioRecommendation[] = [];
  const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // slot day_of_week: 0=Monday

  for (const snap of snapshots) {
    const zid = snap.zernioAccountId ?? "unknown";
    if (snap.addonMissing) {
      recs.push({
        zernioAccountId: zid,
        kind: "addon-gate",
        message: `Analytics add-on gate hit on '${snap.metric}' — confirm the entitlement before trusting totals.`,
        evidence: snap.data,
      });
      continue;
    }

    if (snap.metric === "best-time") {
      const slots = Array.isArray(snap.data.slots)
        ? (snap.data.slots as Array<Record<string, number>>)
        : [];
      const solid = slots
        .filter((s) => (s.post_count ?? 0) >= 2)
        .sort((a, b) => (b.avg_engagement ?? 0) - (a.avg_engagement ?? 0))
        .slice(0, 3);
      if (solid.length > 0) {
        const labels = solid.map((s) => `${DAYS[s.day_of_week] ?? s.day_of_week} ${s.hour}:00 UTC`);
        recs.push({
          zernioAccountId: zid,
          kind: "best-time",
          message: `Highest-engagement posting slots: ${labels.join(", ")}.`,
          evidence: { slots: solid },
        });
      }
    }

    if (snap.metric === "posting-frequency") {
      const freq = Array.isArray(snap.data.frequency)
        ? (snap.data.frequency as Array<Record<string, unknown>>)
        : [];
      for (const f of freq) {
        const perWeek = Number(f.posts_per_week ?? 0);
        if (perWeek > 0 && perWeek < TARGET_POSTS_PER_WEEK) {
          recs.push({
            zernioAccountId: zid,
            kind: "posting-frequency",
            message: `${String(f.platform)} is at ${perWeek} posts/wk — playbook cadence is ${TARGET_POSTS_PER_WEEK}/wk.`,
            evidence: f as Record<string, unknown>,
          });
        }
      }
    }

    if (snap.metric === "follower-stats") {
      const accounts = Array.isArray(snap.data.accounts)
        ? (snap.data.accounts as Array<Record<string, unknown>>)
        : [];
      for (const a of accounts) {
        const growth = Number(a.growth ?? 0);
        if (growth < 0) {
          recs.push({
            zernioAccountId: zid,
            kind: "follower-decline",
            message: `@${String(a.username ?? zid)} lost ${Math.abs(growth)} followers over the window.`,
            evidence: a as Record<string, unknown>,
          });
        }
      }
    }
  }

  return recs;
}
