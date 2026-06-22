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
import { z } from "zod";
import type { Db } from "@paperclipai/db";
import {
  createCheckoutSession as createStripeCheckoutSession,
} from "../services/stripe-checkout.js";
import {
  upsertAttribution,
  type AttributionInput,
} from "../services/university-attribution.js";
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
} from "../services/university-stripe-handler.js";
import {
  handleAttributionCheckoutCompleted,
  handleAttributionInvoicePaid,
  handleAttributionInvoicePaymentFailed,
  handleAttributionChargeRefunded,
} from "../services/university-attribution-webhook.js";
import { logger } from "../middleware/logger.js";

const LOOKUP_KEY = "university_monthly";

interface PriceListResponse {
  data: Array<{
    id: string;
    active: boolean;
    lookup_key: string | null;
  }>;
}

/**
 * Resolves the Stripe price id for University.
 *
 * Order of preference (matches the convention in docs/deploy/stripe-products.md):
 *   1. `stripe.prices.list({ lookup_keys: ["university_monthly"], expand: ["data.product"] })`
 *      — stable across test/live mode rotations.
 *   2. `UNIVERSITY_STRIPE_PRICE_ID` env var fallback for accounts that
 *      haven't backfilled lookup_keys yet.
 *
 * Throws if neither resolves so the route surfaces a clear 503.
 *
 * The price lives on the University Stripe account (Starwise), NOT the shared
 * Coherence Daddy account — so the lookup_keys call must authenticate with the
 * University key (`universityStripeKey()` = UNIVERSITY_STRIPE_SECRET_KEY ??
 * STRIPE_SECRET_KEY). Callers pass that key in; it defaults to the resolved
 * University key when omitted.
 */
export async function resolveUniversityPriceId(
  secretKey?: string,
): Promise<string> {
  const key = secretKey ?? universityStripeKey();
  if (key) {
    try {
      const list = await stripeRequest<PriceListResponse>(
        "GET",
        `/prices?lookup_keys[]=${encodeURIComponent(LOOKUP_KEY)}&active=true&expand[]=data.product&limit=10`,
        undefined,
        key,
      );
      const active = list.data?.find(
        (p) => p.active && p.lookup_key === LOOKUP_KEY,
      );
      if (active) return active.id;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, lookupKey: LOOKUP_KEY },
        "university-checkout: lookup_key resolve failed, falling back to env var",
      );
    }
  }

  const envId = process.env.UNIVERSITY_STRIPE_PRICE_ID?.trim();
  if (envId) return envId;

  throw new Error(
    `University price not resolvable: no Stripe price with lookup_key="${LOOKUP_KEY}" and UNIVERSITY_STRIPE_PRICE_ID is unset`,
  );
}

