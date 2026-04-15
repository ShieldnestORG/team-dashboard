import { randomUUID } from "crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems, contentFeedback, xTweetAnalytics } from "@paperclipai/db";
import { getEmbedding } from "../intel-embeddings.js";
import { XApiClient } from "./client.js";
import { canUseDailyBudget } from "./rate-limiter.js";
import { logger } from "../../middleware/logger.js";

import * as blaze from "../../content-templates/blaze.js";
import * as cipher from "../../content-templates/cipher.js";
import * as spark from "../../content-templates/spark.js";
import * as prism from "../../content-templates/prism.js";
import * as vanguard from "../../content-templates/vanguard.js";
import * as forge from "../../content-templates/forge.js";

// ---------------------------------------------------------------------------
// X/Twitter Content Bridge
// Bridges content generation to X posting with embedding-enriched context
// and engagement feedback from tweet analytics.
// ---------------------------------------------------------------------------

import { callOllamaGenerate, OLLAMA_MODEL } from "../ollama-client.js";

const callOllama = callOllamaGenerate;
const DEFAULT_COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const PERSONALITIES: Record<string, {
  SYSTEM_PROMPT: string;
  CONTENT_TYPE_PROMPTS: Record<string, string>;
  PLATFORM_LIMITS: Record<string, number>;
}> = { blaze, cipher, spark, prism, vanguard, forge };

const MAX_TWEET_CHARS = 280;
const MAX_TWEETS_PER_DAY = 40; // maximizing content output while burning API credits

// ---------------------------------------------------------------------------
// Context fetcher — embedding-enriched intel context
// ---------------------------------------------------------------------------

async function fetchQualityContextSafe(db: Db, topic: string, limit = 5): Promise<string> {
  try {
    const { fetchQualityContext } = await import("../intel-quality.js");
    return await fetchQualityContext(db, topic, limit);
  } catch (err) {
    logger.warn({ err }, "content-bridge: quality context failed, falling back to basic");
    try {
      const queryEmbedding = await getEmbedding(topic);
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      const results = await db.execute(sql`
        SELECT r.headline, r.body, r.report_type, r.company_slug
        FROM intel_reports r
        WHERE r.embedding IS NOT NULL
          AND r.captured_at > NOW() - INTERVAL '7 days'
        ORDER BY r.embedding <=> ${embeddingStr}::vector
        LIMIT ${limit}
      `) as unknown as Array<Record<string, unknown>>;

      if (!results || results.length === 0) return "";
      const contextLines = results.map((r) => {
        const body = typeof r.body === "string" ? r.body.slice(0, 300) : "";
        return `[${r.report_type}/${r.company_slug}] ${r.headline}\n${body}`;
      });
      return `\nRelevant context from recent intel:\n${contextLines.join("\n\n")}`;
    } catch {
      return "";
    }
  }
}

// ---------------------------------------------------------------------------
// Top performing tweets — engagement signal from x_tweet_analytics
// ---------------------------------------------------------------------------

