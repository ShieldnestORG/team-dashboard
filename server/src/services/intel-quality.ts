import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Intel Quality Service
// Scores, deduplicates, and filters intel reports for relevance and quality.
// Applied during ingestion and content generation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. SEMANTIC DEDUPLICATION
// Skip reports that are >90% similar to an existing report for the same company
// ---------------------------------------------------------------------------

const DEDUP_SIMILARITY_THRESHOLD = 0.90;

export async function isDuplicate(
  db: Db,
  companySlug: string,
  embeddingStr: string,
  reportType: string,
): Promise<boolean> {
  try {
    const result = await db.execute(sql`
      SELECT id, 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
      FROM intel_reports
      WHERE company_slug = ${companySlug}
        AND report_type = ${reportType}
        AND embedding IS NOT NULL
        AND captured_at > NOW() - INTERVAL '7 days'
      ORDER BY embedding <=> ${embeddingStr}::vector
      LIMIT 1
    `) as unknown as Array<{ id: number; similarity: number }>;

    if (result.length > 0 && Number(result[0]!.similarity) >= DEDUP_SIMILARITY_THRESHOLD) {
      logger.debug(
        { companySlug, reportType, similarity: result[0]!.similarity, existingId: result[0]!.id },
        "Intel quality: semantic duplicate detected, skipping",
      );
      return true;
    }
    return false;
  } catch (err) {
    // If embeddings aren't available, fall through
    logger.debug({ err }, "Intel quality: dedup check failed, allowing through");
    return false;
  }
}

// ---------------------------------------------------------------------------
// 2. QUALITY SCORING
// Score each piece of content on multiple dimensions (0.0 - 1.0)
// ---------------------------------------------------------------------------

export interface QualityScore {
  overall: number;
  contentLength: number;
  engagement: number;
  sourceCredibility: number;
  freshness: number;
  aiLikelihood: number; // 0 = likely human, 1 = likely AI
  flags: string[];
}

// Source credibility tiers
const CREDIBLE_SOURCES: Record<string, number> = {
  // High credibility (0.9+)
  "coingecko": 0.95,
  "github": 0.90,
  // Medium credibility (0.6-0.8)
  "reddit": 0.70,
  "news": 0.65,
  // Lower credibility (0.4-0.6)
  "twitter": 0.50,
  // Unknown
  "default": 0.40,
};

// AI content detection heuristics
const AI_PATTERNS = [
  /\bin conclusion\b/i,
  /\blet'?s dive in\b/i,
  /\bin this article\b/i,
  /\bcomprehensive guide\b/i,
  /\bunlock(ing)?\s+(the\s+)?(power|potential|secrets)\b/i,
  /\bgame.?changer\b/i,
  /\brevolution(ize|izing|ary)\b/i,
  /\bseamless(ly)?\b/i,
  /\bleverage\b/i,
  /\bdelve\b/i,
  /\btapestry\b/i,
  /\blandscape\b/i,
  /\brobust\b/i,
  /\bparadigm\b/i,
  /\bsynerg(y|ies|istic)\b/i,
  /\bholistic\b/i,
  /\bin today'?s (fast.?paced|ever.?changing|dynamic)\b/i,
  /\bstay ahead of the (curve|competition)\b/i,
  /\btransform(ative|ational|ing the way)\b/i,
  /\bcutting.?edge\b/i,
  /\bnot just\b.*\bbut also\b/i,
  /\bwhether you'?re\b.*\bor\b/i,
];