interface CheckoutBody {
  email?: unknown;
  displayName?: unknown;
  returnUrl?: unknown;
  ref?: unknown;
  attribution?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// ---------------------------------------------------------------------------
// Optional ad/marketing attribution carried on the checkout payload.
//
// Validated leniently (every field optional, empty strings stripped) so a
// storefront that sends NO attribution behaves exactly as before, and a
// storefront that sends partial/garbage fields never 400s the checkout — the
// attribution is a best-effort marketing signal, not a gate. Unknown keys are
// dropped (`.strip()` is the zod default for objects).
//
// These fields are (a) upserted into the university_attribution table keyed on
// email and (b) flattened into the Stripe Checkout Session METADATA (never
// client_reference_id — the referral branch owns that). Keys are kept SHORT to
// stay well under Stripe's metadata limits (50 keys, 500 chars each).
// ---------------------------------------------------------------------------

const trimmedString = z
  .string()
  .trim()
  .max(500) // Stripe metadata value cap — also keeps junk payloads bounded.
  .optional();

const attributionSchema = z
  .object({
    fbclid: trimmedString,
    fbc: trimmedString,
    fbp: trimmedString,
    ttclid: trimmedString,
    gclid: trimmedString,
    utm_source: trimmedString,
    utm_medium: trimmedString,
    utm_campaign: trimmedString,
    utm_content: trimmedString,
    utm_term: trimmedString,
    landing_url: trimmedString,
    referrer: trimmedString,
  })
  .partial();

type AttributionPayload = z.infer<typeof attributionSchema>;

/**
 * Parse the optional `attribution` object off the body. Returns null when it is
 * absent, not an object, or fails validation — in every one of those cases the
 * checkout proceeds exactly as it did before (fully backward-compatible).
 */
function parseAttribution(raw: unknown): AttributionPayload | null {
  if (raw == null || typeof raw !== "object") return null;
  const result = attributionSchema.safeParse(raw);
  if (!result.success) {
    logger.warn(
      { issues: result.error.issues },
      "university-checkout: ignoring invalid attribution payload",
    );
    return null;
  }
  return result.data;
}

/** Map the snake_case wire payload to the service's camelCase input shape. */
function toAttributionInput(p: AttributionPayload): AttributionInput {
  return {
    fbclid: p.fbclid,
    fbc: p.fbc,
    fbp: p.fbp,
    ttclid: p.ttclid,
    gclid: p.gclid,
    utmSource: p.utm_source,
    utmMedium: p.utm_medium,
    utmCampaign: p.utm_campaign,
    utmContent: p.utm_content,
    utmTerm: p.utm_term,
    landingUrl: p.landing_url,
    referrer: p.referrer,
  };
}

/**
 * Flatten attribution into SHORT Stripe metadata keys (prefixed `at_` to avoid
 * colliding with the existing product/plan/customerEmail keys). Only non-empty
 * fields are emitted, so a checkout with no attribution adds zero keys. Each
 * value is already <=500 chars (zod cap); the prefix keeps total key count well
 * under Stripe's 50-key limit (12 attribution keys max + the existing handful).
 */
function attributionMetadata(p: AttributionPayload): Record<string, string> {
  const map: Array<[keyof AttributionPayload, string]> = [
    ["fbclid", "at_fbclid"],
    ["fbc", "at_fbc"],
    ["fbp", "at_fbp"],
    ["ttclid", "at_ttclid"],
    ["gclid", "at_gclid"],
    ["utm_source", "at_utm_source"],
    ["utm_medium", "at_utm_medium"],
    ["utm_campaign", "at_utm_campaign"],
    ["utm_content", "at_utm_content"],
    ["utm_term", "at_utm_term"],
    ["landing_url", "at_landing_url"],
    ["referrer", "at_referrer"],
  ];
  const out: Record<string, string> = {};
  for (const [field, key] of map) {
    const value = p[field];
    if (value) out[key] = value;
  }
  return out;
}

export function universityCheckoutRoutes(db: Db): Router {
  const router = Router();

  router.post("/checkout", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CheckoutBody;
    const email = asString(body.email).toLowerCase();
    const displayName = asString(body.displayName);
    const returnUrl = asString(body.returnUrl);
    const ref = asString(body.ref);
    // Optional ad attribution — null when absent/invalid (backward-compatible).
    const attribution = parseAttribution(body.attribution);

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
      // account the university_monthly price lives on.
      const secretKey = universityStripeKey();
      const priceId = await resolveUniversityPriceId(secretKey);
      const metadata: Record<string, string> = {
        product: "university",
        plan: "university_monthly",
        customerEmail: email,
      };
      if (displayName) metadata.displayName = displayName;
      if (ref) metadata.referral_code = ref;

      // Ad attribution (optional). Upsert the per-lead row (best-effort,
      // non-fatal) and carry the click ids / UTM / landing context in the
      // Stripe Checkout Session METADATA — never client_reference_id, which the
      // referral branch owns for its `ref` code.
      if (attribution) {
        await upsertAttribution(db, email, toAttributionInput(attribution));
        Object.assign(metadata, attributionMetadata(attribution));
      }

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
  // Stripe test-vs-live flag. Threaded to the attribution webhook so test
  // events don't fire prod Meta/TikTok conversions or pollute the MRR ledger.
  livemode?: boolean;
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
    };
    if (session.metadata?.product !== "university") return;
    // Order matters: the member + subscription rows must exist BEFORE the
    // attribution hook so it can resolve subscription_id for the FK stamp and
    // stamp the campaign onto the just-created subscription row. The attribution
    // hook is best-effort (never throws) — a failure there must not block the
    // core activation, which already succeeded above.
    await handleUniversityCheckout(db, session);
    await handleAttributionCheckoutCompleted(db, event);
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as { id: string; status: string };
    await handleUniversitySubscriptionUpdated(db, sub);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as { id: string; status: string };
    await handleUniversitySubscriptionDeleted(db, sub);
    return;
  }

  // Ad-attribution ledger events (M3). These ONLY append to the University
  // attribution events ledger (MRR / churn / refunds) — they never touch the
  // member/subscription rows, so they can run independently of the handlers
  // above. invoice.payment_succeeded is Stripe's older alias for invoice.paid;
  // accept both so the ledger is complete regardless of which Stripe sends.
  if (event.type === "invoice.paid" || event.type === "invoice.payment_succeeded") {
    await handleAttributionInvoicePaid(db, event);
    return;
  }

  if (event.type === "invoice.payment_failed") {
    await handleAttributionInvoicePaymentFailed(db, event);
    return;
  }

  if (event.type === "charge.refunded") {
    await handleAttributionChargeRefunded(db, event);
    return;
  }

  // Unhandled event type — Stripe expects 2xx so it doesn't retry forever.
  logger.debug(
    { eventType: event.type, eventId: event.id },
    "university-webhook: ignoring unhandled event type",
  );
}
