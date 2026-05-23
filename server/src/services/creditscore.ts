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
import { linkStripeCustomerToAccount } from "./customer-account-linker.js";

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

// A result is "degraded" if the crawler returned no pages OR every scrape
// came back with effectively empty markdown (the symptom of Firecrawl
// answering 200 with an empty body — the original P0 cause from
// 2026-04-30).
//
// We deliberately do NOT treat "all three data subscores zero" as
// degraded: that triggers on genuinely thin / parked / single-page sites
// where the crawler worked fine but the page has no JSON-LD, no headings,
// and no sitemap lastmod (example.com is the canonical case). Treating
// those as "crawler down" hides a real, low-but-honest result behind a
// misleading error message.
//
// The markdown-length check is the actual signal for "crawler succeeded
// but returned nothing useful." 100 chars combined across all scrapes is
// well below any real page (example.com itself produces ~400) but well
// above an empty/whitespace-only response.
const MIN_TOTAL_MARKDOWN_CHARS = 100;

export function isDegradedAuditResult(result: AuditResult): boolean {
  if ((result.pagesScraped ?? 0) === 0) return true;
  const totalMarkdownChars = (result.rawData ?? []).reduce(
    (sum, page) => sum + (page.markdown?.length ?? 0),
    0,
  );
  return totalMarkdownChars < MIN_TOTAL_MARKDOWN_CHARS;
}

