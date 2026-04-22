// ---------------------------------------------------------------------------
// CreditScore Report Agent (Sage) — fix-priority monthly digest.
//
// Complements creditscore:scan (which fires a report email when a rescan
// completes). The fix-priority digest is a separate cadence: on the 1st of
// each month we pull the most recent complete report for every active
// Starter+ subscription, extract the top-priority recommendation, and fire
// a coaching email ("here's your #1 AEO gap this month").
//
// Cron: creditscore:fix-priority-digest  — 1st of month, 9 AM UTC.
// Owner agent: sage (CMO).
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creditscoreReports, creditscoreSubscriptions } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import { logger } from "../middleware/logger.js";

interface RecommendationShape {
  priority: "high" | "medium" | "low";
  title: string;
  impact: string;
}

// Exported for unit testing.
export function extractTopRecommendation(resultJson: unknown): RecommendationShape | null {
  if (!resultJson || typeof resultJson !== "object") return null;
  const recs = (resultJson as { recommendations?: unknown }).recommendations;
  if (!Array.isArray(recs) || recs.length === 0) return null;
  const priorityRank = { high: 3, medium: 2, low: 1 } as const;
  const sorted = [...recs]
    .filter((r): r is RecommendationShape =>
      typeof r === "object" && r !== null && typeof (r as RecommendationShape).title === "string",
    )
    .sort(
      (a, b) =>
        (priorityRank[b.priority] ?? 0) - (priorityRank[a.priority] ?? 0),
    );
  return sorted[0] ?? null;
}

async function runFixPriorityDigest(db: Db): Promise<void> {
  const subs = await db
    .select({
      id: creditscoreSubscriptions.id,
      tier: creditscoreSubscriptions.tier,
      domain: creditscoreSubscriptions.domain,
      email: creditscoreSubscriptions.email,
    })
    .from(creditscoreSubscriptions)
    .where(
      and(
        inArray(creditscoreSubscriptions.tier, ["starter", "growth", "pro"]),
        or(
          eq(creditscoreSubscriptions.status, "active"),
          eq(creditscoreSubscriptions.status, "past_due"),
        ),
      ),
    );

  let sent = 0;
  let skipped = 0;

  for (const sub of subs) {
    if (!sub.email || !sub.domain) {
      skipped += 1;
      continue;
    }

    const last = await db
      .select({
        score: creditscoreReports.score,
        resultJson: creditscoreReports.resultJson,
        createdAt: creditscoreReports.createdAt,
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

    if (!last[0]) {
      skipped += 1;
      continue;
    }

    const topRec = extractTopRecommendation(last[0].resultJson);
    if (!topRec) {
      skipped += 1;
      continue;
    }

    void sendCreditscoreEmail({
      kind: "fix_priority_monthly",
      to: sub.email,
      data: {
        domain: sub.domain,
        tier: sub.tier,
        currentScore: last[0].score,
        lastReportAt: last[0].createdAt,
        topPriority: topRec,
      },
      messageId: `fix-priority-${sub.id}-${new Date().toISOString().slice(0, 7)}`,
    });

    sent += 1;
  }

  logger.info(
    { sent, skipped, considered: subs.length },
    "creditscore:fix-priority-digest — cycle complete",
  );
}

export function startCreditscoreReportAgent(db: Db): void {
  registerCronJob({
    jobName: "creditscore:fix-priority-digest",
    schedule: "0 9 1 * *", // 1st of month, 9 AM UTC
    ownerAgent: "sage",
    sourceFile: "creditscore-report-agent.ts",
    handler: () => runFixPriorityDigest(db),
  });
}

export { runFixPriorityDigest };
