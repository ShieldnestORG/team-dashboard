// ---------------------------------------------------------------------------
// Coherent Ones University — ad-attribution webhook side (M3).
//
// This is the WEBHOOK half of the ad-attribution feature. The M2 checkout half
// (services/university-attribution.ts) captured the click ids / UTM / landing
// context into the `university_attribution` row keyed on email, and flattened
// them into the Stripe Checkout Session METADATA under short `at_*` keys. Here,
// on the verified Stripe webhook, we:
//
//   1. GUARD every side-effect with an idempotency record keyed on the Stripe
//      `event.id` (university_attribution_events, UNIQUE on stripe_event_id). An
//      INSERT ... ON CONFLICT DO NOTHING that returns no row means the event was
//      already processed → we skip so Meta CAPI / TikTok never double-fire on a
//      Stripe redelivery. This is SEPARATE from the member/subscription upserts
//      in university-stripe-handler.ts (those are independently idempotent on
//      stripe_subscription_id); this guard exists specifically for the
//      not-naturally-idempotent CAPI/TikTok HTTP side-effects + the
//      append-only MRR/churn/refund ledger writes below.
//
//   2. On `checkout.session.completed` (product=university): read the `at_*`
//      attribution metadata back off the session, stamp the resolved Stripe
//      customer + subscription onto the per-lead attribution row, stamp the
//      acquisition campaign (utm_campaign / utm_source) onto the
//      `university_subscriptions` row so RENEWALS stay attributed (renewal
//      invoices carry no checkout metadata), and FIRE Meta CAPI `Purchase` +
//      TikTok `CompletePayment` best-effort using the stored fbc/fbp/ttclid, a
//      stable event_id (the Stripe checkout session id — see EVENT_ID below),
//      and the order value/currency.
//
//   3. On `invoice.paid` / `invoice.payment_failed` / `charge.refunded`: append
//      a ledger row to university_attribution_events so MRR / churn / refunds
//      are captured for marketing analytics. (We deliberately reuse the events
//      table as the ledger — it already carries event_type + payload JSONB + the
//      idempotency key.)
//
// BEST-EFFORT CONTRACT: nothing here may throw into the webhook. Every Stripe
// event must still 200 even if attribution stamping, the CAPI/TikTok calls, or
// a ledger write fails. The Meta/TikTok modules themselves already no-op safely
// when their env vars are unset (feature flag) and never throw; we additionally
// wrap everything in try/catch and log.
//
// ── event_id strategy (browser ↔ server dedup) ─────────────────────────────
// Meta and TikTok dedupe the server event against the browser Pixel event by a
// shared `event_id`. We derive it deterministically from the Stripe object id so
// it is STABLE across webhook redeliveries (same purchase → same event_id, so a
// redelivered webhook that somehow slipped past the idempotency guard still
// can't create a duplicate conversion) AND reproducible by the storefront
// thank-you page (which has the checkout session id in the success_url
// `session_id={CHECKOUT_SESSION_ID}` param and can emit the same id to the
// browser Pixel). Concretely: event_id = the Stripe Checkout Session id
// (`cs_...`). One purchase = one session = one event_id.
//
// ── FUTURE MERGE NOTE (referral-p2 branch) ─────────────────────────────────
// The referral-p2 branch's partner-network webhook (routes/directory-listings
// .ts) ALSO handles invoice.paid / invoice.payment_failed / charge.refunded for
// ITS OWN tables (partner_companies / commissions). These University handlers
// are additive and touch only University tables — there is no shared row. When
// the branches merge, the dispatch wiring in routes/university-checkout.ts is
// the only conflict surface; the ledger writes here stay University-scoped.
// ---------------------------------------------------------------------------

import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityAttribution,
  universityAttributionEvents,
  universitySubscriptions,
} from "@paperclipai/db";
import { sendPurchaseEvent } from "./meta-capi.js";
import { sendCompletePaymentEvent } from "./tiktok-events.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Narrow Stripe event shapes — only the fields we read. Mirrors the fetch-based
// (SDK-free) convention in university-stripe-handler.ts.
// ---------------------------------------------------------------------------

export interface AttributionStripeEvent {
  id: string;
  type: string;
  /**
   * Stripe `livemode`. Test-mode events (livemode=false) are recorded but kept
   * out of the production CAPI/TikTok fire + the MRR ledger so test traffic
   * doesn't pollute marketing data. Some embedded/legacy events omit it; absent
   * is treated as NOT live (safer — a missing flag won't fire prod conversions).
   */
  livemode?: boolean;
  data: { object: Record<string, unknown> };
}

interface CheckoutSessionObject {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  amount_total?: number | null; // minor units (cents)
  currency?: string | null;
  metadata?: Record<string, string> | null;
}