type RawScrape = AuditResult["rawData"][number];
function rawDataForDb(result: AuditResult): RawScrape[] | null {
  return result.rawData && result.rawData.length > 0 ? result.rawData : null;
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
      allow_promotion_codes: "true",
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

  async function compGrant(args: {
    tier: string;
    url: string;
    email: string;
    compReason: string;
    grantedByUserId?: string;
    durationDays?: number;
  }): Promise<{ subscriptionId: string }> {
    const plan = await getPlanBySlug(args.tier);
    if (!plan) throw new Error(`Unknown creditscore plan: ${args.tier}`);

    const domain = domainFromUrl(args.url);
    if (!domain) throw new Error("Valid url required (must be absolute URL)");

    const reason = args.compReason.trim();
    if (!reason) throw new Error("compReason required");

    const oneTime = plan.billingInterval === "one_time";
    const now = new Date();
    const durationDays = args.durationDays ?? 30;
    const periodEnd = oneTime
      ? null
      : new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const [row] = await db
      .insert(creditscoreSubscriptions)
      .values({
        companyId: null,
        email: args.email,
        domain,
        planId: plan.id,
        tier: plan.tier,
        status: oneTime ? "fulfilled" : "active",
        currentPeriodStart: oneTime ? null : now,
        currentPeriodEnd: periodEnd,
        compReason: reason,
        grantedByUserId: args.grantedByUserId ?? null,
      })
      .returning({ id: creditscoreSubscriptions.id });
    const subId = row!.id;

    // Fire-and-forget initial audit + welcome email (mirrors paid checkout path).
    void generateReport(args.url, {
      subscriptionId: subId,
      email: args.email,
    })
      .then(({ result }) => {
        if (!result) return;
        if (isDegradedAuditResult(result)) {
          logger.warn(
            { subId },
            "creditscore: skipping welcome email — initial report was degraded; will retry on next scheduled scan",
          );
          return;
        }
        const kind =
          plan.tier === "report"
            ? "one_time_report"
            : plan.tier === "pro"
              ? "welcome_pro"
              : plan.tier === "growth"
                ? "welcome_growth"
                : "welcome_starter";
        void sendCreditscoreEmail({
          kind,
          to: args.email,
          data: {
            url: result.url,
            score: result.score,
            breakdown: result.breakdown,
            competitors: result.competitors,
            recommendations: result.recommendations,
            scanFrequency: plan.tier === "pro" ? "weekly" : "monthly",
          },
        });
      })
      .catch((err) => {
        logger.error({ err, subId }, "creditscore: comp grant initial audit failed");
      });

    return { subscriptionId: subId };
  }

  async function createPromoCode(args: {
    code: string;
    percentOff?: number;
    amountOffCents?: number;
    currency?: string;
    maxRedemptions?: number;
    expiresAt?: Date | null;
    duration?: "once" | "repeating" | "forever";
    durationInMonths?: number;
    name?: string;
  }): Promise<{ couponId: string; promoCodeId: string; code: string }> {
    const code = args.code.trim().toUpperCase();
    if (!code) throw new Error("code required");
    if (!/^[A-Z0-9_-]{3,40}$/.test(code)) {
      throw new Error("code must be 3-40 chars, A-Z 0-9 _ - only");
    }
    if (
      (args.percentOff == null || args.percentOff <= 0) &&
      (args.amountOffCents == null || args.amountOffCents <= 0)
    ) {
      throw new Error("percentOff or amountOffCents required");
    }

    const couponBody: Record<string, unknown> = {
      duration: args.duration ?? "once",
      name: args.name ?? `CreditScore promo ${code}`,
    };
    if (args.percentOff != null) couponBody.percent_off = String(args.percentOff);
    if (args.amountOffCents != null) {
      couponBody.amount_off = String(args.amountOffCents);
      couponBody.currency = (args.currency ?? "usd").toLowerCase();
    }
    if (args.duration === "repeating" && args.durationInMonths) {
      couponBody.duration_in_months = String(args.durationInMonths);
    }
    if (args.maxRedemptions && args.maxRedemptions > 0) {
      couponBody.max_redemptions = String(args.maxRedemptions);
    }

    const coupon = await stripeRequest<{ id: string }>("POST", "/coupons", couponBody);

    const promoBody: Record<string, unknown> = {
      coupon: coupon.id,
      code,
    };
    if (args.expiresAt) {
      promoBody.expires_at = String(Math.floor(args.expiresAt.getTime() / 1000));
    }
    if (args.maxRedemptions && args.maxRedemptions > 0) {
      promoBody.max_redemptions = String(args.maxRedemptions);
    }

    const promo = await stripeRequest<{ id: string; code: string }>(
      "POST",
      "/promotion_codes",
      promoBody,
    );

    return { couponId: coupon.id, promoCodeId: promo.id, code: promo.code };
  }

  async function listPromoCodes(): Promise<
    Array<{
      id: string;
      code: string;
      active: boolean;
      timesRedeemed: number;
      maxRedemptions: number | null;
      expiresAt: number | null;
      coupon: {
        id: string;
        percentOff: number | null;
        amountOff: number | null;
        currency: string | null;
        duration: string;
      };
    }>
  > {
    type StripePromo = {
      id: string;
      code: string;
      active: boolean;
      times_redeemed: number;
      max_redemptions: number | null;
      expires_at: number | null;
      coupon: {
        id: string;
        percent_off: number | null;
        amount_off: number | null;
        currency: string | null;
        duration: string;
      };
    };
    const res = await stripeRequest<{ data: StripePromo[] }>(
      "GET",
      "/promotion_codes?limit=100",
    );
    return res.data.map((p) => ({
      id: p.id,
      code: p.code,
      active: p.active,
      timesRedeemed: p.times_redeemed,
      maxRedemptions: p.max_redemptions,
      expiresAt: p.expires_at,
      coupon: {
        id: p.coupon.id,
        percentOff: p.coupon.percent_off,
        amountOff: p.coupon.amount_off,
        currency: p.coupon.currency,
        duration: p.coupon.duration,
      },
    }));
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
          if (isDegradedAuditResult(result)) {
            logger.warn(
              { subId: sub.id },
              "creditscore: skipping welcome email — initial report was degraded; will retry on next scheduled scan",
            );
            return;
          }
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
        customer_email?: string | null;
        customer_details?: { email?: string | null } | null;
        subscription?: string;
        payment_intent?: string;
        metadata?: Record<string, string>;
      };
      if (session.metadata?.product === "creditscore") {
        await activateFromCheckout(session);
      }
      // Link Stripe customer to portal account — cross-cutting; runs for every
      // checkout regardless of product. Wrapped in try/catch so a linker
      // failure never rolls back product fulfillment.
      const sessionEmail =
        session.customer_details?.email || session.customer_email || null;
      if (sessionEmail && session.customer) {
        try {
          await linkStripeCustomerToAccount(db, {
            email: sessionEmail,
            stripeCustomerId: session.customer,
          });
        } catch (err) {
          logger.error(
            { err, sessionId: session.id },
            "creditscore: customer-account-linker failed (non-fatal)",
          );
        }
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
    const degraded = isDegradedAuditResult(typedResult);

    if (degraded) {
      logger.warn(
        {
          reportId,
          domain,
          pagesScraped: typedResult.pagesScraped,
          score: typedResult.score,
        },
        "creditscore: generated report is degraded — crawler returned partial/no data",
      );
    }

    await db
      .update(creditscoreReports)
      .set({
        status: degraded ? "degraded" : "complete",
        score: degraded ? null : typedResult.score,
        resultJson: typedResult as unknown as Record<string, unknown>,
        rawData: rawDataForDb(typedResult) as unknown as Record<string, unknown> | null,
        updatedAt: new Date(),
      })
      .where(eq(creditscoreReports.id, reportId));

    return { reportId, result: typedResult };
  }

  async function storeAuditResult(args: {
    url: string;
    result: AuditResult;
    email?: string;
  }): Promise<{ reportId: string; status: "complete" | "degraded" }> {
    const domain = domainFromUrl(args.url);
    if (!domain) throw new Error("Valid url required");

    const degraded = isDegradedAuditResult(args.result);
    const status: "complete" | "degraded" = degraded ? "degraded" : "complete";

    if (degraded) {
      logger.warn(
        {
          domain,
          pagesScraped: args.result.pagesScraped,
          score: args.result.score,
        },
        "creditscore: storing audit result as degraded — crawler returned partial/no data",
      );
    }

    const [row] = await db
      .insert(creditscoreReports)
      .values({
        subscriptionId: null,
        domain,
        email: args.email ?? null,
        status,
        // Suppress score on degraded rows so dashboards / upsells can't
        // ORDER BY score and surface garbage data.
        score: degraded ? null : args.result.score,
        resultJson: args.result as unknown as Record<string, unknown>,
        rawData: rawDataForDb(args.result) as unknown as Record<string, unknown> | null,
      })
      .returning({ id: creditscoreReports.id });
    return { reportId: row!.id, status };
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
    compGrant,
    createPromoCode,
    listPromoCodes,
    handleWebhook,
    generateReport,
    storeAuditResult,
    scheduleScans,
  };
}
