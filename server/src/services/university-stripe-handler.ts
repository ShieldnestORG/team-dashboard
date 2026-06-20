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
import { universityMembers, universitySubscriptions } from "@paperclipai/db";
import { linkStripeCustomerToAccount } from "./customer-account-linker.js";
import { logActivity } from "./activity-log.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import {
  UNIVERSITY_LOGIN_URL,
  UNIVERSITY_LESSON_URL,
  UNIVERSITY_MANAGE_BILLING_URL,
  UNIVERSITY_REJOIN_URL,
  UNIVERSITY_PLAN_LABEL,
  UNIVERSITY_PRICE_DISPLAY,
  firstNameFromDisplayName,
} from "./university-email.js";
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
        plan: "university_monthly",
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
        plan: "university_monthly",
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
  if (existingMember[0]) {
    await db
      .update(universityMembers)
      .set({
        status: "active",
        plan: "university_monthly",
        accountId,
        displayName,
        joinedAt: now,
        updatedAt: now,
      })
      .where(eq(universityMembers.id, existingMember[0].id))
      .returning({ id: universityMembers.id });
    memberId = existingMember[0].id;
  } else {
    const [row] = await db
      .insert(universityMembers)
      .values({
        email,
        displayName,
        status: "active",
        plan: "university_monthly",
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
  // storefront-side; we only post the envelope.
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
          amount: UNIVERSITY_PRICE_DISPLAY,
          dateISO: now.toISOString(),
          plan: UNIVERSITY_PLAN_LABEL,
          manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
        },
      });
    } catch (err) {
      logger.error(
        { err, email, kind: "university_receipt" },
        "university-stripe-handler: receipt email failed (non-fatal)",
      );
    }
  }

  logger.info(
    {
      sessionId: session.id,
      subscriptionId,
      memberId,
      stripeSubscriptionId,
      created,
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
    },
  );

  return { subscriptionId, memberId, created };
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
