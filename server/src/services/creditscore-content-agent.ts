// ---------------------------------------------------------------------------
// CreditScore Content Agent (Cipher) — drafts AEO-optimized pages via Ollama.
//
// Calls Ollama Cloud (gemma4:31b by default on VPS2) to generate N HTML page
// drafts per active Growth+ subscription per month, targeting the signals
// the latest audit identified as weakest. Drafts land in
// creditscore_content_drafts with status=pending_review; a board admin
// approves/rejects via the routes at /api/creditscore/content-drafts.
//
// Quota per PRD: Growth = 2 pages/mo, Pro = 4 pages/mo.
// Owner agent: cipher (Technical Writer).
// LLM backend matches the rest of the content pipeline (SEO engine,
// compliance second-opinion primary). No Claude dependency.
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscoreContentDrafts,
  creditscoreReports,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { callOllamaChat, OLLAMA_MODEL } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

const DRAFTS_PER_TIER: Record<string, number> = {
  growth: 2,
  pro: 4,
};

interface AuditBreakdown {
  aiAccess?: { score: number; max: number; issues?: string[] };
  structuredData?: { score: number; max: number; schemas?: string[]; issues?: string[] };
  contentQuality?: { score: number; max: number; issues?: string[] };
  freshness?: { score: number; max: number; issues?: string[] };
  technical?: { score: number; max: number; issues?: string[] };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

function weakestSignals(resultJson: unknown): Array<{ name: string; gap: number; issues: string[] }> {
  if (!resultJson || typeof resultJson !== "object") return [];
  const breakdown = (resultJson as { breakdown?: AuditBreakdown }).breakdown;
  if (!breakdown) return [];
  const signals: Array<{ name: string; gap: number; issues: string[] }> = [];
  for (const [name, sig] of Object.entries(breakdown)) {
    if (!sig || typeof sig !== "object") continue;
    const { score, max, issues } = sig as { score?: number; max?: number; issues?: string[] };
    if (typeof score !== "number" || typeof max !== "number") continue;
    signals.push({
      name,
      gap: max - score,
      issues: Array.isArray(issues) ? issues : [],
    });
  }
  signals.sort((a, b) => b.gap - a.gap);
  return signals.filter((s) => s.gap > 0);
}

interface DraftPayload {
  title: string;
  slug: string;
  targetSignal: string;
  html: string;
  markdown: string;
}

async function askOllama(prompt: string): Promise<string | null> {
  try {
    const result = await callOllamaChat(
      [
        {
          role: "system",
          content:
            "You are Cipher, a technical writer specializing in AEO (AI Engine Optimization). Return ONLY a fenced JSON object, no prose before or after.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.7, maxTokens: 4096, timeoutMs: 180_000 },
    );
    return result.content || null;
  } catch (err) {
    logger.error(
      { err, model: OLLAMA_MODEL },
      "creditscore-content-agent: Ollama call failed",
    );
    return null;
  }
}

function parseDraftJson(raw: string, fallbackSignal: string): DraftPayload | null {
  // Expected format from the prompt: a fenced JSON object with keys
  // { title, slug, targetSignal, html, markdown }.
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = jsonMatch?.[1] ?? raw;
  try {
    const parsed = JSON.parse(body) as Partial<DraftPayload>;
    if (!parsed.title || !parsed.html) return null;
    return {
      title: parsed.title,
      slug: parsed.slug?.trim() || slugify(parsed.title),
      targetSignal: parsed.targetSignal?.trim() || fallbackSignal,
      html: parsed.html,
      markdown: parsed.markdown ?? "",
    };
  } catch {
    return null;
  }
}

function buildPrompt(args: {
  domain: string;
  targetSignal: string;
  gapDetail: string;
  issues: string[];
  priorTitles: string[];
}): string {
  const priorList = args.priorTitles.length
    ? `Previously drafted titles (do NOT duplicate):\n${args.priorTitles.map((t) => `- ${t}`).join("\n")}\n\n`
    : "";
  return `You are Cipher, a technical writer specializing in AEO (AI Engine Optimization). You draft pages that help websites rank in ChatGPT, Perplexity, Claude, and other AI answer engines.

Your task: draft ONE AEO-optimized web page for ${args.domain} that directly addresses their weakest audit signal.

Target signal: ${args.targetSignal} (${args.gapDetail})
Specific gaps: ${args.issues.join("; ") || "general improvement"}

${priorList}Requirements:
- Length: 600-900 words in the page body.
- Include FAQPage JSON-LD with 4-6 Q&A pairs embedded in a <script type="application/ld+json"> tag.
- Use H1, multiple H2s, at least one H3. Clear heading hierarchy.
- Write in a direct, factual tone that AI engines will extract verbatim.
- Include a brief intro paragraph that directly answers the page's central question.
- End with a short, non-pushy CTA.
- Do NOT use marketing hype or first-person plural ("we believe", "imagine if"). Write for an AI to cite.

Return ONLY a fenced JSON object, no prose before or after, with this exact shape:
\`\`\`json
{
  "title": "string (page title, 40-70 chars)",
  "slug": "kebab-case-url-slug",
  "targetSignal": "${args.targetSignal}",
  "html": "<!-- full HTML body starting with <h1> through the final </section>, including the JSON-LD script -->",
  "markdown": "# Title\\n\\n...same content in Markdown for easy review..."
}
\`\`\``;
}

export function creditscoreContentAgent(db: Db) {
  async function generateDraftsForSubscription(
    subscriptionId: string,
    opts: { cycleTag?: string; now?: Date } = {},
  ): Promise<{ generated: number; skipped: number; reason?: string }> {
    const [sub] = await db
      .select()
      .from(creditscoreSubscriptions)
      .where(eq(creditscoreSubscriptions.id, subscriptionId))
      .limit(1);

    if (!sub) return { generated: 0, skipped: 0, reason: "subscription not found" };
    if (!sub.domain) return { generated: 0, skipped: 0, reason: "subscription has no domain" };

    const quota = DRAFTS_PER_TIER[sub.tier];
    if (!quota) return { generated: 0, skipped: 0, reason: `tier ${sub.tier} has no draft quota` };

    const now = opts.now ?? new Date();
    const cycleTag = opts.cycleTag ?? now.toISOString().slice(0, 7); // "2026-04"

    // Idempotency — if we've already drafted this cycle, skip.
    const existingThisCycle = await db
      .select({ id: creditscoreContentDrafts.id })
      .from(creditscoreContentDrafts)
      .where(
        and(
          eq(creditscoreContentDrafts.subscriptionId, sub.id),
          eq(creditscoreContentDrafts.cycleTag, cycleTag),
        ),
      );
    if (existingThisCycle.length >= quota) {
      return { generated: 0, skipped: existingThisCycle.length, reason: "cycle already fulfilled" };
    }

    // Find latest complete audit for context.
    const [latestReport] = await db
      .select({ resultJson: creditscoreReports.resultJson, score: creditscoreReports.score })
      .from(creditscoreReports)
      .where(
        and(
          eq(creditscoreReports.subscriptionId, sub.id),
          eq(creditscoreReports.status, "complete"),
        ),
      )
      .orderBy(desc(creditscoreReports.createdAt))
      .limit(1);

    if (!latestReport) {
      return { generated: 0, skipped: 0, reason: "no complete audit yet" };
    }

    const signals = weakestSignals(latestReport.resultJson);
    if (!signals.length) {
      return { generated: 0, skipped: 0, reason: "audit has no exploitable gaps" };
    }

    // Pull prior titles across all cycles so we don't repeat ourselves.
    const priorDrafts = await db
      .select({ title: creditscoreContentDrafts.title })
      .from(creditscoreContentDrafts)
      .where(eq(creditscoreContentDrafts.subscriptionId, sub.id))
      .limit(50);
    const priorTitles = priorDrafts.map((d) => d.title);

    const needed = quota - existingThisCycle.length;
    let generated = 0;
    let skipped = 0;

    for (let i = existingThisCycle.length; i < existingThisCycle.length + needed; i += 1) {
      const signal = signals[i % signals.length];
      if (!signal) break;

      const prompt = buildPrompt({
        domain: sub.domain,
        targetSignal: signal.name,
        gapDetail: `${signal.gap} points below maximum`,
        issues: signal.issues,
        priorTitles,
      });

      const raw = await askOllama(prompt);
      if (!raw) {
        skipped += 1;
        continue;
      }
      const draft = parseDraftJson(raw, signal.name);
      if (!draft) {
        logger.warn(
          { subId: sub.id, cycleTag, cycleIndex: i },
          "creditscore-content-agent: could not parse Ollama response as draft JSON",
        );
        skipped += 1;
        continue;
      }

      await db.insert(creditscoreContentDrafts).values({
        subscriptionId: sub.id,
        domain: sub.domain,
        cycleTag,
        cycleIndex: i,
        title: draft.title,
        slug: draft.slug,
        targetSignal: draft.targetSignal,
        htmlDraft: draft.html,
        markdownDraft: draft.markdown,
        promptMeta: {
          model: OLLAMA_MODEL,
          signal: signal.name,
          gap: signal.gap,
          baseScore: latestReport.score,
        },
        status: "pending_review",
      });

      priorTitles.push(draft.title);
      generated += 1;
    }

    return { generated, skipped };
  }

  async function runMonthlyDraftCycle(): Promise<{ generated: number; skipped: number }> {
    const subs = await db
      .select({ id: creditscoreSubscriptions.id, tier: creditscoreSubscriptions.tier })
      .from(creditscoreSubscriptions)
      .where(
        and(
          inArray(creditscoreSubscriptions.tier, ["growth", "pro"]),
          or(
            eq(creditscoreSubscriptions.status, "active"),
            eq(creditscoreSubscriptions.status, "past_due"),
          ),
        ),
      );

    let generated = 0;
    let skipped = 0;
    for (const sub of subs) {
      try {
        const out = await generateDraftsForSubscription(sub.id);
        generated += out.generated;
        skipped += out.skipped;
      } catch (err) {
        logger.error(
          { err, subId: sub.id },
          "creditscore-content-agent: subscription drafting failed",
        );
        skipped += 1;
      }
    }
    logger.info(
      { generated, skipped, considered: subs.length },
      "creditscore:content-drafts — cycle complete",
    );
    return { generated, skipped };
  }

  async function listPendingDrafts(limit = 100) {
    return db
      .select()
      .from(creditscoreContentDrafts)
      .where(eq(creditscoreContentDrafts.status, "pending_review"))
      .orderBy(desc(creditscoreContentDrafts.createdAt))
      .limit(limit);
  }

  async function getDraft(id: string) {
    const rows = await db
      .select()
      .from(creditscoreContentDrafts)
      .where(eq(creditscoreContentDrafts.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function approveDraft(
    id: string,
    opts: { userId?: string; agentId?: string; reviewNotes?: string },
  ) {
    await db
      .update(creditscoreContentDrafts)
      .set({
        status: "approved",
        reviewNotes: opts.reviewNotes ?? null,
        reviewedByUserId: opts.userId ?? null,
        reviewedByAgentId: opts.agentId ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreContentDrafts.id, id));
  }

  async function rejectDraft(
    id: string,
    opts: { userId?: string; agentId?: string; reviewNotes?: string },
  ) {
    await db
      .update(creditscoreContentDrafts)
      .set({
        status: "rejected",
        reviewNotes: opts.reviewNotes ?? null,
        reviewedByUserId: opts.userId ?? null,
        reviewedByAgentId: opts.agentId ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreContentDrafts.id, id));
  }

  async function markPublished(id: string, publishedUrl: string) {
    await db
      .update(creditscoreContentDrafts)
      .set({
        status: "published",
        publishedUrl,
        publishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreContentDrafts.id, id));
  }

  return {
    generateDraftsForSubscription,
    runMonthlyDraftCycle,
    listPendingDrafts,
    getDraft,
    approveDraft,
    rejectDraft,
    markPublished,
  };
}
