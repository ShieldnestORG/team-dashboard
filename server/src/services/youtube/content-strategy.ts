/**
 * YouTube Pipeline — Content Strategy service
 *
 * Topic selection, pillar rotation, angle generation.
 * Pillar selection balances toward the owner's target mix (equal thirds for
 * tx_blockchain, crypto and motivation); topic selection is least-recently-used
 * within the chosen pillar so the channel stops repeating its closed topic pool.
 * Recent channel insights (persisted by analytics.ts) are injected into the
 * angle prompt to close the feedback loop.
 */

import type { Db } from "@paperclipai/db";
import { ytContentStrategies, ytAnalytics, ytKeywordPerformance, ytPublishQueue, intelReports } from "@paperclipai/db";
import { desc, eq, and, isNotNull, gte } from "drizzle-orm";
import { callLlmChat } from "../llm-client.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Niche topic pools — the channel's content pillars
// ---------------------------------------------------------------------------

export const NICHE_TOPICS: Record<string, string[]> = {
  tx_blockchain: [
    "what staking on TX actually means, and what it does not",
    "how validators and delegators split rewards on TX",
    "what tokns.fi is for: NFTs, a multi-wallet view and staking in one place",
    "unbonding periods explained: why staked coins are not instantly liquid",
    "how to check a validator before you delegate",
    "how governance votes work on TX",
    "Cosmos SDK chains in plain English, and where TX fits",
    "self-custody basics for TX: wallets, keys and seed phrases",
    "reading a block explorer for TX: transactions, validators, proposals",
    "staking rewards versus inflation: why the headline rate is not the whole story",
  ],
  crypto: [
    "how to spot a crypto scam before it costs you",
    "stablecoins explained: what backs them and what can go wrong",
    "what a crypto exchange listing actually means",
    "DeFi lending in plain English: collateral, liquidation and risk",
    "the Bitcoin halving explained without the hype",
    "hot wallets versus cold wallets: which to use for what",
    "gas fees explained: why sending crypto costs money",
    "dollar-cost averaging versus lump sum: how each one feels in a crash",
    "what a DeFi governance proposal is and who gets to vote",
    "layer 1 versus layer 2 in plain English",
  ],
  motivation: [
    "discipline beats motivation: small habits that stick",
    "sleep as a performance tool: what to change tonight",
    "a two-minute breathing reset for stress",
    "how a daily walk changes your thinking",
    "focus in a distracted world: one-task blocks",
    "money mindset without the hype: patience, habits and avoiding scams",
    "why your environment beats your willpower",
    "hard conversations: how to say the true thing kindly",
    "morning routines that are realistic, not a millionaire fantasy",
    "coherence: when your thoughts, words and actions line up",
    "building a friendship circle that makes you better",
    "rest is not lazy: recovery as part of the work",
  ],
};
export const PILLAR_TARGETS: Record<string, number> = { tx_blockchain: 1 / 3, crypto: 1 / 3, motivation: 1 / 3 };

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function getTopicHistory(db: Db): Promise<Array<{ topic: string; pillar: string; createdAt: Date }>> {
  const since = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ topic: ytContentStrategies.topic, pillar: ytContentStrategies.pillar, createdAt: ytContentStrategies.createdAt })
    .from(ytContentStrategies)
    .where(
      and(
        eq(ytContentStrategies.companyId, COMPANY_ID),
        gte(ytContentStrategies.createdAt, since),
      ),
    )
    .orderBy(desc(ytContentStrategies.createdAt));
  return rows.map((r) => ({ topic: r.topic, pillar: r.pillar, createdAt: r.createdAt }));
}

async function getRecentTitles(db: Db): Promise<string[]> {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ title: ytPublishQueue.title })
    .from(ytPublishQueue)
    .where(
      and(
        eq(ytPublishQueue.companyId, COMPANY_ID),
        gte(ytPublishQueue.createdAt, since),
      ),
    )
    .orderBy(desc(ytPublishQueue.createdAt))
    .limit(30);
  return rows.map((r) => r.title);
}