interface InvoiceObject {
  id?: string;
  customer?: string | null;
  subscription?: string | null;
  amount_paid?: number | null; // minor units
  amount_due?: number | null;
  currency?: string | null;
  billing_reason?: string | null;
  period_start?: number | null;
  period_end?: number | null;
  customer_email?: string | null;
}

interface ChargeObject {
  id?: string;
  customer?: string | null;
  invoice?: string | null;
  amount_refunded?: number | null; // minor units
  currency?: string | null;
  billing_details?: { email?: string | null } | null;
}

// ---------------------------------------------------------------------------
// Idempotency / replay guard.
// ---------------------------------------------------------------------------

/**
 * Record this Stripe event ONCE. Inserts the idempotency/ledger row keyed on the
 * Stripe `event.id` (UNIQUE). Returns true the FIRST time the event is seen
 * (caller proceeds with side-effects) and false on every redelivery (caller
 * skips so CAPI/TikTok never double-fire and the ledger never double-counts).
 *
 * Mirrors the insert(...).onConflictDoNothing(...).returning() idempotency
 * pattern in services/clawback.ts (recordClawback).
 *
 * Never throws: on a DB error it logs and returns false (fail-closed — better to
 * skip a side-effect than to risk a double-fire or to throw into the webhook).
 */
