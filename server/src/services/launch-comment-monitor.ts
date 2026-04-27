// ---------------------------------------------------------------------------
// Launch Comment Monitor
//
// Watches HN, Reddit, and dev.to for new comments on tracked launch posts.
// Each new comment is run through a Claude Haiku classifier that compares it
// against 8 documented pushback patterns. When confidence >= 0.85, a
// pre-formatted reply is attached to the row so the human reviewer can
// approve / edit / dismiss before posting upstream.
//
// External APIs:
//   - HN: Algolia search (no auth) — story_${id} tag
//   - Reddit: public .json endpoint (no auth, custom UA required)
//   - dev.to: /api/comments?a_id=... (api-key header required)
//
// Hard-coded threshold: see CLASSIFIER_THRESHOLD below.
// ---------------------------------------------------------------------------

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { commentReplies, launchTrackedItems } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// Hard-coded confidence threshold — at or above this we attach a suggested
// reply; below, status defaults to needs_custom and suggestedReply is null.
export const CLASSIFIER_THRESHOLD = 0.85;

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
// Latest Haiku family per CLAUDE.md / env knowledge.
const HAIKU_MODEL = "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// PATTERN BANK — exact reply text. Do NOT paraphrase. The classifier system
// prompt embeds these verbatim and the model is instructed to return one of
// these reply strings unmodified when confidence is high.
// ---------------------------------------------------------------------------

export interface PatternEntry {
  patternId: string;
  matches: string;
  reply: string;
}

export const PATTERN_BANK: ReadonlyArray<PatternEntry> = [
  {
    patternId: "aider",
    matches:
      "comment compares this to Aider, Cline, Continue, Codex, OpenHands, or any other agentic CLI",
    reply:
      "Aider's a great fit if you want a chat-style CLI. The pitch here is different: I want the *Claude Code* UX (the agentic loop, the file edits, the diff-review flow) but I want the cheap mechanical work to run locally. Aider doesn't give me that — it has its own agentic style. They're complementary, not competing. If you already love Aider, this isn't for you.",
  },
  {
    patternId: "cursor",
    matches:
      "comment compares this to Cursor, Copilot, Codeium, Windsurf, or other editor-integrated tools",
    reply:
      "Cursor's editor-integrated and good at it. This is for people who already live in the terminal half the time and would rather not relearn keyboard muscle memory in a second tool. Also: Cursor's pricing is decent at $20-40/mo, but Claude Code's quota model + the variance of agentic loops is exactly where the local-route saves money. Different shape of the same problem.",
  },
  {
    patternId: "cheap_tokens",
    matches:
      "comment argues tokens are cheap now / Sonnet 4.5 / Haiku is fine / pricing makes this moot",
    reply:
      "Per-token, sure — but that doesn't fix Claude Code's *quota* model, which is the actual pain point. A Pro account hits its limit on agentic loops well before you've spent $20 on tokens. Routing the mechanical 70% to localhost means you stop hitting the cap on dumb work and reserve the cap for the calls that actually need Sonnet's reasoning. Cheaper tokens don't help if your quota resets weekly.",
  },
  {
    patternId: "gemma_bad",
    matches:
      "comment claims Gemma 7B can't do real coding work, cites benchmarks (τ2-bench), or argues local model is too weak",
    reply:
      "Correct, and the post says exactly this. Gemma 7B is for the *mechanical* tail — lints, grep-and-replace, formatting, batch ops. Anything requiring multi-step planning or tool-chain coherence stays on Sonnet. If you tried to do real refactors on Gemma you'd hate it. The whole pitch is classifying tasks into \"needs frontier reasoning\" vs \"doesn't\" — not pretending the models are interchangeable.",
  },
  {
    patternId: "other_tool",
    matches: 'comment asks "why not Continue / Cline / OpenHands / [tool not covered above]"',
    reply:
      "Use them if they fit your workflow — the post isn't claiming Claude Code is the only good agentic CLI. It's specifically for people already on Pro who want to keep using Claude Code without burning quota on mechanical work. If you're not already on Claude Code, the cost-benefit math is different and the right answer might genuinely be a different tool.",
  },
  {
    patternId: "latency",
    matches: "comment argues local LLM latency is too slow / round-trip / API is faster",
    reply:
      "For a 7B model on an M-series Mac it's actually competitive on small inputs — Ollama + Gemma 7B does formatting / lint passes in roughly the same wall-clock as a round-trip to api.anthropic.com. Where local loses is on long contexts / large outputs, which is exactly the work I don't route there. The latency story tracks the cost story: short mechanical = local; long reasoning = API.",
  },
  {
    patternId: "setup_hassle",
    matches: "comment complains setup is too involved, complicated, hassle, too much yak-shaving",
    reply:
      "Fair — that's why the repo includes a copy-paste prompt that does ~98% of the install for you (auto-detects OS, installs Ollama, pulls Gemma, writes the router config, runs the verify step). I'd argue 5 min one-time setup to never think about it again is a reasonable trade for the quota relief. If it took 30 min I wouldn't have shipped it.",
  },
  {
    patternId: "obvious",
    matches:
      'comment dismisses this as obvious, "yet another", "been done", "any blog post can do this"',
    reply:
      "The 21-slide visual setup + the OS auto-detect + the verify-both-engines step at the end are the differentiators. The technique itself isn't novel — pointing Claude Code at an OpenAI-compatible endpoint has been doable since the SDK shipped. What was missing was a setup that an intermediate user could finish in 5 min without yak-shaving env vars. That's the gap.",
  },
];

