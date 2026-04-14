import { createHash, randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  intelApiKeys,
  intelCustomers,
  intelPlans,
  intelUsageMeter,
} from "@paperclipai/db";
import { createTransport, type Transporter } from "nodemailer";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Stripe REST client (fetch-based, no npm dependency)
// ---------------------------------------------------------------------------

const STRIPE_API = "https://api.stripe.com/v1";

function stripeKey(): string | null {
  const k = process.env.STRIPE_SECRET_KEY;
  return k && k.trim() ? k.trim() : null;
}

function toForm(params: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      parts.push(toForm(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object" && item !== null) {
          parts.push(toForm(item as Record<string, unknown>, `${key}[${i}]`));
        } else {
          parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
        }
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

async function stripeRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const key = stripeKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  const url = `${STRIPE_API}${path}`;
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body && method === "POST") {
    (init as { body: string }).body = toForm(body);
  }
  const res = await fetch(url, init);
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const msg = (json as { error?: { message?: string } })?.error?.message || text;
    throw new Error(`Stripe ${method} ${path} failed: ${msg}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Webhook signature verification (Stripe docs: scheme v1)
// ---------------------------------------------------------------------------

export function verifyStripeSignature(
  payload: string | Buffer,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
): boolean {
  if (!header) return false;
  const parts = header.split(",").reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split("=");
    if (k && v) acc[k.trim()] = v.trim();
    return acc;
  }, {});
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;
  const signedPayload = `${t}.${typeof payload === "string" ? payload : payload.toString("utf8")}`;
  const expected = createHmac("sha256", secret).update(signedPayload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(v1, "utf8");
  if (a.length !== b.length) return false;
  if (!timingSafeEqual(a, b)) return false;
  const ageSec = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  return ageSec <= toleranceSec;
}

// ---------------------------------------------------------------------------
// API key generation + hashing
// ---------------------------------------------------------------------------

const KEY_PREFIX = "cd_intel_";

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `${KEY_PREFIX}${randomBytes(24).toString("hex")}`;
  const prefix = raw.slice(0, KEY_PREFIX.length + 8);
  const hash = createHash("sha256").update(raw).digest("hex");
  return { raw, prefix, hash };
}

// ---------------------------------------------------------------------------
// SMTP welcome email
// ---------------------------------------------------------------------------

let mailer: Transporter | null = null;
function getMailer(): Transporter | null {
  if (mailer) return mailer;
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT) || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  mailer = createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return mailer;
}

async function sendWelcomeEmail(email: string, rawKey: string, planName: string): Promise<void> {
  const transport = getMailer();
  const from = process.env.ALERT_EMAIL_FROM || "noreply@coherencedaddy.com";
  const bcc = process.env.ALERT_EMAIL_TO;
  const subject = `Your Coherence Daddy Intel API key — ${planName}`;
  const body = [
    `Welcome to the Coherence Daddy Intel API (${planName} plan).`,
    "",
    "Your API key (save this — it will only be shown once):",
    "",
    `  ${rawKey}`,
    "",
    "Quickstart:",
    `  curl -H "Authorization: Bearer ${rawKey}" https://api.coherencedaddy.com/api/intel/companies`,
    "",
    "Docs: https://coherencedaddy.com/intel/docs",
    "Manage your subscription: https://coherencedaddy.com/intel/billing",
    "",
    "If you didn't sign up, reply to this email and we'll revoke the key.",
  ].join("\n");

  if (!transport) {
    logger.warn({ email }, "intel-billing: SMTP not configured — welcome email skipped");
    return;
  }

  try {
    await transport.sendMail({
      from,
      to: email,
      bcc: bcc || undefined,
      subject,
      text: body,
    });
    logger.info({ email, bcc }, "intel-billing: welcome email sent");
  } catch (err) {
    logger.error({ err, email }, "intel-billing: welcome email failed");
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface CheckoutArgs {
  planSlug: string;
  email: string;
  successUrl?: string;
  cancelUrl?: string;
}

export function intelBillingService(db: Db) {
  async function listPlans() {
    return db
      .select()
      .from(intelPlans)
      .where(eq(intelPlans.active, true));
  }

  async function getPlanBySlug(slug: string) {
    const rows = await db
      .select()
      .from(intelPlans)
      .where(eq(intelPlans.slug, slug))
      .limit(1);
    return rows[0] ?? null;
  }

  async function createCheckoutSession(args: CheckoutArgs): Promise<{ url: string }> {
    const plan = await getPlanBySlug(args.planSlug);
    if (!plan) throw new Error(`Unknown plan: ${args.planSlug}`);
    if (plan.slug === "free") throw new Error("Cannot subscribe to the free plan");
    if (!plan.stripePriceId) throw new Error(`Plan ${plan.slug} has no Stripe price configured`);

    const successUrl =
      args.successUrl ||
      process.env.INTEL_BILLING_SUCCESS_URL ||
      "https://dashboard.coherencedaddy.com/billing/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      args.cancelUrl ||
      process.env.INTEL_BILLING_CANCEL_URL ||
      "https://dashboard.coherencedaddy.com/intel/pricing";

    const body: Record<string, unknown> = {
      mode: "subscription",
      "line_items[0][price]": plan.stripePriceId,
      "line_items[0][quantity]": 1,
      customer_email: args.email,
      success_url: successUrl,
      cancel_url: cancelUrl,
      "metadata[plan_slug]": plan.slug,
      "metadata[email]": args.email,
    };

    // Add metered overage price as a second line item if configured.
    if (plan.stripeMeteredPriceId) {
      body["line_items[1][price]"] = plan.stripeMeteredPriceId;
    }

    const session = await stripeRequest<{ url: string }>(
      "POST",
      "/checkout/sessions",
      body,
    );
    return { url: session.url };
  }

  async function provisionFromCheckout(session: {
    id: string;
    customer?: string;
    customer_email?: string;
    subscription?: string;
    metadata?: Record<string, string>;
  }): Promise<{ apiKeyId: string; rawKey: string } | null> {
    const email = session.customer_email || session.metadata?.email;
    const planSlug = session.metadata?.plan_slug;
    if (!email || !planSlug) {
      logger.warn({ session: session.id }, "intel-billing: checkout missing email or plan");
      return null;
    }
    const plan = await getPlanBySlug(planSlug);
    if (!plan) {
      logger.warn({ planSlug }, "intel-billing: unknown plan in checkout");
      return null;
    }

    // Fetch subscription for billing period + item id for metered usage.
    let subItemId: string | null = null;
    let periodStart: Date | null = null;
    let periodEnd: Date | null = null;
    if (session.subscription) {
      try {
        const sub = await stripeRequest<{
          current_period_start: number;
          current_period_end: number;
          items: { data: Array<{ id: string; price: { id: string } }> };
        }>("GET", `/subscriptions/${session.subscription}`);
        periodStart = new Date(sub.current_period_start * 1000);
        periodEnd = new Date(sub.current_period_end * 1000);
        if (plan.stripeMeteredPriceId) {
          const item = sub.items.data.find((i) => i.price.id === plan.stripeMeteredPriceId);
          if (item) subItemId = item.id;
        }
      } catch (err) {
        logger.warn({ err }, "intel-billing: subscription fetch failed");
      }
    }

    // Upsert customer.
    const existing = await db
      .select()
      .from(intelCustomers)
      .where(eq(intelCustomers.email, email))
      .limit(1);

    let customerId: string;
    if (existing.length > 0) {
      customerId = existing[0].id;
      await db
        .update(intelCustomers)
        .set({
          stripeCustomerId: session.customer ?? existing[0].stripeCustomerId,
          stripeSubscriptionId: session.subscription ?? existing[0].stripeSubscriptionId,
          stripeSubscriptionItemId: subItemId ?? existing[0].stripeSubscriptionItemId,
          planId: plan.id,
          status: "active",
          currentPeriodStart: periodStart ?? existing[0].currentPeriodStart,
          currentPeriodEnd: periodEnd ?? existing[0].currentPeriodEnd,
          updatedAt: new Date(),
        })
        .where(eq(intelCustomers.id, customerId));
    } else {
      const inserted = await db
        .insert(intelCustomers)
        .values({
          email,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          stripeSubscriptionItemId: subItemId,
          planId: plan.id,
          status: "active",
          currentPeriodStart: periodStart,
          currentPeriodEnd: periodEnd,
        })
        .returning({ id: intelCustomers.id });
      customerId = inserted[0].id;
    }

    // Generate and store an API key.
    const { raw, prefix, hash } = generateApiKey();
    const inserted = await db
      .insert(intelApiKeys)
      .values({ customerId, keyPrefix: prefix, keyHash: hash, name: "default" })
      .returning({ id: intelApiKeys.id });

    await sendWelcomeEmail(email, raw, plan.name);

    return { apiKeyId: inserted[0].id, rawKey: raw };
  }

  async function markStatus(stripeCustomerId: string, status: string) {
    await db
      .update(intelCustomers)
      .set({ status, updatedAt: new Date() })
      .where(eq(intelCustomers.stripeCustomerId, stripeCustomerId));
  }

  async function extendPeriod(stripeSubscriptionId: string, periodEnd: Date) {
    await db
      .update(intelCustomers)
      .set({ currentPeriodEnd: periodEnd, status: "active", updatedAt: new Date() })
      .where(eq(intelCustomers.stripeSubscriptionId, stripeSubscriptionId));
  }

  async function handleWebhookEvent(event: { type: string; data: { object: Record<string, unknown> } }) {
    const obj = event.data.object;
    switch (event.type) {
      case "checkout.session.completed": {
        await provisionFromCheckout(obj as Parameters<typeof provisionFromCheckout>[0]);
        break;
      }
      case "invoice.payment_succeeded": {
        const inv = obj as { subscription?: string; period_end?: number };
        if (inv.subscription && inv.period_end) {
          await extendPeriod(inv.subscription, new Date(inv.period_end * 1000));
        }
        break;
      }
      case "customer.subscription.deleted":
      case "customer.subscription.updated": {
        const sub = obj as { customer?: string; status?: string };
        if (sub.customer && sub.status) {
          await markStatus(sub.customer, sub.status);
        }
        break;
      }
      case "invoice.payment_failed": {
        const inv = obj as { customer?: string };
        if (inv.customer) await markStatus(inv.customer, "past_due");
        break;
      }
    }
  }

  async function reportOverageUsage(): Promise<{ reported: number }> {
    if (!stripeKey()) {
      logger.debug("intel-billing: STRIPE_SECRET_KEY unset — overage reporting skipped");
      return { reported: 0 };
    }
    // Find unreported overage rows joined with subscription item IDs.
    const rows = await db.execute<{
      meter_id: string;
      overage_count: number;
      sub_item_id: string;
    }>(sql`
      SELECT m.id AS meter_id, m.overage_count, c.stripe_subscription_item_id AS sub_item_id
      FROM intel_usage_meter m
      JOIN intel_api_keys k ON k.id = m.api_key_id
      JOIN intel_customers c ON c.id = k.customer_id
      WHERE m.overage_count > 0
        AND m.overage_reported_to_stripe_at IS NULL
        AND c.stripe_subscription_item_id IS NOT NULL
    `);
    const list = (rows as unknown as { rows?: Array<{ meter_id: string; overage_count: number; sub_item_id: string }> }).rows
      ?? (rows as unknown as Array<{ meter_id: string; overage_count: number; sub_item_id: string }>);
    let reported = 0;
    for (const row of list ?? []) {
      try {
        await stripeRequest("POST", `/subscription_items/${row.sub_item_id}/usage_records`, {
          quantity: row.overage_count,
          timestamp: Math.floor(Date.now() / 1000),
          action: "increment",
        });
        await db
          .update(intelUsageMeter)
          .set({ overageReportedToStripeAt: new Date() })
          .where(eq(intelUsageMeter.id, row.meter_id));
        reported += 1;
      } catch (err) {
        logger.warn({ err, meterId: row.meter_id }, "intel-billing: usage record failed");
      }
    }
    return { reported };
  }

  async function getMyUsage(rawKey: string) {
    const hash = createHash("sha256").update(rawKey).digest("hex");
    const rows = await db
      .select({
        customerId: intelCustomers.id,
        email: intelCustomers.email,
        status: intelCustomers.status,
        planName: intelPlans.name,
        planSlug: intelPlans.slug,
        quota: intelPlans.monthlyRequestQuota,
        rateLimit: intelPlans.rateLimitPerMin,
        keyId: intelApiKeys.id,
      })
      .from(intelApiKeys)
      .innerJoin(intelCustomers, eq(intelApiKeys.customerId, intelCustomers.id))
      .leftJoin(intelPlans, eq(intelCustomers.planId, intelPlans.id))
      .where(and(eq(intelApiKeys.keyHash, hash), isNull(intelApiKeys.revokedAt)))
      .limit(1);
    if (rows.length === 0) return null;
    const row = rows[0];
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    const usage = await db
      .select()
      .from(intelUsageMeter)
      .where(and(eq(intelUsageMeter.apiKeyId, row.keyId), eq(intelUsageMeter.periodStart, period)))
      .limit(1);
    return {
      email: row.email,
      status: row.status,
      plan: { name: row.planName, slug: row.planSlug, quota: Number(row.quota ?? 0), rateLimitPerMin: row.rateLimit },
      usage: {
        requestCount: usage[0] ? Number(usage[0].requestCount) : 0,
        overageCount: usage[0] ? Number(usage[0].overageCount) : 0,
        periodStart: period,
      },
    };
  }

  return {
    listPlans,
    getPlanBySlug,
    createCheckoutSession,
    provisionFromCheckout,
    handleWebhookEvent,
    reportOverageUsage,
    getMyUsage,
  };
}

export type IntelBillingService = ReturnType<typeof intelBillingService>;
