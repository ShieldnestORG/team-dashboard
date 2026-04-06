// ---------------------------------------------------------------------------
// X API — engagement learning and target discovery
// ---------------------------------------------------------------------------
// Analyzes engagement effectiveness over time and discovers potential new
// targets based on topic relevance from intel reports and tweet analytics.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { xEngagementLog, xTweetAnalytics, intelReports } from "@paperclipai/db";
import { and, eq, gte, desc, sql, count } from "drizzle-orm";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Engagement insights
// ---------------------------------------------------------------------------

export interface EngagementInsights {
  topTargets: Array<{
    username: string;
    actions: number;
    successRate: number;
  }>;
  actionBreakdown: Record<string, { total: number; success: number }>;
  bestTimeOfDay: number; // UTC hour with most successful engagements
}

/**
 * Analyze engagement effectiveness over the last N days.
 * Returns insights on which targets and topics drive the most engagement.
 */
export async function getEngagementInsights(
  db: Db,
  companyId: string,
  days: number,
): Promise<EngagementInsights> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);

  // Top targets by action count and success rate
  const targetStats = await db
    .select({
      username: xEngagementLog.targetUsername,
      total: count(),
      successes: sql<number>`sum(case when ${xEngagementLog.success} then 1 else 0 end)`.as("successes"),
    })
    .from(xEngagementLog)
    .where(
      and(
        eq(xEngagementLog.companyId, companyId),
        gte(xEngagementLog.executedAt, since),
      ),
    )
    .groupBy(xEngagementLog.targetUsername)
    .orderBy(desc(count()))
    .limit(20);

  const topTargets = targetStats
    .filter((r) => r.username != null)
    .map((r) => ({
      username: r.username as string,
      actions: Number(r.total),
      successRate: Number(r.total) > 0 ? Number(r.successes) / Number(r.total) : 0,
    }));

  // Action type breakdown
  const actionStats = await db
    .select({
      action: xEngagementLog.action,
      total: count(),
      successes: sql<number>`sum(case when ${xEngagementLog.success} then 1 else 0 end)`.as("successes"),
    })
    .from(xEngagementLog)
    .where(
      and(
        eq(xEngagementLog.companyId, companyId),
        gte(xEngagementLog.executedAt, since),
      ),
    )
    .groupBy(xEngagementLog.action);

  const actionBreakdown: Record<string, { total: number; success: number }> = {};
  for (const row of actionStats) {
    actionBreakdown[row.action] = {
      total: Number(row.total),
      success: Number(row.successes),
    };
  }

  // Best time of day (hour with most successful engagements)
  const hourStats = await db
    .select({
      hour: sql<number>`extract(hour from ${xEngagementLog.executedAt})`.as("hour"),
      cnt: count(),
    })
    .from(xEngagementLog)
    .where(
      and(
        eq(xEngagementLog.companyId, companyId),
        eq(xEngagementLog.success, true),
        gte(xEngagementLog.executedAt, since),
      ),
    )
    .groupBy(sql`extract(hour from ${xEngagementLog.executedAt})`)
    .orderBy(desc(count()))
    .limit(1);

  const bestTimeOfDay = hourStats.length > 0 ? Number(hourStats[0].hour) : 12;

  return { topTargets, actionBreakdown, bestTimeOfDay };
}

// ---------------------------------------------------------------------------
// Target discovery
// ---------------------------------------------------------------------------

export interface DiscoveredTarget {
  username: string;
  reason: string;
  score: number;
}

/**
 * Discover potential new targets based on topic relevance.
 * Since X API free tier lacks search, this uses:
 * 1. @mentions found in intel reports
 * 2. Authors that engaged with our tweets (from x_tweet_analytics — high reply/quote counts)
 * 3. Usernames mentioned in high-engagement tweets from existing targets
 */
