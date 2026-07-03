// ---------------------------------------------------------------------------
// Coherent Ones University — Stripe checkout route + webhook router.
//
// Exposes two surfaces:
//
//   POST /api/university/checkout   — public; storefront proxies here
//   POST /api/university/webhook    — Stripe webhook receiver
//
// The checkout route resolves the price by `lookup_key=university_monthly`
// (preferred — see docs/deploy/stripe-products.md §Notes) and falls back
// to the `UNIVERSITY_STRIPE_PRICE_ID` env var if no lookup_keys are set on
// the account.
//
// The webhook router uses express.raw() and must be mounted BEFORE
// express.json() in app.ts (mirrors watchtowerWebhookRouter).
//
// Mirrors the single-tier $X/mo Watchtower template
// (routes/watchtower-checkout.ts) — University is a flat $50/mo membership, so
// the body is just `{ email, displayName? }` (no brand/domain/prompts).
// ---------------------------------------------------------------------------

import express, { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  createCheckoutSession as createStripeCheckoutSession,
} from "../services/stripe-checkout.js";
import {
  stripeRequest,
  stripeConfigured,
  verifyStripeSignature,
  universityStripeKey,
} from "../services/stripe-client.js";
import {
  handleUniversityCheckout,
  handleUniversitySubscriptionUpdated,
  handleUniversitySubscriptionDeleted,
  handleVoiceAddonCheckout,
  handleVoiceAddonSubscriptionUpdated,
  handleVoiceAddonSubscriptionDeleted,
  isVoiceAddonSubscription,
  invoiceLinesAreVoiceAddon,
  VOICE_ADDON_PRODUCT,
  type InvoiceLineForAddonCheck,
} from "../services/university-stripe-handler.js";
import {
  handleReferralAttribution,
  handleReferralInvoicePaid,
  handleReferralRefund,
} from "../services/university-referrals.js";
import {
  resolvePlanKey,
  countUniversityMembers,
  foundingCap,
  isFoundingEligible,
  PLAN_ANNUAL,
  PLAN_MONTHLY,
  type UniversityPlanKey,
} from "../services/university-founding.js";
import { logger } from "../middleware/logger.js";

// Per-plan Stripe price resolution. Each plan resolves by its own lookup_key
// first (stable across test/live rotations) then falls back to its env var.
// Both prices live on the University Stripe account (Starwise).
const PLAN_PRICE_CONFIG: Record<
  UniversityPlanKey,
  { lookupKey: string; envVar: string }
> = {
  [PLAN_MONTHLY]: {
    lookupKey: "university_monthly",
    envVar: "UNIVERSITY_STRIPE_PRICE_ID",
  },
  [PLAN_ANNUAL]: {
    lookupKey: "university_annual",
    envVar: "UNIVERSITY_ANNUAL_PRICE_ID",
  },
};

interface PriceListResponse {
  data: Array<{
    id: string;
    active: boolean;
    lookup_key: string | null;
  }>;
}

/**
 * Resolves the Stripe price id for a University plan (monthly or annual).
 *
 * Order of preference per plan (matches docs/deploy/stripe-products.md):
 *   1. `stripe.prices.list({ lookup_keys: [<plan lookup_key>], ... })`
 *      — stable across test/live mode rotations.
 *   2. the plan's env var fallback (UNIVERSITY_STRIPE_PRICE_ID for monthly,
 *      UNIVERSITY_ANNUAL_PRICE_ID for annual) for accounts that haven't
 *      backfilled lookup_keys yet.
 *
 * Throws if neither resolves so the route surfaces a clear 503.
 *
 * The prices live on the University Stripe account (Starwise), NOT the shared
 * Coherence Daddy account — so the lookup_keys call must authenticate with the
 * University key (`universityStripeKey()` = UNIVERSITY_STRIPE_SECRET_KEY ??
 * STRIPE_SECRET_KEY). Callers pass that key in; it defaults to the resolved
 * University key when omitted. `plan` defaults to monthly for back-compat.
 */
