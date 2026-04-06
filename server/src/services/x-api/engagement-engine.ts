// ---------------------------------------------------------------------------
// X API — engagement engine
// ---------------------------------------------------------------------------
// Main engagement cycle runner. Called by the plugin's engagement-cycle job.
// Loads active targets, scores tweets by embedding similarity to brand topics,
// and executes like/follow/reply actions with human-like timing.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { xEngagementLog } from "@paperclipai/db";
import { sql, and, eq, gte, count } from "drizzle-orm";
import { logger } from "../../middleware/logger.js";
import { getEmbedding, getEmbeddings } from "../intel-embeddings.js";
import { canUseDailyBudget } from "./rate-limiter.js";
import { jitteredDelay, breathingPause, shouldBreathingPause, isWithinActiveHours, pickRandom } from "./timing.js";
import type { XApiClient } from "./client.js";

// ---------------------------------------------------------------------------
// Brand topics for scoring tweet relevance
// ---------------------------------------------------------------------------

const BRAND_TOPICS = [
  "web3",
  "privacy",
  "blockchain",
  "self-help",
  "coherence",
  "security",
  "crypto",
  "personal development",
];

const BRAND_TOPICS_TEXT = BRAND_TOPICS.join(" ");

// Cache the brand embedding so we only compute it once per process
let cachedBrandEmbedding: number[] | null = null;

async function getBrandEmbedding(): Promise<number[]> {
  if (cachedBrandEmbedding) return cachedBrandEmbedding;
  cachedBrandEmbedding = await getEmbedding(BRAND_TOPICS_TEXT);
  return cachedBrandEmbedding;
}

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ---------------------------------------------------------------------------
// Target data shape (mirrors plugin types — kept minimal to avoid cross-pkg import)
// ---------------------------------------------------------------------------

export interface EngagementTarget {
  handle: string;
  displayName?: string;
  profileUrl: string;
  engageActions: string[];       // e.g. ["LIKE", "FOLLOW", "REPLY"]
  userId?: string;               // X user ID — may not be present
  venture: string;
  engagementCount: number;
  lastEngagedAt?: string;
}

// ---------------------------------------------------------------------------
// Score a tweet for engagement relevance
// ---------------------------------------------------------------------------

/**
 * Score a tweet for engagement relevance using BGE-M3 embedding similarity
 * against the brand topics vector. Returns 0.0–1.0.
 */
export async function scoreEngagementCandidate(tweetText: string): Promise<number> {
  try {
    const [tweetEmb, brandEmb] = await Promise.all([
      getEmbedding(tweetText),
      getBrandEmbedding(),
    ]);
    return Math.max(0, Math.min(1, cosineSimilarity(tweetEmb, brandEmb)));
  } catch (err) {
    logger.warn({ err }, "Embedding scoring failed — returning default 0.5");
    return 0.5;
  }
}

/**
 * Score multiple tweets in a single batch embedding call.
 */
async function scoreTweetsBatch(
  tweets: Array<{ id: string; text: string }>,
): Promise<Array<{ id: string; text: string; score: number }>> {
  if (tweets.length === 0) return [];

  try {
    const texts = tweets.map((t) => t.text);
    const [embeddings, brandEmb] = await Promise.all([
      getEmbeddings(texts),
      getBrandEmbedding(),
    ]);

    return tweets.map((t, i) => ({
      ...t,
      score: Math.max(0, Math.min(1, cosineSimilarity(embeddings[i], brandEmb))),
    }));
  } catch (err) {
    logger.warn({ err }, "Batch embedding scoring failed — returning default 0.5");
    return tweets.map((t) => ({ ...t, score: 0.5 }));
  }
}

// ---------------------------------------------------------------------------
// Log an engagement action
// ---------------------------------------------------------------------------

export async function logEngagement(
  db: Db,
  companyId: string,
  action: string,
  targetTweetId: string | null,
  targetUserId: string | null,
  targetUsername: string | null,
  success: boolean,
  error: string | null,
  apiResponseMs: number,
  rateLimitRemaining: number | null,
  embeddingScore: number | null,
): Promise<void> {
  try {
    await db.insert(xEngagementLog).values({
      companyId,
      action,
      targetTweetId,
      targetUserId,
      targetUsername,
      success,
      error,
      apiResponseMs,
      rateLimitRemaining,
      embeddingScore,
    });
  } catch (err) {
    logger.error({ err, action, targetUsername }, "Failed to log engagement action");
  }
}

