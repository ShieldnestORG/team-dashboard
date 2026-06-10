import { randomUUID } from "crypto";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { contentItems, contentFeedback } from "@paperclipai/db";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

import * as blaze from "../content-templates/blaze.js";
import * as cipher from "../content-templates/cipher.js";
import * as spark from "../content-templates/spark.js";
import * as prism from "../content-templates/prism.js";
import * as vanguard from "../content-templates/vanguard.js";
import * as forge from "../content-templates/forge.js";
import { getPartnerInjection } from "./partner-content.js";
import { buildBrandSystemPromptBlock } from "./brand-personas.js";
import { getAeoCta, pickBlueskyCta } from "./aeo-cta.js";
import {
  enqueueApprovedContent,
  flagContent,
  isDuplicateRecent,
  resolveAccountForContent,
} from "./socials/content-bridge.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PublishTargetResult {
  success: boolean;
  error?: string;
  publishedAt?: string;
  url?: string;
}

export interface PublishResults {
  cd?: PublishTargetResult;
  sn?: PublishTargetResult;
  toknsApp?: PublishTargetResult;
}

export interface ContentItem {
  id: string;
  companyId: string;
  personalityId: string;
  contentType: string;
  platform: string;
  status: "draft" | "published" | "rejected";
  content: string;
  metadata: {
    topic: string;
    contextQuery?: string;
    model: string;
    charCount: number;
    charLimit: number;
    withinLimit: boolean;
  };
  createdAt: string;
  reviewStatus: "pending" | "approved" | "flagged";
  reviewComment?: string;
  publishedAt?: string | null;
  // blog-post specific: slug on the target blog surfaces, and per-target publish status
  slug?: string | null;
  publishResults?: PublishResults;
}

export interface GeneratedContent {
  contentId: string;
  content: string;
  metadata: ContentItem["metadata"];
}