async function fetchTopPerformingTweets(db: Db, companyId: string, limit = 5): Promise<string> {
  try {
    const rows = await db
      .select({
        tweetText: xTweetAnalytics.tweetText,
        likeCount: xTweetAnalytics.likeCount,
        retweetCount: xTweetAnalytics.retweetCount,
        impressionCount: xTweetAnalytics.impressionCount,
      })
      .from(xTweetAnalytics)
      .where(eq(xTweetAnalytics.companyId, companyId))
      .orderBy(desc(xTweetAnalytics.likeCount))
      .limit(limit);

    if (rows.length === 0) return "";

    let block = "\n\n## Top Performing Tweets (engagement signal)\n";
    block += "These tweets performed well — learn from their style:\n";
    for (const row of rows) {
      const snippet = row.tweetText.slice(0, 200);
      block += `- "${snippet}" (${row.likeCount} likes, ${row.retweetCount} RTs, ${row.impressionCount} impressions)\n`;
    }
    return block;
  } catch (err) {
    logger.warn({ err }, "content-bridge: failed to fetch top performing tweets");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Admin feedback context — liked/disliked content for training
// ---------------------------------------------------------------------------

async function buildFeedbackContext(
  db: Db,
  companyId: string,
  personalityId: string,
): Promise<string> {
  try {
    const liked = await db
      .select({
        content: contentItems.content,
        comment: contentFeedback.comment,
      })
      .from(contentFeedback)
      .innerJoin(contentItems, eq(contentFeedback.contentItemId, contentItems.id))
      .where(
        and(
          eq(contentFeedback.companyId, companyId),
          eq(contentFeedback.contentType, "text"),
          eq(contentFeedback.rating, "like"),
          eq(contentItems.personalityId, personalityId),
          eq(contentItems.platform, "twitter"),
        ),
      )
      .orderBy(desc(contentFeedback.createdAt))
      .limit(3);

    const disliked = await db
      .select({
        content: contentItems.content,
        comment: contentFeedback.comment,
      })
      .from(contentFeedback)
      .innerJoin(contentItems, eq(contentFeedback.contentItemId, contentItems.id))
      .where(
        and(
          eq(contentFeedback.companyId, companyId),
          eq(contentFeedback.contentType, "text"),
          eq(contentFeedback.rating, "dislike"),
          eq(contentItems.personalityId, personalityId),
          eq(contentItems.platform, "twitter"),
        ),
      )
      .orderBy(desc(contentFeedback.createdAt))
      .limit(3);

    if (liked.length === 0 && disliked.length === 0) return "";

    let block = "\n\n## Recent Admin Feedback\n";

    if (liked.length > 0) {
      block += "### Content the admin liked:\n";
      for (const item of liked) {
        const snippet = item.content.slice(0, 200);
        const comment = item.comment ? ` — feedback: "${item.comment}"` : "";
        block += `- "${snippet}..."${comment}\n`;
      }
    }

    if (disliked.length > 0) {
      block += "### Content the admin disliked:\n";
      for (const item of disliked) {
        const snippet = item.content.slice(0, 200);
        const comment = item.comment ? ` — feedback: "${item.comment}"` : "";
        block += `- "${snippet}..."${comment}\n`;
      }
    }

    block += "\nUse this feedback to guide your tone and approach.\n";
    return block;
  } catch (err) {
    logger.warn({ err }, "content-bridge: failed to fetch feedback context");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Count today's twitter posts to enforce daily cap
// ---------------------------------------------------------------------------

async function countTodaysTweets(db: Db, companyId: string): Promise<number> {
  try {
    const rows = await db
      .select({ cnt: sql<number>`count(*)` })
      .from(contentItems)
      .where(
        and(
          eq(contentItems.companyId, companyId),
          eq(contentItems.platform, "twitter"),
          sql`${contentItems.createdAt} >= CURRENT_DATE`,
        ),
      );
    return Number(rows[0]?.cnt ?? 0);
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a tweet using Ollama with embedding-enriched context and engagement feedback.
 * 1. Get embedding for topic via getEmbedding()
 * 2. Query intel_reports for relevant context (quality-filtered)
 * 3. Fetch top 5 performing tweets from x_tweet_analytics for "what works" signal
 * 4. Fetch recent 3 liked + 3 disliked from content_feedback for training signal
 * 5. Build enhanced prompt with all context
 * 6. Call Ollama to generate tweet text (max 280 chars)
 * 7. Store in content_items table (platform: 'twitter', status: 'draft')
 * 8. Return the content item
 */
export async function generateTweetWithContext(
  db: Db,
  topic: string,
  personality: string,
  companyId: string,
): Promise<{ id: string; content: string; topic: string }> {
  const personaConfig = PERSONALITIES[personality];
  if (!personaConfig) {
    throw new Error(`Unknown personality: ${personality}. Valid: ${Object.keys(PERSONALITIES).join(", ")}`);
  }

  // Gather all context in parallel
  const [intelContext, topTweets, feedbackCtx] = await Promise.all([
    fetchQualityContextSafe(db, topic),
    fetchTopPerformingTweets(db, companyId),
    buildFeedbackContext(db, companyId, personality),
  ]);

  // Build the full prompt with all signals
  const systemPrompt = personaConfig.SYSTEM_PROMPT.replace("{CONTEXT}", intelContext);
  const tweetTypePrompt = personaConfig.CONTENT_TYPE_PROMPTS["tweet"] || "Write a single tweet under 280 characters.";

  const fullPrompt = [
    systemPrompt,
    topTweets,
    feedbackCtx,
    "",
    tweetTypePrompt,
    "",
    `IMPORTANT: The tweet MUST be under ${MAX_TWEET_CHARS} characters. Count carefully.`,
    "When relevant, mention 1-2 ecosystem accounts WITH CONTEXT about what they do:",
    "- @txEcosystem — the TX blockchain L1 (Cosmos SDK, IBC-enabled)",
    "- @tokns_fi — TX portfolio tracker, NFT marketplace, staking, swaps at app.tokns.fi",
    "- @txDevHub — TX developer tools, SDKs, and technical infrastructure built on TX",
    "Reference what they're building, not just the handle. Don't force all three into one tweet.",
    `Topic: ${topic}`,
  ].join("\n");

  // Call Ollama
  let generatedText = await callOllama(fullPrompt);

  // Truncate if over limit (Ollama sometimes exceeds)
  if (generatedText.length > MAX_TWEET_CHARS) {
    generatedText = generatedText.slice(0, MAX_TWEET_CHARS - 1) + "\u2026";
  }

  const charCount = generatedText.length;
  const charLimit = personaConfig.PLATFORM_LIMITS["tweet"] || MAX_TWEET_CHARS;

  // Store in database
  const contentId = randomUUID();
  await db.insert(contentItems).values({
    id: contentId,
    companyId,
    personalityId: personality,
    contentType: "tweet",
    platform: "twitter",
    status: "draft",
    content: generatedText,
    topic,
    contextQuery: topic,
    model: OLLAMA_MODEL,
    charCount,
    charLimit,
    reviewStatus: "pending",
  });

  logger.info(
    { contentId, personality, topic, charCount, withinLimit: charCount <= charLimit },
    "content-bridge: tweet generated with enriched context",
  );

  return { id: contentId, content: generatedText, topic };
}

/**
 * Generate a contextual reply for engagement.
 * 1. Get embedding for the tweet text
 * 2. Find related intel context
 * 3. Use personality prompt to craft a reply (max 280 chars)
 * 4. Return reply text (NOT stored in content_items -- used directly by engagement engine)
 */
export async function generateEngagementReply(
  db: Db,
  tweetText: string,
  tweetAuthor: string,
  personality: string,
): Promise<string> {
  const personaConfig = PERSONALITIES[personality];
  if (!personaConfig) {
    throw new Error(`Unknown personality: ${personality}. Valid: ${Object.keys(PERSONALITIES).join(", ")}`);
  }

  // Get related intel context for the reply
  const intelContext = await fetchQualityContextSafe(db, tweetText, 3);

  const systemPrompt = personaConfig.SYSTEM_PROMPT.replace("{CONTEXT}", intelContext);

  const replyPrompt = [
    systemPrompt,
    "",
    "You are replying to a tweet to engage meaningfully in conversation.",
    `Original tweet by @${tweetAuthor}: "${tweetText}"`,
    "",
    "Write a thoughtful, engaging reply. Be conversational and add value.",
    "Do NOT repeat the original tweet. Add a unique perspective or insight.",
    `IMPORTANT: The reply MUST be under ${MAX_TWEET_CHARS} characters.`,
  ].join("\n");

  let reply = await callOllama(replyPrompt);

  // Truncate if over limit
  if (reply.length > MAX_TWEET_CHARS) {
    reply = reply.slice(0, MAX_TWEET_CHARS - 1) + "\u2026";
  }

  logger.info(
    { personality, tweetAuthor, replyLength: reply.length },
    "content-bridge: engagement reply generated",
  );

  return reply;
}

/**
 * Auto-generate and queue a tweet for posting.
 * Combines generateTweetWithContext + daily cap enforcement.
 * Called by content crons.
 */
export async function autoGenerateAndQueue(
  db: Db,
  personality: string,
  companyId: string,
  topic?: string,
  accountSlug = "primary",
): Promise<void> {
  // Check daily cap
  const todayCount = await countTodaysTweets(db, companyId);
  if (todayCount >= MAX_TWEETS_PER_DAY) {
    logger.info(
      { todayCount, maxPerDay: MAX_TWEETS_PER_DAY },
      "content-bridge: daily tweet cap reached, skipping auto-generate",
    );
    return;
  }

  // Pick topic if not provided
  let resolvedTopic = topic;
  if (!resolvedTopic) {
    // Lazy import to avoid circular dependency with content-crons
    const { pickTopicForBridge } = await import("./content-bridge-topics.js");
    resolvedTopic = await pickTopicForBridge(db);
  }

  const result = await generateTweetWithContext(db, resolvedTopic, personality, companyId);

  // Auto-post if X API budget allows
  const budget = canUseDailyBudget("post");
  if (budget.allowed) {
    try {
      const client = new XApiClient(db, companyId, accountSlug);
      const tweetResult = await client.createTweet({ text: result.content });
      const tweetId = tweetResult?.data?.id;

      // Update status to published
      await db
        .update(contentItems)
        .set({ status: "published", publishedAt: new Date(), updatedAt: new Date() })
        .where(eq(contentItems.id, result.id));

      logger.info(
        { contentId: result.id, tweetId, personality, topic: result.topic, todayCount: todayCount + 1, remaining: budget.remaining - 1 },
        "content-bridge: tweet posted to X",
      );
    } catch (postErr) {
      logger.warn(
        { err: postErr, contentId: result.id, personality },
        "content-bridge: failed to post tweet — stays as draft",
      );
    }
  } else {
    logger.info(
      { contentId: result.id, personality, remaining: budget.remaining },
      "content-bridge: daily budget exhausted — tweet saved as draft",
    );
  }
}
