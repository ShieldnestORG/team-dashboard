// ---------------------------------------------------------------------------
// Coherent Ones University — Stripe webhook handlers.
//
// A University member is its OWN member class (see schema/university.ts), so
// every Stripe event touches TWO rows: the member entity (university_members)
// and its billing record (university_subscriptions).
//
// Three handlers (one per Stripe event we care about for University):
//
//   handleUniversityCheckout(db, session)
//     - Fired on `checkout.session.completed` when the session metadata carries
//       `product = "university"`. Chains `linkStripeCustomerToAccount` so
//       portal-auth can later resolve the customer, upserts the
//       `university_subscriptions` row idempotently on stripe_subscription_id,
//       and upserts the `university_members` row (status active, account_id
//       linked, joined_at set).
//
//   handleUniversitySubscriptionUpdated(db, sub)
//     - Fired on `customer.subscription.updated`. Mirrors Stripe status onto
//       BOTH rows via mapStripeStatus:
//         active | trialing            → active
//         past_due | unpaid            → past_due
//         canceled | incomplete_expired → cancelled
//         (anything else, incl. paused) → leaves both rows untouched (no-op)
//       Note: unlike Watchtower, the University status CHECK is
//       (pending|active|past_due|cancelled) — there is no 'paused' member
//       state, so a Stripe `paused` is a deliberate no-op here.
//
//   handleUniversitySubscriptionDeleted(db, sub)
//     - Fired on `customer.subscription.deleted`. Sets status='cancelled' on
//       both rows and leaves them in place for history.
//
// All three handlers are idempotent. Replaying the same Stripe event must not
// create duplicate rows or corrupt state — `handleUniversityCheckout` looks up
// an existing subscription by `stripe_subscription_id` first and an existing
// member by `email`; the two subscription handlers are pure UPDATEs.
//
// Wiring: `universityWebhookRouter` (see routes/university-checkout.ts) owns
// the actual /api/university/webhook route. Each product mounts its own
// raw-body router before express.json — see app.ts. Mirrors the single-tier
// $X/mo Watchtower template (services/watchtower-stripe-handler.ts).
// ---------------------------------------------------------------------------

import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universitySubscriptions,
  universityVoiceAddons,
} from "@paperclipai/db";
import { linkStripeCustomerToAccount } from "./customer-account-linker.js";
import { logActivity } from "./activity-log.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import { sendBrevoEmail } from "./brevo.js";
import {
  UNIVERSITY_LOGIN_URL,
  UNIVERSITY_LESSON_URL,
  UNIVERSITY_MANAGE_BILLING_URL,
  UNIVERSITY_REJOIN_URL,
  planLabel,
  priceDisplay,
  firstNameFromDisplayName,
} from "./university-email.js";
import {
  resolvePlanKey,
  countUniversityMembers,
  foundingCap,
  isFoundingEligible,
} from "./university-founding.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

async function logUniversityActivity(
  db: Db,
  action: string,
  subscriptionId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await logActivity(db, {
      companyId: COMPANY_ID,
      actorType: "system",
      actorId: "university_stripe_webhook",
      action,
      entityType: "university_subscription",
      entityId: subscriptionId,
      details,
    });
  } catch (err) {
    logger.error(
      { err, action, subscriptionId },
      "university-stripe-handler: activity log failed (non-fatal)",
    );
  }
}

// ---------------------------------------------------------------------------
// Type shapes — narrow Stripe event objects to just what we touch.
// We intentionally avoid pulling in the full Stripe SDK types because the
// REST client in services/stripe-client.ts is fetch-based.
// ---------------------------------------------------------------------------

export interface UniversityCheckoutSession {
  id: string;
  customer?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | null;
  metadata?: Record<string, string> | null;
}

