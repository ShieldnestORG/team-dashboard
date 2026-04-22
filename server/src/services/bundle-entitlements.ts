import { and, desc, eq, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  bundlePlans,
  bundleSubscriptions,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { stripeRequest, verifyStripeSignature } from "./stripe-client.js";
import { logger } from "../middleware/logger.js";

type CreditscoreTier = "report" | "starter" | "growth" | "pro";

const CREDITSCORE_TIER_RANK: Record<CreditscoreTier, number> = {
  report: 1,
  starter: 2,
  growth: 3,
  pro: 4,
};

// Exported for unit testing.
export function higherCreditscoreTier(
  a: { tier: CreditscoreTier; domains: number } | null,
  b: { tier: CreditscoreTier; domains: number } | null,
): { tier: CreditscoreTier; domains: number } | null {
  if (!a) return b;
  if (!b) return a;
  return CREDITSCORE_TIER_RANK[a.tier] >= CREDITSCORE_TIER_RANK[b.tier] ? a : b;
}

export { verifyStripeSignature };

// ---------------------------------------------------------------------------
// Entitlement shape (mirrors bundles-prd.md JSON)
// ---------------------------------------------------------------------------

export interface BundleEntitlements {
  creditscore?: { tier: "report" | "starter" | "growth" | "pro"; domains: number } | null;
  directoryListing?: { tier: "featured" | "verified" | "boosted" } | null;
  partnerNetwork?: { tier: "proof" | "performance" | "premium" } | null;
  intelApi?: { planSlug: string } | null;
  allInclusive?: boolean;
}

export interface ResolvedEntitlements {
  creditscore: { tier: "report" | "starter" | "growth" | "pro"; domains: number } | null;
  directoryListing: { tier: "featured" | "verified" | "boosted" } | null;
  partnerNetwork: { tier: "proof" | "performance" | "premium" } | null;
  intelApi: { planSlug: string } | null;
  allInclusive: boolean;
  source: "bundle" | "standalone" | "none";
  bundleSlug: string | null;
}

async function getStandaloneCreditscoreEntitlement(
  db: Db,
  companyId: string,
): Promise<{ tier: CreditscoreTier; domains: number } | null> {
  const rows = await db
    .select({ tier: creditscoreSubscriptions.tier })
    .from(creditscoreSubscriptions)
    .where(
      and(
        eq(creditscoreSubscriptions.companyId, companyId),
        or(
          eq(creditscoreSubscriptions.status, "active"),
          eq(creditscoreSubscriptions.status, "past_due"),
        ),
      ),
    )
    .orderBy(desc(creditscoreSubscriptions.createdAt));

  if (!rows.length) return null;

  // Pick the highest-tier active subscription (customer may have multiple).
  let best: { tier: CreditscoreTier; domains: number } | null = null;
  for (const row of rows) {
    const tier = row.tier as CreditscoreTier;
    if (!(tier in CREDITSCORE_TIER_RANK)) continue;
    const candidate = { tier, domains: 1 };
    if (!best || CREDITSCORE_TIER_RANK[candidate.tier] > CREDITSCORE_TIER_RANK[best.tier]) {
      best = candidate;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function bundleEntitlementsService(db: Db) {
  async function listPlans() {
    return db
      .select()
      .from(bundlePlans)
      .where(eq(bundlePlans.active, true));
  }

  async function getPlanBySlug(slug: string) {
    const rows = await db
      .select()
      .from(bundlePlans)
      .where(eq(bundlePlans.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getActiveSubscription(companyId: string) {
    const rows = await db
      .select()
      .from(bundleSubscriptions)
      .where(
        and(
          eq(bundleSubscriptions.companyId, companyId),
          or(
            eq(bundleSubscriptions.status, "active"),
            eq(bundleSubscriptions.status, "past_due"),
          ),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async function getEntitlementsForCompany(companyId: string): Promise<ResolvedEntitlements> {
    const standaloneCs = await getStandaloneCreditscoreEntitlement(db, companyId);

    const sub = await getActiveSubscription(companyId);
    if (!sub) {
      return {
        creditscore: standaloneCs,
        directoryListing: null,
        partnerNetwork: null,
        intelApi: null,
        allInclusive: false,
        source: standaloneCs ? "standalone" : "none",
        bundleSlug: null,
      };
    }

    const plan = await db
      .select()
      .from(bundlePlans)
      .where(eq(bundlePlans.id, sub.bundlePlanId))
      .limit(1);
    if (!plan[0]) {
      return {
        creditscore: standaloneCs,
        directoryListing: null,
        partnerNetwork: null,
        intelApi: null,
        allInclusive: false,
        source: standaloneCs ? "standalone" : "none",
        bundleSlug: null,
      };
    }

    const e = plan[0].entitlements as BundleEntitlements;

    // Resolve CreditScore from both the bundle entitlement map and any
    // standalone creditscore_subscriptions. Higher tier wins.
    const bundleCs = e.creditscore ?? null;

    return {
      creditscore: higherCreditscoreTier(bundleCs, standaloneCs),
      directoryListing: e.directoryListing ?? null,
      partnerNetwork: e.partnerNetwork ?? null,
      intelApi: e.intelApi ?? null,
      allInclusive: e.allInclusive ?? false,
      source: "bundle",
      bundleSlug: plan[0].slug,
    };
  }

  async function createCheckoutSession(
    slug: string,
    companyId: string,
    email: string,
    interval: "monthly" | "annual" = "monthly",
  ) {
    const plan = await getPlanBySlug(slug);
    if (!plan) throw new Error(`Unknown bundle plan: ${slug}`);

    const priceId = interval === "annual" ? plan.stripeAnnualPriceId : plan.stripePriceId;
    if (!priceId) throw new Error(`Bundle ${slug} ${interval} Stripe price not configured`);

    const successUrl =
      process.env.BUNDLE_SUCCESS_URL ||
      "https://dashboard.coherencedaddy.com/bundles/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      process.env.BUNDLE_CANCEL_URL ||
      "https://dashboard.coherencedaddy.com/bundles";

    const session = await stripeRequest<{ id: string; url: string }>(
      "POST",
      "/checkout/sessions",
      {
        mode: "subscription",
        "line_items[0][price]": priceId,
        "line_items[0][quantity]": 1,
        customer_email: email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[product]": "bundle",
        "metadata[bundle_slug]": slug,
        "metadata[company_id]": companyId,
        "metadata[billing_interval]": interval,
      },
    );

    await db.insert(bundleSubscriptions).values({
      companyId,
      bundlePlanId: plan.id,
      stripeCheckoutSessionId: session.id,
      billingInterval: interval,
      status: "pending",
    });

    return { url: session.url, sessionId: session.id };
  }

  async function activateFromCheckout(session: {
    id: string;
    customer?: string;
    subscription?: string;
    metadata?: Record<string, string>;
  }) {
    await db
      .update(bundleSubscriptions)
      .set({
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: session.subscription ?? null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(bundleSubscriptions.stripeCheckoutSessionId, session.id),
          eq(bundleSubscriptions.status, "pending"),
        ),
      );
  }

  async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET_BUNDLES;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET_BUNDLES not configured");
    if (!verifyStripeSignature(rawBody, signature, secret)) {
      throw new Error("Invalid Stripe signature");
    }

    const event = JSON.parse(rawBody.toString("utf8")) as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as {
        id: string;
        customer?: string;
        subscription?: string;
        metadata?: Record<string, string>;
      };
      if (session.metadata?.product === "bundle") {
        await activateFromCheckout(session);
      }
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as {
        id: string;
        status: string;
        current_period_start?: number;
        current_period_end?: number;
      };
      await db
        .update(bundleSubscriptions)
        .set({
          status: sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "canceled",
          currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
          currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
          updatedAt: new Date(),
        })
        .where(eq(bundleSubscriptions.stripeSubscriptionId, sub.id));
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as { id: string };
      await db
        .update(bundleSubscriptions)
        .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(bundleSubscriptions.stripeSubscriptionId, sub.id));
    }
  }

  return {
    listPlans,
    getPlanBySlug,
    getActiveSubscription,
    getEntitlementsForCompany,
    createCheckoutSession,
    handleWebhook,
  };
}
