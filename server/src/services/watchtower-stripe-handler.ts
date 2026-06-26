// ---------------------------------------------------------------------------
// Watchtower — Stripe webhook handlers.
//
// Three handlers (one per Stripe event we care about for Watchtower):
//
//   handleWatchtowerCheckout(db, session)
//     - Fired on `checkout.session.completed` when the session metadata
//       carries `product = "watchtower"`. Creates the
//       `watchtower_subscriptions` row that the weekly cron will pick up,
//       and chains `linkStripeCustomerToAccount` so portal-auth can later
//       resolve the customer.
//
//   handleWatchtowerSubscriptionUpdated(db, sub)
//     - Fired on `customer.subscription.updated`. Mirrors Stripe status into
//       our `status` column. Mapping is the spec from docs/deploy/stripe-products.md
//       extended for past_due/paused (added by migration 0111):
//         active                    → active
//         past_due | unpaid         → past_due
//         canceled                  → cancelled
//         paused                    → paused
//         (anything else)           → leaves the row untouched (logged warn)
//
//   handleWatchtowerSubscriptionDeleted(db, sub)
//     - Fired on `customer.subscription.deleted`. Sets status=cancelled and
//       leaves the row in place for history; the cron filters by status so
//       it stops running automatically.
//
// All three handlers are idempotent. Replaying the same Stripe event must
// not create duplicate rows or corrupt state — `handleWatchtowerCheckout`
// looks up an existing row by `stripe_subscription_id` first; the two
// subscription handlers are pure UPDATEs on the same key.
//
// Wiring: a new `watchtowerWebhookRouter` (see routes/watchtower-checkout.ts)
// owns the actual /api/watchtower/webhook route. There is no consolidated
// dispatcher in this repo today (each product mounts its own raw-body
// router before express.json — see app.ts). When/if a consolidated
// dispatcher lands, it should call into these handlers without modification.
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { watchtowerSubscriptions, watchtowerPromptVersions } from "@paperclipai/db";
import { linkStripeCustomerToAccount } from "./customer-account-linker.js";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

// HARD upper bound enforced at insert time to prevent a malformed metadata
// payload from creating a runaway subscription. The route layer enforces
// the PRD-default cap of 25; this is the runtime backstop and matches
// HARD_PROMPT_CEILING in services/watchtower-monitor.ts.
const HARD_PROMPT_CEILING_INSERT = 50;

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

async function logWatchtowerActivity(
  db: Db,
  action: string,
  subscriptionId: string,
  details: Record<string, unknown>,
): Promise<void> {
  try {
    await logActivity(db, {
      companyId: COMPANY_ID,
      actorType: "system",
      actorId: "watchtower_stripe_webhook",
      action,
      entityType: "watchtower_subscription",
      entityId: subscriptionId,
      details,
    });
  } catch (err) {
    logger.error(
      { err, action, subscriptionId },
      "watchtower-stripe-handler: activity log failed (non-fatal)",
    );
  }
}

// ---------------------------------------------------------------------------
// Type shapes — narrow Stripe event objects to just what we touch.
// We intentionally avoid pulling in the full Stripe SDK types because the
// REST client in services/stripe-client.ts is fetch-based.
// ---------------------------------------------------------------------------

export interface WatchtowerCheckoutSession {
  id: string;
  customer?: string | null;
  customer_email?: string | null;
  customer_details?: { email?: string | null } | null;
  subscription?: string | null;
  metadata?: Record<string, string> | null;
}

export interface WatchtowerStripeSubscription {
  id: string;
  status: string;
}

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

export interface WatchtowerCheckoutResult {
  subscriptionId: string;
  created: boolean;
}

