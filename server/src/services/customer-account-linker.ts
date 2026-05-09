import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { customerAccounts } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Customer Account Linker — cross-cutting concern.
//
// Maps a Stripe customer ID to a `customer_accounts` row. Called from every
// product webhook handler that fires on checkout.session.completed. This
// decouples portal auth (magic link → customer_accounts) from Stripe payment
// (checkout → product subscription). Once the link exists, /api/portal/me
// can surface bundle entitlements and /api/portal/stripe-portal can create a
// Billing Portal session.
//
// Idempotency guarantee:
//   - INSERT ... ON CONFLICT (email) DO UPDATE only when stripe_customer_id
//     IS DISTINCT FROM the incoming value → no spurious writes on retries.
//   - If account does not exist, inserts a new row with status='pending'.
//     A magic link is NOT issued here; the customer self-serves via the portal
//     login flow when they first visit.
// ---------------------------------------------------------------------------

export interface LinkStripeCustomerArgs {
  email: string;
  stripeCustomerId: string;
}

export type LinkerAction = "created" | "updated" | "noop";

export interface LinkResult {
  action: LinkerAction;
  accountId: string;
}

/**
 * Idempotently links a Stripe customer ID to a customer_accounts row.
 *
 * - If `email` or `stripeCustomerId` is empty, logs a warning and returns
 *   `null` (no-op).
 * - Must be called inside a try/catch by the caller so that linker failures
 *   do NOT roll back product-fulfillment work.
 */
export async function linkStripeCustomerToAccount(
  db: Db,
  { email: emailRaw, stripeCustomerId }: LinkStripeCustomerArgs,
): Promise<LinkResult | null> {
  const email = emailRaw?.trim().toLowerCase();
  if (!email || !stripeCustomerId) {
    logger.warn(
      { email: emailRaw, stripeCustomerId },
      "customer-account-linker: missing email or stripeCustomerId — skipping",
    );
    return null;
  }

  // Attempt an upsert on the email unique key.
  //
  // Drizzle doesn't have a first-class citext-aware onConflict helper, so we
  // drop to raw SQL for the conflict target. The `customer_accounts_email_key`
  // unique index is on `email` (citext in prod, plain text in test). We use
  // LOWER() when checking existing rows to stay safe in both environments.
  //
  // SQL semantics:
  //   INSERT ... ON CONFLICT (email) DO UPDATE SET stripe_customer_id = ...
  //   WHERE customer_accounts.stripe_customer_id IS DISTINCT FROM EXCLUDED.stripe_customer_id
  //
  // If the WHERE doesn't match (stripe_customer_id is already equal) Postgres
  // returns 0 rows; we then re-select to return the existing id.
  const upserted = await db.execute(sql`
    INSERT INTO customer_accounts (email, stripe_customer_id, created_at)
    VALUES (${email}, ${stripeCustomerId}, NOW())
    ON CONFLICT (email) DO UPDATE
      SET stripe_customer_id = EXCLUDED.stripe_customer_id
      WHERE customer_accounts.stripe_customer_id IS DISTINCT FROM EXCLUDED.stripe_customer_id
    RETURNING id,
              (xmax = 0) AS was_inserted,
              (xmax <> 0) AS was_updated
  `);

  const firstRow = (upserted as unknown as Array<{
    id: string;
    was_inserted: boolean;
    was_updated: boolean;
  }>)[0];

  if (firstRow) {
    const action: LinkerAction = firstRow.was_inserted
      ? "created"
      : firstRow.was_updated
        ? "updated"
        : "noop";
    logger.info(
      { email, stripeCustomerId, action, accountId: firstRow.id },
      "customer-account-linker: linked",
    );
    return { action, accountId: firstRow.id };
  }

  // No row returned → conflict fired but WHERE excluded the update (noop).
  // Fetch the existing row to return its id.
  const existing = await db.execute(sql`
    SELECT id FROM customer_accounts WHERE LOWER(email) = ${email} LIMIT 1
  `);
  const existingRow = (existing as unknown as Array<{ id: string }>)[0];

  const accountId = existingRow?.id ?? "unknown";
  logger.info(
    { email, stripeCustomerId, action: "noop", accountId },
    "customer-account-linker: stripe_customer_id already up-to-date, noop",
  );
  return { action: "noop", accountId };
}

// ---------------------------------------------------------------------------
// Stripe event helpers — call from webhook routes to handle
// customer.created / customer.updated events directly.
// ---------------------------------------------------------------------------

export interface StripeCustomerEvent {
  type: "customer.created" | "customer.updated";
  data: {
    object: {
      id: string;
      email?: string | null;
    };
  };
}

/**
 * Handles a Stripe `customer.created` or `customer.updated` event by linking
 * the Stripe customer ID to the customer_accounts table.
 *
 * Returns the link result or null if the event has no email.
 * Wrapped in try/catch — errors are logged but NOT re-thrown so callers don't
 * 500 on a linker failure.
 */
export async function handleStripeCustomerEvent(
  db: Db,
  event: StripeCustomerEvent,
): Promise<LinkResult | null> {
  const customer = event.data.object;
  const email = customer.email?.trim().toLowerCase() ?? "";
  const stripeCustomerId = customer.id;

  if (!email) {
    logger.warn(
      { stripeCustomerId, eventType: event.type },
      "customer-account-linker: customer event has no email — skipping",
    );
    return null;
  }

  try {
    return await linkStripeCustomerToAccount(db, { email, stripeCustomerId });
  } catch (err) {
    logger.error(
      { err, email, stripeCustomerId, eventType: event.type },
      "customer-account-linker: handleStripeCustomerEvent failed",
    );
    return null;
  }
}
