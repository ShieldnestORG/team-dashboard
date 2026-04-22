// ---------------------------------------------------------------------------
// CreditScore Schema Agent (Core) — generates JSON-LD per subscriber site.
//
// Pulls the latest complete audit per active Growth+ subscription, decides
// which schema.org types best address the gap (FAQPage for AEO coverage,
// Organization for brand clarity, Product/Article/LocalBusiness as fit),
// and generates ready-to-install JSON-LD + a copy-paste <script> snippet.
//
// Quota per PRD: Growth = 1 impl/mo, Pro = 2 impls/mo.
// Owner agent: core (Backend Dev). Runs via Ollama Cloud (gemma4:31b).
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscoreReports,
  creditscoreSchemaImpls,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { callOllamaChat, OLLAMA_MODEL } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

const IMPLS_PER_TIER: Record<string, number> = {
  growth: 1,
  pro: 2,
};

// schema.org types we're willing to generate. Ordered rough priority.
const SCHEMA_CANDIDATES = [
  "FAQPage",
  "Organization",
  "Article",
  "Product",
  "LocalBusiness",
  "BreadcrumbList",
  "WebSite",
] as const;

interface SchemaPayload {
  schemaType: string;
  jsonLd: Record<string, unknown>;
  htmlSnippet: string;
}

// Exported for unit testing.
export function pickSchemaType(
  resultJson: unknown,
  priorTypes: string[],
): (typeof SCHEMA_CANDIDATES)[number] {
  // Prefer FAQPage if the audit shows no structured data at all.
  if (resultJson && typeof resultJson === "object") {
    const breakdown = (resultJson as { breakdown?: { structuredData?: { schemas?: string[] } } })
      .breakdown;
    const existingSchemas = breakdown?.structuredData?.schemas ?? [];
    for (const candidate of SCHEMA_CANDIDATES) {
      if (!existingSchemas.includes(candidate) && !priorTypes.includes(candidate)) {
        return candidate;
      }
    }
  }
  // Fall back to the first candidate we haven't already delivered.
  for (const candidate of SCHEMA_CANDIDATES) {
    if (!priorTypes.includes(candidate)) return candidate;
  }
  return SCHEMA_CANDIDATES[0];
}

function buildPrompt(args: { domain: string; schemaType: string; brandContext: string }): string {
  return `You are Core, a backend developer generating schema.org JSON-LD for AEO optimization.

Generate a production-ready ${args.schemaType} JSON-LD block for ${args.domain}.

Context about the site: ${args.brandContext || "A business site with no structured data yet."}

Rules:
- Return a strictly valid JSON-LD object with "@context": "https://schema.org" and "@type": "${args.schemaType}".
- Include every field that AI engines rely on for that type:
  * FAQPage: 5-8 realistic Q&A pairs relevant to the domain.
  * Organization: name, url, logo (infer https://${args.domain}/logo.png), sameAs [], contactPoint.
  * Article: headline, author (Organization), datePublished, dateModified, mainEntityOfPage.
  * Product: name, description, brand, offers with priceSpecification.
  * LocalBusiness: name, address (best-guess), geo, openingHoursSpecification, telephone.
  * BreadcrumbList: itemListElement for a plausible 3-level hierarchy.
  * WebSite: url, name, potentialAction (SearchAction with urlTemplate).
- Use plausible, non-fictional values grounded in ${args.domain} — if you don't know something, use sensible defaults not placeholders like "XXX".
- Do NOT wrap in <script> tags — just the JSON-LD object.

Return ONLY a fenced JSON object, no prose before or after:
\`\`\`json
{ /* the full JSON-LD here */ }
\`\`\``;
}

// Exported for unit testing.
export function wrapInScript(jsonLd: Record<string, unknown>): string {
  return `<script type="application/ld+json">\n${JSON.stringify(jsonLd, null, 2)}\n</script>`;
}

