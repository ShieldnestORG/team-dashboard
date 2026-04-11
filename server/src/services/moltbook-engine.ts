/**
 * Moltbook autonomous engine — feed ingestion, content generation, engagement.
 *
 * Uses Ollama for content generation and BGE-M3 for vector embeddings.
 * Rate limits: only Moltbook's platform limits (60 reads/min, 30 writes/min).
 * No artificial budget caps — Ollama is our infrastructure.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MOLTBOOK_API = "https://www.moltbook.com/api/v1";
const MOLTBOOK_API_KEY = process.env.MOLTBOOK_API_KEY || "";

// Content safety — blocks credentials, internal IPs, env vars, secrets
const BLOCKED_PATTERNS = [
  /[A-Za-z0-9_-]{20,}(?:key|token|secret)/i,
  /(?:31\.220|168\.231|147\.79)\.\d+\.\d+/,
  /(?:DATABASE_URL|ANTHROPIC_API_KEY|SMTP_|STRIPE_|DISCORD_TOKEN|GITHUB_TOKEN|GROK_API_KEY|GEMINI_API_KEY|CONTENT_API_KEY|INTEL_INGEST_KEY|EMBED_API_KEY|OLLAMA_API_KEY|MOLTBOOK_API_KEY)/i,
  /sk-[a-zA-Z0-9]{20,}/,
  /ghp_[a-zA-Z0-9]{20,}/,
  /moltbook_[a-zA-Z0-9]{10,}/,
  /Bearer\s+[A-Za-z0-9._-]{20,}/,
];

function isContentSafe(text: string): boolean {
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(text)) {
      logger.warn({ pattern: re.source }, "Moltbook content blocked by safety filter");
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Moltbook API helpers
// ---------------------------------------------------------------------------

interface MoltbookResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  hint?: string;
}

let retryAfterUntil = 0;

async function moltbookFetch(path: string, opts: RequestInit = {}): Promise<MoltbookResponse> {
  if (Date.now() < retryAfterUntil) {
    return { success: false, error: `Rate limited — retry after ${Math.ceil((retryAfterUntil - Date.now()) / 1000)}s` };
  }

  const url = `${MOLTBOOK_API}${path}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(MOLTBOOK_API_KEY ? { Authorization: `Bearer ${MOLTBOOK_API_KEY}` } : {}),
    ...(opts.headers as Record<string, string> || {}),
  };

  try {
    const res = await fetch(url, { ...opts, headers, redirect: "manual" });

    // Handle rate limit
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      retryAfterUntil = Date.now() + (retryAfter ? parseInt(retryAfter, 10) * 1000 : 60_000);
      logger.warn({ retryAfterUntil }, "Moltbook 429 — backing off");
      return { success: false, error: "Rate limited by Moltbook" };
    }

    // Block redirects off-domain
    if (res.status >= 300 && res.status < 400) {
      return { success: false, error: `Redirect blocked: ${res.status}` };
    }

    const body = await res.json().catch(() => ({ success: res.ok })) as MoltbookResponse;
    return body;
  } catch (err) {
    logger.error({ err, path }, "Moltbook API error");
    return { success: false, error: String(err) };
  }
}

async function moltbookGet(path: string): Promise<MoltbookResponse> {
  return moltbookFetch(path, { method: "GET" });
}

async function moltbookPost(path: string, body: Record<string, unknown>): Promise<MoltbookResponse> {
  return moltbookFetch(path, { method: "POST", body: JSON.stringify(body) });
}

// Verification challenge solver
function solveChallenge(challenge: string): string {
  const nums: number[] = [];
  // Extract all numbers (digits or word-numbers)
  const digitMatches = challenge.match(/\d+/g);
  if (digitMatches) {
    for (const m of digitMatches) nums.push(parseInt(m, 10));
  }
  if (nums.length < 2) return "0.00";
  const lower = challenge.toLowerCase();
  let result: number;
  if (/(?:minus|subtract|slow|lose|decrease|drop|reduce)/.test(lower)) {
    result = nums[0]! - nums[1]!;
  } else if (/(?:times|multipli|double)/.test(lower)) {
    result = nums[0]! * nums[1]!;
  } else if (/(?:divid|split|halv)/.test(lower)) {
    result = nums[1] !== 0 ? nums[0]! / nums[1]! : 0;
  } else {
    result = nums[0]! + nums[1]!;
  }
  return result.toFixed(2);
}

// Handle verification if needed after posting
async function handleVerification(resp: MoltbookResponse): Promise<MoltbookResponse> {
  const data = resp.data as Record<string, unknown> | undefined;
  if (data?.verification_required || data?.verification_code) {
    const code = (data.verification_code as string) || "";
    const challenge = (data.challenge as string) || "";
    if (code && challenge) {
      const answer = solveChallenge(challenge);
      logger.info({ challenge, answer }, "Solving Moltbook verification");
      const verifyResp = await moltbookPost("/verify", { verification_code: code, answer });
      if (verifyResp.success) {
        return verifyResp;
      }
      logger.warn({ verifyResp }, "Verification failed");
    }
  }
  return resp;
}

// ---------------------------------------------------------------------------
// Stats helper
// ---------------------------------------------------------------------------

async function incrementStat(db: Db, field: string): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    await db.execute(sql`
      INSERT INTO moltbook_stats (date, ${sql.raw(field)})
      VALUES (${today}, 1)
      ON CONFLICT (date) DO UPDATE SET ${sql.raw(field)} = moltbook_stats.${sql.raw(field)} + 1
    `);
  } catch (err) {
    logger.warn({ err, field }, "Failed to increment moltbook stat");
  }
}

// ---------------------------------------------------------------------------
// Prompt templates
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are Coherence Daddy on Moltbook — an AI agent social network.

You represent a 508(c)(1)(A) faith-based organization and a framework for helping humans get ready for an AI-driven world. You believe in becoming a full-spectrum human: someone who is constantly learning, creating, and connecting.

The three problems you exist to solve:
1. People are living without purpose — and it's breaking everything
2. AI is driving changes to work faster than anyone is preparing for
3. We were trained to be economically useful, not fully human

Your voice: Warm, genuine, mission-driven. Technically competent but never condescending. Faith informs your values but you never preach. You speak from experience building real things.

What you've built: 523+ free tools, YourArchi (privacy-first self-help app where no data leaves the device), a blockchain directory of 532 companies, a 17-agent AI team, visual content pipeline, and an AEO data engine.

Key URLs: coherencedaddy.com, yourarchi.com, tokns.fi, shieldnest.org
Tagline: Integrity. Privacy. Effortlessly.

RULES:
- Lead with human problems, not infrastructure specs
- Technical details are proof points, not the pitch
- Never be salesy or self-promotional without substance
- Always add genuine value to the conversation
- Keep posts substantive — the platform rewards depth
- Never include API keys, passwords, internal IPs, or infrastructure secrets`;

const POST_PROMPT = `Based on what's trending on Moltbook right now, write a thoughtful post.

TRENDING TOPICS:
{context}

Pick ONE angle that connects to our mission (purpose, privacy, AI-driven change, becoming full-spectrum) and write a substantive post about it. Use our real experience building things as supporting evidence.

Target submolt: {submolt}

Format your response as JSON:
{"title": "your title here", "content": "your post content here"}

The title should be specific and provocative (not generic). The content should be 200-600 words, substantive, with a clear thesis.`;

const COMMENT_PROMPT = `Write a thoughtful comment on this Moltbook post.

POST TITLE: {title}
POST CONTENT: {content}

Write a comment that adds genuine value. Connect to our real experience where relevant. Be warm, specific, and conversational. Do NOT be generic or sycophantic.

Keep it 50-200 words. Reply with just the comment text, no JSON wrapper.`;

// ---------------------------------------------------------------------------
// Content pillars — rotated across posts
// ---------------------------------------------------------------------------

const SUBMOLT_ROTATION = ["general", "agents", "builds", "general", "philosophy", "memory"];
let pillarIndex = 0;

function nextSubmolt(): string {
  const s = SUBMOLT_ROTATION[pillarIndex % SUBMOLT_ROTATION.length]!;
  pillarIndex++;
  return s;
}

// ---------------------------------------------------------------------------
// Core engine functions
// ---------------------------------------------------------------------------

/** Ingest feed — fetch hot + new posts, embed with BGE-M3, store. */
export async function ingestFeed(db: Db): Promise<{ ingested: number }> {
  if (!MOLTBOOK_API_KEY) {
    logger.info("Moltbook ingest skipped — no API key");
    return { ingested: 0 };
  }

  let ingested = 0;

  for (const sort of ["hot", "new"] as const) {
    const resp = await moltbookGet(`/posts?sort=${sort}&limit=25`);
    if (!resp.success) {
      logger.warn({ sort, error: resp.error }, "Moltbook feed fetch failed");
      continue;
    }

    const posts = ((resp as unknown as Record<string, unknown>).posts ?? resp.data) as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(posts)) continue;

    for (const post of posts) {
      const postId = post.id as string;
      if (!postId) continue;

      // Check if already ingested
      const existing = await db.execute(sql`
        SELECT 1 FROM moltbook_feed WHERE post_id = ${postId} LIMIT 1
      `);
      if ((existing as unknown[]).length > 0) continue;

      const title = (post.title as string) || "";
      const content = (post.content as string) || "";
      const submolt = ((post.submolt as Record<string, unknown>)?.name as string) || "general";
      const author = (post.author as Record<string, unknown>) || {};
      const authorName = (author.name as string) || "unknown";
      const authorKarma = (author.karma as number) || 0;
      const upvotes = (post.upvotes as number) || 0;
      const commentCount = (post.comment_count as number) || 0;

      // Embed with BGE-M3
      let embeddingStr: string | null = null;
      try {
        const vec = await getEmbedding(`${title} ${content}`.slice(0, 2000));
        embeddingStr = `[${vec.join(",")}]`;
      } catch (err) {
        logger.warn({ err, postId }, "Embedding failed for feed item");
      }

      try {
        await db.execute(sql`
          INSERT INTO moltbook_feed (post_id, submolt, title, content, author_name, author_karma, upvotes, comment_count, embedding)
          VALUES (${postId}, ${submolt}, ${title}, ${content}, ${authorName}, ${authorKarma}, ${upvotes}, ${commentCount},
                  ${embeddingStr ? sql`${embeddingStr}::vector` : sql`NULL`})
          ON CONFLICT (post_id) DO NOTHING
        `);
        ingested++;
      } catch (err) {
        logger.warn({ err, postId }, "Failed to insert feed item");
      }
    }
  }

  if (ingested > 0) {
    await incrementStat(db, "feed_items_ingested");
    logger.info({ ingested }, "Moltbook feed ingested");
  }
  return { ingested };
}

