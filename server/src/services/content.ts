import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
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
// File-based queue store
// ---------------------------------------------------------------------------

const QUEUE_PATH = join(process.cwd(), "data", "content-queue.json");

function ensureDir() {
  const dir = dirname(QUEUE_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readQueue(): ContentItem[] {
  if (!existsSync(QUEUE_PATH)) return [];
  try {
    return JSON.parse(readFileSync(QUEUE_PATH, "utf-8")) as ContentItem[];
  } catch {
    return [];
  }
}

function writeQueue(items: ContentItem[]): void {
  ensureDir();
  writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2));
}

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
// Service
// ---------------------------------------------------------------------------

export function contentService(db: Db) {
  async function generate(opts: {
    personalityId: string;
    contentType: string;
    topic: string;
    contextQuery?: string;
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

    // Fetch context from intel reports
    const contextTopic = opts.contextQuery || opts.topic;
    const context = await fetchContext(db, contextTopic);

    // Build the full prompt
    const systemPrompt = personality.SYSTEM_PROMPT.replace("{CONTEXT}", context);
    const fullPrompt = `${systemPrompt}\n\n${contentTypePrompt}\n\nTopic: ${opts.topic}`;

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

    // Store in queue
    const contentId = randomUUID();
    const item: ContentItem = {
      id: contentId,
      personalityId: opts.personalityId,
      contentType: opts.contentType,
      platform: resolvePlatform(opts.contentType),
      status: "draft",
      content: generatedText,
      metadata,
      createdAt: new Date().toISOString(),
      reviewStatus: "pending",
    };

    const queue = readQueue();
    queue.push(item);
    writeQueue(queue);

    logger.info(
      { contentId, personalityId: opts.personalityId, contentType: opts.contentType, charCount, withinLimit },
      "Content generated",
    );

    return { contentId, content: generatedText, metadata };
  }

  async function listQueue(opts: {
    status?: string;
    platform?: string;
    limit?: number;
    offset?: number;
  }): Promise<ContentItem[]> {
    let items = readQueue();

    if (opts.status) {
      items = items.filter((i) => i.status === opts.status || i.reviewStatus === opts.status);
    }
    if (opts.platform) {
      items = items.filter((i) => i.platform === opts.platform);
    }

    // Sort newest first
    items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const offset = opts.offset || 0;
    const limit = opts.limit || 50;
    return items.slice(offset, offset + limit);
  }

  async function reviewItem(id: string, reviewStatus: string, reviewComment?: string): Promise<void> {
    const queue = readQueue();
    const idx = queue.findIndex((i) => i.id === id);
    if (idx === -1) {
      throw new Error(`Content item not found: ${id}`);
    }

    if (reviewStatus !== "approved" && reviewStatus !== "flagged") {
      throw new Error(`Invalid review status: ${reviewStatus}. Must be "approved" or "flagged"`);
    }

    queue[idx].reviewStatus = reviewStatus;
    if (reviewComment) {
      queue[idx].reviewComment = reviewComment;
    }
    if (reviewStatus === "approved") {
      queue[idx].status = "published";
    }
    if (reviewStatus === "flagged") {
      queue[idx].status = "rejected";
    }

    writeQueue(queue);
    logger.info({ id, reviewStatus }, "Content item reviewed");
  }

  async function stats(): Promise<ContentStats> {
    const items = readQueue();

    const byStatus: Record<string, number> = {};
    const byPlatform: Record<string, number> = {};
    const byPersonality: Record<string, number> = {};
    const byReviewStatus: Record<string, number> = {};

    for (const item of items) {
      byStatus[item.status] = (byStatus[item.status] || 0) + 1;
      byPlatform[item.platform] = (byPlatform[item.platform] || 0) + 1;
      byPersonality[item.personalityId] = (byPersonality[item.personalityId] || 0) + 1;
      byReviewStatus[item.reviewStatus] = (byReviewStatus[item.reviewStatus] || 0) + 1;
    }

    return {
      total: items.length,
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
      "Content preview generated (not saved to queue)",
    );

    return { content: generatedText, metadata };
  }

  return { generate, preview, listQueue, reviewItem, stats };
}