export async function discoverNewTargets(
  db: Db,
  companyId: string,
  existingTargets: string[], // existing handles to exclude
): Promise<DiscoveredTarget[]> {
  const discovered: DiscoveredTarget[] = [];
  const existingSet = new Set(existingTargets.map((h) => h.toLowerCase()));

  // 1. Extract @mentions from intel reports (recent, relevant ones)
  try {
    const recentReports = await db
      .select({
        body: intelReports.body,
        headline: intelReports.headline,
      })
      .from(intelReports)
      .orderBy(desc(intelReports.capturedAt))
      .limit(50);

    const mentionCounts = new Map<string, number>();

    for (const report of recentReports) {
      const text = `${report.headline ?? ""} ${report.body ?? ""}`;
      // Extract @handles from text
      const handles = text.match(/@([a-zA-Z0-9_]{1,15})/g);
      if (handles) {
        for (const raw of handles) {
          const handle = raw.slice(1).toLowerCase();
          if (!existingSet.has(handle) && handle.length > 1) {
            mentionCounts.set(handle, (mentionCounts.get(handle) || 0) + 1);
          }
        }
      }
    }

    // Take handles mentioned more than once
    for (const [handle, cnt] of mentionCounts.entries()) {
      if (cnt >= 2) {
        discovered.push({
          username: handle,
          reason: `Mentioned ${cnt} times in recent intel reports`,
          score: Math.min(1, cnt / 10),
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "Engagement learning: failed to scan intel reports for targets");
  }

  // 2. Our tweets with high reply/quote counts indicate engaged audiences
  try {
    const engagedTweets = await db
      .select({
        tweetText: xTweetAnalytics.tweetText,
        replyCount: xTweetAnalytics.replyCount,
        quoteCount: xTweetAnalytics.quoteCount,
      })
      .from(xTweetAnalytics)
      .where(eq(xTweetAnalytics.companyId, companyId))
      .orderBy(desc(xTweetAnalytics.replyCount))
      .limit(20);

    // Extract @mentions from our highest-engagement tweets
    const replierCounts = new Map<string, number>();
    for (const tweet of engagedTweets) {
      const handles = tweet.tweetText.match(/@([a-zA-Z0-9_]{1,15})/g);
      if (handles) {
        for (const raw of handles) {
          const handle = raw.slice(1).toLowerCase();
          if (!existingSet.has(handle) && handle.length > 1) {
            replierCounts.set(handle, (replierCounts.get(handle) || 0) + 1);
          }
        }
      }
    }

    for (const [handle, cnt] of replierCounts.entries()) {
      // Skip if already discovered
      if (discovered.some((d) => d.username === handle)) continue;
      discovered.push({
        username: handle,
        reason: `Found in ${cnt} high-engagement tweets`,
        score: Math.min(1, cnt / 5),
      });
    }
  } catch (err) {
    logger.warn({ err }, "Engagement learning: failed to scan tweet analytics for targets");
  }

  // 3. Targets that have had successful engagements that we've logged
  //    (find usernames in the log that aren't in our target list — could be
  //     mentions from replies we received)
  try {
    const loggedUsers = await db
      .select({
        username: xEngagementLog.targetUsername,
        cnt: count(),
      })
      .from(xEngagementLog)
      .where(
        and(
          eq(xEngagementLog.companyId, companyId),
          eq(xEngagementLog.success, true),
        ),
      )
      .groupBy(xEngagementLog.targetUsername)
      .orderBy(desc(count()))
      .limit(50);

    for (const row of loggedUsers) {
      if (!row.username) continue;
      const handle = row.username.toLowerCase();
      if (existingSet.has(handle)) continue;
      if (discovered.some((d) => d.username === handle)) continue;
      discovered.push({
        username: handle,
        reason: `${Number(row.cnt)} successful past engagements`,
        score: Math.min(1, Number(row.cnt) / 8),
      });
    }
  } catch (err) {
    logger.warn({ err }, "Engagement learning: failed to scan engagement log for targets");
  }

  // Sort by score descending and return top 20
  discovered.sort((a, b) => b.score - a.score);
  return discovered.slice(0, 20);
}