export interface UniversityStripeSubscription {
  id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

export interface UniversityCheckoutResult {
  subscriptionId: string;
  memberId: string;
  created: boolean;
  plan: string;
  founding: boolean;
}

export async function handleUniversityCheckout(
  db: Db,
  session: UniversityCheckoutSession,
): Promise<UniversityCheckoutResult | null> {
  const metadata = session.metadata ?? {};
  if (metadata.product !== "university") {
    // Defensive: caller should already have routed by metadata.product, but
    // guard so a misrouted event doesn't insert a junk row.
    return null;
  }

  const displayName = metadata.displayName?.trim() || null;
  // Plan key set at checkout ('university_monthly' | 'university_annual').
  // Normalize defensively; unknown/missing → monthly.
  const plan = resolvePlanKey(metadata.plan);
  const stripeCustomerId =
    typeof session.customer === "string" ? session.customer : null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;
  const sessionEmail =
    metadata.customerEmail
    || session.customer_details?.email
    || session.customer_email
    || null;
  const email = sessionEmail ? sessionEmail.trim().toLowerCase() : null;

  if (!email) {
    logger.warn(
      { sessionId: session.id, metadata },
      "university-stripe-handler: missing email in checkout metadata — skipping insert",
    );
    return null;
  }
  if (!stripeSubscriptionId) {
    logger.warn(
      { sessionId: session.id },
      "university-stripe-handler: checkout has no subscription id — skipping insert",
    );
    return null;
  }

  // Resolve account_id BEFORE the upserts so both the member and the
  // subscription point at the customer_accounts row from creation — this is
  // the shared magic-link login identity. Non-fatal on failure: rows are still
  // written with account_id=NULL and the email join still resolves the member.
  let accountId: string | null = null;
  if (stripeCustomerId) {
    try {
      const linked = await linkStripeCustomerToAccount(db, {
        email,
        stripeCustomerId,
      });
      accountId = linked?.accountId ?? null;
    } catch (err) {
      logger.error(
        { err, sessionId: session.id, email, stripeCustomerId },
        "university-stripe-handler: customer-account-linker failed (non-fatal) — rows inserted with account_id=NULL until manually relinked",
      );
    }
  }

  const now = new Date();

  // --- Subscription row (idempotent on stripe_subscription_id) ---
  const existingSub = await db
    .select({ id: universitySubscriptions.id })
    .from(universitySubscriptions)
    .where(
      eq(universitySubscriptions.stripeSubscriptionId, stripeSubscriptionId),
    )
    .limit(1);

  let subscriptionId: string;
  let created: boolean;
  if (existingSub[0]) {
    await db
      .update(universitySubscriptions)
      .set({
        status: "active",
        plan,
        stripeCustomerId,
        stripeCheckoutSessionId: session.id,
        email,
        accountId,
        updatedAt: now,
      })
      .where(eq(universitySubscriptions.id, existingSub[0].id))
      .returning({ id: universitySubscriptions.id });
    subscriptionId = existingSub[0].id;
    created = false;
  } else {
    const [row] = await db
      .insert(universitySubscriptions)
      .values({
        status: "active",
        plan,
        stripeCustomerId,
        stripeSubscriptionId,
        stripeCheckoutSessionId: session.id,
        email,
        accountId,
      })
      .returning({ id: universitySubscriptions.id });
    subscriptionId = row!.id;
    created = true;
  }

  // --- Member entity (idempotent on email) ---
  const existingMember = await db
    .select({ id: universityMembers.id })
    .from(universityMembers)
    .where(sql`LOWER(${universityMembers.email}) = ${email}`)
    .limit(1);

  let memberId: string;
  let founding: boolean;
  if (existingMember[0]) {
    // Re-activation / replay: NEVER recompute founding. A founder stays a
    // founder for life, and a late-comer must not be retro-promoted just
    // because they re-subscribed. We deliberately omit `founding` from the SET
    // so the stamped value is preserved, and read it back for the result/logs.
    const updated = await db
      .update(universityMembers)
      .set({
        status: "active",
        plan,
        accountId,
        displayName,
        joinedAt: now,
        updatedAt: now,
      })
      .where(eq(universityMembers.id, existingMember[0].id))
      .returning({
        id: universityMembers.id,
        founding: universityMembers.founding,
      });
    memberId = existingMember[0].id;
    founding = updated[0]?.founding ?? false;
  } else {
    // First activation: founding is decided ONCE, here, against the live count
    // of existing members (which excludes this not-yet-inserted one) versus the
    // configured cap. Stamped permanently — see schema/university.ts. The count
    // is best-effort; a failure defaults to non-founding so we never over-grant
    // the lifetime-locked rate by accident.
    let existingCount = Number.POSITIVE_INFINITY;
    try {
      existingCount = await countUniversityMembers(db);
    } catch (err) {
      logger.error(
        { err, sessionId: session.id, email },
        "university-stripe-handler: member count failed (non-fatal) — defaulting founding=false",
      );
    }
    founding = isFoundingEligible(existingCount, foundingCap());
    const [row] = await db
      .insert(universityMembers)
      .values({
        email,
        displayName,
        status: "active",
        plan,
        founding,
        accountId,
        joinedAt: now,
      })
      .returning({ id: universityMembers.id });
    memberId = row!.id;
  }

  // Backfill the subscription's member_id now that the member row exists.
  await db
    .update(universitySubscriptions)
    .set({ memberId, updatedAt: now })
    .where(eq(universitySubscriptions.id, subscriptionId))
    .returning({ id: universitySubscriptions.id });

  // Activation emails (welcome + receipt) — ONLY on a genuinely new member.
  // `created` is true exactly when the subscription row was INSERTed (the
  // UNIQUE stripe_subscription_id idempotency key found no existing row); a
  // Stripe webhook RETRY of the same checkout.session.completed takes the
  // UPDATE path (created=false), so gating here is what stops the welcome +
  // receipt from being double-sent on every replay.
  //
  // Non-fatal: a mail failure must never break the webhook (mirrors the
  // linkStripeCustomerToAccount try/catch above). Templates + FROM/voice live
  // storefront-side; we only post the envelope. The receipt amount/plan label
  // are plan-aware (monthly vs annual) via priceDisplay/planLabel.
  if (created) {
    const firstName = firstNameFromDisplayName(displayName);
    try {
      await sendCreditscoreEmail({
        kind: "university_welcome",
        to: email,
        data: {
          firstName,
          loginUrl: UNIVERSITY_LOGIN_URL,
          lessonUrl: UNIVERSITY_LESSON_URL,
        },
      });
    } catch (err) {
      logger.error(
        { err, email, kind: "university_welcome" },
        "university-stripe-handler: welcome email failed (non-fatal)",
      );
    }
    try {
      await sendCreditscoreEmail({
        kind: "university_receipt",
        to: email,
        data: {
          amount: priceDisplay(plan),
          dateISO: now.toISOString(),
          plan: planLabel(plan),
          manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
        },
      });
    } catch (err) {
      logger.error(
        { err, email, kind: "university_receipt" },
        "university-stripe-handler: receipt email failed (non-fatal)",
      );
    }

    // Owner alert — notify the business inbox of every NEW paying member (Brevo).
    // Non-fatal: a mail failure must never break the webhook.
    try {
      const ownerTo = process.env.OWNER_ALERT_EMAIL || "info@coherencedaddy.com";
      const fromAddr = process.env.ALERT_EMAIL_FROM || "info@coherencedaddy.com";
      await sendBrevoEmail({
        from: `Coherence Daddy <${fromAddr}>`,
        to: ownerTo,
        subject: `💸 New $50 member: ${email}`,
        html: `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#111">
          <h2 style="margin:0 0 12px">💸 New paying member</h2>
          <table style="border-collapse:collapse">
            <tr><td style="padding:2px 12px 2px 0;color:#666">Email</td><td><strong>${email}</strong></td></tr>
            <tr><td style="padding:2px 12px 2px 0;color:#666">Name</td><td>${displayName ?? "—"}</td></tr>
            <tr><td style="padding:2px 12px 2px 0;color:#666">Plan</td><td>${planLabel(plan)}</td></tr>
            <tr><td style="padding:2px 12px 2px 0;color:#666">When</td><td>${now.toISOString()}</td></tr>
          </table>
        </div>`,
      });
    } catch (err) {
      logger.error({ err, email }, "university-stripe-handler: owner alert failed (non-fatal)");
    }

    // Owner-legible dashboard feed line (separate from the audit log below, which
    // also covers the replay path). logUniversityActivity is itself non-fatal.
    await logUniversityActivity(db, "university.member.joined", subscriptionId, {
      email,
      displayName,
      plan,
      founding,
      memberId,
    });
  }

  logger.info(
    {
      sessionId: session.id,
      subscriptionId,
      memberId,
      stripeSubscriptionId,
      created,
      plan,
      founding,
      email,
    },
    "university-stripe-handler: checkout processed",
  );

  await logUniversityActivity(
    db,
    created
      ? "university.subscription.created"
      : "university.subscription.checkout_replayed",
    subscriptionId,
    {
      stripeSessionId: session.id,
      stripeSubscriptionId,
      stripeCustomerId,
      memberId,
      email,
      accountId,
      plan,
      founding,
    },
  );

  return { subscriptionId, memberId, created, plan, founding };
}

// ---------------------------------------------------------------------------
// customer.subscription.updated
// ---------------------------------------------------------------------------

export type UniversityStatus = "active" | "past_due" | "cancelled";

export function mapStripeStatus(stripeStatus: string): UniversityStatus | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "incomplete":
      // Pre-payment state; leave the rows untouched.
      return null;
    default:
      // Unmapped (incl. Stripe 'paused' — University has no paused member
      // state). Leave both rows untouched.
      return null;
  }
}