async function recordEventOnce(
  db: Db,
  event: AttributionStripeEvent,
  ctx: {
    email?: string | null;
    stripeCustomerId?: string | null;
    payload?: Record<string, unknown>;
  },
): Promise<boolean> {
  try {
    const [row] = await db
      .insert(universityAttributionEvents)
      .values({
        stripeEventId: event.id,
        eventType: event.type,
        email: ctx.email?.trim().toLowerCase() || null,
        stripeCustomerId: ctx.stripeCustomerId ?? null,
        payload: ctx.payload ?? null,
      })
      .onConflictDoNothing({
        target: universityAttributionEvents.stripeEventId,
      })
      .returning({ id: universityAttributionEvents.id });

    if (!row) {
      logger.info(
        { eventId: event.id, eventType: event.type },
        "university-attribution-webhook: event already processed — skipping side-effects",
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error(
      { err, eventId: event.id, eventType: event.type },
      "university-attribution-webhook: idempotency record failed (non-fatal) — skipping side-effects",
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// Attribution metadata read-back (the `at_*` keys written at checkout).
// ---------------------------------------------------------------------------

interface ReadAttribution {
  fbc?: string;
  fbp?: string;
  ttclid?: string;
  utmCampaign?: string;
  utmSource?: string;
}

/** Read the short `at_*` attribution keys back off the checkout metadata. */
function readAttributionMetadata(
  metadata: Record<string, string> | null | undefined,
): ReadAttribution {
  const m = metadata ?? {};
  const get = (k: string): string | undefined => {
    const v = m[k]?.trim();
    return v ? v : undefined;
  };
  return {
    fbc: get("at_fbc"),
    fbp: get("at_fbp"),
    ttclid: get("at_ttclid"),
    utmCampaign: get("at_utm_campaign"),
    utmSource: get("at_utm_source"),
  };
}

function emailFromSession(session: CheckoutSessionObject): string | null {
  const raw =
    session.metadata?.customerEmail
    || session.customer_details?.email
    || session.customer_email
    || null;
  return raw ? raw.trim().toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// checkout.session.completed — stamp acquisition + fire CAPI/TikTok.
// ---------------------------------------------------------------------------

/**
 * On a verified University checkout completion: stamp the resolved Stripe
 * customer + subscription onto the per-lead attribution row, stamp the
 * acquisition campaign onto the subscription so renewals stay attributed, and
 * fire Meta CAPI Purchase + TikTok CompletePayment best-effort.
 *
 * Idempotent via recordEventOnce on event.id. Best-effort throughout: every
 * step is wrapped so a failure never breaks the webhook.
 */
export async function handleAttributionCheckoutCompleted(
  db: Db,
  event: AttributionStripeEvent,
): Promise<void> {
  const session = event.data.object as CheckoutSessionObject;
  if (session.metadata?.product !== "university") return;

  const email = emailFromSession(session);
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  // Idempotency guard — record the event once. On a redelivery this returns
  // false and we skip every side-effect (no double Purchase / CompletePayment).
  const first = await recordEventOnce(db, event, {
    email,
    stripeCustomerId,
    payload: {
      sessionId: session.id,
      subscription: stripeSubscriptionId,
      amount_total: session.amount_total ?? null,
      currency: session.currency ?? null,
    },
  });
  if (!first) return;

  const attribution = readAttributionMetadata(session.metadata);

  // 1) Stamp the Stripe customer + subscription onto the per-lead attribution
  //    row (looked up by email). Best-effort; the row may not exist for an
  //    organic checkout that sent no attribution — that's fine.
  if (email) {
    try {
      // Resolve the local subscription row id (FK target) when we have one.
      let subscriptionRowId: string | null = null;
      if (stripeSubscriptionId) {
        const [subRow] = await db
          .select({ id: universitySubscriptions.id })
          .from(universitySubscriptions)
          .where(
            eq(
              universitySubscriptions.stripeSubscriptionId,
              stripeSubscriptionId,
            ),
          )
          .limit(1);
        subscriptionRowId = subRow?.id ?? null;
      }

      await db
        .update(universityAttribution)
        .set({
          stripeCustomerId:
            stripeCustomerId ?? sql`${universityAttribution.stripeCustomerId}`,
          subscriptionId:
            subscriptionRowId ?? sql`${universityAttribution.subscriptionId}`,
          updatedAt: new Date(),
        })
        .where(eq(universityAttribution.email, email));
    } catch (err) {
      logger.error(
        { err, email, eventId: event.id },
        "university-attribution-webhook: stamping customer/subscription onto attribution row failed (non-fatal)",
      );
    }
  }

  // 2) Stamp the acquisition campaign onto the subscription so a RENEWAL invoice
  //    (which carries no checkout metadata) still resolves the campaign. Only
  //    fill columns that are still NULL so a later event can't clobber them.
  if (stripeSubscriptionId && (attribution.utmCampaign || attribution.utmSource)) {
    try {
      await db
        .update(universitySubscriptions)
        .set({
          utmCampaign: sql`COALESCE(${universitySubscriptions.utmCampaign}, ${attribution.utmCampaign ?? null})`,
          utmSource: sql`COALESCE(${universitySubscriptions.utmSource}, ${attribution.utmSource ?? null})`,
          updatedAt: new Date(),
        })
        .where(
          eq(
            universitySubscriptions.stripeSubscriptionId,
            stripeSubscriptionId,
          ),
        );
    } catch (err) {
      logger.error(
        { err, stripeSubscriptionId, eventId: event.id },
        "university-attribution-webhook: stamping campaign onto subscription failed (non-fatal)",
      );
    }
  }

  // 3) Fire the conversions. Test-mode events do NOT fire prod conversions.
  if (event.livemode !== true) {
    logger.info(
      { eventId: event.id, livemode: event.livemode },
      "university-attribution-webhook: non-live checkout — skipping CAPI/TikTok fire",
    );
    return;
  }
  if (!email) return;
  // A real checkout.session.completed always carries a session id; guard for
  // the TS-narrowing + the (impossible) malformed case rather than fire a
  // conversion with an empty/undefined dedup key.
  if (!session.id) return;

  // event_id strategy: the Stripe Checkout Session id (stable + browser-side
  // reproducible). One purchase = one session = one event_id.
  const eventId = session.id;
  // Stripe amount_total is in MINOR units (cents); CAPI/TikTok want MAJOR units.
  const value = (session.amount_total ?? 0) / 100;
  const currency = (session.currency ?? "usd").toUpperCase();

  // Both calls are best-effort. The modules no-op when unconfigured and never
  // throw, but we still isolate each so one failing can't affect the other.
  await fireConversions(eventId, email, value, currency, attribution, event.id);
}

/**
 * Fire Meta CAPI Purchase + TikTok CompletePayment. Each call is independent and
 * best-effort — a failure or no-op on one must not affect the other or the
 * webhook. The modules already log their own failures; we log a one-line summary.
 */
async function fireConversions(
  eventId: string,
  email: string,
  value: number,
  currency: string,
  attribution: ReadAttribution,
  stripeEventId: string,
): Promise<void> {
  try {
    const meta = await sendPurchaseEvent({
      eventId,
      email,
      value,
      currency,
      fbc: attribution.fbc,
      fbp: attribution.fbp,
    });
    logger.info(
      { eventId, stripeEventId, result: meta },
      "university-attribution-webhook: Meta CAPI Purchase dispatched",
    );
  } catch (err) {
    // sendPurchaseEvent is contractually no-throw; this is belt-and-braces.
    logger.error(
      { err, eventId, stripeEventId },
      "university-attribution-webhook: Meta CAPI Purchase threw unexpectedly (non-fatal)",
    );
  }

  try {
    const tiktok = await sendCompletePaymentEvent({
      eventId,
      email,
      value,
      currency,
      ttclid: attribution.ttclid,
    });
    logger.info(
      { eventId, stripeEventId, result: tiktok },
      "university-attribution-webhook: TikTok CompletePayment dispatched",
    );
  } catch (err) {
    logger.error(
      { err, eventId, stripeEventId },
      "university-attribution-webhook: TikTok CompletePayment threw unexpectedly (non-fatal)",
    );
  }
}

// ---------------------------------------------------------------------------
// invoice.paid — MRR / renewal ledger. (Recurring renewals carry no checkout
// metadata; the campaign was stamped onto the subscription at checkout above,
// so a downstream MRR query joins university_subscriptions.utm_campaign.)
// ---------------------------------------------------------------------------

/**
 * Record a paid invoice (MRR / renewal) to the attribution events ledger.
 * Idempotent on event.id. Best-effort: never throws into the webhook.
 *
 * NOTE (future merge — referral-p2): the partner-network webhook also handles
 * invoice.paid for partner_companies/commissions. This handler is University-
 * scoped (writes only university_attribution_events) and shares no row with it.
 */
export async function handleAttributionInvoicePaid(
  db: Db,
  event: AttributionStripeEvent,
): Promise<void> {
  const inv = event.data.object as InvoiceObject;
  await recordEventOnce(db, event, {
    email: inv.customer_email ?? null,
    stripeCustomerId: typeof inv.customer === "string" ? inv.customer : null,
    payload: {
      invoiceId: inv.id ?? null,
      subscription: typeof inv.subscription === "string" ? inv.subscription : null,
      amount_paid: inv.amount_paid ?? null,
      currency: inv.currency ?? null,
      billing_reason: inv.billing_reason ?? null,
      period_start: inv.period_start ?? null,
      period_end: inv.period_end ?? null,
      livemode: event.livemode ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// invoice.payment_failed — churn-risk / dunning ledger.
// ---------------------------------------------------------------------------

/**
 * Record a failed invoice payment (churn risk) to the ledger. Idempotent on
 * event.id. Best-effort: never throws.
 */
export async function handleAttributionInvoicePaymentFailed(
  db: Db,
  event: AttributionStripeEvent,
): Promise<void> {
  const inv = event.data.object as InvoiceObject;
  await recordEventOnce(db, event, {
    email: inv.customer_email ?? null,
    stripeCustomerId: typeof inv.customer === "string" ? inv.customer : null,
    payload: {
      invoiceId: inv.id ?? null,
      subscription: typeof inv.subscription === "string" ? inv.subscription : null,
      amount_due: inv.amount_due ?? null,
      currency: inv.currency ?? null,
      billing_reason: inv.billing_reason ?? null,
      livemode: event.livemode ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// charge.refunded — refund ledger. (We record the refund so net-revenue /
// refund-rate marketing analytics are honest. We do NOT auto-fire a negative
// Meta/TikTok event — that's a deliberate later decision, not a silent default.)
// ---------------------------------------------------------------------------

/**
 * Record a refund to the ledger. Idempotent on event.id. Best-effort: never
 * throws.
 */
export async function handleAttributionChargeRefunded(
  db: Db,
  event: AttributionStripeEvent,
): Promise<void> {
  const charge = event.data.object as ChargeObject;
  await recordEventOnce(db, event, {
    email: charge.billing_details?.email ?? null,
    stripeCustomerId:
      typeof charge.customer === "string" ? charge.customer : null,
    payload: {
      chargeId: charge.id ?? null,
      invoice: typeof charge.invoice === "string" ? charge.invoice : null,
      amount_refunded: charge.amount_refunded ?? null,
      currency: charge.currency ?? null,
      livemode: event.livemode ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Re-attach a resolved subscription row to the attribution row, used when the
// checkout webhook raced ahead of subscription creation. (Exported for the
// dispatcher / future callers; currently the inline lookup in
// handleAttributionCheckoutCompleted covers the common case.)
// ---------------------------------------------------------------------------

/**
 * Backfill `subscription_id` onto attribution rows that have a stripe_customer_id
 * but no linked subscription yet. Cheap, idempotent, best-effort. Not wired into
 * the hot path — kept for a reconcile cron if checkout consistently races.
 */
export async function backfillAttributionSubscription(
  db: Db,
  stripeCustomerId: string,
  subscriptionRowId: string,
): Promise<void> {
  try {
    await db
      .update(universityAttribution)
      .set({ subscriptionId: subscriptionRowId, updatedAt: new Date() })
      .where(
        and(
          eq(universityAttribution.stripeCustomerId, stripeCustomerId),
          isNull(universityAttribution.subscriptionId),
        ),
      );
  } catch (err) {
    logger.error(
      { err, stripeCustomerId, subscriptionRowId },
      "university-attribution-webhook: subscription backfill failed (non-fatal)",
    );
  }
}