export const PATTERN_IDS: ReadonlyArray<string> = PATTERN_BANK.map((p) => p.patternId);

export function buildClassifierSystemPrompt(): string {
  const patterns = PATTERN_BANK.map(
    (p) =>
      `pattern_id: "${p.patternId}"\nmatches: ${p.matches}\nreply: ${JSON.stringify(p.reply)}`,
  ).join("\n\n");
  return `You are a comment-classifier for a HN/Reddit/dev.to launch-monitoring system.

You will be given the body of a comment posted on a launch announcement. Decide which (if any) of the 8 patterns below it matches. The 8 patterns capture the most common pushback / dismissal shapes seen on launch posts.

Return STRICT JSON ONLY (no prose, no fence) of shape:
{"patternId": string|null, "confidence": number, "suggestedReply": string|null}

Rules:
- confidence is a number 0..1.
- If confidence < ${CLASSIFIER_THRESHOLD}: patternId MUST be null AND suggestedReply MUST be null.
- If confidence >= ${CLASSIFIER_THRESHOLD}: patternId MUST be one of the 8 listed ids AND suggestedReply MUST be the EXACT reply text of that pattern, byte-for-byte, with no edits, no truncation, no paraphrasing.
- If the comment is positive, off-topic, or doesn't fit any pattern, return null/0.0/null.

Pattern bank:

${patterns}`;
}

// ---------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------

export interface ClassifierResult {
  patternId: string | null;
  confidence: number;
  suggestedReply: string | null;
}

function safeParseJson(raw: string): ClassifierResult | null {
  // Strip optional fenced block.
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced?.[1] ?? raw).trim();
  try {
    const parsed = JSON.parse(body) as {
      patternId?: unknown;
      confidence?: unknown;
      suggestedReply?: unknown;
    };
    const confidence =
      typeof parsed.confidence === "number" && Number.isFinite(parsed.confidence)
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0;
    const patternId =
      typeof parsed.patternId === "string" && PATTERN_IDS.includes(parsed.patternId)
        ? parsed.patternId
        : null;
    const suggestedReply =
      typeof parsed.suggestedReply === "string" ? parsed.suggestedReply : null;
    return { patternId, confidence, suggestedReply };
  } catch {
    return null;
  }
}

/** Apply the threshold + pattern-bank invariants regardless of what the model returned. */
export function enforceClassifierInvariants(raw: ClassifierResult): ClassifierResult {
  if (raw.confidence < CLASSIFIER_THRESHOLD) {
    return { patternId: null, confidence: raw.confidence, suggestedReply: null };
  }
  if (!raw.patternId || !PATTERN_IDS.includes(raw.patternId)) {
    return { patternId: null, confidence: raw.confidence, suggestedReply: null };
  }
  // Force the suggestedReply to the exact pattern-bank reply text.
  const entry = PATTERN_BANK.find((p) => p.patternId === raw.patternId);
  return {
    patternId: raw.patternId,
    confidence: raw.confidence,
    suggestedReply: entry?.reply ?? null,
  };
}

