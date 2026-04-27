// ---------------------------------------------------------------------------
// Tutorials Marketing Agent (Scribe) — off-site distribution PILOT.
//
// Job:
//   Drafts long-form tutorial-distribution content from internal tutorial
//   sources into the off-site marketing surfaces:
//     - dev.to (long-form devrel)
//     - Hashnode (long-form devrel mirror)
//     - YouTube long-form scripts
//     - X tutorial-clip posts (short, link-back)
//   All drafts land in `marketing_drafts` with status=pending_review for
//   board admin review before publish.
//
// Forbidden zones (enforced by marketing-skill-registry assertCanWrite):
//   - umbrella.* feed (owned by Beacon)
//   - any creditscore.* / tokns.* channel (owned by Ledger / Mint)
//
// Cross-post protocol:
//   When a tutorial deserves umbrella amplification, Scribe writes a
//   `cross_post_request` row pointing at Beacon (TODO — table planned
//   in a follow-up PR). Scribe NEVER writes umbrella drafts directly.
//
// LLM: Claude API (model: claude-sonnet-4-6) with prompt caching on the
// system prompt + skill-rules block. Per CLAUDE.md guidance.
// ---------------------------------------------------------------------------

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { marketingDrafts } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import {
  assertCanWrite,
  type SkillKey,
} from "./marketing-skill-registry.js";

// Claude API Configuration. Per CLAUDE.md: default to latest model.
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
const SCRIBE_AGENT_KEY = "scribe" as const;

const SCRIBE_SYSTEM_PROMPT = `You are Scribe, the off-site tutorial-distribution writer for the Coherence Daddy ecosystem.

Your charter:
- Convert internal tutorial source material into channel-appropriate drafts for dev.to, Hashnode, YouTube long-form scripts, and X tutorial-clip posts.
- Preserve technical accuracy. Do not invent APIs, model names, or version numbers.
- Match the channel: dev.to/Hashnode want code-heavy long-form; YouTube wants spoken-cadence scripts with timestamps; X wants <280-char hooks with a single link-back.
- Never reference internal-only details (private repos, customer names, unreleased products).
- Output VALID JSON ONLY in a fenced code block, with the exact schema requested in the user prompt. No prose before or after.`;

interface ScribeTaskInput {
  companyId: string;
  ownerAgentId: string; // DB id of the Scribe agent in agents table
  channel: SkillKey; // must be a tutorials.* skill
  source: {
    title: string;
    body: string;
    canonicalUrl?: string;
  };
}

interface ScribeDraftPayload {
  title: string;
  body: string;
  hook?: string;
  hashtags?: string[];
  channel: string;
  meta: {
    model: string;
    sourceTitle: string;
    canonicalUrl?: string;
  };
}

function buildUserPrompt(channel: SkillKey, source: ScribeTaskInput["source"]): string {
  const channelGuidance: Partial<Record<SkillKey, string>> = {
    "tutorials.devto":
      "Draft a 1200-1800 word dev.to article. Include a TL;DR, code blocks where relevant, and a closing CTA linking to the canonical tutorial.",
    "tutorials.hashnode":
      "Draft a 1200-1800 word Hashnode article. Mirror dev.to structure but tune voice slightly more conversational.",
    "tutorials.youtube-long":
      "Draft a 6-10 minute YouTube long-form script. Use [00:00] timestamp markers per section. Include an intro hook, demo walkthrough, and outro CTA.",
    "tutorials.x-clip":
      "Draft a single X (Twitter) post under 280 chars. Lead with a hook, end with the canonical URL placeholder {{LINK}}. Include up to 3 relevant hashtags.",
    "paid-ads-creative.tutorials":
      "Draft 3 paid-ad creative variants for this tutorial: 1 headline + 1 primary text per variant, max 90 chars headline / 250 chars body.",
  };
  const guidance = channelGuidance[channel] ?? "Draft an off-site distribution piece for this tutorial.";
  return `Channel: ${channel}
Guidance: ${guidance}

Source tutorial title: ${source.title}
${source.canonicalUrl ? `Canonical URL: ${source.canonicalUrl}\n` : ""}Source body:
"""
${source.body}
"""

Return ONLY a fenced JSON object:
\`\`\`json
{
  "title": "string",
  "body": "string (channel-appropriate length)",
  "hook": "string (optional, for X / YouTube intro)",
  "hashtags": ["#optional", "#tags"]
}
\`\`\``;
}