export interface ContentStats {
  total: number;
  byStatus: Record<string, number>;
  byPlatform: Record<string, number>;
  byPersonality: Record<string, number>;
  byReviewStatus: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Personalities registry
// ---------------------------------------------------------------------------

const PERSONALITIES: Record<string, {
  SYSTEM_PROMPT: string;
  CONTENT_TYPE_PROMPTS: Record<string, string>;
  PLATFORM_LIMITS: Record<string, number>;
}> = {
  blaze,
  cipher,
  spark,
  prism,
  vanguard,
  forge,
};

// ---------------------------------------------------------------------------
// Ollama client
// ---------------------------------------------------------------------------

import { callOllamaGenerate, OLLAMA_MODEL } from "./ollama-client.js";
import { enforceCharLimit, smartTruncate } from "./char-limit.js";

const callOllama = callOllamaGenerate;

// ---------------------------------------------------------------------------
// Context fetcher — query intel_reports via pgvector similarity
// ---------------------------------------------------------------------------

async function fetchContext(db: Db, topic: string, limit = 5): Promise<string> {
  try {
    // Use quality-filtered context that scores, deduplicates, and filters for relevance
    const { fetchQualityContext } = await import("./intel-quality.js");
    return await fetchQualityContext(db, topic, limit);
  } catch (err) {
    logger.warn({ err }, "Failed to fetch quality context, falling back to basic");
    // Fallback: basic context fetch without quality gates
    try {
      const queryEmbedding = await getEmbedding(topic);
      const embeddingStr = `[${queryEmbedding.join(",")}]`;

      const results = await db.execute(sql`
        SELECT r.headline, r.body, r.report_type, r.company_slug
        FROM intel_reports r
        WHERE r.embedding IS NOT NULL
          AND r.captured_at > NOW() - INTERVAL '7 days'
        ORDER BY r.embedding::halfvec(1024) <=> ${embeddingStr}::halfvec(1024)
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
// Resolve platform from contentType
// ---------------------------------------------------------------------------

function resolvePlatform(contentType: string): string {
  const map: Record<string, string> = {
    tweet: "twitter",
    thread: "twitter",
    blog_post: "blog",
    linkedin: "linkedin",
    reddit: "reddit",
    discord: "discord",
    bluesky: "bluesky",
  };
  return map[contentType] || contentType;
}

// ---------------------------------------------------------------------------
// Map DB row to ContentItem
// ---------------------------------------------------------------------------

function rowToContentItem(row: typeof contentItems.$inferSelect): ContentItem {
  return {
    id: row.id,
    companyId: row.companyId,
    personalityId: row.personalityId,
    contentType: row.contentType,
    platform: row.platform,
    status: row.status as ContentItem["status"],
    content: row.content,
    metadata: {
      topic: row.topic,
      contextQuery: row.contextQuery ?? undefined,
      model: row.model ?? OLLAMA_MODEL,
      charCount: row.charCount ?? 0,
      charLimit: row.charLimit ?? 0,
      withinLimit: (row.charCount ?? 0) <= (row.charLimit ?? 0),
    },
    createdAt: row.createdAt.toISOString(),
    reviewStatus: row.reviewStatus as ContentItem["reviewStatus"],
    reviewComment: row.reviewComment ?? undefined,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    slug: row.slug ?? null,
    publishResults: (row.publishResults ?? {}) as PublishResults,
  };
}

// ---------------------------------------------------------------------------
// Feedback context builder for training
// ---------------------------------------------------------------------------

async function buildFeedbackContext(
  db: Db,
  companyId: string,
  personalityId: string,
  platform: string,
): Promise<string> {
  try {
    // Get liked examples
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
          eq(contentItems.platform, platform),
        ),
      )
      .orderBy(desc(contentFeedback.createdAt))
      .limit(3);

    // Get disliked examples
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
          eq(contentItems.platform, platform),
        ),
      )
      .orderBy(desc(contentFeedback.createdAt))
      .limit(3);

    if (liked.length === 0 && disliked.length === 0) return "";

    let feedbackBlock = "\n\n## Recent Admin Feedback\n";

    if (liked.length > 0) {
      feedbackBlock += "### Content the admin liked:\n";
      for (const item of liked) {
        const snippet = item.content.slice(0, 200);
        const comment = item.comment ? ` — feedback: "${item.comment}"` : "";
        feedbackBlock += `- "${snippet}..."${comment}\n`;
      }
    }

    if (disliked.length > 0) {
      feedbackBlock += "### Content the admin disliked:\n";
      for (const item of disliked) {
        const snippet = item.content.slice(0, 200);
        const comment = item.comment ? ` — feedback: "${item.comment}"` : "";
        feedbackBlock += `- "${snippet}..."${comment}\n`;
      }
    }

    feedbackBlock += "\nUse this feedback to guide your tone and approach.\n";
    return feedbackBlock;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch feedback for training context");
    return "";
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

const DEFAULT_COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

interface GenerateOpts {
  personalityId: string;
  contentType: string;
  topic: string;
  contextQuery?: string;
  companyId?: string;
  /** brand controls which X account / publish target this content belongs to (default: 'cd') */
  brand?: string;
}

interface ProducedText {
  text: string;
  charLimit: number;
  platform: string;
  companyId: string;
}

export function contentService(db: Db) {
  /**
   * Internal helper — runs the full prompt + Ollama + enforce + CTA pipeline
   * and returns the final text. Used by both generate() (which inserts a new
   * row) and regenerateContent() (which updates an existing row in place).
   */
  async function produceText(opts: GenerateOpts): Promise<ProducedText> {
    const personality = PERSONALITIES[opts.personalityId];
    if (!personality) {
      throw new Error(`Unknown personality: ${opts.personalityId}. Valid: ${Object.keys(PERSONALITIES).join(", ")}`);
    }

    const contentTypePrompt = personality.CONTENT_TYPE_PROMPTS[opts.contentType];
    if (!contentTypePrompt) {
      throw new Error(`Unknown content type: ${opts.contentType}. Valid: ${Object.keys(personality.CONTENT_TYPE_PROMPTS).join(", ")}`);
    }

    const charLimit = personality.PLATFORM_LIMITS[opts.contentType] || 5000;
    const companyId = opts.companyId || DEFAULT_COMPANY_ID;
    const platform = resolvePlatform(opts.contentType);

    const contextTopic = opts.contextQuery || opts.topic;
    const context = await fetchContext(db, contextTopic);
    const feedbackContext = await buildFeedbackContext(db, companyId, opts.personalityId, platform);
    const partnerContext = await getPartnerInjection(db, opts.topic, opts.brand);

    const brandBlock = buildBrandSystemPromptBlock(opts.brand);
    const systemPrompt = personality.SYSTEM_PROMPT.replace("{CONTEXT}", context) + brandBlock;
    const fullPrompt = `${systemPrompt}${feedbackContext}${partnerContext}\n\n${contentTypePrompt}\n\nTopic: ${opts.topic}`;

    const rawGeneratedText = await callOllama(fullPrompt);

    const enforced = await enforceCharLimit(
      rawGeneratedText,
      charLimit,
      callOllama,
      (attempt) =>
        `${fullPrompt}\n\nSTRICT REQUIREMENT (attempt ${attempt}): The output MUST be ${charLimit} characters or fewer, including spaces, line breaks, and emojis. Count carefully. Output ONLY the post text — no preamble, no quotes, no explanation.`,
      { personalityId: opts.personalityId, contentType: opts.contentType },
    );

    let generatedText = enforced;
    if (opts.contentType === 'bluesky') {
      // Rotate across product CTAs (directory, creditscore, optimize-me, affiliate, partners)
      // so audiences don't see the same suffix every post. Skip if the post is already
      // close to the limit — preserving the LLM's organic close beats jamming a CTA in.
      const cta = pickBlueskyCta();
      const suffix = cta.tweetSuffix;
      if (generatedText.length + suffix.length <= charLimit) {
        generatedText = generatedText + suffix;
      }
    } else if (opts.brand) {
      const cta = getAeoCta(opts.brand);
      if (opts.contentType === 'tweet') {
        const suffix = cta.tweetSuffix;
        if (generatedText.length + suffix.length <= 280) {
          generatedText = generatedText + suffix;
        }
      } else if (opts.contentType === 'blog_post') {
        if (cta.blogCtaBlock) {
          generatedText = generatedText + '\n' + cta.blogCtaBlock;
        }
      }
    }

    if (generatedText.length > charLimit) {
      generatedText = smartTruncate(generatedText, charLimit);
    }

    return { text: generatedText, charLimit, platform, companyId };
  }

  async function generate(opts: GenerateOpts): Promise<GeneratedContent> {
    const { text: generatedText, charLimit, platform, companyId } = await produceText(opts);

    const charCount = generatedText.length;
    const withinLimit = charCount <= charLimit;

    const metadata: ContentItem["metadata"] = {
      topic: opts.topic,
      contextQuery: opts.contextQuery,
      model: OLLAMA_MODEL,
      charCount,
      charLimit,
      withinLimit,
    };

    // Store in database
    const contentId = randomUUID();
    const [row] = await db.insert(contentItems).values({
      id: contentId,
      companyId,
      personalityId: opts.personalityId,
      contentType: opts.contentType,
      platform,
      status: "draft",
      content: generatedText,
      topic: opts.topic,
      contextQuery: opts.contextQuery ?? null,
      model: OLLAMA_MODEL,
      charCount,
      charLimit,
      reviewStatus: "pending",
      brand: opts.brand ?? "cd",
    }).returning();

    logger.info(
      { contentId: row.id, personalityId: opts.personalityId, contentType: opts.contentType, charCount, withinLimit },
      "Content generated and stored in DB",
    );

    try {
      const brand = row.brand ?? "cd";
      const account = await resolveAccountForContent(db, companyId, brand, opts.contentType);
      if (account && account.status === "active") {
        const mode = account.automationMode;
        if (mode === "full_auto" || mode === "assisted") {
          let proceed = true;
          let flagReason: string | null = null;
          if (mode === "assisted") {
            flagReason = flagContent(generatedText, account.platform);
            if (!flagReason) {
              const dup = await isDuplicateRecent(db, companyId, generatedText);
              if (dup) flagReason = "duplicate of recent content";
            }
            if (flagReason) proceed = false;
          }
          if (proceed) {
            const now = new Date();
            await db
              .update(contentItems)
              .set({
                reviewStatus: "approved",
                status: "published",
                publishedAt: now,
                updatedAt: now,
              })
              .where(eq(contentItems.id, row.id));
            const enqueue = await enqueueApprovedContent(db, row.id);
            logger.info({ contentId: row.id, mode, enqueue }, "Auto-approved content via automation_mode");
          } else {
            await db
              .update(contentItems)
              .set({ reviewComment: flagReason, updatedAt: new Date() })
              .where(eq(contentItems.id, row.id));
            logger.info({ contentId: row.id, flagReason }, "Assisted-mode content flagged, kept pending");
          }
        }
      }
    } catch (err) {
      logger.warn({ err, contentId: row.id }, "Auto-enqueue path failed; row left in pending");
    }

    return { contentId: row.id, content: generatedText, metadata };
  }

  async function listQueue(opts: {
    status?: string;
    platform?: string;
    personalityId?: string;
    limit?: number;
    offset?: number;
    companyId?: string;
  }): Promise<ContentItem[]> {
    const companyId = opts.companyId || DEFAULT_COMPANY_ID;
    const conditions = [eq(contentItems.companyId, companyId)];

    if (opts.status) {
      // Support filtering by either status or reviewStatus
      conditions.push(
        sql`(${contentItems.status} = ${opts.status} OR ${contentItems.reviewStatus} = ${opts.status})`,
      );
    }
    if (opts.platform) {
      conditions.push(eq(contentItems.platform, opts.platform));
    }
    if (opts.personalityId) {
      conditions.push(eq(contentItems.personalityId, opts.personalityId));
    }

    const rows = await db
      .select()
      .from(contentItems)
      .where(and(...conditions))
      .orderBy(desc(contentItems.createdAt))
      .limit(opts.limit || 50)
      .offset(opts.offset || 0);

    return rows.map(rowToContentItem);
  }

  async function reviewItem(id: string, reviewStatus: string, reviewComment?: string): Promise<void> {
    if (reviewStatus !== "approved" && reviewStatus !== "flagged") {
      throw new Error(`Invalid review status: ${reviewStatus}. Must be "approved" or "flagged"`);
    }

    const now = new Date();
    const updates: Record<string, unknown> = {
      reviewStatus,
      reviewComment: reviewComment ?? null,
      updatedAt: now,
    };

    if (reviewStatus === "approved") {
      updates.status = "published";
      updates.publishedAt = now;
    }
    if (reviewStatus === "flagged") {
      updates.status = "rejected";
    }

    const result = await db
      .update(contentItems)
      .set(updates)
      .where(eq(contentItems.id, id))
      .returning({ id: contentItems.id });

    if (result.length === 0) {
      throw new Error(`Content item not found: ${id}`);
    }

    logger.info({ id, reviewStatus }, "Content item reviewed");

    if (reviewStatus === "approved") {
      try {
        const enqueue = await enqueueApprovedContent(db, id);
        logger.info({ id, enqueue }, "Content approval enqueue result");
      } catch (err) {
        logger.warn({ err, id }, "Content approval succeeded but enqueue to social_posts failed");
      }
    }
  }

  async function stats(companyId?: string): Promise<ContentStats> {
    const cid = companyId || DEFAULT_COMPANY_ID;
    const rows = await db
      .select()
      .from(contentItems)
      .where(eq(contentItems.companyId, cid));

    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byPersonality: Record<string, number> = {};
    const byReviewStatus: Record<string, number> = {};

    for (const row of rows) {
      byStatus[row.status] = (byStatus[row.status] || 0) + 1;
      byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
      byPersonality[row.personalityId] = (byPersonality[row.personalityId] || 0) + 1;
      byReviewStatus[row.reviewStatus] = (byReviewStatus[row.reviewStatus] || 0) + 1;
    }

    return {
      total: rows.length,
      byStatus,
      byPlatform,
      byPersonality,
      byReviewStatus,
    };
  }

  async function preview(opts: {
    personalityId: string;
    contentType: string;
    topic: string;
    contextQuery?: string;
  }): Promise<{ content: string; metadata: ContentItem["metadata"] }> {
    const personality = PERSONALITIES[opts.personalityId];
    if (!personality) {
      throw new Error(`Unknown personality: ${opts.personalityId}. Valid: ${Object.keys(PERSONALITIES).join(", ")}`);
    }

    const contentTypePrompt = personality.CONTENT_TYPE_PROMPTS[opts.contentType];
    if (!contentTypePrompt) {
      throw new Error(`Unknown content type: ${opts.contentType}. Valid: ${Object.keys(personality.CONTENT_TYPE_PROMPTS).join(", ")}`);
    }

    const charLimit = personality.PLATFORM_LIMITS[opts.contentType] || 5000;

    const contextTopic = opts.contextQuery || opts.topic;
    const context = await fetchContext(db, contextTopic);

    const systemPrompt = personality.SYSTEM_PROMPT.replace("{CONTEXT}", context);
    const fullPrompt = `${systemPrompt}\n\n${contentTypePrompt}\n\nTopic: ${opts.topic}`;

    const rawGeneratedText = await callOllama(fullPrompt);
    const generatedText = await enforceCharLimit(
      rawGeneratedText,
      charLimit,
      callOllama,
      (attempt) =>
        `${fullPrompt}\n\nSTRICT REQUIREMENT (attempt ${attempt}): The output MUST be ${charLimit} characters or fewer, including spaces, line breaks, and emojis. Count carefully. Output ONLY the post text — no preamble, no quotes, no explanation.`,
      { personalityId: opts.personalityId, contentType: opts.contentType },
    );

    const charCount = generatedText.length;
    const withinLimit = charCount <= charLimit;

    const metadata: ContentItem["metadata"] = {
      topic: opts.topic,
      contextQuery: opts.contextQuery,
      model: OLLAMA_MODEL,
      charCount,
      charLimit,
      withinLimit,
    };

    logger.info(
      { personalityId: opts.personalityId, contentType: opts.contentType, charCount, withinLimit },
      "Content preview generated (not saved)",
    );

    return { content: generatedText, metadata };
  }

  /**
   * Re-run an existing content_items row through the generation pipeline,
   * updating it in place. Used by cleanup scripts when existing drafts violate
   * char limits or otherwise need a fresh take. Preserves id and createdAt.
   */
  async function regenerateContent(rowId: string): Promise<{ id: string; before: number; after: number }> {
    const [row] = await db.select().from(contentItems).where(eq(contentItems.id, rowId));
    if (!row) throw new Error(`content_items row not found: ${rowId}`);
    if (row.status === "published") {
      throw new Error(`refusing to regenerate published content: ${rowId}`);
    }

    const beforeLen = row.content.length;
    const { text: newText, charLimit } = await produceText({
      personalityId: row.personalityId,
      contentType: row.contentType,
      topic: row.topic,
      contextQuery: row.contextQuery ?? undefined,
      companyId: row.companyId,
      brand: row.brand ?? undefined,
    });

    const charCount = newText.length;
    await db
      .update(contentItems)
      .set({
        content: newText,
        charCount,
        charLimit,
        model: OLLAMA_MODEL,
        // reset review state — this is effectively a new draft
        reviewStatus: "pending",
        reviewComment: null,
      })
      .where(eq(contentItems.id, rowId));

    logger.info(
      { rowId, beforeLen, afterLen: charCount, charLimit, withinLimit: charCount <= charLimit },
      "Content regenerated and updated in place",
    );

    return { id: rowId, before: beforeLen, after: charCount };
  }

  return { generate, preview, listQueue, reviewItem, stats, regenerateContent };
}