export async function resolveUniversityPriceId(
  plan: UniversityPlanKey = PLAN_MONTHLY,
  secretKey: string | undefined = universityStripeKey(),
): Promise<string> {
  const { lookupKey, envVar } = PLAN_PRICE_CONFIG[plan];

  if (secretKey) {
    try {
      const list = await stripeRequest<PriceListResponse>(
        "GET",
        `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&expand[]=data.product&limit=10`,
        undefined,
        secretKey,
      );
      const active = list.data?.find(
        (p) => p.active && p.lookup_key === lookupKey,
      );
      if (active) return active.id;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, lookupKey, plan },
        "university-checkout: lookup_key resolve failed, falling back to env var",
      );
    }
  }

  const envId = process.env[envVar]?.trim();
  if (envId) return envId;

  throw new Error(
    `University price not resolvable for plan="${plan}": no Stripe price with lookup_key="${lookupKey}" and ${envVar} is unset`,
  );
}

interface CheckoutBody {
  email?: unknown;
  displayName?: unknown;
  returnUrl?: unknown;
  ref?: unknown;
  // 'monthly' | 'annual' selector from the storefront toggle. Normalized via
  // resolvePlanKey; anything unrecognized fails safe to monthly.
  plan?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function universityCheckoutRoutes(db: Db): Router {
  const router = Router();

  // Public status — drives the storefront's "Founding member — rate locked for
  // life" badge + the pricing copy. Server-authoritative so the badge can't be
  // shown after founders run out. Cheap (one COUNT); cached briefly by the CDN.
  router.get("/status", async (_req: Request, res: Response) => {
    try {
      const cap = foundingCap();
      const count = await countUniversityMembers(db);
      const remaining = Math.max(0, cap - count);
      res.set("Cache-Control", "public, max-age=60");
      res.json({
        founding: {
          available: isFoundingEligible(count, cap),
          cap,
          claimed: count,
          remaining,
        },
        plans: {
          monthly: { key: PLAN_MONTHLY, priceDisplay: "$50/mo" },
          annual: { key: PLAN_ANNUAL, priceDisplay: "$500/yr" },
        },
      });
    } catch (err) {
      logger.error({ err }, "university-checkout: status failed");
      // Fail safe: report founding UNAVAILABLE so the storefront never promises
      // a founding rate it can't verify.
      res.status(200).json({
        founding: { available: false, cap: 0, claimed: 0, remaining: 0 },
        plans: {
          monthly: { key: PLAN_MONTHLY, priceDisplay: "$50/mo" },
          annual: { key: PLAN_ANNUAL, priceDisplay: "$500/yr" },
        },
      });
    }
  });

  router.post("/checkout", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CheckoutBody;
    const email = asString(body.email).toLowerCase();
    const displayName = asString(body.displayName);
    const returnUrl = asString(body.returnUrl);
    // Referral attribution code. Accept from the body; tolerate the query param
    // as a fallback (storefront forwards either). NOT validated/rejected here —
    // checkout stays dumb + fast; the webhook validates against the DB.
    const ref = asString(body.ref) || asString(req.query.ref);
    // Plan selector ('monthly' | 'annual'). Tolerate the query param as a
    // fallback. Normalized to a stable plan key; unknown → monthly.
    const planKey = resolvePlanKey(asString(body.plan) || asString(req.query.plan));

    // Validation
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }

    if (!stripeConfigured()) {
      res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
      return;
    }

    // Success → the University page in the portal so a fresh member lands
    // directly on the product they paid for. Cancel → back to the storefront
    // signup page so a bounced checkout doesn't dump the visitor into a
    // logged-out portal. Caller can override either via the body's returnUrl
    // (legacy unified base) or the env vars.
    const successBase =
      returnUrl
      || process.env.UNIVERSITY_SUCCESS_URL
      || "https://app.coherencedaddy.com/university";
    const cancelBase =
      process.env.UNIVERSITY_CANCEL_URL
      || returnUrl
      || "https://coherencedaddy.com/university";
    const successSep = successBase.includes("?") ? "&" : "?";
    const cancelSep = cancelBase.includes("?") ? "&" : "?";
    const successUrl = `${successBase}${successSep}status=success&session_id={CHECKOUT_SESSION_ID}&product=university`;
    const cancelUrl = `${cancelBase}${cancelSep}status=cancelled`;

    try {
      // University bills on the Starwise account — use the University key for
      // BOTH the price lookup and the checkout session so they hit the same
      // account the university prices live on.
      const secretKey = universityStripeKey();
      const priceId = await resolveUniversityPriceId(planKey, secretKey);

      // Founding eligibility is a hint here (the webhook is authoritative and
      // re-checks against the live count at activation). Computed best-effort so
      // a slow/failed count never blocks checkout. We pass it on metadata so the
      // success page / receipt can reflect it without another round-trip.
      let foundingHint = false;
      try {
        foundingHint = isFoundingEligible(
          await countUniversityMembers(db),
          foundingCap(),
        );
      } catch (err) {
        logger.warn(
          { err: (err as Error).message, email },
          "university-checkout: founding count failed (non-fatal) — metadata hint=false; webhook re-checks",
        );
      }

      const metadata: Record<string, string> = {
        product: "university",
        plan: planKey,
        founding_hint: foundingHint ? "true" : "false",
        customerEmail: email,
      };
      if (displayName) metadata.displayName = displayName;
      // Belt-and-suspenders attribution: client_reference_id is the canonical
      // Stripe-native field; metadata.referral_code is the redundant read path.
      if (ref) metadata.referral_code = ref;

      const { checkoutUrl, sessionId } = await createStripeCheckoutSession({
        email,
        priceId,
        successUrl,
        cancelUrl,
        metadata,
        secretKey,
        clientReferenceId: ref || undefined,
      });

      res.json({ url: checkoutUrl, sessionId });
    } catch (err) {
      logger.error(
        { err, email },
        "university-checkout: create session failed",
      );
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Webhook router — mounted BEFORE express.json() in app.ts.
// ---------------------------------------------------------------------------

interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export function universityWebhookRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string | undefined;
      // University-specific secret if set, else fall back to the global one.
      const secret =
        process.env.STRIPE_WEBHOOK_SECRET_UNIVERSITY
        || process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        logger.error(
          {},
          "university-webhook: no STRIPE_WEBHOOK_SECRET_UNIVERSITY or STRIPE_WEBHOOK_SECRET configured",
        );
        res.status(503).json({ error: "webhook secret not configured" });
        return;
      }
      const raw = req.body as Buffer;
      if (!verifyStripeSignature(raw, sig, secret)) {
        res.status(400).json({ error: "Invalid Stripe signature" });
        return;
      }

      let event: StripeEvent;
      try {
        event = JSON.parse(raw.toString("utf8")) as StripeEvent;
      } catch (err) {
        logger.error({ err }, "university-webhook: failed to parse event body");
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      try {
        await dispatchUniversityEvent(db, event);
        res.json({ received: true, type: event.type });
      } catch (err) {
        logger.error(
          { err, eventId: event.id, eventType: event.type },
          "university-webhook: handler failed",
        );
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  return router;
}

/**
 * Invoice line items for the add-on check. Stripe embeds them inline in the
 * invoice.paid webhook payload (`invoice.lines.data`, each with its `price`), so
 * the common path reads them straight off the event. Defensively — only when the
 * payload omits them (a truncated/minimal event) — retrieve the invoice with
 * price-expanded lines so the add-on line-item check never silently sees nothing.
 */
async function resolveInvoiceLines(invoice: {
  id: string;
  lines?: { data?: InvoiceLineForAddonCheck[] } | null;
}): Promise<InvoiceLineForAddonCheck[]> {
  const inline = invoice.lines?.data;
  if (Array.isArray(inline) && inline.length > 0) return inline;
  const key = universityStripeKey();
  if (!key || !invoice.id) return [];
  try {
    const full = await stripeRequest<{
      lines?: { data?: InvoiceLineForAddonCheck[] } | null;
    }>(
      "GET",
      `/invoices/${encodeURIComponent(invoice.id)}?expand[]=lines.data.price`,
      undefined,
      key,
    );
    return full.lines?.data ?? [];
  } catch (err) {
    logger.warn(
      { err, invoiceId: invoice.id },
      "university-webhook: could not retrieve invoice lines for add-on check — falling back to DB check only",
    );
    return [];
  }
}

/**
 * Dispatches a verified Stripe event to the right University handler.
 *
 * Exported for unit testing without spinning up a full Express app /
 * mocking signature verification.
 */
export async function dispatchUniversityEvent(
  db: Db,
  event: StripeEvent,
): Promise<void> {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as {
      id: string;
      metadata?: Record<string, string> | null;
      customer?: string | null;
      customer_email?: string | null;
      customer_details?: { email?: string | null } | null;
      subscription?: string | null;
      client_reference_id?: string | null;
    };
    // Paid Rex voice add-on checkout (Phase 2) — a distinct product on the same
    // Starwise account. Routed before the membership guard by metadata.product.
    if (session.metadata?.product === VOICE_ADDON_PRODUCT) {
      await handleVoiceAddonCheckout(db, session);
      return;
    }
    if (session.metadata?.product !== "university") return;
    // Referral attribution runs BEFORE the member/subscription upsert so the
    // "can't refer an existing member" check sees the pre-checkout state (the
    // member row this very checkout is about to create must not count). Failures
    // here must NOT block activation — credit is a benefit layered on top of a
    // paid membership, never a precondition for it.
    try {
      await handleReferralAttribution(db, session);
    } catch (err) {
      logger.error(
        { err, sessionId: session.id },
        "university-webhook: referral attribution failed (non-fatal) — activation continues",
      );
    }
    await handleUniversityCheckout(db, session);
    return;
  }

  // invoice.paid (and the older alias invoice.payment_succeeded) — the lifetime
  // engine: accrue the referrer's monthly credit and apply the payer's standing
  // credit to this invoice (capped at the floor). See university-referrals.ts.
  if (
    event.type === "invoice.paid"
    || event.type === "invoice.payment_succeeded"
  ) {
    const invoice = event.data.object as {
      id: string;
      subscription?: string | null;
      customer?: string | null;
      customer_email?: string | null;
      lines?: { data?: InvoiceLineForAddonCheck[] } | null;
    };
    // Add-on-first fall-through (mirrors subscription.updated/.deleted): a paid
    // voice add-on invoice ($10/$20) must NOT flow to the referral engine, which
    // keys off the payer and assumes a flat $50/mo membership bill — it would
    // drain the member's standing referral credit against the wrong headroom.
    // Only membership invoices reach handleReferralInvoicePaid, exactly as before.
    //
    // ORDER-INDEPENDENT: Stripe events can race — an add-on's FIRST
    // invoice.payment_succeeded can arrive BEFORE checkout.session.completed
    // writes the university_voice_addons row, so the DB check alone would return
    // false and misapply referral credit against the add-on invoice. Decide
    // add-on-ness from the invoice's OWN line items first (embedded inline in the
    // webhook payload), then fall back to the DB row (belt and suspenders): it's
    // an add-on iff EITHER source says so.
    const invoiceSubId =
      typeof invoice.subscription === "string" ? invoice.subscription : null;
    const invoiceLines = await resolveInvoiceLines(invoice);
    const isAddonInvoice =
      invoiceLinesAreVoiceAddon(invoiceLines)
      || (invoiceSubId
        ? await isVoiceAddonSubscription(db, invoiceSubId)
        : false);
    if (isAddonInvoice) {
      logger.debug(
        { invoiceId: invoice.id, stripeSubscriptionId: invoiceSubId },
        "university-webhook: invoice.paid for voice add-on — skipping referral engine",
      );
      return;
    }
    await handleReferralInvoicePaid(db, invoice);
    return;
  }

  // charge.refunded — reverse the referral credit for the affected invoice
  // (credit-only, so no cash clawback).
  if (event.type === "charge.refunded") {
    const charge = event.data.object as {
      id: string;
      invoice?: string | null;
      customer?: string | null;
    };
    await handleReferralRefund(db, charge);
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as {
      id: string;
      status: string;
      current_period_end?: number | null;
    };
    // Try the add-on row first; if it matched, this is a voice-add-on sub and
    // the membership handler would only log a spurious "no matching row".
    const addon = await handleVoiceAddonSubscriptionUpdated(db, sub);
    if (addon.matched > 0) return;
    await handleUniversitySubscriptionUpdated(db, sub);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as {
      id: string;
      status: string;
      current_period_end?: number | null;
    };
    const addon = await handleVoiceAddonSubscriptionDeleted(db, sub);
    if (addon.matched > 0) return;
    await handleUniversitySubscriptionDeleted(db, sub);
    return;
  }

  // Unhandled event type — Stripe expects 2xx so it doesn't retry forever.
  logger.debug(
    { eventType: event.type, eventId: event.id },
    "university-webhook: ignoring unhandled event type",
  );
}
