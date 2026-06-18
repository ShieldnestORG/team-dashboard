// ---------------------------------------------------------------------------
// Directory Featured Listings — admin REST API
// Monetization layer on top of intel_companies. Admin-only (board actor).
// Stripe webhook is a separate router that must NOT go through JSON middleware
// re-parsing; we verify signature using req.rawBody captured by the global
// express.json({ verify }) callback in app.ts.
// ---------------------------------------------------------------------------

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliates,
  commissions,
  intelCompanies,
  partnerCompanies,
  referralAttribution,
} from "@paperclipai/db";
import {
  directoryListingsService,
  LISTING_TIERS,
  type ListingTierSlug,
} from "../services/directory-listings.js";
import { verifyStripeSignature, stripeRequest } from "../services/stripe-client.js";
import { decrementUnsentPayouts } from "../services/payout-adjust.js";
import { recordClawback } from "../services/clawback.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";
import { logger } from "../middleware/logger.js";
import { sendTransactional } from "../services/email-templates.js";

// Phase 3 — attribution-type-aware commission rate.
// led_cd_finalized pays a 25% bonus over the default rate; cd_direct pays 0
// (the rep was the acquirer). referred / assisted / admin_override all pay
// the affiliate's default commissionRate.
function rateForAttribution(
  attributionType: string | null | undefined,
  defaultRate: string | null | undefined,
): string {
  const base = defaultRate ?? "0.10";
  switch (attributionType) {
    case "affiliate_led_cd_finalized":
      return String(Number(base) * 1.25);
    case "cd_direct":
      return "0";
    case "affiliate_referred_cd_closed":
    case "affiliate_assisted_cd_closed":
    case "admin_override":
    default:
      return base;
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.actor?.type !== "board") {
    res.status(401).json({ error: "Admin only" });
    return;
  }
  next();
}

