// ---------------------------------------------------------------------------
// Zernio analytics read API (Goal B). Admin-only, READ-ONLY.
//
// Mounted at /api/socials/analytics by app.ts (AFTER /socials so it doesn't
// shadow existing /socials routes). Serves FROM the two poller-populated tables
// (zernio_post_analytics / zernio_account_analytics) — it does NOT hit live
// Zernio. The zernio:analytics-poller cron (every 6h) keeps the tables fresh.
//
// Endpoints:
//   GET /overview?window=30d
//   GET /accounts/:socialAccountId?window=30d
//   GET /recommendations?accountId=all|<socialAccountId>
//
// Recommendations are DETERMINISTIC (no LLM in v1): action is computed from
// thresholds over stored signals; the reason string is templated from those
// signals. TODO(future): LLM phrasing of the reason copy.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parse a "30d" / "7d" / "90d" window into a clamped day count (default 30).
function parseWindowDays(raw: unknown): number {
  const m = typeof raw === "string" ? /^(\d+)d$/.exec(raw.trim()) : null;
  const n = m ? parseInt(m[1], 10) : 30;
  return Math.min(365, Math.max(1, Number.isFinite(n) ? n : 30));
}

function windowLabel(days: number): string {
  return `${days}d`;
}

function n(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

// IG insights are delayed ~48h upstream; surfaced verbatim so the UI is honest.
const DATA_DELAYS_NOTE =
  "Instagram account insights lag ~48h upstream; per-post metrics may also be delayed. Numbers reflect the latest poll, not real time.";

interface AccountRow {
  social_account_id: string;
  zernio_account_id: string;
  platform: string;
  username: string;
  display_name: string | null;
}

// Accounts NOT connected through Zernio (no "zernio:<id>" oauth_ref). Excluded
// from totals; listed by handle for honesty.
interface UnconnectedRow {
  handle: string;
  display_name: string | null;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function socialsAnalyticsRoutes(db: Db): Router {
  const router = Router();

  // Board-only. Mirrors the inline guard in watchtower-admin.ts.
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // ── GET /overview ─────────────────────────────────────────────────────────
  router.get("/overview", async (req, res) => {
    try {
      const days = parseWindowDays(req.query.window);

      // Zernio-connected accounts (have analytics rows OR a zernio oauth_ref).
      const accountRows = (await db.execute(sql`
        SELECT
          sa.id            AS social_account_id,
          split_part(sa.oauth_ref, ':', 2) AS zernio_account_id,
          sa.platform      AS platform,
          sa.handle        AS username,
          sa.display_name  AS display_name
        FROM social_accounts sa
        WHERE sa.company_id = ${COMPANY_ID}
          AND sa.oauth_ref LIKE 'zernio:%'
          AND sa.archived = false
        ORDER BY sa.handle ASC
      `)) as unknown as AccountRow[];

      // Per-account post aggregates over the window.
      const postAgg = (await db.execute(sql`
        SELECT
          social_account_id,
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(reach), 0)::int       AS reach,
          COALESCE(SUM(likes), 0)::int       AS likes,
          COALESCE(SUM(comments), 0)::int    AS comments,
          COALESCE(SUM(shares), 0)::int      AS shares,
          COALESCE(SUM(saves), 0)::int       AS saves,
          COALESCE(SUM(views), 0)::int       AS views,
          COALESCE(AVG(engagement_rate), 0)  AS avg_engagement_rate,
          COUNT(*)::int                      AS post_count
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          AND published_at >= NOW() - (${days} || ' days')::interval
        GROUP BY social_account_id
      `)) as unknown as Record<string, unknown>[];

      // Latest account snapshot per account (followers + reach), and a snapshot
      // from ~`days` ago for follower growth.
      const latestSnap = (await db.execute(sql`
        SELECT DISTINCT ON (social_account_id)
          social_account_id,
          followers,
          reach,
          as_of_date
        FROM zernio_account_analytics
        WHERE company_id = ${COMPANY_ID}
        ORDER BY social_account_id, as_of_date DESC
      `)) as unknown as Record<string, unknown>[];

      const priorSnap = (await db.execute(sql`
        SELECT DISTINCT ON (social_account_id)
          social_account_id,
          followers
        FROM zernio_account_analytics
        WHERE company_id = ${COMPANY_ID}
          AND as_of_date <= (CURRENT_DATE - (${days} || ' days')::interval)
        ORDER BY social_account_id, as_of_date DESC
      `)) as unknown as Record<string, unknown>[];

      const aggBy = new Map(postAgg.map((r) => [r.social_account_id as string, r]));
      const latestBy = new Map(latestSnap.map((r) => [r.social_account_id as string, r]));
      const priorBy = new Map(priorSnap.map((r) => [r.social_account_id as string, r]));

      const accounts = accountRows.map((acc) => {
        const agg = aggBy.get(acc.social_account_id);
        const latest = latestBy.get(acc.social_account_id);
        const prior = priorBy.get(acc.social_account_id);
        const followers = n(latest?.followers);
        const priorFollowers = n(prior?.followers);
        return {
          socialAccountId: acc.social_account_id,
          zernioAccountId: acc.zernio_account_id,
          platform: acc.platform,
          username: acc.username,
          displayName: acc.display_name ?? acc.username,
          impressions: n(agg?.impressions),
          reach: n(agg?.reach),
          engagementRate: n(agg?.avg_engagement_rate),
          followers,
          followerGrowth: priorFollowers > 0 ? followers - priorFollowers : 0,
          postCount: n(agg?.post_count),
        };
      });

      // Totals across connected accounts only.
      const totals = accounts.reduce(
        (t, a) => {
          t.impressions += a.impressions;
          t.reach += a.reach;
          t.followers += a.followers;
          return t;
        },
        { impressions: 0, reach: 0, followers: 0 },
      );

      // Likes/comments/shares/saves/views from the post aggregate (not on the
      // AccountSummary contract, but part of overview totals). Iterate the
      // filtered accounts[] population (connected, non-archived) and look up each
      // account's postAgg row, so all nine total fields agree on the
      // connected-account set — a row that was archived after the poller wrote it
      // must not leak into these sums.
      const totalsExtra = accounts.reduce(
        (t: { likes: number; comments: number; shares: number; saves: number; views: number }, a) => {
          const agg = aggBy.get(a.socialAccountId);
          t.likes += n(agg?.likes);
          t.comments += n(agg?.comments);
          t.shares += n(agg?.shares);
          t.saves += n(agg?.saves);
          t.views += n(agg?.views);
          return t;
        },
        { likes: 0, comments: 0, shares: 0, saves: 0, views: 0 },
      );

      const erValues = accounts.map((a) => a.engagementRate).filter((x) => x > 0);
      const avgEngagementRate =
        erValues.length > 0 ? erValues.reduce((s, x) => s + x, 0) / erValues.length : 0;

      // Most-recent sync across both tables.
      const lastSyncRow = (await db.execute(sql`
        SELECT MAX(ts) AS last_sync FROM (
          SELECT MAX(last_synced_at) AS ts FROM zernio_post_analytics WHERE company_id = ${COMPANY_ID}
          UNION ALL
          SELECT MAX(last_synced_at) AS ts FROM zernio_account_analytics WHERE company_id = ${COMPANY_ID}
        ) s
      `)) as unknown as Record<string, unknown>[];
      const lastSync = (lastSyncRow[0]?.last_sync as string | null) ?? null;

      // Accounts NOT connected through Zernio — excluded from totals (honesty).
      const unconnectedRows = (await db.execute(sql`
        SELECT sa.handle AS handle, sa.display_name AS display_name
        FROM social_accounts sa
        WHERE sa.company_id = ${COMPANY_ID}
          AND sa.archived = false
          AND (sa.oauth_ref IS NULL OR sa.oauth_ref NOT LIKE 'zernio:%')
        ORDER BY sa.handle ASC
      `)) as unknown as UnconnectedRow[];

      res.json({
        window: windowLabel(days),
        lastSync,
        dataDelaysNote: DATA_DELAYS_NOTE,
        totals: {
          impressions: totals.impressions,
          reach: totals.reach,
          likes: totalsExtra.likes,
          comments: totalsExtra.comments,
          shares: totalsExtra.shares,
          saves: totalsExtra.saves,
          views: totalsExtra.views,
          avgEngagementRate,
          followers: totals.followers,
        },
        accounts,
        connectedCount: accounts.length,
        unconnectedAccounts: unconnectedRows.map((r) => r.display_name || r.handle),
      });
    } catch (err) {
      logger.error({ err }, "Failed to get socials analytics overview");
      res.status(500).json({ error: "Failed to get analytics overview" });
    }
  });

  // ── GET /accounts/:socialAccountId ─────────────────────────────────────────
  router.get("/accounts/:socialAccountId", async (req, res) => {
    try {
      const socialAccountId = req.params.socialAccountId;
      const days = parseWindowDays(req.query.window);

      const accRows = (await db.execute(sql`
        SELECT
          sa.id            AS social_account_id,
          split_part(sa.oauth_ref, ':', 2) AS zernio_account_id,
          sa.platform      AS platform,
          sa.handle        AS username,
          sa.display_name  AS display_name
        FROM social_accounts sa
        WHERE sa.company_id = ${COMPANY_ID}
          AND sa.id = ${socialAccountId}
        LIMIT 1
      `)) as unknown as AccountRow[];

      const acc = accRows[0];
      if (!acc) {
        res.status(404).json({ error: "Unknown social account" });
        return;
      }

      const aggRows = (await db.execute(sql`
        SELECT
          COALESCE(SUM(impressions), 0)::int AS impressions,
          COALESCE(SUM(reach), 0)::int       AS reach,
          COALESCE(AVG(engagement_rate), 0)  AS avg_engagement_rate,
          COUNT(*)::int                      AS post_count
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND published_at >= NOW() - (${days} || ' days')::interval
      `)) as unknown as Record<string, unknown>[];
      const agg = aggRows[0] ?? {};

      const latestSnapRows = (await db.execute(sql`
        SELECT followers, reach, views, accounts_engaged, total_interactions
        FROM zernio_account_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
        ORDER BY as_of_date DESC
        LIMIT 1
      `)) as unknown as Record<string, unknown>[];
      const snap = latestSnapRows[0] ?? {};

      const priorSnapRows = (await db.execute(sql`
        SELECT followers
        FROM zernio_account_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND as_of_date <= (CURRENT_DATE - (${days} || ' days')::interval)
        ORDER BY as_of_date DESC
        LIMIT 1
      `)) as unknown as Record<string, unknown>[];
      const followers = n(snap.followers);
      const priorFollowers = n(priorSnapRows[0]?.followers);

      const account = {
        socialAccountId: acc.social_account_id,
        zernioAccountId: acc.zernio_account_id,
        platform: acc.platform,
        username: acc.username,
        displayName: acc.display_name ?? acc.username,
        impressions: n(agg.impressions),
        reach: n(agg.reach),
        engagementRate: n(agg.avg_engagement_rate),
        followers,
        followerGrowth: priorFollowers > 0 ? followers - priorFollowers : 0,
        postCount: n(agg.post_count),
      };

      const accountInsights = {
        reach: n(snap.reach),
        views: n(snap.views),
        accountsEngaged: n(snap.accounts_engaged),
        totalInteractions: n(snap.total_interactions),
      };

      const followerHistoryRows = (await db.execute(sql`
        SELECT as_of_date AS date, followers AS value
        FROM zernio_account_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND as_of_date >= (CURRENT_DATE - (${days} || ' days')::interval)
        ORDER BY as_of_date ASC
      `)) as unknown as Record<string, unknown>[];
      const followerHistory = followerHistoryRows.map((r) => ({
        date: r.date as string,
        value: n(r.value),
      }));

      const recentRows = (await db.execute(sql`
        SELECT
          zernio_post_id, platform_post_id, platform_post_url, content_preview,
          published_at, impressions, reach, likes, comments, shares, saves,
          views, engagement_rate
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND published_at >= NOW() - (${days} || ' days')::interval
        ORDER BY published_at DESC
        LIMIT 50
      `)) as unknown as Record<string, unknown>[];
      const recentPosts = recentRows.map((r) => ({
        zernioPostId: (r.zernio_post_id as string) ?? null,
        platformPostId: (r.platform_post_id as string) ?? null,
        platformPostUrl: (r.platform_post_url as string) ?? null,
        contentPreview: (r.content_preview as string) ?? null,
        publishedAt: r.published_at as string,
        impressions: n(r.impressions),
        reach: n(r.reach),
        likes: n(r.likes),
        comments: n(r.comments),
        shares: n(r.shares),
        saves: n(r.saves),
        views: n(r.views),
        engagementRate: n(r.engagement_rate),
      }));

      // Best times: engagement-rate-weighted score per (day-of-week, hour),
      // derived from stored posts (no live call).
      const bestTimesRows = (await db.execute(sql`
        SELECT
          EXTRACT(DOW  FROM published_at)::int AS day,
          EXTRACT(HOUR FROM published_at)::int AS hour,
          AVG(engagement_rate) AS score
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND published_at IS NOT NULL
          AND published_at >= NOW() - (${days} || ' days')::interval
        GROUP BY 1, 2
        ORDER BY score DESC
        LIMIT 10
      `)) as unknown as Record<string, unknown>[];
      // Map Postgres DOW (0=Sun..6=Sat) to a weekday label so the API matches the
      // frontend's string `day` contract and renders "Wed 2pm", not "3 2pm".
      const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      const bestTimes = bestTimesRows.map((r) => ({
        day: DOW[n(r.day)] ?? String(n(r.day)),
        hour: n(r.hour),
        score: n(r.score),
      }));

      // Posting frequency: posts per ISO week within the window.
      const freqRows = (await db.execute(sql`
        SELECT
          to_char(date_trunc('week', published_at), 'IYYY-"W"IW') AS period,
          COUNT(*)::int AS count
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          AND social_account_id = ${socialAccountId}
          AND published_at IS NOT NULL
          AND published_at >= NOW() - (${days} || ' days')::interval
        GROUP BY 1
        ORDER BY 1 ASC
      `)) as unknown as Record<string, unknown>[];
      const postingFrequency = freqRows.map((r) => ({
        period: r.period as string,
        count: n(r.count),
      }));

      res.json({
        account,
        accountInsights,
        followerHistory,
        recentPosts,
        bestTimes,
        postingFrequency,
      });
    } catch (err) {
      logger.error({ err }, "Failed to get socials analytics account detail");
      res.status(500).json({ error: "Failed to get account analytics" });
    }
  });

  // ── GET /recommendations ───────────────────────────────────────────────────
  // DETERMINISTIC: action from thresholds over stored signals; reason templated.
  router.get("/recommendations", async (req, res) => {
    try {
      const accountId = (req.query.accountId as string) || "all";

      // Account-scope filter SQL fragment.
      const accountFilter =
        accountId && accountId !== "all"
          ? sql`AND social_account_id = ${accountId}`
          : sql``;

      // Post-level rows we'll score.
      const postRows = (await db.execute(sql`
        SELECT
          social_account_id, platform_post_id, content_preview,
          published_at, engagement_rate, impressions
        FROM zernio_post_analytics
        WHERE company_id = ${COMPANY_ID}
          ${accountFilter}
          AND published_at IS NOT NULL
          AND published_at >= NOW() - INTERVAL '90 days'
        ORDER BY published_at DESC
      `)) as unknown as Record<string, unknown>[];

      // Group posts by account to compute each account's median engagement rate.
      const byAccount = new Map<string, Record<string, unknown>[]>();
      for (const r of postRows) {
        const id = r.social_account_id as string;
        if (!byAccount.has(id)) byAccount.set(id, []);
        byAccount.get(id)!.push(r);
      }

      // Account display labels + follower growth signal.
      const accLabelRows = (await db.execute(sql`
        SELECT id, handle, display_name
        FROM social_accounts
        WHERE company_id = ${COMPANY_ID}
      `)) as unknown as Record<string, unknown>[];
      const labelBy = new Map(
        accLabelRows.map((r) => [
          r.id as string,
          (r.display_name as string) || (r.handle as string),
        ]),
      );

      type Rec = {
        scope: "account" | "post";
        subjectId: string;
        subjectLabel: string;
        action: "post_more" | "change" | "remove" | "keep";
        reason: string;
        signals: Record<string, number | string>;
      };
      const recommendations: Rec[] = [];

      for (const [accId, posts] of byAccount) {
        const ers = posts.map((p) => n(p.engagement_rate)).filter((x) => x >= 0);
        const med = median(ers);
        const label = labelBy.get(accId) || accId;
        const postCount = posts.length;

        // Follower growth over the trailing 30d for this account.
        const growthRows = (await db.execute(sql`
          SELECT
            (SELECT followers FROM zernio_account_analytics
              WHERE social_account_id = ${accId} ORDER BY as_of_date DESC LIMIT 1) AS latest,
            (SELECT followers FROM zernio_account_analytics
              WHERE social_account_id = ${accId}
                AND as_of_date <= (CURRENT_DATE - INTERVAL '30 days')
              ORDER BY as_of_date DESC LIMIT 1) AS prior
        `)) as unknown as Record<string, unknown>[];
        const latestF = n(growthRows[0]?.latest);
        const priorF = n(growthRows[0]?.prior);
        const followerGrowth = priorF > 0 ? latestF - priorF : 0;

        // Account-scope verdict (deterministic thresholds):
        //  - post_more: healthy median ER AND positive follower growth
        //  - change:    median ER below a floor, OR followers shrinking
        //  - keep:      otherwise
        let accAction: Rec["action"] = "keep";
        let accReason = `Median engagement rate ${med.toFixed(4)} over ${postCount} posts; follower change ${followerGrowth >= 0 ? "+" : ""}${followerGrowth}.`;
        if (med >= 0.03 && followerGrowth > 0) {
          accAction = "post_more";
          accReason = `Median engagement rate ${med.toFixed(4)} is strong and followers grew by ${followerGrowth} in 30d — increase cadence.`;
        } else if (med < 0.01 || followerGrowth < 0) {
          accAction = "change";
          accReason = `Median engagement rate ${med.toFixed(4)} is weak${followerGrowth < 0 ? ` and followers fell by ${Math.abs(followerGrowth)} in 30d` : ""} — change content approach.`;
        }

        recommendations.push({
          scope: "account",
          subjectId: accId,
          subjectLabel: label,
          action: accAction,
          reason: accReason,
          signals: {
            medianEngagementRate: Number(med.toFixed(6)),
            postCount,
            followerGrowth,
          },
        });

        // Per-post verdicts vs the account's own median (content-decay signal).
        // Score the 20 most recent posts to keep the payload bounded.
        for (const p of posts.slice(0, 20)) {
          const er = n(p.engagement_rate);
          const postLabel =
            (p.content_preview as string)?.slice(0, 60) ||
            (p.platform_post_id as string) ||
            "(post)";
          let action: Rec["action"] = "keep";
          let reason = `Engagement rate ${er.toFixed(4)} vs account median ${med.toFixed(4)}.`;
          if (med > 0 && er >= med * 1.5) {
            action = "post_more";
            reason = `Engagement rate ${er.toFixed(4)} is ${(er / med).toFixed(1)}x the account median — make more like this.`;
          } else if (med > 0 && er <= med * 0.4) {
            action = "remove";
            reason = `Engagement rate ${er.toFixed(4)} is far below the account median ${med.toFixed(4)} — underperformer.`;
          } else if (med > 0 && er < med * 0.8) {
            action = "change";
            reason = `Engagement rate ${er.toFixed(4)} is below the account median ${med.toFixed(4)} — adjust format.`;
          }
          recommendations.push({
            scope: "post",
            subjectId: (p.platform_post_id as string) || postLabel,
            subjectLabel: postLabel,
            action,
            reason,
            signals: {
              engagementRate: Number(er.toFixed(6)),
              accountMedian: Number(med.toFixed(6)),
              impressions: n(p.impressions),
            },
          });
        }
      }

      res.json({ recommendations });
    } catch (err) {
      logger.error({ err }, "Failed to get socials analytics recommendations");
      res.status(500).json({ error: "Failed to get recommendations" });
    }
  });

  return router;
}
