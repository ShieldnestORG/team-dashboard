// ---------------------------------------------------------------------------
// CreditScore Competitor Agent (Forge) — monthly competitor AEO scans.
//
// For each active Growth/Pro subscription, pulls the competitor list from
// the most recent complete audit, runs the audit pipeline against up to
// N competitor domains (Growth=3, Pro=5), and stores comparative results
// in creditscore_competitor_scans with a short gap summary.
//
// Owner agent: forge (already runs content:comparison:blog + content:aeo:blog).
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscoreCompetitorScans,
  creditscoreReports,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { runAudit, type AuditResult } from "../routes/audit.js";
import { logger } from "../middleware/logger.js";

const COMPETITORS_PER_TIER: Record<string, number> = {
  growth: 3,
  pro: 5,
};

interface CompetitorHint {
  domain: string;
}

function extractCompetitorDomains(resultJson: unknown): string[] {
  if (!resultJson || typeof resultJson !== "object") return [];
  const competitors = (resultJson as { competitors?: CompetitorHint[] }).competitors;
  if (!Array.isArray(competitors)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of competitors) {
    const raw = (c?.domain ?? "").toString().trim().toLowerCase();
    if (!raw) continue;
    const cleaned = raw.replace(/^(https?:\/\/)?(www\.)?/, "").split(/[/?#]/)[0];
    if (!cleaned || cleaned.startsWith("alt") || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

async function auditOnce(url: string): Promise<AuditResult | null> {
  let result: AuditResult | null = null;
  try {
    await runAudit(
      url,
      (ev) => {
        if (ev.type === "complete") result = ev.result;
      },
      () => false,
    );
  } catch (err) {
    logger.warn({ err, url }, "creditscore-competitor-agent: runAudit failed");
    return null;
  }
  return result;
}

function summarizeGap(customerScore: number, competitor: AuditResult): string {
  const delta = competitor.score - customerScore;
  const sign = delta > 0 ? "ahead" : delta < 0 ? "behind" : "tied";
  const topCompetitorStrength = Object.entries(competitor.breakdown)
    .sort(([, a], [, b]) => b.score / b.max - a.score / a.max)[0];
  const [signal, details] = topCompetitorStrength ?? [];
  const signalNote =
    signal && details
      ? ` Strongest signal: ${signal} (${details.score}/${details.max}).`
      : "";
  return `${Math.abs(delta)} pts ${sign}.${signalNote}`;
}

export function creditscoreCompetitorAgent(db: Db) {
  async function scanForSubscription(
    subscriptionId: string,
    opts: { cycleTag?: string; now?: Date } = {},
  ): Promise<{ scanned: number; skipped: number; reason?: string }> {
    const [sub] = await db
      .select()
      .from(creditscoreSubscriptions)
      .where(eq(creditscoreSubscriptions.id, subscriptionId))
      .limit(1);
    if (!sub) return { scanned: 0, skipped: 0, reason: "subscription not found" };
    if (!sub.domain) return { scanned: 0, skipped: 0, reason: "no domain" };

    const quota = COMPETITORS_PER_TIER[sub.tier];
    if (!quota) return { scanned: 0, skipped: 0, reason: `tier ${sub.tier} excluded` };

    const now = opts.now ?? new Date();
    const cycleTag = opts.cycleTag ?? now.toISOString().slice(0, 7);

    const existingThisCycle = await db
      .select({ id: creditscoreCompetitorScans.id })
      .from(creditscoreCompetitorScans)
      .where(
        and(
          eq(creditscoreCompetitorScans.subscriptionId, sub.id),
          eq(creditscoreCompetitorScans.cycleTag, cycleTag),
        ),
      );
    if (existingThisCycle.length >= quota) {
      return { scanned: 0, skipped: existingThisCycle.length, reason: "cycle already scanned" };
    }

    const [latestReport] = await db
      .select({
        id: creditscoreReports.id,
        score: creditscoreReports.score,
        resultJson: creditscoreReports.resultJson,
      })
      .from(creditscoreReports)
      .where(
        and(
          eq(creditscoreReports.subscriptionId, sub.id),
          eq(creditscoreReports.status, "complete"),
        ),
      )
      .orderBy(desc(creditscoreReports.createdAt))
      .limit(1);

    if (!latestReport) return { scanned: 0, skipped: 0, reason: "no complete audit yet" };

    const competitors = extractCompetitorDomains(latestReport.resultJson).slice(0, quota);
    if (!competitors.length) {
      return { scanned: 0, skipped: 0, reason: "no competitors in audit result" };
    }

    const customerScore = latestReport.score ?? 0;
    let scanned = 0;
    let skipped = 0;

    for (const competitorDomain of competitors) {
      const competitorUrl = `https://${competitorDomain}`;

      const [row] = await db
        .insert(creditscoreCompetitorScans)
        .values({
          subscriptionId: sub.id,
          parentReportId: latestReport.id,
          cycleTag,
          customerDomain: sub.domain,
          competitorDomain,
          status: "pending",
        })
        .returning({ id: creditscoreCompetitorScans.id });

      const result = await auditOnce(competitorUrl);
      if (!result) {
        await db
          .update(creditscoreCompetitorScans)
          .set({
            status: "failed",
            auditJson: { error: "runAudit returned no result" },
            updatedAt: new Date(),
          })
          .where(eq(creditscoreCompetitorScans.id, row!.id));
        skipped += 1;
        continue;
      }

      await db
        .update(creditscoreCompetitorScans)
        .set({
          status: "complete",
          competitorScore: result.score,
          customerScore,
          auditJson: result as unknown as Record<string, unknown>,
          gapSummary: summarizeGap(customerScore, result),
          updatedAt: new Date(),
        })
        .where(eq(creditscoreCompetitorScans.id, row!.id));

      scanned += 1;
    }

    return { scanned, skipped };
  }

  async function runMonthlyCompetitorCycle(): Promise<{ scanned: number; skipped: number }> {
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

    let scanned = 0;
    let skipped = 0;
    for (const sub of subs) {
      try {
        const out = await scanForSubscription(sub.id);
        scanned += out.scanned;
        skipped += out.skipped;
      } catch (err) {
        logger.error({ err, subId: sub.id }, "competitor-agent: subscription run failed");
        skipped += 1;
      }
    }
    logger.info(
      { scanned, skipped, considered: subs.length },
      "creditscore:competitor-scans — cycle complete",
    );
    return { scanned, skipped };
  }

  async function listForSubscription(subscriptionId: string, cycleTag?: string) {
    const conds = [eq(creditscoreCompetitorScans.subscriptionId, subscriptionId)];
    if (cycleTag) conds.push(eq(creditscoreCompetitorScans.cycleTag, cycleTag));
    return db
      .select()
      .from(creditscoreCompetitorScans)
      .where(and(...conds))
      .orderBy(desc(creditscoreCompetitorScans.createdAt));
  }

  return {
    scanForSubscription,
    runMonthlyCompetitorCycle,
    listForSubscription,
  };
}
