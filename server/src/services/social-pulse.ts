import { sql, eq, and, gte, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { pulseTweets, pulseAggregations, pulseXrplBridge } from "@paperclipai/db";
import {
  getSocialPulseClient,
  PULSE_QUERIES,
  type PulseUser,
} from "./social-pulse-client.js";
import { getAutoReplyService } from "./auto-reply.js";
import { logger } from "../middleware/logger.js";
import { publishGlobalLiveEvent } from "./live-events.js";
import { sendAlert } from "./alerting.js";

// ---------------------------------------------------------------------------
// Helper: cast db.execute() result to typed rows
// ---------------------------------------------------------------------------

function asRows<T = Record<string, unknown>>(result: unknown): T[] {
  return result as unknown as T[];
}

// ---------------------------------------------------------------------------
// Sentiment word lists (crypto-specific)
// ---------------------------------------------------------------------------

const POSITIVE_WORDS = new Set([
  "bullish", "moon", "pump", "gains", "ath", "breakout", "surge",
  "rally", "strong", "growth", "adoption", "partnership", "launch",
  "upgrade", "milestone", "staking", "rewards", "earn", "yield",
  "innovation", "bridge", "interoperability", "ecosystem", "community",
  "exciting", "amazing", "great", "love", "impressive", "huge",
]);

const NEGATIVE_WORDS = new Set([
  "bearish", "dump", "crash", "scam", "rug", "hack", "exploit",
  "vulnerability", "sell", "fear", "fud", "decline", "loss",
  "warning", "risk", "concern", "issue", "problem", "bug", "broken",
  "down", "fail", "dead", "worthless", "overvalued",
]);

// ---------------------------------------------------------------------------
// Shared tweet ingestion — used by both polling and filtered stream
// ---------------------------------------------------------------------------

export interface TweetData {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  publicMetrics: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    impression_count: number;
  } | null;
}

export interface AuthorData {
  username: string;
  name: string | null;
}

export async function ingestTweet(
  db: Db,
  tweet: TweetData,
  topic: string,
  author: AuthorData,
): Promise<void> {
  await db
    .insert(pulseTweets)
    .values({
      tweetId: tweet.id,
      authorId: tweet.authorId,
      authorUsername: author.username,
      authorName: author.name,
      text: tweet.text,
      tweetCreatedAt: new Date(tweet.createdAt),
      topic,
      metricsLikes: tweet.publicMetrics?.like_count ?? 0,
      metricsRetweets: tweet.publicMetrics?.retweet_count ?? 0,
      metricsReplies: tweet.publicMetrics?.reply_count ?? 0,
      metricsImpressions: tweet.publicMetrics?.impression_count ?? 0,
      sourceQuery: topic, // tag with topic for stream-sourced tweets
    })
    .onConflictDoNothing({ target: pulseTweets.tweetId });
}

// ---------------------------------------------------------------------------
// sinceId tracking — survives across poll cycles within same process
// ---------------------------------------------------------------------------

const sinceIdMap = new Map<string, string>();

// ---------------------------------------------------------------------------
// Service factory
// ---------------------------------------------------------------------------

