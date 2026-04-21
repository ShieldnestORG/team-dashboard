import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  activityLog,
  affiliateEngagement,
  affiliateTiers,
  affiliates,
  commissions,
  companies,
  crmActivities,
  leaderboardSnapshots,
  partnerCompanies,
  payouts,
  promoCampaigns,
  referralAttribution,
} from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendTransactional, type EmailTemplate, type EmailVars } from "./email-templates.js";
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

// ---------------------------------------------------------------------------
// Phase 4 email template seams
// ---------------------------------------------------------------------------
// These template names are the contract between the Phase 4 crons below and
// the email-templates author. Until the corresponding `build*` functions are
// wired into the `sendTransactional` switch, the template names are cast to
// `EmailTemplate` — the same deliberate seam used for `affiliate-lock-expired`
// above. Remove the casts when the templates land.

export type BuildAffiliateTierUpgraded = (
  vars: EmailVars,
) => { subject: string; html: string; text: string };

export type BuildAffiliateReengagement = (
  vars: EmailVars,
) => { subject: string; html: string; text: string };

export type BuildAffiliateGiveawayWinner = (
  vars: EmailVars,
) => { subject: string; html: string; text: string };

const AFFILIATE_TIER_UPGRADED_TEMPLATE = "affiliate-tier-upgraded" as EmailTemplate;
const AFFILIATE_REENGAGEMENT_TEMPLATE = "affiliate-reengagement" as EmailTemplate;
const AFFILIATE_GIVEAWAY_WINNER_TEMPLATE = "affiliate-giveaway-winner" as EmailTemplate;