// ---------------------------------------------------------------------------
// Diversity check — max engagements per author per day
// ---------------------------------------------------------------------------

const MAX_ENGAGEMENTS_PER_AUTHOR_PER_DAY = 3;

async function getAuthorEngagementsToday(
  db: Db,
  companyId: string,
  username: string,
): Promise<number> {
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const result = await db
    .select({ cnt: count() })
    .from(xEngagementLog)
    .where(
      and(
        eq(xEngagementLog.companyId, companyId),
        eq(xEngagementLog.targetUsername, username),
        eq(xEngagementLog.success, true),
        gte(xEngagementLog.executedAt, todayStart),
      ),
    );

  return result[0]?.cnt ?? 0;
}

// ---------------------------------------------------------------------------
// Main engagement cycle
// ---------------------------------------------------------------------------

export interface EngagementCycleResult {
  actionsExecuted: number;
  errors: number;
}

/**
 * Run one engagement cycle.
 *
 * 1. Check if we're within active hours
 * 2. For each target (while budget remains):
 *    a. Fetch recent tweets via xApiClient.getUserTweets(targetUserId, 5)
 *    b. Score each tweet by embedding similarity to brand topics
 *    c. Pick best tweet to engage with
 *    d. Execute action (like, follow, reply) based on target's engageActions config
 *    e. Log to x_engagement_log table
 *    f. Apply jittered delay (2-8 seconds between actions)
 *    g. Every 3-5 actions, take a breathing pause (15-45 seconds)
 * 3. Return summary of actions taken
 */