export function socialPulseService(db: Db) {
  // ── Poll X API searches ───────────────────────────────────────────────

  async function pollSearches(): Promise<{ newTweets: number; queries: number }> {
    const client = getSocialPulseClient();
    if (!client) return { newTweets: 0, queries: 0 };

    let totalNew = 0;

    for (const { query, topic } of PULSE_QUERIES) {
      try {
        const sinceId = sinceIdMap.get(topic);
        const res = await client.searchRecent(query, { sinceId, maxResults: 25 });

        if (!res.data || res.data.length === 0) continue;

        // Build author lookup
        const userMap = new Map<string, PulseUser>();
        for (const u of res.includes?.users ?? []) {
          userMap.set(u.id, u);
        }

        // Track newest id for next poll
        if (res.meta?.newest_id) {
          sinceIdMap.set(topic, res.meta.newest_id);
        }

        // Upsert tweets using shared ingestTweet
        for (const tweet of res.data) {
          const author = userMap.get(tweet.author_id);
          const authorData = {
            username: author?.username ?? "unknown",
            name: author?.name ?? null,
          };
          try {
            await ingestTweet(
              db,
              {
                id: tweet.id,
                text: tweet.text,
                authorId: tweet.author_id,
                createdAt: tweet.created_at,
                publicMetrics: tweet.public_metrics ?? null,
              },
              topic,
              authorData,
            );
            totalNew++;

            // Auto-reply trigger (polling path)
            const autoReply = getAutoReplyService();
            if (autoReply) {
              void autoReply.checkAndReply(
                {
                  id: tweet.id,
                  text: tweet.text,
                  authorId: tweet.author_id,
                  createdAt: tweet.created_at,
                  publicMetrics: tweet.public_metrics ?? null,
                },
                authorData,
                "poll",
              );
            }
          } catch {
            // duplicate — skip
          }
        }
      } catch (err) {
        logger.error({ err, topic }, "Pulse search failed for topic");
      }
    }

    // Emit live event so dashboard auto-refreshes
    if (totalNew > 0) {
      publishGlobalLiveEvent({ type: "pulse.new_tweets", payload: { count: totalNew } });
    }

    return { newTweets: totalNew, queries: PULSE_QUERIES.length };
  }

  // ── Keyword-based sentiment scoring ───────────────────────────────────

  async function scoreSentiment(batchSize = 50): Promise<{ scored: number }> {
    const unscored = await db
      .select()
      .from(pulseTweets)
      .where(sql`${pulseTweets.sentimentScore} IS NULL`)
      .limit(batchSize);

    let scored = 0;

    for (const tweet of unscored) {
      const words = tweet.text.toLowerCase().split(/\W+/);
      let pos = 0;
      let neg = 0;
      for (const w of words) {
        if (POSITIVE_WORDS.has(w)) pos++;
        if (NEGATIVE_WORDS.has(w)) neg++;
      }
      const total = pos + neg;
      const score = total === 0 ? 0.5 : pos / total;

      await db
        .update(pulseTweets)
        .set({ sentimentScore: score })
        .where(eq(pulseTweets.id, tweet.id));
      scored++;
    }

    return { scored };
  }

  // ── Compute aggregations ──────────────────────────────────────────────

  async function computeAggregations(period: "hour" | "day"): Promise<{ upserted: number }> {
    const now = new Date();
    let periodStart: Date;

    if (period === "hour") {
      periodStart = new Date(now);
      periodStart.setMinutes(0, 0, 0);
      periodStart = new Date(periodStart.getTime() - 60 * 60 * 1000);
    } else {
      periodStart = new Date(now);
      periodStart.setHours(0, 0, 0, 0);
      periodStart = new Date(periodStart.getTime() - 24 * 60 * 60 * 1000);
    }

    const periodEnd = new Date(
      periodStart.getTime() + (period === "hour" ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000),
    );

    const periodStartIso = periodStart.toISOString();
    const periodEndIso = periodEnd.toISOString();

    const rows = asRows(await db.execute(sql`
      SELECT
        topic,
        COUNT(*)::int AS tweet_count,
        AVG(sentiment_score)::real AS avg_sentiment,
        SUM(metrics_likes)::int AS total_likes,
        SUM(metrics_retweets)::int AS total_retweets,
        SUM(metrics_impressions)::int AS total_impressions,
        (SELECT tweet_id FROM pulse_tweets pt2
         WHERE pt2.topic = pulse_tweets.topic
           AND pt2.tweet_created_at >= ${periodStartIso}
           AND pt2.tweet_created_at < ${periodEndIso}
         ORDER BY (pt2.metrics_likes + pt2.metrics_retweets) DESC
         LIMIT 1) AS top_tweet_id
      FROM pulse_tweets
      WHERE tweet_created_at >= ${periodStartIso}
        AND tweet_created_at < ${periodEndIso}
      GROUP BY topic
    `));

    let upserted = 0;
    for (const row of rows as any[]) {
      await db
        .insert(pulseAggregations)
        .values({
          period,
          periodStart,
          topic: row.topic,
          tweetCount: row.tweet_count ?? 0,
          avgSentiment: row.avg_sentiment,
          totalLikes: row.total_likes ?? 0,
          totalRetweets: row.total_retweets ?? 0,
          totalImpressions: row.total_impressions ?? 0,
          topTweetId: row.top_tweet_id,
        })
        .onConflictDoNothing();
      upserted++;
    }

    return { upserted };
  }

  // ── Volume spike detection ────────────────────────────────────────────

  async function detectVolumeSpikes(): Promise<Array<{ topic: string; current: number; avg: number }>> {
    const spikes: Array<{ topic: string; current: number; avg: number }> = [];

    const now = new Date();
    const oneHourAgoIso = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const twentyFourHoursAgoIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const currentRows = asRows(await db.execute(sql`
      SELECT topic, COUNT(*)::int AS cnt
      FROM pulse_tweets
      WHERE tweet_created_at >= ${oneHourAgoIso}
      GROUP BY topic
    `));

    const avgRows = asRows(await db.execute(sql`
      SELECT topic, (COUNT(*)::float / 24)::real AS avg_per_hour
      FROM pulse_tweets
      WHERE tweet_created_at >= ${twentyFourHoursAgoIso}
      GROUP BY topic
    `));

    const avgMap = new Map<string, number>();
    for (const r of avgRows as any[]) {
      avgMap.set(r.topic, r.avg_per_hour ?? 0);
    }

    for (const r of currentRows as any[]) {
      const avg = avgMap.get(r.topic) ?? 0;
      if (avg > 0 && r.cnt > avg * 2) {
        const spike = { topic: r.topic, current: r.cnt, avg: Math.round(avg * 100) / 100 };
        spikes.push(spike);
        logger.warn(spike, "Pulse volume spike detected");
        publishGlobalLiveEvent({ type: "pulse.spike", payload: spike });
        void sendAlert(
          "pulse_spike",
          `Pulse spike: ${r.topic} (${r.cnt} tweets vs ${spike.avg} avg)`,
          `Topic "${r.topic}" has ${r.cnt} tweets in the last hour, which is >2x the 24h average of ${spike.avg}/hr.`,
        );
      }
    }

    return spikes;
  }

  // ── Tag XRPL bridge mentions ──────────────────────────────────────────

  async function tagXrplBridgeMentions(): Promise<{ tagged: number }> {
    const untagged = asRows(await db.execute(sql`
      SELECT pt.id, pt.tweet_id, pt.text
      FROM pulse_tweets pt
      LEFT JOIN pulse_xrpl_bridge_mentions px ON pt.tweet_id = px.tweet_id
      WHERE pt.topic = 'xrpl-bridge'
        AND px.id IS NULL
      LIMIT 100
    `));

    let tagged = 0;
    const textLower = (t: string) => t.toLowerCase();

    for (const row of untagged as any[]) {
      const text = textLower(row.text);

      let bridgeType = "general-bridge";
      if (text.includes("xrpl to tx") || text.includes("xrp to cosmos") || text.includes("xrp on tx")) {
        bridgeType = "xrpl-to-tx";
      } else if (text.includes("tx to xrpl") || text.includes("cosmos to xrp")) {
        bridgeType = "tx-to-xrpl";
      }

      let tokenMentioned = "other";
      if (text.includes("xrp")) tokenMentioned = "XRP";
      else if (text.includes("$tx") || text.includes("tx token")) tokenMentioned = "TX";

      const stakingMentioned =
        text.includes("stak") || text.includes("earn") || text.includes("yield") || text.includes("reward");

      await db.insert(pulseXrplBridge).values({
        tweetId: row.tweet_id,
        bridgeType,
        tokenMentioned,
        stakingMentioned,
      });
      tagged++;
    }

    return { tagged };
  }

  // ── Historical backfill ────────────────────────────────────────────────

  async function backfillAggregations(): Promise<{ reScored: number; hourlyFilled: number; dailyFilled: number }> {
    // 1. Re-score any unscored tweets
    const reScored = await scoreSentiment();

    const now = new Date();
    const topics = ["tx", "cosmos", "xrpl-bridge", "tokns"];

    // 2. Fill missing hourly aggregations for last 7 days (168 hours)
    let hourlyFilled = 0;
    for (let h = 0; h < 168; h++) {
      const periodStart = new Date(now.getTime() - (h + 1) * 3600000);
      periodStart.setMinutes(0, 0, 0); // floor to hour
      const periodEnd = new Date(periodStart.getTime() + 3600000);

      for (const topic of topics) {
        const existing = await db
          .select()
          .from(pulseAggregations)
          .where(
            and(
              eq(pulseAggregations.period, "hour"),
              eq(pulseAggregations.topic, topic),
              eq(pulseAggregations.periodStart, periodStart),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          const tweets = await db
            .select({
              count: sql<number>`COUNT(*)::int`,
              avgSentiment: sql<number>`AVG(sentiment_score)::real`,
              totalLikes: sql<number>`COALESCE(SUM(metrics_likes), 0)::int`,
              totalRetweets: sql<number>`COALESCE(SUM(metrics_retweets), 0)::int`,
              totalImpressions: sql<number>`COALESCE(SUM(metrics_impressions), 0)::int`,
            })
            .from(pulseTweets)
            .where(
              and(
                eq(pulseTweets.topic, topic),
                gte(pulseTweets.tweetCreatedAt, periodStart),
                lt(pulseTweets.tweetCreatedAt, periodEnd),
              ),
            );

          if (tweets[0] && tweets[0].count > 0) {
            await db
              .insert(pulseAggregations)
              .values({
                period: "hour",
                periodStart,
                topic,
                tweetCount: tweets[0].count,
                avgSentiment: tweets[0].avgSentiment,
                totalLikes: tweets[0].totalLikes,
                totalRetweets: tweets[0].totalRetweets,
                totalImpressions: tweets[0].totalImpressions,
                computedAt: new Date(),
              })
              .onConflictDoNothing();
            hourlyFilled++;
          }
        }
      }
    }

    // 3. Fill missing daily aggregations for last 30 days
    let dailyFilled = 0;
    for (let d = 0; d < 30; d++) {
      const periodStart = new Date(now.getTime() - (d + 1) * 86400000);
      periodStart.setHours(0, 0, 0, 0);
      const periodEnd = new Date(periodStart.getTime() + 86400000);

      for (const topic of topics) {
        const existing = await db
          .select()
          .from(pulseAggregations)
          .where(
            and(
              eq(pulseAggregations.period, "day"),
              eq(pulseAggregations.topic, topic),
              eq(pulseAggregations.periodStart, periodStart),
            ),
          )
          .limit(1);

        if (existing.length === 0) {
          const tweets = await db
            .select({
              count: sql<number>`COUNT(*)::int`,
              avgSentiment: sql<number>`AVG(sentiment_score)::real`,
              totalLikes: sql<number>`COALESCE(SUM(metrics_likes), 0)::int`,
              totalRetweets: sql<number>`COALESCE(SUM(metrics_retweets), 0)::int`,
              totalImpressions: sql<number>`COALESCE(SUM(metrics_impressions), 0)::int`,
            })
            .from(pulseTweets)
            .where(
              and(
                eq(pulseTweets.topic, topic),
                gte(pulseTweets.tweetCreatedAt, periodStart),
                lt(pulseTweets.tweetCreatedAt, periodEnd),
              ),
            );

          if (tweets[0] && tweets[0].count > 0) {
            await db
              .insert(pulseAggregations)
              .values({
                period: "day",
                periodStart,
                topic,
                tweetCount: tweets[0].count,
                avgSentiment: tweets[0].avgSentiment,
                totalLikes: tweets[0].totalLikes,
                totalRetweets: tweets[0].totalRetweets,
                totalImpressions: tweets[0].totalImpressions,
                computedAt: new Date(),
              })
              .onConflictDoNothing();
            dailyFilled++;
          }
        }
      }
    }

    return { reScored: reScored.scored, hourlyFilled, dailyFilled };
  }

  // ── Query methods for API ─────────────────────────────────────────────

  async function getSummary(hours = 24) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    const [countRows, sentimentRows, xrplRows] = await Promise.all([
      db.execute(sql`
        SELECT topic, COUNT(*)::int AS cnt
        FROM pulse_tweets
        WHERE tweet_created_at >= ${sinceIso}
        GROUP BY topic
      `),
      db.execute(sql`
        SELECT AVG(sentiment_score)::real AS overall
        FROM pulse_tweets
        WHERE tweet_created_at >= ${sinceIso}
          AND sentiment_score IS NOT NULL
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt
        FROM pulse_xrpl_bridge_mentions
        WHERE captured_at >= ${sinceIso}
      `),
    ]);

    const topics = asRows(countRows).map((r: any) => ({
      name: r.topic as string,
      tweetCount24h: r.cnt as number,
    }));

    topics.sort((a, b) => {
      if (a.name === "tx") return -1;
      if (b.name === "tx") return 1;
      return b.tweetCount24h - a.tweetCount24h;
    });

    const totalTweets24h = topics.reduce((sum, t) => sum + t.tweetCount24h, 0);
    const sentRows = asRows(sentimentRows);
    const xRows = asRows(xrplRows);

    return {
      topics,
      totalTweets24h,
      overallSentiment: (sentRows[0] as any)?.overall ?? 0.5,
      xrplBridgeMentions24h: (xRows[0] as any)?.cnt ?? 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async function getTrendingTweets(topic?: string, limit = 10) {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let rows;
    if (topic) {
      rows = asRows(await db.execute(sql`
        SELECT * FROM pulse_tweets
        WHERE tweet_created_at >= ${sinceIso}
          AND topic = ${topic}
        ORDER BY (metrics_likes + metrics_retweets + metrics_replies) DESC
        LIMIT ${limit}
      `));
    } else {
      rows = asRows(await db.execute(sql`
        SELECT * FROM pulse_tweets
        WHERE tweet_created_at >= ${sinceIso}
        ORDER BY (metrics_likes + metrics_retweets + metrics_replies) DESC
        LIMIT ${limit}
      `));
    }

    return rows.map((r: any) => formatTweet(r));
  }

  async function getXrplBridgeStats() {
    const oneDayAgoIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [day1, day7, stakingResult, breakdownResult] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM pulse_xrpl_bridge_mentions
        WHERE captured_at >= ${oneDayAgoIso}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM pulse_xrpl_bridge_mentions
        WHERE captured_at >= ${sevenDaysAgoIso}
      `),
      db.execute(sql`
        SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN staking_mentioned THEN 1 ELSE 0 END)::int AS staking
        FROM pulse_xrpl_bridge_mentions
        WHERE captured_at >= ${oneDayAgoIso}
      `),
      db.execute(sql`
        SELECT bridge_type, COUNT(*)::int AS cnt
        FROM pulse_xrpl_bridge_mentions
        WHERE captured_at >= ${sevenDaysAgoIso}
        GROUP BY bridge_type
      `),
    ]);

    const day1Rows = asRows(day1);
    const day7Rows = asRows(day7);
    const stakingRows = asRows(stakingResult);
    const breakdownRows = asRows(breakdownResult);

    const stakingData = stakingRows[0] as any;
    const total = stakingData?.total ?? 0;
    const staking = stakingData?.staking ?? 0;

    const breakdown: Record<string, number> = {};
    for (const r of breakdownRows as any[]) {
      breakdown[r.bridge_type] = r.cnt;
    }

    const trendingTweets = await getTrendingTweets("xrpl-bridge", 5);

    return {
      totalMentions24h: (day1Rows[0] as any)?.cnt ?? 0,
      totalMentions7d: (day7Rows[0] as any)?.cnt ?? 0,
      stakingMentionPct: total > 0 ? Math.round((staking / total) * 100) : 0,
      bridgeTypeBreakdown: breakdown,
      trendingTweets,
      promoMessage:
        "XRP holders can hold XRP on TX chain and earn staking rewards via IBC bridge. Stake with the tokns.fi validator to earn while supporting community tools.",
    };
  }

  async function getTopicBreakdown() {
    const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const rows = asRows(await db.execute(sql`
      SELECT
        topic,
        COUNT(*)::int AS tweet_count,
        AVG(sentiment_score)::real AS avg_sentiment
      FROM pulse_tweets
      WHERE tweet_created_at >= ${sinceIso}
      GROUP BY topic
      ORDER BY tweet_count DESC
    `));

    const topics = rows.map((r: any) => ({
      topic: r.topic as string,
      tweetCount: r.tweet_count as number,
      avgSentiment: r.avg_sentiment as number | null,
    }));

    topics.sort((a, b) => {
      if (a.topic === "tx") return -1;
      if (b.topic === "tx") return 1;
      return b.tweetCount - a.tweetCount;
    });

    return topics;
  }

  async function getAggregations(topic?: string, period = "hour", hours = 24) {
    const sinceIso = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

    let rows;
    if (topic) {
      rows = asRows(await db.execute(sql`
        SELECT period_start AS time, tweet_count, avg_sentiment
        FROM pulse_aggregations
        WHERE period = ${period}
          AND period_start >= ${sinceIso}
          AND topic = ${topic}
        ORDER BY period_start ASC
      `));
    } else {
      rows = asRows(await db.execute(sql`
        SELECT period_start AS time, SUM(tweet_count)::int AS tweet_count, AVG(avg_sentiment)::real AS avg_sentiment
        FROM pulse_aggregations
        WHERE period = ${period}
          AND period_start >= ${sinceIso}
        GROUP BY period_start
        ORDER BY period_start ASC
      `));
    }

    return rows.map((r: any) => ({
      time: r.time,
      tweetCount: r.tweet_count ?? 0,
      avgSentiment: r.avg_sentiment,
    }));
  }

  async function getTweets(opts: { topic?: string; page?: number; limit?: number }) {
    const { topic, page = 1, limit = 20 } = opts;
    const offset = (page - 1) * limit;

    let rows;
    if (topic) {
      rows = asRows(await db.execute(sql`
        SELECT * FROM pulse_tweets
        WHERE topic = ${topic}
        ORDER BY tweet_created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `));
    } else {
      rows = asRows(await db.execute(sql`
        SELECT * FROM pulse_tweets
        ORDER BY tweet_created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `));
    }

    return rows.map((r: any) => formatTweet(r));
  }

  return {
    pollSearches,
    scoreSentiment,
    computeAggregations,
    detectVolumeSpikes,
    tagXrplBridgeMentions,
    backfillAggregations,
    getSummary,
    getTrendingTweets,
    getXrplBridgeStats,
    getTopicBreakdown,
    getAggregations,
    getTweets,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTweet(row: any) {
  return {
    tweetId: row.tweet_id,
    authorUsername: row.author_username,
    authorName: row.author_name,
    text: row.text,
    createdAt: row.tweet_created_at,
    topic: row.topic,
    sentimentScore: row.sentiment_score,
    metrics: {
      likes: row.metrics_likes,
      retweets: row.metrics_retweets,
      replies: row.metrics_replies,
      impressions: row.metrics_impressions,
    },
  };
}
