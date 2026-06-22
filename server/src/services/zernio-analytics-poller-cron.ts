/**
 * Cron registration for the Zernio analytics poller (Goal B).
 *
 * Every 6 hours, for each social_accounts row whose oauth_ref is "zernio:<id>":
 *   1. derive the Zernio account id,
 *   2. load the per-account key from process.env["ZERNIO_KEY_<id>"] — skip+log
 *      if absent (no throw),
 *   3. pull per-post analytics + IG account-insights + follower-history,
 *   4. UPSERT into zernio_post_analytics / zernio_account_analytics.
 *
 * HTTP 402 AND 403 from Zernio mean "analytics add-on not on this account" and
 * are treated identically: skip + log, NEVER throw (so one un-provisioned
 * account can't crash-loop the job into the circuit breaker). IG insights are
 * delayed ~48h upstream — we persist whatever the snapshot reports and stamp
 * last_synced_at; we do not try to back-date.
 *
 * Mirrors services/social-crons.ts (registerCronJob + start* export wired in
 * app.ts).
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { zernioPostAnalytics, zernioAccountAnalytics } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { logger } from "../middleware/logger.js";
import {
  parseZernioAccountId,
  fetchPostAnalytics,
  fetchInstagramAccountInsights,
  fetchFollowerHistory,
  isUnavailable,
  ANALYTICS_UNAVAILABLE,
} from "./socials/zernio-analytics.js";

// Today's date as a YYYY-MM-DD string for the as_of_date snapshot key. Computed
// in UTC so a single daily snapshot row is stable regardless of server TZ.
function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

interface ZernioAccountRow {
  id: string;
  company_id: string;
  platform: string;
  oauth_ref: string | null;
}

export interface ZernioPollerResult {
  accounts: number;
  polled: number;
  skippedNoKey: number;
  skippedUnavailable: number;
  postsUpserted: number;
  accountSnapshotsUpserted: number;
}

export async function runZernioAnalyticsPollerTick(db: Db): Promise<ZernioPollerResult> {
  const result: ZernioPollerResult = {
    accounts: 0,
    polled: 0,
    skippedNoKey: 0,
    skippedUnavailable: 0,
    postsUpserted: 0,
    accountSnapshotsUpserted: 0,
  };

  // Zernio-connected accounts only. oauth_ref carries "zernio:<id>".
  const rows = (await db.execute(sql`
    SELECT id, company_id, platform, oauth_ref
    FROM social_accounts
    WHERE oauth_ref LIKE 'zernio:%'
      AND archived = false
  `)) as unknown as ZernioAccountRow[];

  result.accounts = rows.length;
  const asOfDate = todayDateStr();

  for (const row of rows) {
    const zid = parseZernioAccountId(row.oauth_ref);
    if (!zid) {
      logger.warn({ socialAccountId: row.id }, "zernio-poller: malformed oauth_ref — skipping");
      continue;
    }

    // No per-account key configured → skip + log (never throw). The client also
    // guards this, but checking the env directly keeps the skip cheap.
    if (!process.env[`ZERNIO_KEY_${zid}`]) {
      result.skippedNoKey += 1;
      logger.info({ socialAccountId: row.id, zid }, "zernio-poller: no ZERNIO_KEY — skipping");
      continue;
    }

    try {
      // --- per-post analytics -------------------------------------------------
      const posts = await fetchPostAnalytics(zid, { limit: 100 });
      if (isUnavailable(posts)) {
        result.skippedUnavailable += 1;
        continue; // already logged inside the client
      }

      for (const p of posts) {
        // UNIQUE (zernio_account_id, platform_post_id) is the upsert key; rows
        // without a reconciled platform_post_id can't be deduped, so skip them
        // (they'll be picked up once Zernio reconciles the on-platform id).
        if (!p.platformPostId) continue;
        await db
          .insert(zernioPostAnalytics)
          .values({
            companyId: row.company_id,
            socialAccountId: row.id,
            zernioAccountId: zid,
            platform: row.platform,
            zernioPostId: p.zernioPostId,
            platformPostId: p.platformPostId,
            platformPostUrl: p.platformPostUrl,
            contentPreview: p.contentPreview,
            publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
            impressions: p.impressions,
            reach: p.reach,
            likes: p.likes,
            comments: p.comments,
            shares: p.shares,
            saves: p.saves,
            views: p.views,
            engagementRate: String(p.engagementRate),
            reelsAvgWatchTime: p.reelsAvgWatchTime,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [zernioPostAnalytics.zernioAccountId, zernioPostAnalytics.platformPostId],
            set: {
              platformPostUrl: p.platformPostUrl,
              contentPreview: p.contentPreview,
              publishedAt: p.publishedAt ? new Date(p.publishedAt) : null,
              impressions: p.impressions,
              reach: p.reach,
              likes: p.likes,
              comments: p.comments,
              shares: p.shares,
              saves: p.saves,
              views: p.views,
              engagementRate: String(p.engagementRate),
              reelsAvgWatchTime: p.reelsAvgWatchTime,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        result.postsUpserted += 1;
      }

      // --- account-level snapshot (IG insights + followers) -------------------
      // account-insights / follower-history are Instagram-only endpoints in v1
      // (see the captured Zernio shapes). For non-IG accounts a non-2xx other
      // than 402/403 would throw and abort this account's snapshot, so we skip
      // the account-level calls entirely and treat them as unavailable — per-post
      // analytics above still persist. Dispatch by platform once Zernio exposes
      // per-platform account endpoints.
      const isInstagram = row.platform === "instagram";
      const insights = isInstagram
        ? await fetchInstagramAccountInsights(zid)
        : ANALYTICS_UNAVAILABLE;
      const history = isInstagram ? await fetchFollowerHistory(zid) : ANALYTICS_UNAVAILABLE;

      // Followers for today's snapshot: prefer the insights value, else the most
      // recent follower-history point.
      let followers = 0;
      let windowStart: string | undefined;
      let windowEnd: string | undefined;
      let reach = 0;
      let views = 0;
      let accountsEngaged = 0;
      let totalInteractions = 0;
      let profileLinksTaps = 0;

      if (!isUnavailable(insights)) {
        followers = insights.followers;
        reach = insights.reach;
        views = insights.views;
        accountsEngaged = insights.accountsEngaged;
        totalInteractions = insights.totalInteractions;
        profileLinksTaps = insights.profileLinksTaps;
        windowStart = insights.windowStart;
        windowEnd = insights.windowEnd;
      }
      if (followers === 0 && !isUnavailable(history) && history.length > 0) {
        followers = history[history.length - 1]?.value ?? 0;
      }

      // Persist a daily snapshot whenever we got ANY account-level data. If both
      // insights AND follower-history are unavailable, there's nothing to write.
      const haveAccountData = !isUnavailable(insights) || (!isUnavailable(history) && history.length > 0);
      if (haveAccountData) {
        await db
          .insert(zernioAccountAnalytics)
          .values({
            companyId: row.company_id,
            socialAccountId: row.id,
            zernioAccountId: zid,
            platform: row.platform,
            asOfDate,
            reach,
            views,
            accountsEngaged,
            totalInteractions,
            followers,
            profileLinksTaps,
            windowStart: windowStart ? windowStart.slice(0, 10) : null,
            windowEnd: windowEnd ? windowEnd.slice(0, 10) : null,
            lastSyncedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [zernioAccountAnalytics.zernioAccountId, zernioAccountAnalytics.asOfDate],
            set: {
              reach,
              views,
              accountsEngaged,
              totalInteractions,
              followers,
              profileLinksTaps,
              windowStart: windowStart ? windowStart.slice(0, 10) : null,
              windowEnd: windowEnd ? windowEnd.slice(0, 10) : null,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            },
          });
        result.accountSnapshotsUpserted += 1;
      }

      result.polled += 1;
    } catch (err) {
      // One account's genuine error must not abort the whole sweep — log and
      // continue. (402/403 are handled as "unavailable" upstream, not here.)
      logger.error(
        { err, socialAccountId: row.id, zid },
        "zernio-poller: failed to poll account — continuing",
      );
    }
  }

  return result;
}

export function startZernioAnalyticsPollerCron(db: Db): void {
  registerCronJob({
    jobName: "zernio:analytics-poller",
    schedule: "0 */6 * * *",
    ownerAgent: "system",
    sourceFile: "zernio-analytics-poller-cron.ts",
    handler: async () => {
      const result = await runZernioAnalyticsPollerTick(db);
      if (result.accounts > 0) {
        logger.info(result, "zernio:analytics-poller tick");
      }
      return result;
    },
  });

  logger.info("Zernio analytics poller cron registered (zernio:analytics-poller)");
}
