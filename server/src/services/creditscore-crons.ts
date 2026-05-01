// ---------------------------------------------------------------------------
// CreditScore cron jobs.
//
// One job: creditscore:scan — every 6 hours, picks up active subscriptions
// whose last complete rescan is older than the tier's cadence, and kicks off
// a fresh audit. Pro = weekly, Starter/Growth = monthly. Report tier is
// one-time-only and ignored.
//
// Owner agent: auditor. See docs/products/creditscore-prd.md § Agent
// Assignments and docs/operations/cron-inventory.md § Product Fulfillment.
// ---------------------------------------------------------------------------

import { and, desc, eq, inArray, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creditscoreReports, creditscoreSubscriptions } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { creditscoreService, isDegradedAuditResult } from "./creditscore.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import { logger } from "../middleware/logger.js";

// Tier cadence in milliseconds.
const CADENCE_MS: Record<string, number> = {
  starter: 30 * 24 * 60 * 60 * 1000, // ~monthly
  growth: 30 * 24 * 60 * 60 * 1000, // ~monthly
  pro: 7 * 24 * 60 * 60 * 1000, // weekly
};

// Score-drop threshold that triggers an alert email.
const SCORE_DROP_ALERT_THRESHOLD = 10;

async function runScheduledScans(db: Db): Promise<void> {
  const svc = creditscoreService(db);
  const now = Date.now();

  const dueSubs = await db
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

  let enqueued = 0;
  let skipped = 0;

  for (const sub of dueSubs) {
    if (!sub.domain) {
      skipped += 1;
      continue;
    }
    const cadence = CADENCE_MS[sub.tier];
    if (!cadence) {
      skipped += 1;
      continue;
    }

    // When was the last complete report for this sub?
    const last = await db
      .select({
        score: creditscoreReports.score,
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

    const lastAt = last[0]?.createdAt?.getTime() ?? 0;
    if (lastAt && now - lastAt < cadence) {
      skipped += 1;
      continue;
    }

    const previousScore = last[0]?.score ?? null;

    try {
      const { result } = await svc.generateReport(sub.domain, {
        subscriptionId: sub.id,
        email: sub.email ?? undefined,
      });
      enqueued += 1;

      if (result && sub.email) {
        // Refuse to email customers off a degraded result. generateReport
        // already wrote status:"degraded" + score:null to the DB, but it
        // returns the in-memory AuditResult unchanged (with the bogus
        // score:30 / all-zero subscores), so without this guard the cron
        // would fire score_drop_alert / weekly_report / monthly_report
        // emails containing fake data the moment Firecrawl flapped.
        if (isDegradedAuditResult(result)) {
          logger.warn(
            { subId: sub.id, domain: sub.domain },
            "creditscore:scan — skipping email; rescan was degraded; will retry next cycle",
          );
          continue;
        }
        // Score-drop alert takes priority over the regular monthly report.
        if (
          typeof previousScore === "number" &&
          result.score <= previousScore - SCORE_DROP_ALERT_THRESHOLD
        ) {
          void sendCreditscoreEmail({
            kind: "score_drop_alert",
            to: sub.email,
            data: {
              url: result.url,
              previousScore,
              newScore: result.score,
              delta: result.score - previousScore,
              topIssues: result.recommendations.slice(0, 3).map((r) => r.title),
            },
          });
        } else {
          void sendCreditscoreEmail({
            kind: sub.tier === "pro" ? "weekly_report" : "monthly_report",
            to: sub.email,
            data: {
              url: result.url,
              score: result.score,
              breakdown: result.breakdown,
              competitors: result.competitors,
              recommendations: result.recommendations,
              previousScore,
            },
          });
        }
      }
    } catch (err) {
      logger.error(
        { err, subId: sub.id, domain: sub.domain },
        "creditscore:scan — generateReport failed for subscription",
      );
    }
  }

  logger.info(
    { enqueued, skipped, considered: dueSubs.length },
    "creditscore:scan — cycle complete",
  );
}

export function startCreditscoreCrons(db: Db): void {
  registerCronJob({
    jobName: "creditscore:scan",
    schedule: "0 */6 * * *", // every 6 hours
    ownerAgent: "auditor",
    sourceFile: "creditscore-crons.ts",
    handler: () => runScheduledScans(db),
  });
}

// Export for testing / manual trigger from services/creditscore.scheduleScans.
export { runScheduledScans };