// Action key used to throttle re-engagement emails via activity_log.
// One row per delivery; the cron queries the most-recent row per affiliate
// and skips if it fired within the last 30 days.
const REENGAGEMENT_ACTIVITY_ACTION = "affiliate_reengagement_email";

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
        try {
          await sendTransactional(
            AFFILIATE_LOCK_EXPIRED_TEMPLATE,
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

  // ---------------------------------------------------------------------------
  // affiliate:tier-recompute — daily 05:00 UTC
  // ---------------------------------------------------------------------------
  // For each affiliate, compute lifetime paid commissions + count of active
  // paying partners, then match against `affiliateTiers` thresholds (highest
  // tier where minLifetimeCents <= lifetime AND minActivePartners <= activeCount).
  //
  // Upgrade-only by policy (see Phase 4 plan "Risk & Rollback"): if the new tier
  // sits at a higher displayOrder than the affiliate's current tier, we promote.
  // Never downgrade — a temporarily-quiet affiliate keeps their rate mid-deal.
  //
  // The webhook in routes/directory-listings.ts joins `affiliates.commissionRate`
  // on every commission insert, so updating `affiliates.commissionRate` here is
  // picked up by the very next invoice without any cache invalidation — the
  // `commissionRate stays the source of truth for the webhook but is recomputed
  // by the tier cron` line from the plan is satisfied by this pair.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:tier-recompute",
    schedule: "0 5 * * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const tiers = await db
        .select({
          id: affiliateTiers.id,
          name: affiliateTiers.name,
          displayOrder: affiliateTiers.displayOrder,
          commissionRate: affiliateTiers.commissionRate,
          minLifetimeCents: affiliateTiers.minLifetimeCents,
          minActivePartners: affiliateTiers.minActivePartners,
        })
        .from(affiliateTiers);

      if (tiers.length === 0) {
        logger.info({}, "affiliate:tier-recompute: no tier config — skipping");
        return { upgraded: 0, checked: 0 };
      }

      // Sort descending by displayOrder — we want the highest-tier match first.
      const tiersDesc = [...tiers].sort((a, b) => b.displayOrder - a.displayOrder);
      const tierByName = new Map(tiers.map((t) => [t.name, t]));

      const all = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
          tier: affiliates.tier,
          commissionRate: affiliates.commissionRate,
        })
        .from(affiliates);

      let upgraded = 0;
      let checked = 0;

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "info@coherencedaddy.com";
      const affiliateDashboardUrl =
        process.env.AFFILIATE_DASHBOARD_URL ?? "https://affiliates.coherencedaddy.com";

      for (const aff of all) {
        checked += 1;

        // Lifetime paid commissions — `paid` | `approved` | `scheduled_for_payout`
        // are all "earned" from the affiliate's perspective and count toward tier.
        const [lifetimeRow] = await db
          .select({
            lifetimeCents: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
          })
          .from(commissions)
          .where(
            and(
              eq(commissions.affiliateId, aff.id),
              inArray(commissions.status, ["paid", "approved", "scheduled_for_payout"]),
            ),
          );
        const lifetimeCents = lifetimeRow?.lifetimeCents ?? 0;

        // Active paying partners — distinct leads with commissions
        // joined to a partnerCompanies row where is_paying = true.
        const [activeRow] = await db
          .select({
            activeCount: sql<number>`count(distinct ${commissions.leadId})::int`,
          })
          .from(commissions)
          .innerJoin(partnerCompanies, eq(partnerCompanies.id, commissions.leadId))
          .where(
            and(
              eq(commissions.affiliateId, aff.id),
              eq(partnerCompanies.isPaying, true),
            ),
          );
        const activeCount = activeRow?.activeCount ?? 0;

        // Highest-tier match: scan descending by displayOrder.
        const matched = tiersDesc.find(
          (t) => t.minLifetimeCents <= lifetimeCents && t.minActivePartners <= activeCount,
        );
        if (!matched) continue;

        const current = tierByName.get(aff.tier);
        const currentOrder = current?.displayOrder ?? 0;

        if (matched.displayOrder <= currentOrder) {
          // Same tier or would-be downgrade — never downgrade.
          continue;
        }

        try {
          await db
            .update(affiliates)
            .set({
              tier: matched.name,
              commissionRate: matched.commissionRate,
              tierUpgradedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(affiliates.id, aff.id));

          upgraded += 1;

          try {
            await sendTransactional(
              AFFILIATE_TIER_UPGRADED_TEMPLATE,
              aff.email,
              {
                recipientName: aff.name,
                recipientEmail: aff.email,
                affiliateName: aff.name,
                tierName: matched.name,
                fromStatus: aff.tier,
                toStatus: matched.name,
                supportEmail,
                affiliateDashboardUrl,
                dashboardUrl: affiliateDashboardUrl,
              },
            );
          } catch (err) {
            logger.warn(
              { err, affiliateId: aff.id, toTier: matched.name },
              "affiliate:tier-recompute email delivery failed",
            );
          }
        } catch (err) {
          logger.error(
            { err, affiliateId: aff.id, toTier: matched.name },
            "affiliate:tier-recompute update failed",
          );
        }
      }

      logger.info({ checked, upgraded }, "affiliate:tier-recompute complete");
      return { upgraded, checked };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:leaderboard-snapshot — monthly on the 1st at 06:00 UTC
  // ---------------------------------------------------------------------------
  // Snapshots the prior calendar month's leaderboard: top 20 affiliates by
  // summed commission amounts (status in paid/approved/scheduled_for_payout)
  // whose `periodStart` lands inside the prior month.
  //
  // Idempotent via a pre-check against `leaderboardSnapshots.period` — the
  // schema does not define a unique constraint, so we check first and bail.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:leaderboard-snapshot",
    schedule: "0 6 1 * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const now = new Date();
      const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const nextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const year = priorMonth.getUTCFullYear();
      const month = String(priorMonth.getUTCMonth() + 1).padStart(2, "0");
      const period = `${year}-${month}`;

      // Idempotency guard — skip if the snapshot has already been written.
      const [existing] = await db
        .select({
          count: sql<number>`count(*)::int`,
        })
        .from(leaderboardSnapshots)
        .where(eq(leaderboardSnapshots.period, period));

      if ((existing?.count ?? 0) > 0) {
        logger.info(
          { period, existingCount: existing?.count },
          "affiliate:leaderboard-snapshot already recorded — skipping",
        );
        return { period, inserted: 0, skipped: true };
      }

      const ranked = await db
        .select({
          affiliateId: commissions.affiliateId,
          score: sql<number>`coalesce(sum(${commissions.amountCents}), 0)::int`,
        })
        .from(commissions)
        .where(
          and(
            inArray(commissions.status, ["paid", "approved", "scheduled_for_payout"]),
            gte(commissions.periodStart, priorMonth),
            lt(commissions.periodStart, nextMonth),
          ),
        )
        .groupBy(commissions.affiliateId)
        .orderBy(sql`sum(${commissions.amountCents}) desc`)
        .limit(20);

      if (ranked.length === 0) {
        logger.info({ period }, "affiliate:leaderboard-snapshot: no commissions for period");
        return { period, inserted: 0, skipped: false };
      }

      const rows = ranked.map((row, idx) => ({
        period,
        rank: idx + 1,
        affiliateId: row.affiliateId,
        // numeric column — drizzle accepts string.
        score: String(row.score ?? 0),
      }));

      await db.insert(leaderboardSnapshots).values(rows);

      logger.info(
        { period, inserted: rows.length },
        "affiliate:leaderboard-snapshot complete",
      );
      return { period, inserted: rows.length, skipped: false };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:inactive-reengagement — weekly Mondays at 14:00 UTC
  // ---------------------------------------------------------------------------
  // Find active, unsuspended affiliates whose last lead submission was >45d ago
  // (or who have never submitted). Email the `affiliate-reengagement` template,
  // throttled to one delivery per 30 days via `activity_log`.
  //
  // activity_log requires a companyId — we pick the companyId off the affiliate's
  // most-recent referred partnerCompany, falling back to any company in the
  // system if the affiliate has no leads yet.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:inactive-reengagement",
    schedule: "0 14 * * 1",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const now = new Date();
      const inactiveCutoff = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
      const throttleCutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const candidates = await db
        .select({
          id: affiliates.id,
          name: affiliates.name,
          email: affiliates.email,
          lastLeadSubmittedAt: affiliates.lastLeadSubmittedAt,
        })
        .from(affiliates)
        .where(
          and(
            eq(affiliates.status, "active"),
            isNull(affiliates.suspendedAt),
            or(
              isNull(affiliates.lastLeadSubmittedAt),
              lt(affiliates.lastLeadSubmittedAt, inactiveCutoff),
            ),
          ),
        );

      if (candidates.length === 0) {
        logger.info({}, "affiliate:inactive-reengagement: no candidates");
        return { emailed: 0, throttled: 0, skipped: 0 };
      }

      // Fallback companyId — picked once per run; used when the affiliate has
      // no referred leads yet and we therefore can't pull a companyId off a
      // partnerCompany row. activity_log requires a non-null companyId.
      const [fallbackCompany] = await db
        .select({ id: companies.id })
        .from(companies)
        .limit(1);
      const fallbackCompanyId = fallbackCompany?.id ?? null;

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "info@coherencedaddy.com";
      const affiliateDashboardUrl =
        process.env.AFFILIATE_DASHBOARD_URL ?? "https://affiliates.coherencedaddy.com";

      let emailed = 0;
      let throttled = 0;
      let skipped = 0;

      for (const aff of candidates) {
        // Throttle — skip if we've emailed this affiliate in the last 30 days.
        const [recent] = await db
          .select({ id: activityLog.id })
          .from(activityLog)
          .where(
            and(
              eq(activityLog.action, REENGAGEMENT_ACTIVITY_ACTION),
              eq(activityLog.entityType, "affiliate"),
              eq(activityLog.entityId, aff.id),
              gte(activityLog.createdAt, throttleCutoff),
            ),
          )
          .orderBy(desc(activityLog.createdAt))
          .limit(1);

        if (recent) {
          throttled += 1;
          continue;
        }

        // Resolve a companyId for the activity_log entry. Prefer the affiliate's
        // most-recent referred partnerCompany so logs are discoverable in the
        // right tenant; fall back to any system company otherwise.
        const [referred] = await db
          .select({ companyId: partnerCompanies.companyId })
          .from(partnerCompanies)
          .where(eq(partnerCompanies.affiliateId, aff.id))
          .orderBy(desc(partnerCompanies.createdAt))
          .limit(1);

        const companyId = referred?.companyId ?? fallbackCompanyId;
        if (!companyId) {
          // No company context available — cannot write activity_log, so we
          // skip rather than fire an untracked email (would defeat the throttle).
          skipped += 1;
          logger.warn(
            { affiliateId: aff.id },
            "affiliate:inactive-reengagement: no company context, skipping",
          );
          continue;
        }

        try {
          await sendTransactional(
            AFFILIATE_REENGAGEMENT_TEMPLATE,
            aff.email,
            {
              recipientName: aff.name,
              recipientEmail: aff.email,
              affiliateName: aff.name,
              supportEmail,
              affiliateDashboardUrl,
              dashboardUrl: affiliateDashboardUrl,
            },
          );
        } catch (err) {
          logger.warn(
            { err, affiliateId: aff.id },
            "affiliate:inactive-reengagement email delivery failed",
          );
          continue;
        }

        try {
          await db.insert(activityLog).values({
            companyId,
            actorType: "system",
            actorId: "affiliate-crons",
            action: REENGAGEMENT_ACTIVITY_ACTION,
            entityType: "affiliate",
            entityId: aff.id,
            details: {
              lastLeadSubmittedAt: aff.lastLeadSubmittedAt?.toISOString() ?? null,
            },
          });
        } catch (err) {
          logger.error(
            { err, affiliateId: aff.id },
            "affiliate:inactive-reengagement: activity_log write failed",
          );
        }

        emailed += 1;
      }

      logger.info(
        { emailed, throttled, skipped, candidateCount: candidates.length },
        "affiliate:inactive-reengagement complete",
      );
      return { emailed, throttled, skipped };
    },
  });

  // ---------------------------------------------------------------------------
  // affiliate:giveaway-eligibility — monthly on the 1st at 06:30 UTC
  // ---------------------------------------------------------------------------
  // For each promo campaign that ended LAST month, take the top 5 engagement
  // rows (ORDER BY score DESC) scoped to that campaign, mark them
  // `giveawayEligible = true`, and email each winner the giveaway template.
  // ---------------------------------------------------------------------------
  registerCronJob({
    jobName: "affiliate:giveaway-eligibility",
    schedule: "30 6 1 * *",
    ownerAgent: "nova",
    sourceFile: "affiliate-crons.ts",
    handler: async () => {
      const now = new Date();
      const priorMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

      const endedCampaigns = await db
        .select({
          id: promoCampaigns.id,
          name: promoCampaigns.name,
          giveawayPrize: promoCampaigns.giveawayPrize,
        })
        .from(promoCampaigns)
        .where(
          and(
            gte(promoCampaigns.endAt, priorMonthStart),
            lt(promoCampaigns.endAt, thisMonthStart),
          ),
        );

      if (endedCampaigns.length === 0) {
        logger.info({}, "affiliate:giveaway-eligibility: no ended campaigns");
        return { campaigns: 0, winners: 0, emailsSent: 0, emailsFailed: 0 };
      }

      const supportEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "info@coherencedaddy.com";
      const affiliateDashboardUrl =
        process.env.AFFILIATE_DASHBOARD_URL ?? "https://affiliates.coherencedaddy.com";

      let totalWinners = 0;
      let emailsSent = 0;
      let emailsFailed = 0;

      for (const campaign of endedCampaigns) {
        const winners = await db
          .select({
            engagementId: affiliateEngagement.id,
            affiliateId: affiliateEngagement.affiliateId,
            score: affiliateEngagement.score,
            affiliateEmail: affiliates.email,
            affiliateName: affiliates.name,
          })
          .from(affiliateEngagement)
          .innerJoin(affiliates, eq(affiliates.id, affiliateEngagement.affiliateId))
          .where(eq(affiliateEngagement.campaignId, campaign.id))
          .orderBy(desc(affiliateEngagement.score))
          .limit(5);

        if (winners.length === 0) continue;

        await db
          .update(affiliateEngagement)
          .set({ giveawayEligible: true })
          .where(inArray(affiliateEngagement.id, winners.map((w) => w.engagementId)));

        totalWinners += winners.length;

        for (const w of winners) {
          try {
            // campaignName + prize are giveaway-specific vars owned by the
            // template author; cast to EmailVars until the template lands.
            await sendTransactional(
              AFFILIATE_GIVEAWAY_WINNER_TEMPLATE,
              w.affiliateEmail,
              {
                recipientName: w.affiliateName,
                recipientEmail: w.affiliateEmail,
                affiliateName: w.affiliateName,
                supportEmail,
                affiliateDashboardUrl,
                dashboardUrl: affiliateDashboardUrl,
                campaignName: campaign.name,
                prize: campaign.giveawayPrize ?? undefined,
              } as unknown as EmailVars,
            );
            emailsSent += 1;
          } catch (err) {
            emailsFailed += 1;
            logger.warn(
              { err, affiliateId: w.affiliateId, campaignId: campaign.id },
              "affiliate:giveaway-eligibility email delivery failed",
            );
          }
        }
      }

      logger.info(
        {
          campaigns: endedCampaigns.length,
          winners: totalWinners,
          emailsSent,
          emailsFailed,
        },
        "affiliate:giveaway-eligibility complete",
      );

      return {
        campaigns: endedCampaigns.length,
        winners: totalWinners,
        emailsSent,
        emailsFailed,
      };
    },
  });
}
