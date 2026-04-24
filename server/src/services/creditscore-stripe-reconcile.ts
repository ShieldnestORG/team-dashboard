// ---------------------------------------------------------------------------
// CreditScore ↔ Stripe reconcile.
//
// On boot, every active creditscore_plans row with a stripe_price_id is
// checked against the live Stripe price. We warn on:
//   - price missing (404)
//   - price.active === false (archived)
//   - price.unit_amount !== plan.price_cents (amount drift)
//   - recurring interval mismatch vs plan.billing_interval
//
// Runs once at startup, non-blocking. No DB writes — this is a drift alarm,
// not an auto-sync, because the authoritative fix is always "update the DB
// row" or "create a new Stripe price", and doing that silently would mask a
// real billing incident. See docs/products/creditscore-prd.md.
// ---------------------------------------------------------------------------

import { and, eq, isNotNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creditscorePlans } from "@paperclipai/db";
import { stripeConfigured, stripeRequest } from "./stripe-client.js";
import { logger } from "../middleware/logger.js";

interface StripePrice {
  id: string;
  active: boolean;
  unit_amount: number | null;
  currency: string;
  recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
}

// Map our billing_interval values to the Stripe recurring shape we expect.
function expectedRecurring(
  billingInterval: string,
): { interval: "month" | "year"; interval_count: number } | null {
  if (billingInterval === "monthly") return { interval: "month", interval_count: 1 };
  if (billingInterval === "annual") return { interval: "year", interval_count: 1 };
  if (billingInterval === "one_time") return null;
  return null;
}

export async function reconcileCreditscorePlans(db: Db): Promise<void> {
  if (!stripeConfigured()) {
    logger.info("creditscore-stripe-reconcile — STRIPE_SECRET_KEY not set, skipping");
    return;
  }

  const rows = await db
    .select({
      slug: creditscorePlans.slug,
      priceCents: creditscorePlans.priceCents,
      billingInterval: creditscorePlans.billingInterval,
      stripePriceId: creditscorePlans.stripePriceId,
    })
    .from(creditscorePlans)
    .where(and(eq(creditscorePlans.active, true), isNotNull(creditscorePlans.stripePriceId)));

  let checked = 0;
  let mismatches = 0;

  for (const row of rows) {
    const priceId = row.stripePriceId;
    if (!priceId) continue;
    checked += 1;

    let price: StripePrice;
    try {
      price = await stripeRequest<StripePrice>("GET", `/prices/${encodeURIComponent(priceId)}`);
    } catch (err) {
      mismatches += 1;
      logger.warn(
        { slug: row.slug, priceId, err: (err as Error).message },
        "creditscore-stripe-reconcile — price lookup failed (archived, deleted, or wrong account?)",
      );
      continue;
    }

    const problems: string[] = [];
    if (!price.active) problems.push("price archived in Stripe");
    if (price.unit_amount !== row.priceCents) {
      problems.push(`amount drift: DB=${row.priceCents} Stripe=${price.unit_amount}`);
    }

    const want = expectedRecurring(row.billingInterval);
    const got = price.recurring;
    if (want === null && got !== null) {
      problems.push(`interval drift: DB=one_time Stripe=${got.interval_count}${got.interval}`);
    } else if (want !== null && got === null) {
      problems.push(`interval drift: DB=${row.billingInterval} Stripe=one_time`);
    } else if (
      want !== null &&
      got !== null &&
      (want.interval !== got.interval || want.interval_count !== got.interval_count)
    ) {
      problems.push(
        `interval drift: DB=${row.billingInterval} Stripe=${got.interval_count}${got.interval}`,
      );
    }

    if (problems.length > 0) {
      mismatches += 1;
      logger.warn(
        { slug: row.slug, priceId, problems },
        "creditscore-stripe-reconcile — plan/Stripe drift",
      );
    }
  }

  logger.info(
    { checked, mismatches },
    mismatches === 0
      ? "creditscore-stripe-reconcile — all plans match Stripe"
      : "creditscore-stripe-reconcile — drift detected, see warnings above",
  );
}