// Spam patterns
const SPAM_PATTERNS = [
  /\b(buy now|limited time|act fast|don'?t miss|sign up free)\b/i,
  /\b(100x|1000x|guaranteed|risk.?free|no.?brainer)\b/i,
  /\b(airdrop|free tokens|giveaway|whitelist)\b/i,
  /#\w+\s*#\w+\s*#\w+\s*#\w+\s*#\w+/i, // 5+ consecutive hashtags
  /(.)\1{4,}/i, // 5+ repeated characters
  /\b(dm me|link in bio|check my profile)\b/i,
];

export function scoreContent(
  text: string,
  reportType: string,
  metadata?: {
    score?: number;        // Reddit score
    numComments?: number;  // Reddit comments
    stars?: number;        // GitHub stars
    priceChange?: number;  // Price change %
  },
): QualityScore {
  const flags: string[] = [];

  // --- Content length score (0-1) ---
  const len = text.length;
  let contentLength = 0;
  if (len < 20) { contentLength = 0.1; flags.push("very_short"); }
  else if (len < 50) contentLength = 0.3;
  else if (len < 100) contentLength = 0.5;
  else if (len < 300) contentLength = 0.7;
  else if (len < 1000) contentLength = 0.9;
  else contentLength = 1.0;

  // --- Engagement score (0-1) ---
  let engagement = 0.5; // Default neutral
  if (metadata?.score !== undefined) {
    if (metadata.score >= 100) engagement = 1.0;
    else if (metadata.score >= 50) engagement = 0.9;
    else if (metadata.score >= 20) engagement = 0.7;
    else if (metadata.score >= 5) engagement = 0.5;
    else { engagement = 0.2; flags.push("low_engagement"); }
  }
  if (metadata?.numComments !== undefined) {
    const commentScore = Math.min(metadata.numComments / 50, 1.0);
    engagement = (engagement + commentScore) / 2;
  }

  // --- Source credibility (0-1) ---
  const sourceCredibility = CREDIBLE_SOURCES[reportType] ?? CREDIBLE_SOURCES["default"]!;

  // --- Freshness (always 1.0 at ingestion time) ---
  const freshness = 1.0;

  // --- AI likelihood (0 = human, 1 = AI) ---
  let aiHits = 0;
  for (const pattern of AI_PATTERNS) {
    if (pattern.test(text)) aiHits++;
  }
  // Normalize: 0 hits = 0.0, 3+ hits = 0.9
  const aiLikelihood = Math.min(aiHits / 3, 0.9);
  if (aiLikelihood >= 0.6) flags.push("likely_ai_generated");

  // --- Spam check ---
  let spamHits = 0;
  for (const pattern of SPAM_PATTERNS) {
    if (pattern.test(text)) spamHits++;
  }
  if (spamHits >= 2) flags.push("likely_spam");
  if (spamHits >= 1) flags.push("spam_signal");

  // --- Empty/garbage check ---
  if (text.trim().length === 0) flags.push("empty_content");
  if (/^[\s\W]+$/.test(text)) flags.push("no_alphanumeric");

  // --- Overall score ---
  // Weighted average, penalized by AI likelihood and spam
  const spamPenalty = spamHits >= 2 ? 0.3 : spamHits >= 1 ? 0.7 : 1.0;
  const aiPenalty = aiLikelihood >= 0.6 ? 0.6 : aiLikelihood >= 0.3 ? 0.8 : 1.0;

  const overall = Math.round(
    (contentLength * 0.20 +
     engagement * 0.25 +
     sourceCredibility * 0.30 +
     freshness * 0.10 +
     (1 - aiLikelihood) * 0.15) *
    spamPenalty *
    aiPenalty *
    100,
  ) / 100;

  return { overall, contentLength, engagement, sourceCredibility, freshness, aiLikelihood, flags };
}

// ---------------------------------------------------------------------------
// 3. QUALITY GATE
// Minimum quality threshold for ingestion and content context
// ---------------------------------------------------------------------------

const INGEST_QUALITY_THRESHOLD = 0.25;     // Very low — just blocks obvious garbage
const CONTEXT_QUALITY_THRESHOLD = 0.40;    // Higher — only good intel feeds content generation

export function shouldIngest(score: QualityScore): boolean {
  if (score.flags.includes("empty_content")) return false;
  if (score.flags.includes("no_alphanumeric")) return false;
  if (score.flags.includes("likely_spam") && score.overall < 0.35) return false;
  return score.overall >= INGEST_QUALITY_THRESHOLD;
}

export function isGoodEnoughForContext(score: QualityScore): boolean {
  if (score.flags.includes("likely_spam")) return false;
  if (score.flags.includes("likely_ai_generated") && score.overall < 0.50) return false;
  return score.overall >= CONTEXT_QUALITY_THRESHOLD;
}

// ---------------------------------------------------------------------------
// 4. FEEDBACK LOOP — downrank intel when content gets flagged
// When a content item gets a "dislike", find the intel reports that were used
// as context and record negative signals
// ---------------------------------------------------------------------------

// In-memory downrank cache — persists for the life of the server process
// Maps company_slug to a penalty factor (0.0 = fully downranked, 1.0 = normal)
const downrankCache = new Map<string, { penalty: number; updatedAt: number }>();

export function getDownrankPenalty(companySlug: string): number {
  const entry = downrankCache.get(companySlug);
  if (!entry) return 1.0;
  // Decay penalty over 7 days
  const ageMs = Date.now() - entry.updatedAt;
  const decayDays = ageMs / (7 * 24 * 60 * 60 * 1000);
  if (decayDays >= 1.0) {
    downrankCache.delete(companySlug);
    return 1.0;
  }
  return entry.penalty + (1.0 - entry.penalty) * decayDays;
}

export function recordNegativeFeedback(companySlug: string): void {
  const current = downrankCache.get(companySlug);
  const currentPenalty = current?.penalty ?? 1.0;
  // Each dislike reduces quality by 20%
  const newPenalty = Math.max(currentPenalty * 0.80, 0.10);
  downrankCache.set(companySlug, { penalty: newPenalty, updatedAt: Date.now() });
  logger.info({ companySlug, penalty: newPenalty }, "Intel quality: downranked company due to negative feedback");
}

export function recordPositiveFeedback(companySlug: string): void {
  const current = downrankCache.get(companySlug);
  if (!current) return;
  // Each like partially restores quality
  const newPenalty = Math.min(current.penalty * 1.10, 1.0);
  if (newPenalty >= 0.95) {
    downrankCache.delete(companySlug);
  } else {
    downrankCache.set(companySlug, { penalty: newPenalty, updatedAt: Date.now() });
  }
}

// ---------------------------------------------------------------------------
// 5. QUALITY-FILTERED CONTEXT QUERY for content generation
// Replaces the blind fetchContext() with quality-aware version
// ---------------------------------------------------------------------------

export async function fetchQualityContext(
  db: Db,
  topic: string,
  limit = 5,
): Promise<string> {
  try {
    const { getEmbedding } = await import("./intel-embeddings.js");
    const queryEmbedding = await getEmbedding(topic);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    // Fetch more candidates than needed, then filter
    const candidates = await db.execute(sql`
      SELECT
        r.headline,
        r.body,
        r.report_type,
        r.company_slug,
        r.captured_at,
        1 - (r.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM intel_reports r
      WHERE r.embedding IS NOT NULL
        AND r.captured_at > NOW() - INTERVAL '7 days'
        AND r.report_type != 'discovery'
      ORDER BY r.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit * 3}
    `) as unknown as Array<Record<string, unknown>>;

    if (!candidates || candidates.length === 0) return "";

    // Score and filter each candidate
    interface ScoredCandidate {
      headline: string;
      body: string;
      report_type: string;
      company_slug: string;
      qualityScore: number;
    }

    const qualified: ScoredCandidate[] = [];
    for (const r of candidates) {
      const bodyStr = typeof r.body === "string" ? r.body : "";
      const text = `${r.headline ?? ""} ${bodyStr}`;
      const score = scoreContent(text, r.report_type as string);
      if (!isGoodEnoughForContext(score)) continue;
      const penalty = getDownrankPenalty(r.company_slug as string);
      qualified.push({
        headline: r.headline as string,
        body: bodyStr,
        report_type: r.report_type as string,
        company_slug: r.company_slug as string,
        qualityScore: score.overall * penalty,
      });
    }

    qualified.sort((a, b) => b.qualityScore - a.qualityScore);
    const top = qualified.slice(0, limit);

    if (top.length === 0) return "";

    const contextLines = top.map((r) => {
      const body = r.body.slice(0, 300);
      return `[${r.report_type}/${r.company_slug}] ${r.headline}\n${body}`;
    });

    return `\nRelevant context from recent intel:\n${contextLines.join("\n\n")}`;
  } catch (err) {
    logger.warn({ err }, "Quality context fetch failed, returning empty");
    return "";
  }
}