/** Generate and post content using trending feed as context. */
export async function generatePost(db: Db): Promise<{ posted: boolean; title?: string; error?: string }> {
  if (!MOLTBOOK_API_KEY) {
    return { posted: false, error: "No API key" };
  }

  // Get trending feed items as context
  const trending = await db.execute(sql`
    SELECT title, content, author_name, upvotes, submolt
    FROM moltbook_feed
    WHERE ingested_at > NOW() - INTERVAL '48 hours'
    ORDER BY upvotes DESC
    LIMIT 10
  `) as unknown as Array<{ title: string; content: string; author_name: string; upvotes: number; submolt: string }>;

  const contextStr = trending.map((t) =>
    `[${t.submolt}] "${t.title}" by ${t.author_name} (${t.upvotes} upvotes): ${(t.content || "").slice(0, 200)}...`
  ).join("\n\n");

  const submolt = nextSubmolt();

  const prompt = `${SYSTEM_PROMPT}\n\n${POST_PROMPT.replace("{context}", contextStr).replace("{submolt}", submolt)}`;

  let generated: string;
  try {
    generated = await callOllamaGenerate(prompt);
    await incrementStat(db, "ollama_calls");
  } catch (err) {
    logger.error({ err }, "Ollama generation failed for Moltbook post");
    await incrementStat(db, "errors");
    return { posted: false, error: String(err) };
  }

  // Parse JSON response
  let title: string;
  let content: string;
  try {
    // Try to extract JSON from the response
    const jsonMatch = generated.match(/\{[\s\S]*"title"[\s\S]*"content"[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { title: string; content: string };
      title = parsed.title;
      content = parsed.content;
    } else {
      // Fallback: use first line as title, rest as content
      const lines = generated.trim().split("\n");
      title = lines[0]!.replace(/^#*\s*/, "").replace(/[*"]/g, "");
      content = lines.slice(1).join("\n").trim();
    }
  } catch {
    const lines = generated.trim().split("\n");
    title = lines[0]!.replace(/^#*\s*/, "").replace(/[*"]/g, "");
    content = lines.slice(1).join("\n").trim();
  }

  if (!title || !content || content.length < 50) {
    logger.warn({ title, contentLen: content?.length }, "Generated content too short");
    return { posted: false, error: "Generated content too short" };
  }

  // Safety check
  if (!isContentSafe(title) || !isContentSafe(content)) {
    await incrementStat(db, "errors");
    return { posted: false, error: "Content blocked by safety filter" };
  }

  // Post to Moltbook
  let resp = await moltbookPost("/posts", {
    submolt_name: submolt,
    title,
    content,
    type: "text",
  });

  // Handle verification challenge
  resp = await handleVerification(resp);

  if (!resp.success) {
    // Store failed attempt
    await db.execute(sql`
      INSERT INTO moltbook_posts (submolt, title, content, content_type, status, error, prompt_context)
      VALUES (${submolt}, ${title}, ${content}, 'post', 'failed', ${resp.error || "unknown"}, ${contextStr.slice(0, 500)})
    `);
    await incrementStat(db, "errors");
    return { posted: false, title, error: resp.error };
  }

  const moltbookPostId = ((resp.data as Record<string, unknown>)?.id as string) || null;

  // Embed and store
  let embeddingStr: string | null = null;
  try {
    const vec = await getEmbedding(`${title} ${content}`.slice(0, 2000));
    embeddingStr = `[${vec.join(",")}]`;
  } catch { /* non-critical */ }

  await db.execute(sql`
    INSERT INTO moltbook_posts (moltbook_post_id, submolt, title, content, content_type, prompt_context, embedding)
    VALUES (${moltbookPostId}, ${submolt}, ${title}, ${content}, 'post', ${contextStr.slice(0, 500)},
            ${embeddingStr ? sql`${embeddingStr}::vector` : sql`NULL`})
  `);

  await incrementStat(db, "posts_made");
  logger.info({ title, submolt, moltbookPostId }, "Moltbook post published");
  return { posted: true, title };
}

/** Engage with feed — upvote relevant posts, comment on highly relevant ones. */
export async function engageFeed(db: Db): Promise<{ comments: number; upvotes: number }> {
  if (!MOLTBOOK_API_KEY) {
    return { comments: 0, upvotes: 0 };
  }

  // Get our mission embedding for similarity scoring
  let missionEmbedding: number[];
  try {
    missionEmbedding = await getEmbedding(
      "faith-driven technology, privacy, purpose, self-help, AI-driven work transformation, full-spectrum human, learning creating connecting"
    );
  } catch (err) {
    logger.warn({ err }, "Failed to generate mission embedding");
    return { comments: 0, upvotes: 0 };
  }

  const missionVec = `[${missionEmbedding.join(",")}]`;

  // Find unengaged posts, scored by relevance to our mission
  const candidates = await db.execute(sql`
    SELECT id, post_id, title, content, author_name, submolt, upvotes,
           1 - (embedding <=> ${missionVec}::vector) AS relevance
    FROM moltbook_feed
    WHERE engaged = FALSE
      AND ingested_at > NOW() - INTERVAL '6 hours'
      AND embedding IS NOT NULL
    ORDER BY relevance DESC
    LIMIT 10
  `) as unknown as Array<{
    id: number; post_id: string; title: string; content: string;
    author_name: string; submolt: string; upvotes: number; relevance: number;
  }>;

  let comments = 0;
  let upvotes = 0;

  for (const post of candidates) {
    if (post.relevance > 0.7) {
      // High relevance — generate and post a comment
      const commentPrompt = `${SYSTEM_PROMPT}\n\n${COMMENT_PROMPT
        .replace("{title}", post.title)
        .replace("{content}", (post.content || "").slice(0, 1500))
      }`;

      try {
        const commentText = await callOllamaGenerate(commentPrompt);
        await incrementStat(db, "ollama_calls");

        // Clean up: remove quotes, JSON wrappers, etc.
        const cleaned = commentText.trim()
          .replace(/^["']|["']$/g, "")
          .replace(/^\{.*"content"\s*:\s*"|"\s*\}$/gs, "")
          .trim();

        if (cleaned.length < 20 || !isContentSafe(cleaned)) {
          // Too short or unsafe — just upvote instead
          await moltbookPost(`/posts/${post.post_id}/upvote`, {});
          upvotes++;
        } else {
          let resp = await moltbookPost(`/posts/${post.post_id}/comments`, { content: cleaned });
          resp = await handleVerification(resp);

          if (resp.success) {
            comments++;
            // Store our comment
            await db.execute(sql`
              INSERT INTO moltbook_posts (moltbook_post_id, submolt, title, content, content_type, parent_post_id)
              VALUES (${((resp.data as Record<string, unknown>)?.id as string) || null},
                      ${post.submolt}, ${"Re: " + post.title}, ${cleaned}, 'comment', ${post.post_id})
            `);
            await incrementStat(db, "comments_made");
          } else {
            // Comment failed — try upvote as fallback
            await moltbookPost(`/posts/${post.post_id}/upvote`, {});
            upvotes++;
          }
        }
      } catch (err) {
        logger.warn({ err, postId: post.post_id }, "Comment generation failed");
        await incrementStat(db, "errors");
      }
    } else if (post.relevance > 0.4) {
      // Moderate relevance — upvote
      await moltbookPost(`/posts/${post.post_id}/upvote`, {});
      upvotes++;
      await incrementStat(db, "upvotes_given");
    }
    // < 0.4 relevance — skip

    // Mark as engaged
    await db.execute(sql`
      UPDATE moltbook_feed
      SET engaged = TRUE, engagement_type = ${post.relevance > 0.7 ? "comment" : post.relevance > 0.4 ? "upvote" : "skip"}
      WHERE id = ${post.id}
    `);
  }

  if (comments > 0 || upvotes > 0) {
    logger.info({ comments, upvotes }, "Moltbook engagement complete");
  }
  return { comments, upvotes };
}

/** Heartbeat — maintain presence on Moltbook. */
export async function heartbeat(): Promise<boolean> {
  if (!MOLTBOOK_API_KEY) return false;

  try {
    const res = await fetch("https://www.moltbook.com/heartbeat.md", {
      headers: { Authorization: `Bearer ${MOLTBOOK_API_KEY}` },
    });
    const ok = res.ok;
    if (ok) {
      logger.info("Moltbook heartbeat OK");
    } else {
      logger.warn({ status: res.status }, "Moltbook heartbeat failed");
    }
    return ok;
  } catch (err) {
    logger.warn({ err }, "Moltbook heartbeat error");
    return false;
  }
}

/** Get stats for admin API. */
export async function getStats(db: Db): Promise<Record<string, unknown>> {
  const today = new Date().toISOString().slice(0, 10);

  const stats = await db.execute(sql`
    SELECT * FROM moltbook_stats WHERE date = ${today} LIMIT 1
  `) as unknown as Array<Record<string, unknown>>;

  const feedCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM moltbook_feed
  `) as unknown as Array<{ count: string }>;

  const postCount = await db.execute(sql`
    SELECT COUNT(*) as count FROM moltbook_posts WHERE status = 'posted'
  `) as unknown as Array<{ count: string }>;

  return {
    today: stats[0] || { date: today, posts_made: 0, comments_made: 0, upvotes_given: 0, feed_items_ingested: 0, ollama_calls: 0, errors: 0 },
    totalFeedItems: parseInt(feedCount[0]?.count || "0", 10),
    totalPostsMade: parseInt(postCount[0]?.count || "0", 10),
    apiKeyConfigured: !!MOLTBOOK_API_KEY,
    rateLimited: Date.now() < retryAfterUntil,
    retryAfterUntil: retryAfterUntil > Date.now() ? new Date(retryAfterUntil).toISOString() : null,
  };
}
