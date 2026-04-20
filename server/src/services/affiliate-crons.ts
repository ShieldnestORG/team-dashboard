import { and, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  commissions,
  crmActivities,
  partnerCompanies,
  payouts,
  referralAttribution,
} from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendTransactional, type EmailVars } from "./email-templates.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Affiliate lock-expired email helper signature
// ---------------------------------------------------------------------------
// Agent B (this file) fires the lock-expired email from the `affiliate:lock-expiration`
// cron, but the template itself is a follow-up owned by the template author.
// The exported signature below is the contract the template author will satisfy
// inside `email-templates.ts`:
//
//   export function buildAffiliateLockExpired(vars: EmailVars): { subject: string; html: string; text: string }
//
// Once that function is added and wired into the `sendTransactional` switch
// under the "affiliate-lock-expired" template name, this cron will deliver
// without further changes on our side. The cast to `EmailTemplate` below is
// the deliberate seam — remove it when the template is wired in.

export type BuildAffiliateLockExpired = (
  vars: EmailVars,
) => { subject: string; html: string; text: string };

const AFFILIATE_LOCK_EXPIRED_TEMPLATE = "affiliate-lock-expired";

export function startAffiliateCrons(db: Db): void {
  registerCronJob({
    jobName: "affiliate:pending-digest",
    schedule: "0 10 * * 1", // Monday 10 AM
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const pending = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
        })
        .from(affiliates)
        .where(eq(affiliates.status, "pending"));

      if (pending.length === 0) return { sent: 0 };

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "info@coherencedaddy.com";

      for (const affiliate of pending) {
        await sendTransactional("affiliate-pending-digest", affiliate.email, {
          recipientName: affiliate.name,
          recipientEmail: affiliate.email,
          affiliateName: affiliate.name,
          supportEmail,
        }).catch(() => {});
      }

      return { sent: pending.length };
    },
  });

  registerCronJob({
    jobName: "affiliate:lock-expiry",
    schedule: "0 3 * * *", // Daily 3 AM UTC
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      // Release expired attribution locks whose associated lead has NOT converted.
      // Conversion signal: partner_companies.is_paying = true → lock stays (referrer of record).
      // Single-statement UPDATE with an EXISTS subquery that requires is_paying = false.
      const now = new Date();
      const released = await db
        .update(referralAttribution)
        .set({ lockReleasedAt: now, updatedAt: now })
        .where(
          and(
            isNull(referralAttribution.lockReleasedAt),
            lt(referralAttribution.lockExpiresAt, sql`NOW()`),
            sql`EXISTS (
              SELECT 1 FROM ${partnerCompanies}
              WHERE ${partnerCompanies.id} = ${referralAttribution.leadId}
                AND ${partnerCompanies.isPaying} = false
            )`,
          ),
        )
        .returning({ id: referralAttribution.id });

      return { released: released.length };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:commission-maturation — daily 03:15 UTC
  // Promote pending_activation commissions whose hold window has lapsed.
  // Email notifications are owned by Agent D (not triggered here).
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:commission-maturation",
    schedule: "15 3 * * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const matured = await db
        .update(commissions)
        .set({ status: "approved", updatedAt: new Date() })
        .where(
          and(
            eq(commissions.status, "pending_activation"),
            lt(commissions.holdExpiresAt, sql`NOW()`),
          ),
        )
        .returning({ id: commissions.id });

      logger.info({ count: matured.length }, "affiliate:commission-maturation released");
      return { released: matured.length };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:payout-batcher — monthly on the 1st at 04:00 UTC
  // For each affiliate whose approved commissions sum >= minimumPayoutCents,
  // create a payouts row for the PRIOR month and flip those commissions to
  // scheduled_for_payout. Per-affiliate transactions so one failure can't
  // break the rest of the batch.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:payout-batcher",
    schedule: "0 4 1 * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      // Previous calendar month — formatted YYYY-MM in UTC.
      const now = new Date();
      const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const year = priorMonth.getUTCFullYear();
      const month = String(priorMonth.getUTCMonth() + 1).padStart(2, "0");
      const batchMonth = `${year}-${month}`;

      // Aggregate approved commissions per affiliate, joined with affiliate threshold.
      const candidates = await db
        .select({
          affiliateId: commissions.affiliateId,
          approvedCents: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
          commissionCount: sql<number>`count(*)::int`,
          minimumPayoutCents: affiliates.minimumPayoutCents,
          payoutMethod: affiliates.payoutMethod,
        })
        .from(commissions)
        .innerJoin(affiliates, eq(affiliates.id, commissions.affiliateId))
        .where(eq(commissions.status, "approved"))
        .groupBy(
          commissions.affiliateId,
          affiliates.minimumPayoutCents,
          affiliates.payoutMethod,
        );

      const scheduledFor = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      let batched = 0;
      let skipped = 0;
      let failed = 0;
      let totalCents = 0;

      for (const candidate of candidates) {
        const threshold = candidate.minimumPayoutCents ?? 5000;
        if (candidate.approvedCents < threshold) {
          skipped += 1;
          continue;
        }

        try {
          await db.transaction(async (tx) => {
            // Re-read the approved commissions inside the tx to grab the row ids
            // and lock them. (Idempotent retry: (affiliate_id, batch_month) unique
            // on payouts guarantees we can't double-insert a payout.)
            const approvedRows = await tx
              .select({ id: commissions.id, amountCents: commissions.amountCents })
              .from(commissions)
              .where(
                and(
                  eq(commissions.affiliateId, candidate.affiliateId),
                  eq(commissions.status, "approved"),
                ),
              );

            if (approvedRows.length === 0) return;

            const totalAmount = approvedRows.reduce((sum, r) => sum + r.amountCents, 0);
            if (totalAmount < threshold) return;

            const [payout] = await tx
              .insert(payouts)
              .values({
                affiliateId: candidate.affiliateId,
                amountCents: totalAmount,
                commissionCount: approvedRows.length,
                method: candidate.payoutMethod ?? "manual_ach",
                status: "scheduled",
                batchMonth,
                scheduledFor,
              })
              .returning({ id: payouts.id });

            if (!payout) {
              // Unique (affiliate_id, batch_month) hit — already batched for this
              // month. Safe to bail without mutating commissions.
              return;
            }

            await tx
              .update(commissions)
              .set({
                payoutBatchId: payout.id,
                status: "scheduled_for_payout",
                updatedAt: new Date(),
              })
              .where(
                and(
                  inArray(commissions.id, approvedRows.map((r) => r.id)),
                  eq(commissions.status, "approved"),
                ),
              );

            batched += 1;
            totalCents += totalAmount;
          });
        } catch (err) {
          failed += 1;
          logger.error(
            { err, affiliateId: candidate.affiliateId, batchMonth },
            "affiliate:payout-batcher per-affiliate transaction failed",
          );
        }
      }

      logger.info(
        {
          batchMonth,
          batched,
          skipped,
          failed,
          totalCents,
          candidateCount: candidates.length,
        },
        "affiliate:payout-batcher complete",
      );

      return { batchMonth, batched, skipped, failed, totalCents };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:lead-expiration — daily 03:30 UTC
  // Phase 3 CRM pipeline hygiene. Transitions stale leads between statuses:
  //   - submitted       (> 7d  since pipeline entry / last activity) → expired
  //   - demo_scheduled  (> 14d since last activity)                  → nurture
  //   - proposal_sent   (> 30d since last activity)                  → nurture
  // Each transition writes a crm_activities row with actor_type='system',
  // activity_type='status_change', and from/to_status set so the affiliate
  // timeline reflects the automated move. The SQL uses COALESCE(last_activity_at,
  // pipeline_entered_at, created_at) as the "age" reference so rows that have
  // never recorded an activity still age cleanly from submission time.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:lead-expiration",
    schedule: "30 3 * * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const now = new Date();

      // Reusable SQL fragment: effective age reference for a pipeline row.
      const ageRef = sql`COALESCE(${partnerCompanies.lastActivityAt}, ${partnerCompanies.pipelineEnteredAt}, ${partnerCompanies.createdAt})`;

      // Single pass per status transition. Each UPDATE returns the ids + the
      // fromStatus so we can mirror every transition into crm_activities.
      const transitions: Array<{
        fromStatus: string;
        toStatus: string;
        ageDays: number;
      }> = [
        { fromStatus: "submitted", toStatus: "expired", ageDays: 7 },
        { fromStatus: "demo_scheduled", toStatus: "nurture", ageDays: 14 },
        { fromStatus: "proposal_sent", toStatus: "nurture", ageDays: 30 },
      ];

      const results: Record<string, number> = {};
      let totalTransitioned = 0;

      for (const t of transitions) {
        const ageLimit = sql`NOW() - (${t.ageDays}::int * INTERVAL '1 day')`;

        const transitioned = await db
          .update(partnerCompanies)
          .set({
            leadStatus: t.toStatus,
            lastActivityAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(partnerCompanies.leadStatus, t.fromStatus),
              lt(ageRef, ageLimit),
            ),
          )
          .returning({ id: partnerCompanies.id });

        if (transitioned.length > 0) {
          await db.insert(crmActivities).values(
            transitioned.map((row) => ({
              leadId: row.id,
              actorType: "system",
              activityType: "status_change",
              fromStatus: t.fromStatus,
              toStatus: t.toStatus,
              visibleToAffiliate: true,
            })),
          );
        }

        results[`${t.fromStatus}_to_${t.toStatus}`] = transitioned.length;
        totalTransitioned += transitioned.length;
      }

      logger.info(
        { ...results, total: totalTransitioned },
        "affiliate:lead-expiration complete",
      );
      return { transitioned: totalTransitioned, ...results };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:lock-expiration — daily 03:45 UTC
  // Phase 3 companion to affiliate:lock-expiry. Releases attribution locks when:
  //   - lockExpiresAt < NOW()
  //   - lockReleasedAt IS NULL
  //   - the lead has NOT progressed past `qualified` (i.e. still in early pipeline)
  //
  // Progression-past-qualified is the Phase 3 signal that the lead is "in motion"
  // and attribution should not be released purely on timeout. Statuses that
  // represent progression past qualified: contacted, awaiting_response, interested,
  // demo_scheduled, proposal_sent, negotiation, won. (lost / expired / nurture
  // are terminal or cool-down and thus releasable.)
  //
  // Side effects per released row:
  //   1. attribution.lockReleasedAt = NOW()
  //   2. crm_activities row (actor_type=system, activity_type=lock_expired)
  //   3. Email to the referring affiliate via buildAffiliateLockExpired (stub — see top of file)
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:lock-expiration",
    schedule: "45 3 * * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const now = new Date();

      // Statuses that mean "lead has progressed past qualified" — attribution
      // stays locked for these regardless of timeout.
      const progressedStatuses = [
        "contacted",
        "awaiting_response",
        "interested",
        "demo_scheduled",
        "proposal_sent",
        "negotiation",
        "won",
      ];

      // Pull candidate rows first so we can email + write crm_activities per row.
      // (A single-UPDATE-then-query pattern would race against other writers
      // releasing the same lock; pulling-then-updating via id list is safe
      // because lockReleasedAt IS NULL is re-checked in the UPDATE.)
      const candidates = await db
        .select({
          attributionId: referralAttribution.id,
          leadId: referralAttribution.leadId,
          affiliateId: referralAttribution.affiliateId,
          affiliateEmail: affiliates.email,
          affiliateName: affiliates.name,
          leadName: partnerCompanies.name,
          leadStatus: partnerCompanies.leadStatus,
        })
        .from(referralAttribution)
        .innerJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
        .innerJoin(partnerCompanies, eq(partnerCompanies.id, referralAttribution.leadId))
        .where(
          and(
            isNull(referralAttribution.lockReleasedAt),
            lt(referralAttribution.lockExpiresAt, sql`NOW()`),
            // not progressed past qualified
            or(
              isNull(partnerCompanies.leadStatus),
              sql`${partnerCompanies.leadStatus} NOT IN (${sql.join(
                progressedStatuses.map((s) => sql`${s}`),
                sql`, `,
              )})`,
            ),
          ),
        );

      if (candidates.length === 0) {
        return { released: 0 };
      }

      const attributionIds = candidates.map((c) => c.attributionId);

      // Re-check lockReleasedAt IS NULL so concurrent releases don't double-fire.
      const released = await db
        .update(referralAttribution)
        .set({ lockReleasedAt: now, updatedAt: now })
        .where(
          and(
            inArray(referralAttribution.id, attributionIds),
            isNull(referralAttribution.lockReleasedAt),
          ),
        )
        .returning({ id: referralAttribution.id });

      const releasedIds = new Set(released.map((r) => r.id));
      const actualReleased = candidates.filter((c) => releasedIds.has(c.attributionId));

      if (actualReleased.length > 0) {
        await db.insert(crmActivities).values(
          actualReleased.map((c) => ({
            leadId: c.leadId,
            actorType: "system",
            activityType: "lock_expired",
            visibleToAffiliate: true,
          })),
        );
      }

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "info@coherencedaddy.com";
      const affiliateDashboardUrl =
        process.env.AFFILIATE_DASHBOARD_URL ?? "https://affiliates.coherencedaddy.com/leads";

      let emailsSent = 0;
      let emailsFailed = 0;

      for (const c of actualReleased) {
        // TODO: the "affiliate-lock-expired" template is owned by the template author.
        // buildAffiliateLockExpired signature is exported at the top of this file.
        // Once the template lands in email-templates.ts and joins the EmailTemplate
        // union, the `as` cast below becomes a clean named template dispatch.
        try {
          await sendTransactional(
            AFFILIATE_LOCK_EXPIRED_TEMPLATE as Parameters<typeof sendTransactional>[0],
            c.affiliateEmail,
            {
              recipientName: c.affiliateName,
              recipientEmail: c.affiliateEmail,
              affiliateName: c.affiliateName,
              leadName: c.leadName,
              supportEmail,
              affiliateDashboardUrl,
              dashboardUrl: affiliateDashboardUrl,
            },
          );
          emailsSent += 1;
        } catch (err) {
          emailsFailed += 1;
          logger.warn(
            { err, affiliateId: c.affiliateId, leadId: c.leadId },
            "affiliate:lock-expiration email delivery failed",
          );
        }
      }

      logger.info(
        {
          released: actualReleased.length,
          emailsSent,
          emailsFailed,
          candidateCount: candidates.length,
        },
        "affiliate:lock-expiration complete",
      );

      return {
        released: actualReleased.length,
        emailsSent,
        emailsFailed,
      };
    },
  });
}