async function getCryptoSources(db: Db): Promise<Array<{ title: string; source: string; url?: string }>> {
  const since = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const rows = await db
    .select({
      headline: intelReports.headline,
      sourceUrl: intelReports.sourceUrl,
      companySlug: intelReports.companySlug,
    })
    .from(intelReports)
    .where(
      and(
        eq(intelReports.reportType, "news"),
        gte(intelReports.capturedAt, since),
      ),
    )
    .orderBy(desc(intelReports.capturedAt));

  const keyword = /(bitcoin|ethereum|solana|coinbase|binance|kraken|aave|maker|lido|chainlink|stablecoin|defi|crypto|blockchain|token)/i;
  const matches = rows.filter(
    (r) => keyword.test(r.companySlug) || keyword.test(r.headline),
  );

  return matches.slice(0, 5).map((r) => {
    let source = "";
    if (r.sourceUrl) {
      try {
        source = new URL(r.sourceUrl).hostname.replace(/^www\./, "");
      } catch {
        source = r.sourceUrl;
      }
    }
    return {
      title: r.headline,
      source,
      ...(r.sourceUrl ? { url: r.sourceUrl } : {}),
    };
  });
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
// Pillar selection — balance toward the owner's target mix, not random
// ---------------------------------------------------------------------------

export function selectPillarBalanced(
  recentPillars: string[],
  targets: Record<string, number> = PILLAR_TARGETS,
  rand: () => number = Math.random,
): string {
  const targetPillars = Object.keys(targets);
  if (targetPillars.length === 0) return "";

  // newest first; only the target pillars count (e.g. "site-walker" runs are ignored)
  const recent = recentPillars.filter((p) => p in targets).slice(0, 9);
  const n = recent.length;

  if (n === 0) {
    return targetPillars[Math.floor(rand() * targetPillars.length)];
  }

  let best: string[] = [];
  let bestDeficit = -Infinity;
  for (const pillar of targetPillars) {
    const count = recent.filter((p) => p === pillar).length;
    const deficit = targets[pillar] - count / Math.max(1, n);
    if (deficit > bestDeficit) {
      bestDeficit = deficit;
      best = [pillar];
    } else if (deficit === bestDeficit) {
      best.push(pillar);
    }
  }

  return best[Math.floor(rand() * best.length)];
}

// ---------------------------------------------------------------------------
// Topic selection — least recently used seed within the pillar
// ---------------------------------------------------------------------------

export function selectTopicLru(
  pillar: string,
  history: Array<{ topic: string; createdAt: Date }>,
  now: Date = new Date(),
): string {
  const pool = NICHE_TOPICS[pillar] || NICHE_TOPICS.crypto;

  // Never-used seeds first, in list order.
  const neverUsed = pool.find((topic) => !history.some((entry) => entry.topic === topic));
  if (neverUsed !== undefined) return neverUsed;

  // All seeds used: return the one whose most recent use is oldest.
  // Most recent use = the entry with the latest createdAt for that seed.
  const mostRecentUse = (topic: string): number => {
    let latest = Number.NEGATIVE_INFINITY;
    for (const entry of history) {
      if (entry.topic === topic && entry.createdAt.getTime() > latest) {
        latest = entry.createdAt.getTime();
      }
    }
    return latest;
  };

  let best = pool[0];
  let bestLatest = mostRecentUse(pool[0]);
  for (let i = 1; i < pool.length; i++) {
    const latest = mostRecentUse(pool[i]);
    if (latest < bestLatest) {
      best = pool[i];
      bestLatest = latest;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Angle generation — includes persisted channel insights as context
// ---------------------------------------------------------------------------

async function generateAngleWithAI(topic: string, recentInsights: string[] = [], recentTitles: string[] = []): Promise<string> {
  try {
    const year = new Date().getFullYear();
    const insightContext = recentInsights.length > 0
      ? `\nChannel performance insights to inform the angle: ${recentInsights.slice(0, 3).join("; ")}`
      : "";
    const titlesContext = recentTitles.length > 0
      ? `\nRecent titles (the angle must not resemble any of these): ${recentTitles.join(" | ")}`
      : "";
    const result = await callLlmChat(
      [
        {
          role: "system",
          content: `You generate YouTube video angles for the Coherence Daddy channel (TX blockchain ecosystem, tokns.fi, crypto news, self-improvement and mindset). Return ONLY a single-line angle (no quotes, no explanation). Current year: ${year}. The angle must be one honest, specific line. No clickbait words (Ultimate, Proven, Secret, Insane). No first-person claims ("I tried", "I tested"). No money promises. No year unless the topic is about that year. It must not resemble any of the recent titles.${insightContext}${titlesContext}`,
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
  recentTitles?: string[];
  sources?: Array<{ title: string; source: string; url?: string }>;
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
  const [topicHistory, recentTitles, recentInsights] = await Promise.all([
    getTopicHistory(db),
    getRecentTitles(db),
    getRecentInsights(db),
  ]);

  // Pillar history straight from the stored strategies (newest first).
  const recentPillars = topicHistory.map((h) => h.pillar);

  const pillar = selectPillarBalanced(recentPillars);

  const topic = requestedTopic || selectTopicLru(pillar, topicHistory);

  const sources = pillar === "crypto" ? await getCryptoSources(db) : undefined;

  const angle = await generateAngleWithAI(topic, recentInsights, recentTitles);

  const strategy: ContentStrategy = {
    topic,
    angle,
    pillar,
    contentType: selectContentType(topic),
    targetAudience: identifyTargetAudience(topic),
    keywords: extractKeywords(topic),
    estimatedViews: 5000 + Math.floor(Math.random() * 10000),
    bestPublishTime: calculateBestPublishTime(),
    recentTitles,
    ...(sources ? { sources } : {}),
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
      recentTitles: recentTitles.length,
      sources: sources?.length ?? 0,
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