export async function handleWatchtowerCheckout(
  db: Db,
  session: WatchtowerCheckoutSession,
): Promise<WatchtowerCheckoutResult | null> {
  const metadata = session.metadata ?? {};
  if (metadata.product !== "watchtower") {
    // Defensive: caller should already have routed by metadata.product, but
    // guard so a misrouted event doesn't insert a junk row.
    return null;
  }

  const brandName = metadata.brandName?.trim();
  const domain = metadata.domain?.trim() || null;
  // Accuracy-judge ground truth (migration 0123). Forwarded from checkout
  // metadata (truncated to 490 chars there). Null when absent so existing
  // subscriptions and ground-truth-less checkouts stay untouched.
  const groundTruth = metadata.ground_truth?.trim() || null;
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

  if (!brandName) {
    logger.warn(
      { sessionId: session.id, metadata },
      "watchtower-stripe-handler: missing brandName in checkout metadata — skipping insert",
    );
    return null;
  }
  if (!stripeSubscriptionId) {
    logger.warn(
      { sessionId: session.id },
      "watchtower-stripe-handler: checkout has no subscription id — skipping insert",
    );
    return null;
  }

  let prompts: string[] = [];
  try {
    const parsed = metadata.prompts ? JSON.parse(metadata.prompts) : [];
    if (Array.isArray(parsed)) {
      prompts = parsed
        .filter((p): p is string => typeof p === "string")
        .map((p) => p.trim())
        .filter((p) => p.length > 0)
        .slice(0, HARD_PROMPT_CEILING_INSERT);
    }
  } catch (err) {
    logger.warn(
      { err, sessionId: session.id },
      "watchtower-stripe-handler: failed to parse prompts metadata — defaulting to empty array",
    );
  }

  // Resolve account_id BEFORE the upsert so the subscription row points at
  // the customer_accounts row from creation. This is what watchtower-cron's
  // resolveWatchtowerRecipient() joins on to find the digest recipient — if
  // we leave account_id NULL the cron fail-closes and skips the digest,
  // meaning a paid customer would silently receive nothing.
  let accountId: string | null = null;
  if (email && stripeCustomerId) {
    try {
      const linked = await linkStripeCustomerToAccount(db, { email, stripeCustomerId });
      accountId = linked?.accountId ?? null;
    } catch (err) {
      logger.error(
        { err, sessionId: session.id, email, stripeCustomerId },
        "watchtower-stripe-handler: customer-account-linker failed (non-fatal) — subscription will be inserted with account_id=NULL and digest will skip until manually relinked",
      );
    }
  }

  // Idempotency: look up by stripe_subscription_id first. If a row already
  // exists (event replay), update non-identity fields and return early.
  const existing = await db
    .select({ id: watchtowerSubscriptions.id })
    .from(watchtowerSubscriptions)
    .where(eq(watchtowerSubscriptions.stripeSubscriptionId, stripeSubscriptionId))
    .limit(1);

  let result: WatchtowerCheckoutResult;
  if (existing[0]) {
    await db
      .update(watchtowerSubscriptions)
      .set({
        status: "active",
        brandName,
        domain,
        prompts,
        groundTruth,
        stripeCustomerId,
        email,
        accountId,
      })
      .where(eq(watchtowerSubscriptions.id, existing[0].id))
      .returning({ id: watchtowerSubscriptions.id });
    result = { subscriptionId: existing[0].id, created: false };
  } else {
    const [row] = await db
      .insert(watchtowerSubscriptions)
      .values({
        brandName,
        domain,
        prompts,
        groundTruth,
        status: "active",
        frequency: "weekly",
        plan: "watchtower_monthly",
        stripeCustomerId,
        stripeSubscriptionId,
        email,
        accountId,
      })
      .returning({ id: watchtowerSubscriptions.id });
    result = { subscriptionId: row!.id, created: true };

    // Mint version 1 alongside the subscription so every run from day 1
    // has a non-null prompt_version_id. Non-fatal — the migration 0115
    // backfill also covers subscriptions that lack a version row, so
    // a failure here just means the first run's version is filled by
    // the next edit (or stays NULL = "legacy" until then).
    try {
      await db.insert(watchtowerPromptVersions).values({
        subscriptionId: row!.id,
        prompts,
        createdByActorType: "system",
        createdByActorLabel: "watchtower_stripe_webhook",
      });
    } catch (err) {
      logger.error(
        { err, subscriptionId: row!.id },
        "watchtower-stripe-handler: initial prompt-version insert failed (non-fatal — backfill covers)",
      );
    }
  }

  logger.info(
    {
      sessionId: session.id,
      subscriptionId: result.subscriptionId,
      stripeSubscriptionId,
      created: result.created,
      brandName,
      domain,
      promptCount: prompts.length,
    },
    "watchtower-stripe-handler: checkout processed",
  );

  await logWatchtowerActivity(
    db,
    result.created
      ? "watchtower.subscription.created"
      : "watchtower.subscription.checkout_replayed",
    result.subscriptionId,
    {
      stripeSessionId: session.id,
      stripeSubscriptionId,
      stripeCustomerId,
      brandName,
      domain,
      email,
      accountId,
      promptCount: prompts.length,
    },
  );

  return result;
}

