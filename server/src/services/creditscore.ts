import { and, desc, eq, or } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  creditscorePlans,
  creditscoreReports,
  creditscoreSubscriptions,
} from "@paperclipai/db";
import { stripeRequest, verifyStripeSignature } from "./stripe-client.js";
import { logger } from "../middleware/logger.js";
import { runAudit, type AuditResult } from "../routes/audit.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";

// ---------------------------------------------------------------------------
// CreditScore product service.
// Mirrors the structure of bundle-entitlements.ts.
// ---------------------------------------------------------------------------

export type CreditscoreTier = "report" | "starter" | "growth" | "pro";

export interface CreateCheckoutArgs {
  // Slug of the creditscore_plans row (e.g. "starter_monthly").
  tier: string;
  // Site URL the customer is auditing; stored on the subscription.
  url: string;
  email?: string;
  auditResultId?: string;
  companyId?: string;
  successUrl?: string;
  cancelUrl?: string;
}

function domainFromUrl(input: string): string | null {
  try {
    const u = new URL(input.trim());
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function creditscoreService(db: Db) {
  async function listPlans() {
    return db
      .select()
      .from(creditscorePlans)
      .where(eq(creditscorePlans.active, true));
  }

  async function getPlanBySlug(slug: string) {
    const rows = await db
      .select()
      .from(creditscorePlans)
      .where(eq(creditscorePlans.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async function getReport(reportId: string) {
    const rows = await db
      .select()
      .from(creditscoreReports)
      .where(eq(creditscoreReports.id, reportId))
      .limit(1);
    return rows[0] ?? null;
  }

  async function resolveEntitlement(args: { domain?: string; email?: string }) {
    const filters: Parameters<typeof and> = [];
    if (args.email) filters.push(eq(creditscoreSubscriptions.email, args.email));
    if (args.domain) filters.push(eq(creditscoreSubscriptions.domain, args.domain));
    if (!filters.length) return null;

    const rows = await db
      .select()
      .from(creditscoreSubscriptions)
      .where(
        and(
          or(
            eq(creditscoreSubscriptions.status, "active"),
            eq(creditscoreSubscriptions.status, "past_due"),
          ),
          ...filters,
        ),
      )
      .orderBy(desc(creditscoreSubscriptions.createdAt))
      .limit(1);

    return rows[0] ?? null;
  }

  async function createCheckout(args: CreateCheckoutArgs): Promise<{ url: string; sessionId: string }> {
    const plan = await getPlanBySlug(args.tier);
    if (!plan) throw new Error(`Unknown creditscore plan: ${args.tier}`);
    if (!plan.stripePriceId) {
      throw new Error(`Creditscore plan ${args.tier} has no Stripe price configured`);
    }

    const domain = domainFromUrl(args.url);
    if (!domain) throw new Error("Valid url required (must be absolute URL)");

    const successUrl =
      args.successUrl ||
      process.env.CREDITSCORE_SUCCESS_URL ||
      "https://freetools.coherencedaddy.com/creditscore-home?checkout=success&session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      args.cancelUrl ||
      process.env.CREDITSCORE_CANCEL_URL ||
      "https://freetools.coherencedaddy.com/creditscore-home?checkout=canceled";

    const mode = plan.billingInterval === "one_time" ? "payment" : "subscription";

    const body: Record<string, string> = {
      mode,
      "line_items[0][price]": plan.stripePriceId,
      "line_items[0][quantity]": "1",
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[product]": "creditscore",
      "metadata[plan_slug]": plan.slug,
      "metadata[tier]": plan.tier,
      "metadata[billing_interval]": plan.billingInterval,
      "metadata[domain]": domain,
      "metadata[url]": args.url,
    };
    if (args.email) body.customer_email = args.email;
    if (args.companyId) body["metadata[company_id]"] = args.companyId;
    if (args.auditResultId) body["metadata[audit_result_id]"] = args.auditResultId;

    const session = await stripeRequest<{ id: string; url: string }>(
      "POST",
      "/checkout/sessions",
      body,
    );

    await db.insert(creditscoreSubscriptions).values({
      companyId: args.companyId ?? null,
      email: args.email ?? null,
      domain,
      planId: plan.id,
      tier: plan.tier,
      stripeCheckoutSessionId: session.id,
      status: "pending",
    });

    return { url: session.url, sessionId: session.id };
  }

  async function activateFromCheckout(session: {
    id: string;
    customer?: string;
    subscription?: string;
    payment_intent?: string;
    metadata?: Record<string, string>;
  }) {
    const meta = session.metadata ?? {};
    const oneTime = meta.billing_interval === "one_time";
    await db
      .update(creditscoreSubscriptions)
      .set({
        stripeCustomerId: session.customer ?? null,
        stripeSubscriptionId: session.subscription ?? null,
        stripePaymentIntentId: session.payment_intent ?? null,
        status: oneTime ? "fulfilled" : "active",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(creditscoreSubscriptions.stripeCheckoutSessionId, session.id),
          eq(creditscoreSubscriptions.status, "pending"),
        ),
      );

    // Kick off the initial audit for the purchased domain and send the
    // tier-appropriate welcome email. Fire-and-forget — errors are logged
    // but do not fail the webhook.
    const row = await db
      .select()
      .from(creditscoreSubscriptions)
      .where(eq(creditscoreSubscriptions.stripeCheckoutSessionId, session.id))
      .limit(1);
    const sub = row[0];
    if (sub && meta.url) {
      void generateReport(meta.url, {
        subscriptionId: sub.id,
        email: sub.email ?? undefined,
      })
        .then(({ result }) => {
          if (!sub.email || !result) return;
          const kind =
            sub.tier === "report"
              ? "one_time_report"
              : sub.tier === "pro"
                ? "welcome_pro"
                : sub.tier === "growth"
                  ? "welcome_growth"
                  : "welcome_starter";
          void sendCreditscoreEmail({
            kind,
            to: sub.email,
            data: {
              url: result.url,
              score: result.score,
              breakdown: result.breakdown,
              competitors: result.competitors,
              recommendations: result.recommendations,
              scanFrequency: sub.tier === "pro" ? "weekly" : "monthly",
            },
          });
        })
        .catch((err) => {
          logger.error({ err, subId: sub.id }, "creditscore: initial audit after checkout failed");
        });
    }
  }

  async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.STRIPE_WEBHOOK_SECRET_CREDITSCORE;
    if (!secret) {
      throw new Error("STRIPE_WEBHOOK_SECRET_CREDITSCORE not configured");
    }
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
        payment_intent?: string;
        metadata?: Record<string, string>;
      };
      if (session.metadata?.product === "creditscore") {
        await activateFromCheckout(session);
      }
    }

    if (event.type === "invoice.paid") {
      const invoice = event.data.object as {
        subscription?: string;
        period_start?: number;
        period_end?: number;
      };
      if (invoice.subscription) {
        await db
          .update(creditscoreSubscriptions)
          .set({
            status: "active",
            currentPeriodStart: invoice.period_start
              ? new Date(invoice.period_start * 1000)
              : undefined,
            currentPeriodEnd: invoice.period_end
              ? new Date(invoice.period_end * 1000)
              : undefined,
            updatedAt: new Date(),
          })
          .where(eq(creditscoreSubscriptions.stripeSubscriptionId, invoice.subscription));
      }
    }

    if (event.type === "customer.subscription.updated") {
      const sub = event.data.object as {
        id: string;
        status: string;
        current_period_start?: number;
        current_period_end?: number;
      };
      const mappedStatus =
        sub.status === "active" ? "active" : sub.status === "past_due" ? "past_due" : "canceled";
      await db
        .update(creditscoreSubscriptions)
        .set({
          status: mappedStatus,
          currentPeriodStart: sub.current_period_start
            ? new Date(sub.current_period_start * 1000)
            : undefined,
          currentPeriodEnd: sub.current_period_end
            ? new Date(sub.current_period_end * 1000)
            : undefined,
          updatedAt: new Date(),
        })
        .where(eq(creditscoreSubscriptions.stripeSubscriptionId, sub.id));
    }

    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as { id: string };
      await db
        .update(creditscoreSubscriptions)
        .set({ status: "canceled", canceledAt: new Date(), updatedAt: new Date() })
        .where(eq(creditscoreSubscriptions.stripeSubscriptionId, sub.id));
    }

    return { received: true, handled: true, type: event.type };
  }

  async function generateReport(
    urlOrDomain: string,
    opts: { email?: string; subscriptionId?: string; persistComplete?: boolean } = {},
  ): Promise<{ reportId: string; result: AuditResult | null }> {
    const asUrl = urlOrDomain.startsWith("http")
      ? urlOrDomain
      : `https://${urlOrDomain.replace(/^\/\//, "")}`;
    const domain = domainFromUrl(asUrl);
    if (!domain) throw new Error("Valid url or domain required");

    // Find prior score for delta tracking.
    const prior = await db
      .select({ score: creditscoreReports.score })
      .from(creditscoreReports)
      .where(
        and(eq(creditscoreReports.domain, domain), eq(creditscoreReports.status, "complete")),
      )
      .orderBy(desc(creditscoreReports.createdAt))
      .limit(1);
    const previousScore = prior[0]?.score ?? null;

    const [row] = await db
      .insert(creditscoreReports)
      .values({
        subscriptionId: opts.subscriptionId ?? null,
        domain,
        email: opts.email ?? null,
        status: "pending",
        previousScore: previousScore ?? undefined,
      })
      .returning({ id: creditscoreReports.id });
    const reportId = row!.id;

    let result: AuditResult | null = null;
    try {
      await runAudit(
        asUrl,
        (ev) => {
          if (ev.type === "complete") result = ev.result;
        },
        () => false,
      );
    } catch (err) {
      await db
        .update(creditscoreReports)
        .set({
          status: "failed",
          resultJson: { error: (err as Error).message },
          updatedAt: new Date(),
        })
        .where(eq(creditscoreReports.id, reportId));
      throw err;
    }

    if (!result) {
      await db
        .update(creditscoreReports)
        .set({
          status: "failed",
          resultJson: { error: "Audit returned no result" },
          updatedAt: new Date(),
        })
        .where(eq(creditscoreReports.id, reportId));
      throw new Error("Audit returned no result");
    }

    const typedResult = result as AuditResult;
    await db
      .update(creditscoreReports)
      .set({
        status: "complete",
        score: typedResult.score,
        resultJson: typedResult as unknown as Record<string, unknown>,
        updatedAt: new Date(),
      })
      .where(eq(creditscoreReports.id, reportId));

    return { reportId, result: typedResult };
  }

  async function storeAuditResult(args: {
    url: string;
    result: AuditResult;
    email?: string;
  }): Promise<{ reportId: string }> {
    const domain = domainFromUrl(args.url);
    if (!domain) throw new Error("Valid url required");

    const [row] = await db
      .insert(creditscoreReports)
      .values({
        subscriptionId: null,
        domain,
        email: args.email ?? null,
        status: "complete",
        score: args.result.score,
        resultJson: args.result as unknown as Record<string, unknown>,
      })
      .returning({ id: creditscoreReports.id });
    return { reportId: row!.id };
  }

  async function scheduleScans(): Promise<void> {
    // Real implementation lives in creditscore-crons.ts to avoid a circular
    // import (crons depends on this service). Call the helper directly.
    const { runScheduledScans } = await import("./creditscore-crons.js");
    await runScheduledScans(db);
  }

  return {
    listPlans,
    getPlanBySlug,
    getReport,
    resolveEntitlement,
    createCheckout,
    handleWebhook,
    generateReport,
    storeAuditResult,
    scheduleScans,
  };
}