export async function handleUniversitySubscriptionUpdated(
  db: Db,
  sub: UniversityStripeSubscription,
): Promise<{ matched: number; status: UniversityStatus | null }> {
  const status = mapStripeStatus(sub.status);
  if (!status) {
    logger.info(
      { stripeSubscriptionId: sub.id, stripeStatus: sub.status },
      "university-stripe-handler: subscription.updated → unmapped status, no-op",
    );
    return { matched: 0, status: null };
  }

  const now = new Date();

  const updatedSubs = await db
    .update(universitySubscriptions)
    .set({ status, updatedAt: now })
    .where(eq(universitySubscriptions.stripeSubscriptionId, sub.id))
    .returning({
      id: universitySubscriptions.id,
      memberId: universitySubscriptions.memberId,
      email: universitySubscriptions.email,
    });

  // Mirror onto the member entity. We match members through the subscription's
  // member_id when present, else fall back to the subscription email.
  for (const row of updatedSubs) {
    if (row.memberId) {
      await db
        .update(universityMembers)
        .set({ status, updatedAt: now })
        .where(eq(universityMembers.id, row.memberId));
    } else if (row.email) {
      await db
        .update(universityMembers)
        .set({ status, updatedAt: now })
        .where(sql`LOWER(${universityMembers.email}) = ${row.email.toLowerCase()}`);
    }
  }

  if (updatedSubs.length === 0) {
    logger.warn(
      { stripeSubscriptionId: sub.id, status },
      "university-stripe-handler: subscription.updated received but no matching row",
    );
  } else {
    logger.info(
      { stripeSubscriptionId: sub.id, status, matched: updatedSubs.length },
      "university-stripe-handler: subscription.updated → status mirrored",
    );
    for (const row of updatedSubs) {
      await logUniversityActivity(
        db,
        `university.subscription.status.${status}`,
        row.id,
        {
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status,
          mappedStatus: status,
        },
      );
    }

    // Card-bounce email (touch 1). Only on the past_due transition. Non-fatal:
    // a mail failure must never break the webhook. Templates live storefront-side.
    if (status === "past_due") {
      for (const row of updatedSubs) {
        if (!row.email) continue;
        try {
          await sendCreditscoreEmail({
            kind: "university_past_due",
            to: row.email,
            data: {
              manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
              touch: 1,
            },
          });
        } catch (err) {
          logger.error(
            { err, email: row.email, kind: "university_past_due" },
            "university-stripe-handler: past_due email failed (non-fatal)",
          );
        }
      }
    }
  }
  return { matched: updatedSubs.length, status };
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted
// ---------------------------------------------------------------------------

export async function handleUniversitySubscriptionDeleted(
  db: Db,
  sub: UniversityStripeSubscription,
): Promise<{ matched: number }> {
  const now = new Date();

  const updatedSubs = await db
    .update(universitySubscriptions)
    .set({ status: "cancelled", canceledAt: now, updatedAt: now })
    .where(eq(universitySubscriptions.stripeSubscriptionId, sub.id))
    .returning({
      id: universitySubscriptions.id,
      memberId: universitySubscriptions.memberId,
      email: universitySubscriptions.email,
    });

  for (const row of updatedSubs) {
    if (row.memberId) {
      await db
        .update(universityMembers)
        .set({ status: "cancelled", updatedAt: now })
        .where(eq(universityMembers.id, row.memberId));
    } else if (row.email) {
      await db
        .update(universityMembers)
        .set({ status: "cancelled", updatedAt: now })
        .where(sql`LOWER(${universityMembers.email}) = ${row.email.toLowerCase()}`);
    }
  }

  if (updatedSubs.length === 0) {
    logger.warn(
      { stripeSubscriptionId: sub.id },
      "university-stripe-handler: subscription.deleted received but no matching row",
    );
  } else {
    logger.info(
      { stripeSubscriptionId: sub.id, matched: updatedSubs.length },
      "university-stripe-handler: subscription.deleted → status=cancelled",
    );
    for (const row of updatedSubs) {
      await logUniversityActivity(
        db,
        "university.subscription.cancelled",
        row.id,
        { stripeSubscriptionId: sub.id, stripeStatus: sub.status },
      );
    }

    // "Here's the door back" email. Non-fatal: a mail failure must never break
    // the webhook. accessEndDateISO is omitted — the narrow deleted-event shape
    // doesn't carry a reliable period end, and the contract marks it optional.
    for (const row of updatedSubs) {
      if (!row.email) continue;
      try {
        await sendCreditscoreEmail({
          kind: "university_canceled",
          to: row.email,
          data: {
            rejoinUrl: UNIVERSITY_REJOIN_URL,
          },
        });
      } catch (err) {
        logger.error(
          { err, email: row.email, kind: "university_canceled" },
          "university-stripe-handler: canceled email failed (non-fatal)",
        );
      }
    }
  }
  return { matched: updatedSubs.length };
}

// ---------------------------------------------------------------------------
// Rex VOICE ADD-ONS (Phase 2) — paid monthly voice-minute upgrades.
//
// A separate Stripe subscription (Starwise account) layered on top of the $50
// membership. One row per subscription in `university_voice_addons`, keyed by
// `stripe_subscription_id` (UNIQUE). The member's monthly voice cap is the free
// 3600 s plus the active add-on's seconds (services/voice-budget.ts addonSeconds).
//
//   handleVoiceAddonCheckout           — checkout.session.completed w/ metadata
//                                        product='university_voice_addon'.
//                                        INSERT ... ON CONFLICT idempotent upsert
//                                        (member_id + tier from metadata; the
//                                        subscription is the idempotency key).
//   handleVoiceAddonSubscriptionUpdated — customer.subscription.updated: mirror
//                                        status + current_period_end onto the row.
//                                        UPDATE-only (keyed by sub id); a sub with
//                                        no add-on row is not ours → no-op.
//   handleVoiceAddonSubscriptionDeleted — customer.subscription.deleted: flip the
//                                        row to canceled. UPDATE-only, no-op if
//                                        no row.
//
// All idempotent. Tier→price mapping (checkout) and price→tier (webhook) share
// VOICE_ADDON_TIERS below — one source of truth. The tier→seconds duplicate
// (services/voice-budget.ts VOICE_ADDON_TIER_SECONDS) is the cap authority; kept
// separate so the meter never imports Stripe price ids.
// ---------------------------------------------------------------------------

export type VoiceAddonTier = "1hr" | "2p5hr";

// The metadata.product marker that routes a checkout to the add-on handler.
export const VOICE_ADDON_PRODUCT = "university_voice_addon";

// tier → { Stripe price (Starwise), seconds granted }. Price ids are the two
// live add-on prices; seconds mirror VOICE_ADDON_TIER_SECONDS.
export const VOICE_ADDON_TIERS: Record<
  VoiceAddonTier,
  { priceId: string; seconds: number }
> = {
  "1hr": { priceId: "price_1ToG6HAf8PjDIzDYmjHp5WqU", seconds: 3600 },
  "2p5hr": { priceId: "price_1ToG6HAf8PjDIzDYVQR6KsV6", seconds: 9000 },
};

// Reverse lookup: Stripe price id → tier, or null when it isn't an add-on price.
export function voiceAddonTierByPriceId(
  priceId: string,
): VoiceAddonTier | null {
  for (const tier of Object.keys(VOICE_ADDON_TIERS) as VoiceAddonTier[]) {
    if (VOICE_ADDON_TIERS[tier].priceId === priceId) return tier;
  }
  return null;
}

// A minimal, API-version-tolerant shape for an invoice line item's price ref:
// classic `price.id`, legacy `plan.id`, and the newer string id at
// `pricing.price_details.price`. Only the price id matters for the add-on check.
export interface InvoiceLineForAddonCheck {
  price?: { id?: string | null } | null;
  plan?: { id?: string | null } | null;
  pricing?: { price_details?: { price?: string | null } | null } | null;
}

// Order-independent add-on detection: does this invoice bill a voice add-on
// price? Reads the invoice's OWN line items — which Stripe embeds inline in the
// invoice.paid webhook payload — so an add-on invoice is identified even before
// checkout.session.completed has written the university_voice_addons row (Stripe
// events can arrive out of order). Meant to be OR'd with isVoiceAddonSubscription:
// it's an add-on iff EITHER the line items OR the DB row say so.
export function invoiceLinesAreVoiceAddon(
  lines: InvoiceLineForAddonCheck[] | null | undefined,
): boolean {
  if (!Array.isArray(lines)) return false;
  for (const line of lines) {
    const priceId =
      line?.price?.id ??
      line?.plan?.id ??
      line?.pricing?.price_details?.price ??
      null;
    if (priceId && voiceAddonTierByPriceId(priceId)) return true;
  }
  return false;
}

// Map Stripe's subscription status to the add-on's two-state column, with a
// THREE-way outcome that mirrors the membership mapStripeStatus above:
//   active | trialing              → 'active'
//   canceled | incomplete_expired  → 'canceled'
//   incomplete | past_due | unpaid → null  (leave the row untouched — no-op)
//   (anything else, incl. paused)  → null
// Returning null NO-OPS the row so an out-of-order pre-payment 'incomplete'
// (or a transient dunning past_due) can't flip a just-activated paying member's
// add-on to 'canceled' and zero their paid cap. This matches the membership
// convention (Rule 9): mapStripeStatus never cancels on past_due/unpaid — it
// keeps the member in a still-entitled retained state (voice-budget's member
// lookup counts past_due as valid). The add-on column has no 'past_due' value,
// so the faithful analog is to leave the row as-is rather than cancel it. Only
// 'active' rows count toward the voice cap.
function mapAddonStatus(stripeStatus: string): "active" | "canceled" | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      // incomplete (pre-payment), past_due, unpaid, paused, and anything
      // unmapped — leave the row untouched.
      return null;
  }
}

