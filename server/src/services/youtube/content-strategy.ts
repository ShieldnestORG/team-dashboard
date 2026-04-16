/**
 * YouTube Pipeline — Content Strategy service
 *
 * Topic selection, pillar rotation, angle generation.
 * Pillar and topic selection are weighted by yt_keyword_performance so the
 * pipeline naturally gravitates toward what the audience actually watches.
 * Recent channel insights (persisted by analytics.ts) are injected into the
 * angle prompt to close the feedback loop.
 */

import type { Db } from "@paperclipai/db";
import { ytContentStrategies, ytAnalytics, ytKeywordPerformance } from "@paperclipai/db";
import { desc, eq, and, isNotNull } from "drizzle-orm";
import { callOllamaChat } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Niche topic pools — the channel's content pillars
// ---------------------------------------------------------------------------

const NICHE_TOPICS: Record<string, string[]> = {
  crypto: [
    "Bitcoin price prediction 2026",
    "how to buy crypto for beginners",
    "crypto bull run signals to watch",
    "best altcoins to buy right now",
    "crypto portfolio strategy beginners",
    "Bitcoin vs Ethereum which is better",
    "DeFi explained simply",
    "crypto passive income strategies",
    "how to read crypto charts",
    "crypto mistakes beginners make",
  ],
  tx_blockchain: [
    "TX blockchain explained",
    "TX ecosystem coins to watch",
    "TX ecosystem hidden gems 2026",
    "tokns.fi how it works",
    "TX blockchain vs Ethereum",
    "TX ecosystem staking guide",
    "coherencedaddy crypto picks",
    "TX blockchain use cases real world",
    "how to stake on TX ecosystem",
    "TX ecosystem growth potential",
  ],
  motivation: [
    "how to stay motivated every day",
    "morning routine millionaires follow",
    "mindset shifts that change your life",
    "discipline over motivation explained",
    "how successful people think differently",
    "stop procrastinating for good",
    "building wealth from zero",
    "crypto millionaire mindset",
    "financial freedom roadmap 2026",
    "how to think like an investor",
  ],
};

// Keywords that identify a pillar — used for performance-weighted selection
const PILLAR_SIGNALS: Record<string, RegExp> = {
  crypto: /bitcoin|ethereum|crypto|defi|altcoin|nft|blockchain|staking|token/i,
  tx_blockchain: /\btx\b|tokns|coherence/i,
  motivation: /motivat|mindset|discipline|wealth|freedom|success|millionaire|investor/i,
};

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getRecentTopics(db: Db): Promise<string[]> {
  const rows = await db
    .select({ topic: ytContentStrategies.topic })
    .from(ytContentStrategies)
    .where(eq(ytContentStrategies.companyId, COMPANY_ID))
    .orderBy(desc(ytContentStrategies.createdAt))
    .limit(20);
  return rows.map((r) => r.topic);
}

async function getTopKeywords(db: Db): Promise<Array<{ keyword: string; performanceScore: number }>> {
  const rows = await db
    .select({
      keyword: ytKeywordPerformance.keyword,
      performanceScore: ytKeywordPerformance.performanceScore,
    })
    .from(ytKeywordPerformance)
    .where(eq(ytKeywordPerformance.companyId, COMPANY_ID))
    .orderBy(desc(ytKeywordPerformance.performanceScore))
    .limit(20);
  return rows.map((r) => ({ keyword: r.keyword, performanceScore: r.performanceScore ?? 0 }));
}

async function getRecentInsights(db: Db): Promise<string[]> {
  const rows = await db
    .select({ insights: ytAnalytics.insights })
    .from(ytAnalytics)
    .where(
      and(
        eq(ytAnalytics.companyId, COMPANY_ID),
        isNotNull(ytAnalytics.insights),
      ),
    )
    .orderBy(desc(ytAnalytics.analyzedAt))
    .limit(3);

  const all: string[] = [];
  for (const row of rows) {
    if (Array.isArray(row.insights)) all.push(...(row.insights as string[]));
  }
  // Deduplicate and cap to 5 so the prompt stays concise
  return [...new Set(all)].slice(0, 5);
}

// ---------------------------------------------------------------------------
// Pillar selection — random fallback, performance-weighted when data exists
// ---------------------------------------------------------------------------

function selectPillar(): string {
  const pillars = Object.keys(NICHE_TOPICS);
  return pillars[Math.floor(Math.random() * pillars.length)];
}