// ---------------------------------------------------------------------------
// customer.subscription.updated
// ---------------------------------------------------------------------------

export type WatchtowerStatus = "active" | "past_due" | "paused" | "cancelled";

export function mapStripeStatus(stripeStatus: string): WatchtowerStatus | null {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
    case "unpaid":
      return "past_due";
    case "paused":
      return "paused";
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "incomplete":
      // Pre-payment state; leave the row untouched.
      return null;
    default:
      return null;
  }
}

export async function handleWatchtowerSubscriptionUpdated(
  db: Db,
  sub: WatchtowerStripeSubscription,
): Promise<{ matched: number; status: WatchtowerStatus | null }> {
  const status = mapStripeStatus(sub.status);
  if (!status) {
    logger.info(
      { stripeSubscriptionId: sub.id, stripeStatus: sub.status },
      "watchtower-stripe-handler: subscription.updated → unmapped status, no-op",
    );
    return { matched: 0, status: null };
  }

  // Use raw SQL only to capture rowcount via RETURNING; drizzle's update
  // returns the updated rows on Postgres.
  const updated = await db
    .update(watchtowerSubscriptions)
    .set({ status })
    .where(eq(watchtowerSubscriptions.stripeSubscriptionId, sub.id))
    .returning({ id: watchtowerSubscriptions.id });

  if (updated.length === 0) {
    logger.warn(
      { stripeSubscriptionId: sub.id, status },
      "watchtower-stripe-handler: subscription.updated received but no matching row",
    );
  } else {
    logger.info(
      { stripeSubscriptionId: sub.id, status, matched: updated.length },
      "watchtower-stripe-handler: subscription.updated → status mirrored",
    );
    for (const row of updated) {
      await logWatchtowerActivity(
        db,
        `watchtower.subscription.status.${status}`,
        row.id,
        {
          stripeSubscriptionId: sub.id,
          stripeStatus: sub.status,
          mappedStatus: status,
        },
      );
    }
  }
  return { matched: updated.length, status };
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted
// ---------------------------------------------------------------------------

export async function handleWatchtowerSubscriptionDeleted(
  db: Db,
  sub: WatchtowerStripeSubscription,
): Promise<{ matched: number }> {
  const updated = await db
    .update(watchtowerSubscriptions)
    .set({ status: "cancelled" })
    .where(eq(watchtowerSubscriptions.stripeSubscriptionId, sub.id))
    .returning({ id: watchtowerSubscriptions.id });

  if (updated.length === 0) {
    logger.warn(
      { stripeSubscriptionId: sub.id },
      "watchtower-stripe-handler: subscription.deleted received but no matching row",
    );
  } else {
    logger.info(
      { stripeSubscriptionId: sub.id, matched: updated.length },
      "watchtower-stripe-handler: subscription.deleted → status=cancelled",
    );
    for (const row of updated) {
      await logWatchtowerActivity(
        db,
        "watchtower.subscription.cancelled",
        row.id,
        { stripeSubscriptionId: sub.id, stripeStatus: sub.status },
      );
    }
  }
  return { matched: updated.length };
}