export async function runEngagementCycle(
  db: Db,
  companyId: string,
  targets: EngagementTarget[],
  xApiClient: XApiClient,
): Promise<EngagementCycleResult> {
  const result: EngagementCycleResult = { actionsExecuted: 0, errors: 0 };

  if (targets.length === 0) {
    return result;
  }

  // Don't engage outside active hours
  if (!isWithinActiveHours(9, 21)) {
    logger.info("Engagement engine: outside active hours (9-21 UTC), skipping cycle");
    return result;
  }

  // Shuffle targets so we don't always engage the same ones first
  const shuffled = [...targets].sort(() => Math.random() - 0.5);

  let consecutiveActions = 0;

  for (const target of shuffled) {
    // Check diversity — max engagements per author per day
    const todayCount = await getAuthorEngagementsToday(db, companyId, target.handle);
    if (todayCount >= MAX_ENGAGEMENTS_PER_AUTHOR_PER_DAY) {
      logger.info(
        { handle: target.handle, todayCount },
        "Engagement engine: daily diversity limit reached for target, skipping",
      );
      continue;
    }

    // Determine which actions to attempt for this target
    const actionsToTry = target.engageActions.filter((a) => {
      const budgetMap: Record<string, "like" | "follow" | "reply" | "post"> = {
        LIKE: "like",
        FOLLOW: "follow",
        REPLY: "reply",
        REPOST: "post",
      };
      const budgetKey = budgetMap[a];
      if (!budgetKey) return false;
      const budget = canUseDailyBudget(budgetKey);
      return budget.allowed;
    });

    if (actionsToTry.length === 0) {
      continue;
    }

    // Pick one action to perform this cycle
    const actionType = pickRandom(actionsToTry);

    // We need a userId to fetch tweets or follow
    if (!target.userId) {
      // Try to resolve userId via the client
      try {
        // getUserTweets needs a userId; we can try looking up by username
        // X API v2 free tier doesn't have user lookup by username,
        // so we skip targets without userId
        logger.info(
          { handle: target.handle },
          "Engagement engine: target has no userId, skipping",
        );
        continue;
      } catch {
        continue;
      }
    }

    const start = Date.now();

    try {
      if (actionType === "FOLLOW") {
        // Follow doesn't need tweets — just follow the user
        await xApiClient.followUser(target.userId);
        const elapsed = Date.now() - start;

        await logEngagement(
          db, companyId, "follow",
          null, target.userId, target.handle,
          true, null, elapsed, null, null,
        );

        logger.info({ handle: target.handle, elapsed }, "Engagement engine: followed user");
        result.actionsExecuted++;
        consecutiveActions++;
      } else if (actionType === "LIKE" || actionType === "REPLY" || actionType === "REPOST") {
        // Fetch recent tweets from this target
        const tweetsRes = await xApiClient.getUserTweets(target.userId, 5);
        const tweets = tweetsRes.data ?? [];

        if (tweets.length === 0) {
          logger.info({ handle: target.handle }, "Engagement engine: no recent tweets found");
          continue;
        }

        // Score tweets by relevance
        const scored = await scoreTweetsBatch(
          tweets.map((t) => ({ id: t.id, text: t.text })),
        );

        // Sort by score descending and pick the best
        scored.sort((a, b) => b.score - a.score);
        const bestTweet = scored[0];

        // Minimum score threshold — don't engage with irrelevant content
        if (bestTweet.score < 0.15) {
          logger.info(
            { handle: target.handle, bestScore: bestTweet.score },
            "Engagement engine: no tweet above relevance threshold",
          );
          continue;
        }

        if (actionType === "LIKE") {
          await xApiClient.likeTweet(bestTweet.id);
          const elapsed = Date.now() - start;

          await logEngagement(
            db, companyId, "like",
            bestTweet.id, target.userId, target.handle,
            true, null, elapsed, null, bestTweet.score,
          );

          logger.info(
            { handle: target.handle, tweetId: bestTweet.id, score: bestTweet.score, elapsed },
            "Engagement engine: liked tweet",
          );
          result.actionsExecuted++;
          consecutiveActions++;
        } else if (actionType === "REPLY") {
          // Generate a brief, relevant reply based on the tweet content
          const replyText = generateQuickReply(bestTweet.text);

          await xApiClient.createTweet({
            text: replyText,
            replyTo: bestTweet.id,
          });
          const elapsed = Date.now() - start;

          await logEngagement(
            db, companyId, "reply",
            bestTweet.id, target.userId, target.handle,
            true, null, elapsed, null, bestTweet.score,
          );

          logger.info(
            { handle: target.handle, tweetId: bestTweet.id, score: bestTweet.score, elapsed },
            "Engagement engine: replied to tweet",
          );
          result.actionsExecuted++;
          consecutiveActions++;
        } else if (actionType === "REPOST") {
          // Retweet — use the createTweet with quoteOf for a quote-retweet approach
          // or plain retweet. Use quote to add value.
          await xApiClient.createTweet({
            text: "",
            quoteOf: bestTweet.id,
          });
          const elapsed = Date.now() - start;

          await logEngagement(
            db, companyId, "repost",
            bestTweet.id, target.userId, target.handle,
            true, null, elapsed, null, bestTweet.score,
          );

          logger.info(
            { handle: target.handle, tweetId: bestTweet.id, score: bestTweet.score, elapsed },
            "Engagement engine: reposted tweet",
          );
          result.actionsExecuted++;
          consecutiveActions++;
        }
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      const errorMsg = err instanceof Error ? err.message : String(err);

      await logEngagement(
        db, companyId, actionType.toLowerCase(),
        null, target.userId, target.handle,
        false, errorMsg, elapsed, null, null,
      );

      logger.error(
        { handle: target.handle, actionType, err: errorMsg },
        "Engagement engine: action failed",
      );
      result.errors++;

      // If we hit a rate limit error, stop the cycle entirely
      if (errorMsg.includes("rate limit") || errorMsg.includes("429")) {
        logger.warn("Engagement engine: rate limit hit, stopping cycle early");
        break;
      }
    }

    // Jittered delay between actions (2-8 seconds)
    await jitteredDelay(2000, 8000);

    // Breathing pause every 3-5 actions
    if (shouldBreathingPause(consecutiveActions, 3, 5)) {
      logger.info(
        { consecutiveActions },
        "Engagement engine: taking breathing pause",
      );
      await breathingPause(15, 45);
      consecutiveActions = 0;
    }
  }

  logger.info(
    { actionsExecuted: result.actionsExecuted, errors: result.errors },
    "Engagement engine: cycle complete",
  );

  return result;
}

// ---------------------------------------------------------------------------
// Quick reply generation (simple template-based, no LLM call)
// ---------------------------------------------------------------------------

const REPLY_TEMPLATES = [
  "Great point! This aligns well with what we're seeing in the space.",
  "Interesting perspective on this. The privacy implications are worth watching.",
  "Solid thread. The ecosystem keeps maturing.",
  "This is an important development. Thanks for highlighting it.",
  "Well said. The intersection of security and usability is key.",
  "Appreciate the insight here. Lots of builders working on this.",
  "Good take. The community really needs more conversations like this.",
  "This resonates. Building in public is how we move forward together.",
];

function generateQuickReply(tweetText: string): string {
  // Simple template selection — pick a random reply
  // In a future version this could use Ollama for contextual replies
  return pickRandom(REPLY_TEMPLATES);
}
