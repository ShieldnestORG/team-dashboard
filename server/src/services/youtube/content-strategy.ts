/**
 * YouTube Pipeline — Content Strategy service
 *
 * Topic selection, pillar rotation, angle generation.
 * Uses Ollama instead of Anthropic/Grok for AI-powered strategy.
 */

import type { Db } from "@paperclipai/db";
import { ytContentStrategies, ytAnalytics } from "@paperclipai/db";
import { desc, sql, eq } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// Topic selection
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

function selectPillar(): string {
  const pillars = Object.keys(NICHE_TOPICS);
  return pillars[Math.floor(Math.random() * pillars.length)];
}

function selectTopic(pillar: string, recentTopics: string[]): string {
  const pool = NICHE_TOPICS[pillar] || NICHE_TOPICS.crypto;
  const unused = pool.filter((t) => !recentTopics.includes(t));
  return unused[Math.floor(Math.random() * unused.length)] || pool[0];
}

// ---------------------------------------------------------------------------
// Angle generation via Ollama
// ---------------------------------------------------------------------------

async function generateAngleWithAI(topic: string): Promise<string> {
  try {
    const year = new Date().getFullYear();
    const result = await callOllamaChat(
      [
        {
          role: "system",
          content: `You generate YouTube video angles for the Tokns.fi channel. Return ONLY a single-line angle (no quotes, no explanation). Current year: ${year}. The angle should be compelling and click-worthy while being honest.`,
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

  if (/\bvs\.?\b|\bversus\b/i.test(topic)) {
    return `${topic}: The Real Difference in ${year}`;
  }
  if (/^how to /i.test(topic)) {
    return `${topic} (Step-by-Step Guide)`;
  }
  if (/price|prediction|bull run/i.test(t)) {
    return `${topic}: What the Data Actually Shows`;
  }
  if (/mindset|motivat|discipline/i.test(t)) {
    return `${topic} — This One Shift Changes Everything`;
  }
  if (/\btx\b|tokns|coherence/i.test(t)) {
    return `${topic}: What You Need to Know in ${year}`;
  }
  return `${topic}: The Honest Guide (${year})`;
}

// ---------------------------------------------------------------------------
// Content type selection
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
  const currentDay = now.getDay();
  const daysUntil = (selected.day - currentDay + 7) % 7 || 7;
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
  // Site-walker mode: topic is a URL
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

  const recentTopics = await getRecentTopics(db);
  const pillar = selectPillar();
  const topic = requestedTopic || selectTopic(pillar, recentTopics);
  const angle = await generateAngleWithAI(topic);

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

  // Save to database
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

  logger.info({ topic, pillar, contentType: strategy.contentType }, "Content strategy generated");
  return strategy;
}

function extractHostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