export function directoryListingsRoutes(db: Db): Router {
  const router = Router();
  const svc = directoryListingsService(db);
  // Audit middleware attached alongside `requireAdmin` on every admin route.
  // The /public/enroll endpoint (further down) is the only non-admin route
  // in this router and is intentionally NOT logged.
  const audit = logAdminAccess(db);

  // GET /api/directory-listings/tiers — list tier config (admin)
  router.get("/tiers", requireAdmin, audit, (_req, res) => {
    res.json({
      tiers: Object.values(LISTING_TIERS).map((t) => ({
        slug: t.slug,
        label: t.label,
        monthlyPriceCents: t.monthlyPriceCents,
        stripePriceConfigured: !!process.env[t.priceIdEnv],
      })),
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  // GET /api/directory-listings/stats — counts + MRR
  router.get("/stats", requireAdmin, audit, async (_req, res) => {
    try {
      const stats = await svc.getStats();
      res.json(stats);
    } catch (err) {
      logger.error({ err }, "directory-listings: stats failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings — paginated list of companies + latest listing
  router.get("/", requireAdmin, audit, async (req, res) => {
    try {
      const directory = (req.query.directory as string | undefined) || undefined;
      const search = (req.query.search as string | undefined) || undefined;
      const status = (req.query.status as string | undefined) || "all";
      const limit = parseInt((req.query.limit as string) || "", 10) || 50;
      const offset = parseInt((req.query.offset as string) || "", 10) || 0;
      const result = await svc.listCompaniesWithListings({
        directory: directory === "all" ? undefined : directory,
        search,
        status,
        limit,
        offset,
      });
      res.json({ ...result, limit, offset });
    } catch (err) {
      logger.error({ err }, "directory-listings: list failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/company/:companyId — listings history for a company
  router.get("/company/:companyId", requireAdmin, audit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      const listings = await svc.getCompanyListings(companyId);
      res.json({ listings });
    } catch (err) {
      logger.error({ err }, "directory-listings: company listings failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/company/:companyId/traffic — attribution data
  router.get("/company/:companyId/traffic", requireAdmin, audit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      const data = await svc.getTrafficAttribution(companyId);
      if (!data) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      res.json(data);
    } catch (err) {
      logger.error({ err }, "directory-listings: traffic failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/directory-listings/company/:companyId/contact — update contact info
  router.patch("/company/:companyId/contact", requireAdmin, audit, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      await svc.upsertContact(companyId, {
        email: typeof req.body?.email === "string" ? req.body.email : undefined,
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        source: typeof req.body?.source === "string" ? req.body.source : "manual",
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: update contact failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/checkout — create Stripe Checkout session
  // body: { companyId, tier }
  router.post("/checkout", requireAdmin, audit, async (req, res) => {
    try {
      const companyId = Number(req.body?.companyId);
      const tier = req.body?.tier as ListingTierSlug;
      if (!companyId || !tier || !(tier in LISTING_TIERS)) {
        res.status(400).json({ error: "companyId and valid tier required" });
        return;
      }
      const result = await svc.createCheckoutSession({ companyId, tier });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "directory-listings: checkout failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/cancel — cancel subscription
  router.post("/:id/cancel", requireAdmin, audit, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      await svc.cancelListing(id);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: cancel failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/note — add freeform note
  router.post("/:id/note", requireAdmin, audit, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (Number.isNaN(id) || !note) {
        res.status(400).json({ error: "id and note required" });
        return;
      }
      await svc.addNote(id, note);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: note failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/outreach — mark outreach attempt
  router.post("/:id/outreach", requireAdmin, audit, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      const companyId = Number(req.body?.companyId);
      if (!companyId) {
        res.status(400).json({ error: "companyId required" });
        return;
      }
      const listingId = await svc.markOutreach(Number.isNaN(id) ? null : id, companyId);
      res.json({ ok: true, listingId });
    } catch (err) {
      logger.error({ err }, "directory-listings: outreach failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/:id/events — audit log for a listing
  router.get("/:id/events", requireAdmin, audit, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const events = await svc.getListingEvents(id);
      res.json({ events });
    } catch (err) {
      logger.error({ err }, "directory-listings: events failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/directory-listings/public/enroll — public self-serve enrollment
  // No auth required. Body: { companySlug, email, tier, contactName }
  // ---------------------------------------------------------------------------
  router.post("/public/enroll", async (req, res) => {
    try {
      const companySlug = typeof req.body?.companySlug === "string"
        ? req.body.companySlug.trim().toLowerCase()
        : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
      const tier = req.body?.tier as ListingTierSlug;
      const contactName = typeof req.body?.contactName === "string"
        ? req.body.contactName.trim()
        : "";

      if (!companySlug) {
        res.status(400).json({ error: "companySlug is required" });
        return;
      }
      if (!email || !email.includes("@")) {
        res.status(400).json({ error: "Valid email is required" });
        return;
      }
      if (!tier || !(tier in LISTING_TIERS)) {
        res.status(400).json({ error: "tier must be one of: featured, verified, boosted" });
        return;
      }

      // Look up or create a stub company
      const existing = await db
        .select()
        .from(intelCompanies)
        .where(eq(intelCompanies.slug, companySlug))
        .limit(1);

      let companyId: number;
      if (existing.length > 0) {
        companyId = existing[0].id;
        // Update contact email/name if missing
        const patch: Record<string, unknown> = {};
        if (!existing[0].contactEmail && email) patch.contactEmail = email;
        if (!existing[0].contactName && contactName) patch.contactName = contactName;
        if (Object.keys(patch).length > 0) {
          await db.update(intelCompanies).set(patch).where(eq(intelCompanies.id, companyId));
        }
      } else {
        // Create minimal stub
        const inserted = await db
          .insert(intelCompanies)
          .values({
            slug: companySlug,
            name: contactName || companySlug,
            category: "Unknown",
            directory: "crypto",
            description: "",
            contactEmail: email,
            contactName: contactName || null,
            contactSource: "self_serve",
          })
          .returning({ id: intelCompanies.id });
        companyId = inserted[0].id;
      }

      // Ensure contact email is set before checkout (required by createCheckoutSession)
      await db
        .update(intelCompanies)
        .set({ contactEmail: email, contactSource: "self_serve" })
        .where(eq(intelCompanies.id, companyId));

      // Create Stripe Checkout session (inserts checkout_sent listing row)
      const { url, listingId } = await svc.createCheckoutSession({ companyId, tier });

      logger.info({ companySlug, tier, listingId }, "directory-listings: public enroll checkout created");
      res.json({ checkoutUrl: url, sessionId: listingId });
    } catch (err) {
      logger.error({ err }, "directory-listings: public enroll failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Partner Network webhook handler (source = 'partner_network')
// Called inline from directoryListingsWebhookRoutes below.
// ---------------------------------------------------------------------------
async function handlePartnerStripeEvent(
  db: Db,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<void> {
  const obj = event.data.object;
  logger.info({ type: event.type }, "partner-network: stripe event");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = obj as {
        id: string;
        customer?: string;
        subscription?: string;
        invoice?: string;
        amount_total?: number;
        metadata?: Record<string, string>;
      };
      const partnerSlug = session.metadata?.partner_slug;
      if (!partnerSlug) {
        logger.warn({ sessionId: session.id }, "partner-network: missing partner_slug in metadata");
        return;
      }

      // Fetch subscription for period_end.
      let currentPeriodEnd: Date | null = null;
      if (session.subscription) {
        try {
          const sub = await stripeRequest<{ current_period_end: number }>(
            "GET",
            `/subscriptions/${session.subscription}`,
          );
          currentPeriodEnd = new Date(sub.current_period_end * 1000);
        } catch (err) {
          logger.warn({ err }, "partner-network: subscription fetch failed");
        }
      }

      await db
        .update(partnerCompanies)
        .set({
          stripeCustomerId: session.customer ?? undefined,
          stripeSubscriptionId: session.subscription ?? undefined,
          subscriptionStatus: "active",
          currentPeriodEnd,
          status: "active",
          isPaying: true,
          convertedAt: sql`now()`,
          updatedAt: sql`now()`,
        })
        .where(eq(partnerCompanies.slug, partnerSlug));

      logger.info({ partnerSlug, subscription: session.subscription }, "partner-network: subscription activated");

      // Send partner welcome email if we have a contact email
      {
        const rows = await db
          .select()
          .from(partnerCompanies)
          .where(eq(partnerCompanies.slug, partnerSlug))
          .limit(1);
        const partner = rows[0];
        if (partner?.contactEmail) {
          const baseUrl = process.env.PAPERCLIP_PUBLIC_URL ?? "https://api.coherencedaddy.com";
          const dashUrl = `${baseUrl}/partner-dashboard/${partnerSlug}`;
          await sendTransactional("partner-welcome", partner.contactEmail, {
            recipientEmail: partner.contactEmail,
            recipientName: partner.contactName ?? undefined,
            companyName: partner.name,
            partnerDashboardUrl: dashUrl,
            partnerToken: partner.dashboardToken ?? undefined,
          });
        }
      }

      // Create the initial commission row if this lead has an active attribution.
      // Wrapped in try/catch so a commission failure never breaks activation.
      //
      // Rate source of truth: `affiliates.commissionRate` is JOINed on every
      // invocation — the Phase 4 `affiliate:tier-recompute` cron writes this
      // column when an affiliate's tier is promoted, so the very next webhook
      // event picks up the new rate with no cache to invalidate.
      try {
        const [attribution] = await db
          .select({
            attributionId: referralAttribution.id,
            affiliateId: referralAttribution.affiliateId,
            leadId: referralAttribution.leadId,
            rate: affiliates.commissionRate,
            attributionType: referralAttribution.attributionType,
            affiliateEmail: affiliates.email,
            affiliateName: affiliates.name,
            leadName: partnerCompanies.name,
          })
          .from(referralAttribution)
          .innerJoin(partnerCompanies, eq(partnerCompanies.id, referralAttribution.leadId))
          .innerJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
          .where(
            and(
              eq(partnerCompanies.slug, partnerSlug),
              isNull(referralAttribution.lockReleasedAt),
            ),
          )
          .limit(1);

        if (attribution) {
          const effectiveRate = rateForAttribution(attribution.attributionType, attribution.rate);
          if (effectiveRate === "0") {
            logger.info(
              { partnerSlug, attributionType: attribution.attributionType },
              "partner-network: skipping commission insert (rate=0 for attribution type)",
            );
          } else {
            const basisCents = session.amount_total ?? 0;
            const rateNum = Number(effectiveRate);
            const amountCents = Math.round(basisCents * rateNum);

            // `.returning()` gates the notification: a replayed webhook hits the
            // unique stripeInvoiceId index, onConflictDoNothing inserts no row,
            // and `inserted` is empty — so we never double-email the affiliate.
            const inserted = await db
              .insert(commissions)
              .values({
                affiliateId: attribution.affiliateId,
                leadId: attribution.leadId,
                attributionId: attribution.attributionId,
                type: "initial",
                rate: effectiveRate,
                amountCents,
                basisCents,
                periodStart: sql`now()`,
                periodEnd: currentPeriodEnd ?? sql`now()`,
                status: "pending_activation",
                stripeInvoiceId: session.invoice ?? session.id,
                holdExpiresAt: sql`now() + interval '30 days'`,
              })
              .onConflictDoNothing()
              .returning({ id: commissions.id });

            logger.info(
              {
                partnerSlug,
                affiliateId: attribution.affiliateId,
                amountCents,
                basisCents,
                attributionType: attribution.attributionType,
                stripeInvoiceId: session.invoice ?? session.id,
              },
              "partner-network: initial commission created",
            );

            // Notify the affiliate a new commission landed. Fire-and-forget —
            // never blocks or throws out of the money path (mirrors the
            // affiliate-approved send in routes/affiliates.ts).
            if (inserted.length > 0 && attribution.affiliateEmail) {
              sendTransactional("affiliate-commission-created", attribution.affiliateEmail, {
                recipientName: attribution.affiliateName ?? undefined,
                recipientEmail: attribution.affiliateEmail,
                affiliateName: attribution.affiliateName ?? undefined,
                leadName: attribution.leadName ?? undefined,
                amountCents,
                type: "initial",
              }).catch(() => {});
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, partnerSlug, sessionId: session.id },
          "partner-network: commission insert failed (non-fatal)",
        );
      }
      break;
    }

    case "invoice.payment_succeeded":
    case "invoice.paid": {
      const inv = obj as {
        id?: string;
        subscription?: string;
        amount_paid?: number;
        period_start?: number;
        period_end?: number;
        billing_reason?: string;
      };
      if (!inv.subscription) return;
      const rows = await db
        .select({
          id: partnerCompanies.id,
          currentPeriodEnd: partnerCompanies.currentPeriodEnd,
          convertedAt: partnerCompanies.convertedAt,
        })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.stripeSubscriptionId, inv.subscription))
        .limit(1);
      if (rows.length === 0) return;
      await db
        .update(partnerCompanies)
        .set({
          subscriptionStatus: "active",
          isPaying: true,
          convertedAt: rows[0].convertedAt ?? sql`now()`,
          currentPeriodEnd: inv.period_end
            ? new Date(inv.period_end * 1000)
            : (rows[0].currentPeriodEnd ?? undefined),
          updatedAt: sql`now()`,
        })
        .where(eq(partnerCompanies.stripeSubscriptionId, inv.subscription));

      // Skip the initial invoice — it's handled by checkout.session.completed.
      if (inv.billing_reason === "subscription_create") break;

      // Create a recurring commission row if an active attribution exists for the
      // subscribed partner. Wrapped in try/catch so it can never break billing.
      //
      // Rate source of truth: same as checkout.session.completed above — the
      // JOIN on `affiliates.commissionRate` always returns the current value,
      // which is maintained by the Phase 4 `affiliate:tier-recompute` cron.
      try {
        if (!inv.id) break;

        const [row] = await db
          .select({
            leadId: partnerCompanies.id,
            attributionId: referralAttribution.id,
            affiliateId: referralAttribution.affiliateId,
            rate: affiliates.commissionRate,
            attributionType: referralAttribution.attributionType,
            affiliateEmail: affiliates.email,
            affiliateName: affiliates.name,
            leadName: partnerCompanies.name,
          })
          .from(partnerCompanies)
          .innerJoin(
            referralAttribution,
            and(
              eq(referralAttribution.leadId, partnerCompanies.id),
              isNull(referralAttribution.lockReleasedAt),
            ),
          )
          .innerJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
          .where(eq(partnerCompanies.stripeSubscriptionId, inv.subscription))
          .limit(1);

        if (!row) break;

        const effectiveRate = rateForAttribution(row.attributionType, row.rate);
        if (effectiveRate === "0") {
          logger.info(
            { invoiceId: inv.id, attributionType: row.attributionType },
            "partner-network: skipping recurring commission insert (rate=0 for attribution type)",
          );
          break;
        }

        const basisCents = inv.amount_paid ?? 0;
        const rateNum = Number(effectiveRate);
        const amountCents = Math.round(basisCents * rateNum);

        // `.returning()` gates the notification: a replayed renewal webhook
        // conflicts on the unique stripeInvoiceId index and inserts no row, so
        // `inserted` is empty and we never double-email the affiliate.
        const inserted = await db
          .insert(commissions)
          .values({
            affiliateId: row.affiliateId,
            leadId: row.leadId,
            attributionId: row.attributionId,
            type: "recurring",
            rate: effectiveRate,
            amountCents,
            basisCents,
            periodStart: inv.period_start ? new Date(inv.period_start * 1000) : sql`now()`,
            periodEnd: inv.period_end ? new Date(inv.period_end * 1000) : sql`now()`,
            status: "pending_activation",
            stripeInvoiceId: inv.id,
            holdExpiresAt: sql`now() + interval '30 days'`,
          })
          .onConflictDoNothing()
          .returning({ id: commissions.id });

        logger.info(
          {
            affiliateId: row.affiliateId,
            leadId: row.leadId,
            amountCents,
            basisCents,
            stripeInvoiceId: inv.id,
          },
          "partner-network: recurring commission created",
        );

        // Notify the affiliate a new recurring commission landed. Fire-and-forget
        // — never blocks or throws out of the money path.
        if (inserted.length > 0 && row.affiliateEmail) {
          sendTransactional("affiliate-commission-created", row.affiliateEmail, {
            recipientName: row.affiliateName ?? undefined,
            recipientEmail: row.affiliateEmail,
            affiliateName: row.affiliateName ?? undefined,
            leadName: row.leadName ?? undefined,
            amountCents,
            type: "recurring",
          }).catch(() => {});
        }
      } catch (err) {
        logger.error(
          { err, subscriptionId: inv.subscription, invoiceId: inv.id },
          "partner-network: recurring commission insert failed (non-fatal)",
        );
      }
      break;
    }

    case "invoice.payment_failed": {
      const inv = obj as { subscription?: string };
      if (!inv.subscription) return;
      await db
        .update(partnerCompanies)
        .set({ subscriptionStatus: "past_due", updatedAt: sql`now()` })
        .where(eq(partnerCompanies.stripeSubscriptionId, inv.subscription));
      break;
    }

    case "customer.subscription.deleted": {
      const sub = obj as { id?: string };
      if (!sub.id) return;
      await db
        .update(partnerCompanies)
        .set({
          subscriptionStatus: "canceled",
          status: "trial",
          updatedAt: sql`now()`,
        })
        .where(eq(partnerCompanies.stripeSubscriptionId, sub.id));
      logger.info({ subscriptionId: sub.id }, "partner-network: subscription canceled");
      break;
    }

    case "charge.refunded": {
      const charge = obj as { id?: string; invoice?: string };
      if (!charge.invoice) return;

      // If the commission was already paid, flag it 'clawed_back' (requires admin
      // follow-up). Otherwise it's simply 'reversed' — idempotent by state.
      // Already-terminal rows ('reversed'/'clawed_back') are left untouched so a
      // re-delivered refund webhook can't downgrade a 'clawed_back' row (money
      // disbursed, recovery needed) back to 'reversed' and lose that distinction.
      // If it was already batched (scheduled_for_payout) and the parent payout
      // hasn't been sent yet, decrement that payout's frozen total in the same
      // transaction so the batch doesn't pay out a refunded commission.
      try {
        await db.transaction(async (tx) => {
          // Snapshot the affected commissions' state BEFORE the flip so the
          // payout adjustment can see which ones were scheduled_for_payout.
          const affected = await tx
            .select({
              id: commissions.id,
              affiliateId: commissions.affiliateId,
              status: commissions.status,
              amountCents: commissions.amountCents,
              payoutBatchId: commissions.payoutBatchId,
            })
            .from(commissions)
            .where(eq(commissions.stripeInvoiceId, charge.invoice as string));

          if (affected.length === 0) return;

          await tx
            .update(commissions)
            .set({
              status: sql`CASE WHEN ${commissions.status} = 'paid' THEN 'clawed_back' ELSE 'reversed' END`,
              clawbackReason: "stripe_refund",
              updatedAt: sql`now()`,
            })
            .where(
              and(
                eq(commissions.stripeInvoiceId, charge.invoice as string),
                notInArray(commissions.status, ["reversed", "clawed_back"]),
              ),
            );

          await decrementUnsentPayouts(tx, affected);

          // Rows whose money was already disbursed ('paid' pre-flip → now
          // 'clawed_back') open a recovery obligation netted against future
          // payouts. recordClawback is idempotent (unique on source commission),
          // so a re-delivered refund webhook records nothing the second time.
          for (const c of affected) {
            if (c.status === "paid") {
              await recordClawback(tx, {
                affiliateId: c.affiliateId,
                sourceCommissionId: c.id,
                originAmountCents: c.amountCents,
                reason: "stripe_refund",
              });
            }
          }
        });

        logger.info(
          { chargeId: charge.id, invoiceId: charge.invoice },
          "partner-network: commission reversed/clawed_back on refund",
        );
      } catch (err) {
        logger.error(
          { err, chargeId: charge.id, invoiceId: charge.invoice },
          "partner-network: charge.refunded handler failed (non-fatal)",
        );
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Partner-event detection for metadata-less Stripe events.
//
// Stripe only stamps `metadata.source = 'partner_network'` on the Checkout
// Session. Recurring `invoice.*`, `customer.subscription.deleted`, and
// `charge.refunded` events carry no such marker, so we identify them by the
// IDs we persisted at checkout:
//   - invoice.* / customer.subscription.deleted → match the subscription id
//     against `partnerCompanies.stripeSubscriptionId`.
//   - charge.refunded → no subscription on the object; match the refunded
//     invoice id against an existing `commissions.stripeInvoiceId` (the only
//     definitive partner signal available, and the same key the refund handler
//     uses to reverse/claw back).
// Returns false for events that aren't partner-relevant (e.g.
// checkout.session.completed, which is routed by metadata above).
// ---------------------------------------------------------------------------
async function eventBelongsToPartner(
  db: Db,
  event: { type: string; data: { object: Record<string, unknown> } },
): Promise<boolean> {
  const obj = event.data.object;

  switch (event.type) {
    case "invoice.payment_succeeded":
    case "invoice.paid":
    case "invoice.payment_failed": {
      const subscription = (obj as { subscription?: string }).subscription;
      if (!subscription) return false;
      const [row] = await db
        .select({ id: partnerCompanies.id })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.stripeSubscriptionId, subscription))
        .limit(1);
      return !!row;
    }

    case "customer.subscription.deleted": {
      const subId = (obj as { id?: string }).id;
      if (!subId) return false;
      const [row] = await db
        .select({ id: partnerCompanies.id })
        .from(partnerCompanies)
        .where(eq(partnerCompanies.stripeSubscriptionId, subId))
        .limit(1);
      return !!row;
    }

    case "charge.refunded": {
      const invoice = (obj as { invoice?: string }).invoice;
      if (!invoice) return false;
      const [row] = await db
        .select({ id: commissions.id })
        .from(commissions)
        .where(eq(commissions.stripeInvoiceId, invoice))
        .limit(1);
      return !!row;
    }

    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Stripe webhook — separate mount, reads req.rawBody (captured by global
// express.json({ verify }) middleware in app.ts). No admin auth — signature
// is the auth.
// ---------------------------------------------------------------------------
export function directoryListingsWebhookRoutes(db: Db): Router {
  const router = Router();
  const svc = directoryListingsService(db);

  router.post("/webhook", async (req, res) => {
    // Use a dedicated secret so we can register this as a SEPARATE Stripe
    // webhook endpoint from /api/intel-billing/webhook (each Stripe endpoint
    // has its own signing secret). Falls back to STRIPE_WEBHOOK_SECRET if the
    // dedicated var is unset — useful for dev where one endpoint is fine.
    const secret =
      process.env.STRIPE_WEBHOOK_SECRET_DIRECTORY ||
      process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }
    const sig = req.headers["stripe-signature"];
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: "Missing raw body" });
      return;
    }
    if (!verifyStripeSignature(rawBody, typeof sig === "string" ? sig : undefined, secret)) {
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    try {
      const event = JSON.parse(rawBody.toString("utf8")) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      // Route to the right handler.
      //
      // `metadata.source` only exists on the Checkout Session — Stripe never
      // copies it onto the invoice / charge / subscription objects of the same
      // subscription, so recurring `invoice.paid` and `charge.refunded` events
      // arrive with NO source. Routing purely by `metadata.source` therefore
      // dropped every recurring commission and refund clawback. For those
      // metadata-less events we instead match the partner by the
      // `partnerCompanies.stripeSubscriptionId` we persisted at
      // checkout.session.completed (or by an existing commission row for the
      // refunded invoice). See `eventBelongsToPartner` below.
      const src = (event.data.object as { metadata?: Record<string, string> })?.metadata?.source;

      if (src === "partner_network") {
        await handlePartnerStripeEvent(db, event);
        res.json({ received: true });
        return;
      }

      if (await eventBelongsToPartner(db, event)) {
        await handlePartnerStripeEvent(db, event);
        res.json({ received: true });
        return;
      }

      if (event.type === "checkout.session.completed" && src !== "directory_listings") {
        // Let other webhook handlers (intel-billing) take it.
        res.json({ received: true, ignored: true });
        return;
      }
      await svc.handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: webhook handler failed");
      res.status(500).json({ error: "Webhook handler error" });
    }
  });

  return router;
}