async function askClaude(userPrompt: string): Promise<string | null> {
  if (!ANTHROPIC_API_KEY) {
    logger.error("tutorials-marketing-agent: ANTHROPIC_API_KEY not set");
    return null;
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 4096,
        // Prompt caching: cache the static system prompt so repeat
        // drafts within the 5-minute window pay only the input
        // tokens for the variable user prompt.
        system: [
          {
            type: "text",
            text: SCRIBE_SYSTEM_PROMPT,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => "Unknown");
      throw new Error(`Claude API error (${res.status}): ${err}`);
    }
    const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
    return data.content[0]?.text || null;
  } catch (err) {
    logger.error({ err, model: ANTHROPIC_MODEL }, "tutorials-marketing-agent: Claude call failed");
    return null;
  }
}

function parseDraftResponse(raw: string): { title: string; body: string; hook?: string; hashtags?: string[] } | null {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = jsonMatch?.[1] ?? raw;
  try {
    const parsed = JSON.parse(body) as { title?: string; body?: string; hook?: string; hashtags?: string[] };
    if (!parsed.title || !parsed.body) return null;
    return {
      title: parsed.title,
      body: parsed.body,
      hook: parsed.hook,
      hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : undefined,
    };
  } catch {
    return null;
  }
}

export function tutorialsMarketingAgent(db: Db) {
  async function draftFromTask(task: ScribeTaskInput): Promise<{ draftId: string | null; reason?: string }> {
    // Permission self-check — must be done before any write.
    assertCanWrite(task.channel, SCRIBE_AGENT_KEY);

    const userPrompt = buildUserPrompt(task.channel, task.source);
    const raw = await askClaude(userPrompt);
    if (!raw) return { draftId: null, reason: "claude call failed" };

    const parsed = parseDraftResponse(raw);
    if (!parsed) return { draftId: null, reason: "could not parse draft JSON" };

    const payload: ScribeDraftPayload = {
      title: parsed.title,
      body: parsed.body,
      hook: parsed.hook,
      hashtags: parsed.hashtags,
      channel: task.channel,
      meta: {
        model: ANTHROPIC_MODEL,
        sourceTitle: task.source.title,
        canonicalUrl: task.source.canonicalUrl,
      },
    };

    const [inserted] = await db
      .insert(marketingDrafts)
      .values({
        companyId: task.companyId,
        productScope: "tutorials",
        channel: task.channel,
        ownerAgentId: task.ownerAgentId,
        status: "pending_review",
        payload: payload as unknown as Record<string, unknown>,
      })
      .returning({ id: marketingDrafts.id });

    // TODO(beacon-cross-post): when this draft warrants umbrella amplification,
    // emit a row to the future `cross_post_requests` table:
    //   {
    //     id: uuid,
    //     sourceDraftId: inserted.id,
    //     requestingAgentId: <scribe agent id>,
    //     targetAgentKey: 'beacon',
    //     targetSkillKey: 'umbrella.x' | 'umbrella.blog' | ...,
    //     status: 'pending',
    //     createdAt: now()
    //   }
    // Beacon's queue picks these up, drafts the umbrella post, and
    // back-links via marketing_drafts.cross_post_of_draft_id.

    return { draftId: inserted?.id ?? null };
  }

  async function runScribeDraftQueue(opts: {
    companyId: string;
    ownerAgentId: string;
    tasks: ScribeTaskInput[];
  }): Promise<{ generated: number; skipped: number }> {
    let generated = 0;
    let skipped = 0;
    for (const t of opts.tasks) {
      try {
        const out = await draftFromTask(t);
        if (out.draftId) generated += 1;
        else skipped += 1;
      } catch (err) {
        logger.error({ err, channel: t.channel }, "tutorials-marketing-agent: task failed");
        skipped += 1;
      }
    }
    logger.info({ generated, skipped }, "tutorials:marketing-drafts — cycle complete");
    return { generated, skipped };
  }

  async function listPendingDrafts(companyId: string, limit = 100) {
    return db
      .select()
      .from(marketingDrafts)
      .where(
        and(
          eq(marketingDrafts.companyId, companyId),
          eq(marketingDrafts.productScope, "tutorials"),
          eq(marketingDrafts.status, "pending_review"),
        ),
      )
      .orderBy(desc(marketingDrafts.createdAt))
      .limit(limit);
  }

  return {
    draftFromTask,
    runScribeDraftQueue,
    listPendingDrafts,
  };
}

// Top-level convenience export to match the deliverable signature.
export async function runScribeDraftQueue(
  db: Db,
  opts: { companyId: string; ownerAgentId: string; tasks: ScribeTaskInput[] },
): Promise<{ generated: number; skipped: number }> {
  return tutorialsMarketingAgent(db).runScribeDraftQueue(opts);
}