export async function classifyComment(commentBody: string): Promise<ClassifierResult> {
  const fallback: ClassifierResult = { patternId: null, confidence: 0, suggestedReply: null };
  if (!ANTHROPIC_API_KEY) {
    logger.warn("launch-comment-monitor: ANTHROPIC_API_KEY not set — skipping classification");
    return fallback;
  }
  if (!commentBody.trim()) return fallback;

  const system = buildClassifierSystemPrompt();
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: HAIKU_MODEL,
        max_tokens: 1024,
        // Cache the static pattern-bank system block — repeat polls within
        // a 5-minute window pay only the variable user-prompt tokens.
        system: [
          {
            type: "text",
            text: system,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [
          {
            role: "user",
            content: `Classify this comment:\n"""\n${commentBody}\n"""`,
          },
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "Unknown");
      logger.error(
        { status: res.status, err: errText },
        "launch-comment-monitor: Haiku classify failed",
      );
      return fallback;
    }
    const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
    const text = data.content[0]?.text || "";
    const parsed = safeParseJson(text);
    if (!parsed) {
      logger.warn({ text }, "launch-comment-monitor: classifier returned non-JSON");
      return fallback;
    }
    return enforceClassifierInvariants(parsed);
  } catch (err) {
    logger.error({ err }, "launch-comment-monitor: classify call threw");
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Platform pollers
// ---------------------------------------------------------------------------

export interface RawComment {
  externalCommentId: string;
  externalCommentUrl: string;
  author: string | null;
  body: string;
}

const USER_AGENT = "team-dashboard-comment-monitor/1.0";

export async function pollHN(externalId: string): Promise<RawComment[]> {
  const url = `https://hn.algolia.com/api/v1/search?tags=comment,story_${encodeURIComponent(
    externalId,
  )}&hitsPerPage=200`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.warn({ status: res.status, externalId }, "launch-comment-monitor: HN poll failed");
      return [];
    }
    const data = (await res.json()) as {
      hits?: Array<{
        objectID: string;
        author?: string;
        comment_text?: string;
      }>;
    };
    return (data.hits ?? [])
      .filter((h) => typeof h.comment_text === "string" && h.comment_text.trim().length > 0)
      .map((h) => ({
        externalCommentId: h.objectID,
        externalCommentUrl: `https://news.ycombinator.com/item?id=${h.objectID}`,
        author: h.author ?? null,
        body: stripHtml(h.comment_text || ""),
      }));
  } catch (err) {
    logger.error({ err, externalId }, "launch-comment-monitor: HN poll threw");
    return [];
  }
}

export async function pollReddit(externalId: string): Promise<RawComment[]> {
  const url = `https://www.reddit.com/comments/${encodeURIComponent(externalId)}.json`;
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) {
      logger.warn({ status: res.status, externalId }, "launch-comment-monitor: Reddit poll failed");
      return [];
    }
    const data = (await res.json()) as Array<{
      data?: { children?: Array<{ kind?: string; data?: RedditCommentNode }> };
    }>;
    const flat: RawComment[] = [];
    if (Array.isArray(data) && data[1]?.data?.children) {
      for (const child of data[1].data.children) {
        if (child.kind === "t1" && child.data) {
          walkRedditComment(child.data, flat);
        }
      }
    }
    return flat;
  } catch (err) {
    logger.error({ err, externalId }, "launch-comment-monitor: Reddit poll threw");
    return [];
  }
}

interface RedditCommentNode {
  id?: string;
  author?: string;
  body?: string;
  permalink?: string;
  replies?: { data?: { children?: Array<{ kind?: string; data?: RedditCommentNode }> } } | "";
}

function walkRedditComment(node: RedditCommentNode, out: RawComment[]): void {
  if (node.id && typeof node.body === "string" && node.body.trim()) {
    out.push({
      externalCommentId: `t1_${node.id}`,
      externalCommentUrl: node.permalink
        ? `https://www.reddit.com${node.permalink}`
        : `https://www.reddit.com/comments/${node.id}`,
      author: node.author ?? null,
      body: node.body,
    });
  }
  const replies = node.replies;
  if (replies && typeof replies === "object" && replies.data?.children) {
    for (const child of replies.data.children) {
      if (child.kind === "t1" && child.data) walkRedditComment(child.data, out);
    }
  }
}