export interface VoiceAddonCheckoutSession {
  id: string;
  subscription?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
}

export interface VoiceAddonSubscription {
  id: string;
  status: string;
  current_period_end?: number | null;
}

function fromUnixSeconds(secs: number | null | undefined): Date | null {
  return typeof secs === "number" && Number.isFinite(secs)
    ? new Date(secs * 1000)
    : null;
}

// True when this Stripe subscription id belongs to a voice add-on row. The
// invoice.paid dispatch uses this to SKIP the membership referral engine for
// add-on invoices: applyCreditForPayer keys off the payer and assumes a flat
// $50/mo membership bill, so a $10/$20 add-on invoice would drain the member's
// standing referral credit against the wrong headroom. Mirrors the addon-first
// fall-through already used for subscription.updated/.deleted.
export async function isVoiceAddonSubscription(
  db: Db,
  stripeSubscriptionId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: universityVoiceAddons.id })
    .from(universityVoiceAddons)
    .where(eq(universityVoiceAddons.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);
  return rows.length > 0;
}

// checkout.session.completed → upsert the add-on row. Idempotent on
// stripe_subscription_id: a Stripe webhook retry updates the existing row.
export async function handleVoiceAddonCheckout(
  db: Db,
  session: VoiceAddonCheckoutSession,
): Promise<{ addonId: string; memberId: string; tier: VoiceAddonTier } | null> {
  const metadata = session.metadata ?? {};
  if (metadata.product !== VOICE_ADDON_PRODUCT) return null;

  const memberId = metadata.memberId || session.client_reference_id || null;
  const tier =
    metadata.tier === "1hr" || metadata.tier === "2p5hr"
      ? (metadata.tier as VoiceAddonTier)
      : null;
  const stripeSubscriptionId =
    typeof session.subscription === "string" ? session.subscription : null;

  if (!memberId || !tier || !stripeSubscriptionId) {
    logger.warn(
      { sessionId: session.id, memberId, tier, stripeSubscriptionId },
      "voice-addon: checkout missing memberId/tier/subscription — skipping upsert",
    );
    return null;
  }

  const priceId = VOICE_ADDON_TIERS[tier].priceId;
  const now = new Date();
  const upserted = await db
    .insert(universityVoiceAddons)
    .values({
      memberId,
      stripeSubscriptionId,
      stripePriceId: priceId,
      tier,
      status: "active",
    })
    .onConflictDoUpdate({
      target: universityVoiceAddons.stripeSubscriptionId,
      set: {
        memberId,
        stripePriceId: priceId,
        tier,
        status: "active",
        updatedAt: now,
      },
    })
    .returning({ id: universityVoiceAddons.id });
  const addonId = upserted[0]?.id ?? "";

  logger.info(
    { sessionId: session.id, addonId, memberId, tier, stripeSubscriptionId },
    "voice-addon: checkout processed",
  );
  await logUniversityActivity(db, "university.voice_addon.activated", addonId, {
    stripeSessionId: session.id,
    stripeSubscriptionId,
    memberId,
    tier,
  });
  return { addonId, memberId, tier };
}

