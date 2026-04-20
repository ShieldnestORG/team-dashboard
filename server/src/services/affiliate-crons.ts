import { and, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  commissions,
  partnerCompanies,
  payouts,
  referralAttribution,
} from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendTransactional } from "./email-templates.js";
import { logger } from "../middleware/logger.js";

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
}