export async function pollDevto(articleId: string): Promise<RawComment[]> {
  const apiKey = process.env.DEVTO_API_KEY;
  if (!apiKey) {
    logger.warn("launch-comment-monitor: DEVTO_API_KEY not set — skipping dev.to platform");
    return [];
  }
  const url = `https://dev.to/api/comments?a_id=${encodeURIComponent(articleId)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, "api-key": apiKey },
    });
    if (!res.ok) {
      logger.warn({ status: res.status, articleId }, "launch-comment-monitor: dev.to poll failed");
      return [];
    }
    const data = (await res.json()) as Array<DevtoCommentNode>;
    const flat: RawComment[] = [];
    for (const c of data) walkDevtoComment(c, flat);
    return flat;
  } catch (err) {
    logger.error({ err, articleId }, "launch-comment-monitor: dev.to poll threw");
    return [];
  }
}

interface DevtoCommentNode {
  id_code?: string;
  body_html?: string;
  user?: { username?: string };
  children?: DevtoCommentNode[];
}

function walkDevtoComment(node: DevtoCommentNode, out: RawComment[]): void {
  if (node.id_code && node.body_html) {
    out.push({
      externalCommentId: node.id_code,
      externalCommentUrl: `https://dev.to/comment/${node.id_code}`,
      author: node.user?.username ?? null,
      body: stripHtml(node.body_html),
    });
  }
  for (const child of node.children ?? []) walkDevtoComment(child, out);
}

function stripHtml(s: string): string {
  return s
    .replace(/<\/?[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface PollResult {
  trackedItemId: string;
  platform: string;
  fetched: number;
  inserted: number;
  newRowIds: string[];
}

export async function pollAllPlatforms(db: Db, companyId: string): Promise<PollResult[]> {
  const now = new Date();
  const items = await db
    .select()
    .from(launchTrackedItems)
    .where(
      and(
        eq(launchTrackedItems.companyId, companyId),
        eq(launchTrackedItems.active, true),
      ),
    );

  const results: PollResult[] = [];
  for (const item of items) {
    if (item.watchUntil < now) {
      // Auto-deactivate expired items.
      await db
        .update(launchTrackedItems)
        .set({ active: false })
        .where(eq(launchTrackedItems.id, item.id));
      continue;
    }

    let raw: RawComment[] = [];
    try {
      if (item.platform === "hn") raw = await pollHN(item.externalId);
      else if (item.platform === "reddit") raw = await pollReddit(item.externalId);
      else if (item.platform === "devto") raw = await pollDevto(item.externalId);
      else {
        logger.warn({ platform: item.platform }, "launch-comment-monitor: unknown platform");
      }
    } catch (err) {
      logger.error(
        { err, itemId: item.id, platform: item.platform },
        "launch-comment-monitor: poll threw",
      );
    }

    const newRowIds: string[] = [];
    let inserted = 0;
    for (const c of raw) {
      // Skip if we've already seen this external_comment_id (unique index will
      // also enforce this — onConflictDoNothing keeps us idempotent).
      const cls = await classifyComment(c.body);
      const status =
        cls.patternId && cls.suggestedReply
          ? "pending"
          : "needs_custom";
      const rows = await db
        .insert(commentReplies)
        .values({
          companyId,
          trackedItemId: item.id,
          platform: item.platform,
          externalCommentId: c.externalCommentId,
          externalCommentUrl: c.externalCommentUrl,
          author: c.author,
          commentBody: c.body,
          patternId: cls.patternId,
          confidence: cls.confidence != null ? cls.confidence.toFixed(2) : null,
          suggestedReply: cls.suggestedReply,
          status,
        })
        .onConflictDoNothing({
          target: [commentReplies.platform, commentReplies.externalCommentId],
        })
        .returning({ id: commentReplies.id });
      if (rows[0]?.id) {
        newRowIds.push(rows[0].id);
        inserted += 1;
      }
    }

    await db
      .update(launchTrackedItems)
      .set({ lastPolledAt: sql`now()` })
      .where(eq(launchTrackedItems.id, item.id));

    results.push({
      trackedItemId: item.id,
      platform: item.platform,
      fetched: raw.length,
      inserted,
      newRowIds,
    });
  }

  return results;
}