// customer.subscription.updated → mirror status + period end onto the add-on
// row. UPDATE-only: a subscription with no add-on row is a membership (or
// unrelated) sub, so matched=0 tells the dispatcher to fall through.
export async function handleVoiceAddonSubscriptionUpdated(
  db: Db,
  sub: VoiceAddonSubscription,
): Promise<{ matched: number }> {
  const status = mapAddonStatus(sub.status);

  // No-op status (incomplete / past_due / unpaid / paused): leave the row
  // untouched so an out-of-order event can't zero a just-activated paid cap. We
  // still probe whether this sub is an add-on so the dispatcher's addon-first
  // fall-through works: matched>0 means "this is ours, don't fall through to the
  // membership handler" even though we wrote nothing.
  if (!status) {
    const existing = await db
      .select({ id: universityVoiceAddons.id })
      .from(universityVoiceAddons)
      .where(eq(universityVoiceAddons.stripeSubscriptionId, sub.id))
      .limit(1);
    if (existing.length > 0) {
      logger.info(
        { stripeSubscriptionId: sub.id, stripeStatus: sub.status },
        "voice-addon: subscription.updated → unmapped status, row left untouched (no-op)",
      );
    }
    return { matched: existing.length };
  }

  const currentPeriodEnd = fromUnixSeconds(sub.current_period_end);
  const updated = await db
    .update(universityVoiceAddons)
    .set({ status, currentPeriodEnd, updatedAt: new Date() })
    .where(eq(universityVoiceAddons.stripeSubscriptionId, sub.id))
    .returning({ id: universityVoiceAddons.id });

  if (updated.length > 0) {
    logger.info(
      { stripeSubscriptionId: sub.id, status, matched: updated.length },
      "voice-addon: subscription.updated → status mirrored",
    );
  }
  return { matched: updated.length };
}

// customer.subscription.deleted → flip the add-on row to canceled. UPDATE-only;
// matched=0 means it wasn't an add-on sub (dispatcher falls through).
export async function handleVoiceAddonSubscriptionDeleted(
  db: Db,
  sub: VoiceAddonSubscription,
): Promise<{ matched: number }> {
  const currentPeriodEnd = fromUnixSeconds(sub.current_period_end);
  const updated = await db
    .update(universityVoiceAddons)
    .set({ status: "canceled", currentPeriodEnd, updatedAt: new Date() })
    .where(eq(universityVoiceAddons.stripeSubscriptionId, sub.id))
    .returning({ id: universityVoiceAddons.id });

  if (updated.length > 0) {
    logger.info(
      { stripeSubscriptionId: sub.id, matched: updated.length },
      "voice-addon: subscription.deleted → status=canceled",
    );
    for (const row of updated) {
      await logUniversityActivity(
        db,
        "university.voice_addon.canceled",
        row.id,
        { stripeSubscriptionId: sub.id },
      );
    }
  }
  return { matched: updated.length };
}
