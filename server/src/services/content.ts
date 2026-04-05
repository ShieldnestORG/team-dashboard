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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
};

// ---------------------------------------------------------------------------
// Ollama client
// ---------------------------------------------------------------------------

const OLLAMA_URL = process.env.OLLAMA_URL || "http://168.231.127.180:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";

async function callOllama(prompt: string): Promise<string> {
  const res = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`Ollama error (${res.status}): ${errorText}`);
  }

  const data = await res.json() as { response: string };
  return data.response.trim();
}

// ---------------------------------------------------------------------------
// Context fetcher — query intel_reports via pgvector similarity
// ---------------------------------------------------------------------------

async function fetchContext(db: Db, topic: string, limit = 5): Promise<string> {
  try {
    const queryEmbedding = await getEmbedding(topic);
    const embeddingStr = `[${queryEmbedding.join(",")}]`;

    const results = await db.execute(sql`
      SELECT
        r.headline,
        r.body,
        r.report_type,
        r.company_slug,
        r.captured_at,
        1 - (r.embedding <=> ${embeddingStr}::vector) AS similarity
      FROM intel_reports r
      WHERE r.embedding IS NOT NULL
      ORDER BY r.embedding <=> ${embeddingStr}::vector
      LIMIT ${limit}
    `) as unknown as Array<Record<string, unknown>>;

    if (!results || results.length === 0) return "";

    const contextLines = results.map((r) => {
      const body = typeof r.body === "string" ? r.body.slice(0, 300) : "";
      return `[${r.report_type}/${r.company_slug}] ${r.headline}\n${body}`;
    });

    return `\nRelevant context from recent intel:\n${contextLines.join("\n\n")}`;
  } catch (err) {
    logger.warn({ err }, "Failed to fetch context for content generation, proceeding without context");
    return "";
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

export function contentService(db: Db) {
  async function generate(opts: {
    personalityId: string;
    contentType: string;
    topic: string;
    contextQuery?: string;
    companyId?: string;
  }): Promise<GeneratedContent> {
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

    // Fetch context from intel reports
    const contextTopic = opts.contextQuery || opts.topic;
    const context = await fetchContext(db, contextTopic);

    // Fetch admin feedback for training
    const feedbackContext = await buildFeedbackContext(db, companyId, opts.personalityId, platform);

    // Build the full prompt
    const systemPrompt = personality.SYSTEM_PROMPT.replace("{CONTEXT}", context);
    const fullPrompt = `${systemPrompt}${feedbackContext}\n\n${contentTypePrompt}\n\nTopic: ${opts.topic}`;

    // Call Ollama
    const generatedText = await callOllama(fullPrompt);

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
    }).returning();

    logger.info(
      { contentId: row.id, personalityId: opts.personalityId, contentType: opts.contentType, charCount, withinLimit },
      "Content generated and stored in DB",
    );

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

    const generatedText = await callOllama(fullPrompt);

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

  return { generate, preview, listQueue, reviewItem, stats };
}