function selectPillarWeighted(
  topKeywords: Array<{ keyword: string; performanceScore: number }>,
): string {
  if (topKeywords.length === 0) return selectPillar();

  const scores: Record<string, number> = { crypto: 0, tx_blockchain: 0, motivation: 0 };

  for (const { keyword, performanceScore } of topKeywords) {
    for (const [pillar, signal] of Object.entries(PILLAR_SIGNALS)) {
      if (signal.test(keyword)) scores[pillar] += performanceScore;
    }
  }

  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  if (total === 0) return selectPillar();

  // Weighted random pick — pillars with more proven keywords win more often
  let rand = Math.random() * total;
  for (const [pillar, score] of Object.entries(scores)) {
    rand -= score;
    if (rand <= 0) return pillar;
  }
  return selectPillar();
}

// ---------------------------------------------------------------------------
// Topic selection — prefer unused topics, bias toward keyword-proven ones
// ---------------------------------------------------------------------------

function selectTopic(pillar: string, recentTopics: string[]): string {
  const pool = NICHE_TOPICS[pillar] || NICHE_TOPICS.crypto;
  const unused = pool.filter((t) => !recentTopics.includes(t));
  const candidates = unused.length > 0 ? unused : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function selectTopicWeighted(
  pillar: string,
  recentTopics: string[],
  topKeywords: Array<{ keyword: string; performanceScore: number }>,
): string {
  const pool = NICHE_TOPICS[pillar] || NICHE_TOPICS.crypto;
  const candidates = pool.filter((t) => !recentTopics.includes(t));
  const topics = candidates.length > 0 ? candidates : pool;

  if (topKeywords.length === 0) {
    return topics[Math.floor(Math.random() * topics.length)];
  }

  const kwScoreMap = new Map(
    topKeywords.map((k) => [k.keyword.toLowerCase(), k.performanceScore]),
  );

  // Score each topic by how many of its words match proven keywords
  const scored = topics.map((topic) => {
    const words = topic.toLowerCase().split(/\s+/);
    const score = words.reduce((sum, word) => sum + (kwScoreMap.get(word) ?? 0), 0);
    return { topic, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Weighted random from top 3 so the best topic wins most often but not always
  const topN = scored.slice(0, 3);
  const total = topN.reduce((s, t) => s + t.score + 1, 0);
  let rand = Math.random() * total;
  for (const { topic, score } of topN) {
    rand -= score + 1;
    if (rand <= 0) return topic;
  }
  return topics[0];
}

// ---------------------------------------------------------------------------
// Angle generation — includes persisted channel insights as context
// ---------------------------------------------------------------------------

async function generateAngleWithAI(topic: string, recentInsights: string[] = []): Promise<string> {
  try {
    const year = new Date().getFullYear();
    const insightContext = recentInsights.length > 0
      ? `\nChannel performance insights to inform the angle: ${recentInsights.slice(0, 3).join("; ")}`
      : "";
    const result = await callOllamaChat(
      [
        {
          role: "system",
          content: `You generate YouTube video angles for the Tokns.fi channel. Return ONLY a single-line angle (no quotes, no explanation). Current year: ${year}. The angle should be compelling and click-worthy while being honest.${insightContext}`,
        },
        {
          role: "user",
          content: `Generate a compelling YouTube video angle for the topic: "${topic}"`,
        },
      ],
      { temperature: 0.9, maxTokens: 100 },
    );
    const angle = result.content.trim().replace(/^["']|["']$/g, "");
    if (angle.length > 5) return angle;
  } catch (e) {
    logger.warn({ err: e }, "Ollama angle generation failed, using template");
  }
  return generateAngleFallback(topic);
}

function generateAngleFallback(topic: string): string {
  const year = new Date().getFullYear();
  const t = topic.toLowerCase();

  if (/\bvs\.?\b|\bversus\b/i.test(topic)) return `${topic}: The Real Difference in ${year}`;
  if (/^how to /i.test(topic)) return `${topic} (Step-by-Step Guide)`;
  if (/price|prediction|bull run/i.test(t)) return `${topic}: What the Data Actually Shows`;
  if (/mindset|motivat|discipline/i.test(t)) return `${topic} — This One Shift Changes Everything`;
  if (/\btx\b|tokns|coherence/i.test(t)) return `${topic}: What You Need to Know in ${year}`;
  return `${topic}: The Honest Guide (${year})`;
}

// ---------------------------------------------------------------------------
// Content type / audience helpers
// ---------------------------------------------------------------------------

function selectContentType(topic: string): string {
  const t = topic.toLowerCase();
  if (/how to|guide|learn/.test(t)) return "Tutorial";
  if (/best|top|worst/.test(t)) return "List";
  if (/review|vs|comparison/.test(t)) return "Review";
  if (/what is|why|explained/.test(t)) return "Explainer";
  if (/story|journey/.test(t)) return "Story";
  return "Explainer";
}

function identifyTargetAudience(topic: string): string {
  const t = topic.toLowerCase();
  if (/crypto|blockchain|defi|bitcoin|altcoin|staking/.test(t)) {
    return "Tech enthusiasts, crypto investors, developers";
  }
  if (/motivat|mindset|discipline|wealth|freedom/.test(t)) {
    return "Self-improvement seekers, aspiring investors";
  }
  return "General audience, crypto-curious individuals";
}

function extractKeywords(topic: string): string[] {
  const stopWords = new Set([
    "the", "is", "at", "which", "on", "and", "a", "an", "for", "to", "in",
    "of", "how", "what", "why", "you", "your", "this", "that", "with",
  ]);
  return topic
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w));
}

function calculateBestPublishTime(): string {
  const bestTimes = [
    { day: 2, hour: 14 }, // Tuesday 2pm
    { day: 3, hour: 14 }, // Wednesday 2pm
    { day: 4, hour: 14 }, // Thursday 2pm
    { day: 5, hour: 15 }, // Friday 3pm
    { day: 6, hour: 10 }, // Saturday 10am
    { day: 0, hour: 10 }, // Sunday 10am
  ];
  const selected = bestTimes[Math.floor(Math.random() * bestTimes.length)];
  const now = new Date();
  const daysUntil = (selected.day - now.getDay() + 7) % 7 || 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  next.setHours(selected.hour, 0, 0, 0);
  return next.toISOString();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ContentStrategy {
  topic: string;
  angle: string;
  pillar: string;
  contentType: string;
  targetAudience: string;
  keywords: string[];
  estimatedViews: number;
  bestPublishTime: string;
}

export async function generateContentStrategy(
  db: Db,
  requestedTopic?: string,
): Promise<ContentStrategy> {
  // Site-walker mode: topic is a URL — skip the performance weighting
  const isUrl = requestedTopic && /^https?:\/\//.test(requestedTopic);
  if (isUrl) {
    const topic = requestedTopic;
    const hostname = extractHostnameFromUrl(topic);
    const angle = await generateAngleWithAI(`Website walkthrough and review of ${hostname}`);

    const strategy: ContentStrategy = {
      topic,
      angle,
      pillar: "site-walker",
      contentType: "Review",
      targetAudience: "Tech enthusiasts, web users, potential customers",
      keywords: [hostname, ...hostname.split(".")[0].split("-"), "website review", "walkthrough"],
      estimatedViews: 5000 + Math.floor(Math.random() * 10000),
      bestPublishTime: calculateBestPublishTime(),
    };

    await db.insert(ytContentStrategies).values({
      companyId: COMPANY_ID,
      topic: strategy.topic,
      angle: strategy.angle,
      pillar: strategy.pillar,
      contentType: strategy.contentType,
      targetAudience: strategy.targetAudience,
      keywords: strategy.keywords,
      estimatedViews: strategy.estimatedViews,
      bestPublishTime: new Date(strategy.bestPublishTime),
    });

    logger.info({ topic: hostname, pillar: "site-walker" }, "Site-walker content strategy generated");
    return strategy;
  }

  // Fetch all data-driven signals in parallel
  const [recentTopics, topKeywords, recentInsights] = await Promise.all([
    getRecentTopics(db),
    getTopKeywords(db),
    getRecentInsights(db),
  ]);

  const pillar = topKeywords.length > 0
    ? selectPillarWeighted(topKeywords)
    : selectPillar();

  const topic = requestedTopic || (
    topKeywords.length > 0
      ? selectTopicWeighted(pillar, recentTopics, topKeywords)
      : selectTopic(pillar, recentTopics)
  );

  const angle = await generateAngleWithAI(topic, recentInsights);

  const strategy: ContentStrategy = {
    topic,
    angle,
    pillar,
    contentType: selectContentType(topic),
    targetAudience: identifyTargetAudience(topic),
    keywords: extractKeywords(topic),
    estimatedViews: 5000 + Math.floor(Math.random() * 10000),
    bestPublishTime: calculateBestPublishTime(),
  };

  await db.insert(ytContentStrategies).values({
    companyId: COMPANY_ID,
    topic: strategy.topic,
    angle: strategy.angle,
    pillar: strategy.pillar,
    contentType: strategy.contentType,
    targetAudience: strategy.targetAudience,
    keywords: strategy.keywords,
    estimatedViews: strategy.estimatedViews,
    bestPublishTime: new Date(strategy.bestPublishTime),
  });

  logger.info(
    {
      topic,
      pillar,
      contentType: strategy.contentType,
      dataWeighted: topKeywords.length > 0,
      insightsAvailable: recentInsights.length,
    },
    "Content strategy generated",
  );
  return strategy;
}

function extractHostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
