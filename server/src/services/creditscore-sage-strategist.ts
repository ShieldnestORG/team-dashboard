// ---------------------------------------------------------------------------
// CreditScore Sage Strategist — weekly 1-page action plan for Pro subs.
//
// Synthesizes the last complete audit, latest competitor scans, approved
// content drafts, and approved schema impls into a personal strategy doc.
// Stored in creditscore_strategy_docs and delivered via the storefront
// email callback (kind: sage_weekly_digest).
//
// Cron: creditscore:sage-weekly  — every Monday at 12:00 UTC.
// Owner agent: sage (CMO).
// ---------------------------------------------------------------------------

import { and, desc, eq, gte } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscoreCompetitorScans,
  creditscoreContentDrafts,
  creditscoreReports,
  creditscoreSchemaImpls,
  creditscoreStrategyDocs,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { callOllamaChat, OLLAMA_MODEL } from "./ollama-client.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import { logger } from "../middleware/logger.js";

function isoWeekTag(d: Date): string {
  // e.g. "2026-W17" — uses ISO 8601 week numbering, Monday as first day.
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((dt.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function startOfMondayUtc(d: Date): Date {
  const dt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = dt.getUTCDay() || 7;
  if (day !== 1) dt.setUTCDate(dt.getUTCDate() - (day - 1));
  return dt;
}

async function gatherContext(db: Db, subscriptionId: string) {
  const [latestReport] = await db
    .select({
      score: creditscoreReports.score,
      previousScore: creditscoreReports.previousScore,
      resultJson: creditscoreReports.resultJson,
      createdAt: creditscoreReports.createdAt,
    })
    .from(creditscoreReports)
    .where(
      and(
        eq(creditscoreReports.subscriptionId, subscriptionId),
        eq(creditscoreReports.status, "complete"),
      ),
    )
    .orderBy(desc(creditscoreReports.createdAt))
    .limit(1);

  const lookback = new Date();
  lookback.setUTCDate(lookback.getUTCDate() - 45);

  const competitorRows = await db
    .select({
      competitorDomain: creditscoreCompetitorScans.competitorDomain,
      competitorScore: creditscoreCompetitorScans.competitorScore,
      customerScore: creditscoreCompetitorScans.customerScore,
      gapSummary: creditscoreCompetitorScans.gapSummary,
    })
    .from(creditscoreCompetitorScans)
    .where(
      and(
        eq(creditscoreCompetitorScans.subscriptionId, subscriptionId),
        eq(creditscoreCompetitorScans.status, "complete"),
        gte(creditscoreCompetitorScans.createdAt, lookback),
      ),
    )
    .orderBy(desc(creditscoreCompetitorScans.createdAt))
    .limit(10);

  const contentDraftRows = await db
    .select({
      title: creditscoreContentDrafts.title,
      status: creditscoreContentDrafts.status,
      targetSignal: creditscoreContentDrafts.targetSignal,
    })
    .from(creditscoreContentDrafts)
    .where(
      and(
        eq(creditscoreContentDrafts.subscriptionId, subscriptionId),
        gte(creditscoreContentDrafts.createdAt, lookback),
      ),
    )
    .orderBy(desc(creditscoreContentDrafts.createdAt))
    .limit(10);

  const schemaImplRows = await db
    .select({
      schemaType: creditscoreSchemaImpls.schemaType,
      status: creditscoreSchemaImpls.status,
    })
    .from(creditscoreSchemaImpls)
    .where(
      and(
        eq(creditscoreSchemaImpls.subscriptionId, subscriptionId),
        gte(creditscoreSchemaImpls.createdAt, lookback),
      ),
    )
    .orderBy(desc(creditscoreSchemaImpls.createdAt))
    .limit(10);

  return { latestReport, competitorRows, contentDraftRows, schemaImplRows };
}

function buildPrompt(args: {
  domain: string;
  weekTag: string;
  report: { score: number | null; previousScore: number | null } | null;
  competitors: Array<{
    competitorDomain: string;
    competitorScore: number | null;
    customerScore: number | null;
    gapSummary: string | null;
  }>;
  drafts: Array<{ title: string; status: string; targetSignal: string | null }>;
  schemas: Array<{ schemaType: string; status: string }>;
}): string {
  const compLines = args.competitors
    .map(
      (c) =>
        `- ${c.competitorDomain}: competitor ${c.competitorScore ?? "?"} vs. you ${c.customerScore ?? "?"} — ${c.gapSummary ?? ""}`,
    )
    .join("\n") || "- (no recent competitor scans)";
  const draftLines = args.drafts
    .map((d) => `- "${d.title}" [${d.status}, signal: ${d.targetSignal ?? "n/a"}]`)
    .join("\n") || "- (no recent content drafts)";
  const schemaLines = args.schemas
    .map((s) => `- ${s.schemaType} [${s.status}]`)
    .join("\n") || "- (no recent schema implementations)";

  return `You are Sage, a CMO/strategist producing a weekly AEO action plan for ${args.domain}. Week: ${args.weekTag}.

Current state:
- Latest score: ${args.report?.score ?? "n/a"} (previously ${args.report?.previousScore ?? "n/a"})

Recent competitor scans:
${compLines}

Recent content drafts (from Cipher):
${draftLines}

Recent schema implementations (from Core):
${schemaLines}

Produce a concise, executive-level one-pager:
1. "This week's verdict" — 2-3 sentences: where you stand, biggest risk or win right now.
2. "Top 3 moves for next 7 days" — numbered, specific, actionable, each with a 1-line why.
3. "What to watch" — 1-2 indicators the customer should monitor this week.

Rules:
- Tone: direct, confident, no hype, no marketing fluff.
- Length: 250-400 words total.
- Reference the customer as "your" and use active voice.
- Do not invent data. If a section is empty, say so plainly and recommend collecting it.

Return a fenced JSON object:
\`\`\`json
{
  "html": "<section>...full HTML rendering with <h2>, <h3>, <ol>, <ul>...</section>",
  "markdown": "## This Week's Verdict\\n..."
}
\`\`\``;
}

async function askOllama(prompt: string): Promise<{ html: string; markdown: string } | null> {
  try {
    const res = await callOllamaChat(
      [
        {
          role: "system",
          content: "You are Sage, CMO. Return ONLY a fenced JSON object with html + markdown keys.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5, maxTokens: 3000, timeoutMs: 180_000 },
    );
    const raw = res.content || "";
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = match?.[1] ?? raw;
    const parsed = JSON.parse(body) as { html?: string; markdown?: string };
    if (!parsed.html) return null;
    return { html: parsed.html, markdown: parsed.markdown ?? "" };
  } catch (err) {
    logger.error({ err }, "creditscore-sage-strategist: Ollama call or parse failed");
    return null;
  }
}

export function creditscoreSageStrategist(db: Db) {
  async function generateForSubscription(
    subscriptionId: string,
    opts: { now?: Date } = {},
  ): Promise<{ generated: boolean; reason?: string }> {
    const [sub] = await db
      .select()
      .from(creditscoreSubscriptions)
      .where(eq(creditscoreSubscriptions.id, subscriptionId))
      .limit(1);
    if (!sub) return { generated: false, reason: "subscription not found" };
    if (sub.tier !== "pro") return { generated: false, reason: "non-Pro tier" };
    if (!sub.domain) return { generated: false, reason: "no domain" };

    const now = opts.now ?? new Date();
    const weekTag = isoWeekTag(now);
    const weekOf = startOfMondayUtc(now);

    const existing = await db
      .select({ id: creditscoreStrategyDocs.id })
      .from(creditscoreStrategyDocs)
      .where(
        and(
          eq(creditscoreStrategyDocs.subscriptionId, sub.id),
          eq(creditscoreStrategyDocs.cycleTag, weekTag),
        ),
      );
    if (existing.length) return { generated: false, reason: "already generated this week" };

    const ctx = await gatherContext(db, sub.id);

    const prompt = buildPrompt({
      domain: sub.domain,
      weekTag,
      report: ctx.latestReport
        ? { score: ctx.latestReport.score, previousScore: ctx.latestReport.previousScore }
        : null,
      competitors: ctx.competitorRows,
      drafts: ctx.contentDraftRows,
      schemas: ctx.schemaImplRows,
    });

    const output = await askOllama(prompt);
    if (!output) {
      await db.insert(creditscoreStrategyDocs).values({
        subscriptionId: sub.id,
        cycleTag: weekTag,
        weekOf,
        docHtml: "",
        docMarkdown: "",
        promptMeta: { model: OLLAMA_MODEL, failed: true },
        status: "failed",
      });
      return { generated: false, reason: "LLM produced no output" };
    }

    const [row] = await db
      .insert(creditscoreStrategyDocs)
      .values({
        subscriptionId: sub.id,
        cycleTag: weekTag,
        weekOf,
        docHtml: output.html,
        docMarkdown: output.markdown,
        promptMeta: { model: OLLAMA_MODEL },
        status: "draft",
      })
      .returning({ id: creditscoreStrategyDocs.id });

    if (sub.email) {
      void sendCreditscoreEmail({
        kind: "sage_weekly_digest",
        to: sub.email,
        data: {
          domain: sub.domain,
          weekTag,
          html: output.html,
          markdown: output.markdown,
          score: ctx.latestReport?.score ?? null,
        },
        messageId: `sage-weekly-${sub.id}-${weekTag}`,
      });
    }

    await db
      .update(creditscoreStrategyDocs)
      .set({ status: "delivered", deliveredAt: new Date(), updatedAt: new Date() })
      .where(eq(creditscoreStrategyDocs.id, row!.id));

    return { generated: true };
  }

  async function runWeeklyCycle(): Promise<{ generated: number; skipped: number }> {
    const subs = await db
      .select({ id: creditscoreSubscriptions.id })
      .from(creditscoreSubscriptions)
      .where(
        and(
          eq(creditscoreSubscriptions.tier, "pro"),
          eq(creditscoreSubscriptions.status, "active"),
        ),
      );

    let generated = 0;
    let skipped = 0;
    for (const sub of subs) {
      try {
        const r = await generateForSubscription(sub.id);
        if (r.generated) generated += 1;
        else skipped += 1;
      } catch (err) {
        logger.error({ err, subId: sub.id }, "sage-strategist: subscription run failed");
        skipped += 1;
      }
    }
    logger.info(
      { generated, skipped, considered: subs.length },
      "creditscore:sage-weekly — cycle complete",
    );
    return { generated, skipped };
  }

  async function listForSubscription(subscriptionId: string, limit = 12) {
    return db
      .select()
      .from(creditscoreStrategyDocs)
      .where(eq(creditscoreStrategyDocs.subscriptionId, subscriptionId))
      .orderBy(desc(creditscoreStrategyDocs.weekOf))
      .limit(limit);
  }

  return {
    generateForSubscription,
    runWeeklyCycle,
    listForSubscription,
  };
}