async function askOllamaForSchema(prompt: string): Promise<Record<string, unknown> | null> {
  try {
    const result = await callOllamaChat(
      [
        {
          role: "system",
          content:
            "You are Core. Return ONLY a fenced JSON-LD object wrapped in ```json ... ```. No prose.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 2048, timeoutMs: 120_000 },
    );
    const raw = result.content || "";
    const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    const body = match?.[1] ?? raw;
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (parsed["@context"] !== "https://schema.org") {
      parsed["@context"] = "https://schema.org";
    }
    return parsed;
  } catch (err) {
    logger.error({ err }, "creditscore-schema-agent: Ollama call or JSON parse failed");
    return null;
  }
}

export function creditscoreSchemaAgent(db: Db) {
  async function generateImplsForSubscription(
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

    const quota = IMPLS_PER_TIER[sub.tier];
    if (!quota) return { generated: 0, skipped: 0, reason: `tier ${sub.tier} has no impl quota` };

    const now = opts.now ?? new Date();
    const cycleTag = opts.cycleTag ?? now.toISOString().slice(0, 7);

    const existingThisCycle = await db
      .select({ id: creditscoreSchemaImpls.id, schemaType: creditscoreSchemaImpls.schemaType })
      .from(creditscoreSchemaImpls)
      .where(
        and(
          eq(creditscoreSchemaImpls.subscriptionId, sub.id),
          eq(creditscoreSchemaImpls.cycleTag, cycleTag),
        ),
      );
    if (existingThisCycle.length >= quota) {
      return { generated: 0, skipped: existingThisCycle.length, reason: "cycle already fulfilled" };
    }

    const [latestReport] = await db
      .select({ resultJson: creditscoreReports.resultJson })
      .from(creditscoreReports)
      .where(
        and(
          eq(creditscoreReports.subscriptionId, sub.id),
          eq(creditscoreReports.status, "complete"),
        ),
      )
      .orderBy(desc(creditscoreReports.createdAt))
      .limit(1);

    const priorImpls = await db
      .select({ schemaType: creditscoreSchemaImpls.schemaType })
      .from(creditscoreSchemaImpls)
      .where(eq(creditscoreSchemaImpls.subscriptionId, sub.id))
      .limit(50);
    const priorTypes = priorImpls.map((r) => r.schemaType);

    const brandContext = (() => {
      if (!latestReport) return "";
      const scanned = (latestReport.resultJson as { url?: string }).url;
      return scanned ? `Audited URL: ${scanned}` : "";
    })();

    const needed = quota - existingThisCycle.length;
    let generated = 0;
    let skipped = 0;

    for (let i = existingThisCycle.length; i < existingThisCycle.length + needed; i += 1) {
      const schemaType = pickSchemaType(latestReport?.resultJson, priorTypes);
      const prompt = buildPrompt({
        domain: sub.domain,
        schemaType,
        brandContext,
      });

      const jsonLd = await askOllamaForSchema(prompt);
      if (!jsonLd) {
        skipped += 1;
        continue;
      }

      const payload: SchemaPayload = {
        schemaType,
        jsonLd,
        htmlSnippet: wrapInScript(jsonLd),
      };

      await db.insert(creditscoreSchemaImpls).values({
        subscriptionId: sub.id,
        domain: sub.domain,
        cycleTag,
        cycleIndex: i,
        schemaType: payload.schemaType,
        jsonLd: payload.jsonLd,
        htmlSnippet: payload.htmlSnippet,
        promptMeta: { model: OLLAMA_MODEL, schemaType },
        status: "pending_review",
      });

      priorTypes.push(schemaType);
      generated += 1;
    }

    return { generated, skipped };
  }

  async function runMonthlySchemaCycle(): Promise<{ generated: number; skipped: number }> {
    const subs = await db
      .select({ id: creditscoreSubscriptions.id })
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
        const out = await generateImplsForSubscription(sub.id);
        generated += out.generated;
        skipped += out.skipped;
      } catch (err) {
        logger.error(
          { err, subId: sub.id },
          "creditscore-schema-agent: subscription run failed",
        );
        skipped += 1;
      }
    }
    logger.info(
      { generated, skipped, considered: subs.length },
      "creditscore:schema-impls — cycle complete",
    );
    return { generated, skipped };
  }

  async function listPending(limit = 100) {
    return db
      .select()
      .from(creditscoreSchemaImpls)
      .where(eq(creditscoreSchemaImpls.status, "pending_review"))
      .orderBy(desc(creditscoreSchemaImpls.createdAt))
      .limit(limit);
  }

  async function getImpl(id: string) {
    const rows = await db
      .select()
      .from(creditscoreSchemaImpls)
      .where(eq(creditscoreSchemaImpls.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function approve(id: string, opts: { userId?: string; reviewNotes?: string }) {
    await db
      .update(creditscoreSchemaImpls)
      .set({
        status: "approved",
        reviewNotes: opts.reviewNotes ?? null,
        reviewedByUserId: opts.userId ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreSchemaImpls.id, id));
  }

  async function reject(id: string, opts: { userId?: string; reviewNotes?: string }) {
    await db
      .update(creditscoreSchemaImpls)
      .set({
        status: "rejected",
        reviewNotes: opts.reviewNotes ?? null,
        reviewedByUserId: opts.userId ?? null,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreSchemaImpls.id, id));
  }

  async function markDelivered(id: string) {
    await db
      .update(creditscoreSchemaImpls)
      .set({
        status: "delivered",
        deliveredAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(creditscoreSchemaImpls.id, id));
  }

  return {
    generateImplsForSubscription,
    runMonthlySchemaCycle,
    listPending,
    getImpl,
    approve,
    reject,
    markDelivered,
  };
}
