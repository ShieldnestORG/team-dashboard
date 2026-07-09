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
import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityMembers } from "@paperclipai/db";
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
} from "../services/university-stripe-handler.js";
import {
  handleReferralAttribution,
  handleReferralInvoicePaid,
  handleReferralRefund,
} from "../services/university-referrals.js";
import { logger } from "../middleware/logger.js";

// Founding ("first 100", $50/mo) vs standard ($79/mo) price lookup keys.
const LOOKUP_KEY = "university_monthly";
const STANDARD_LOOKUP_KEY = "university_monthly_standard";

const DEFAULT_FOUNDING_CAP = 100;
// Display/fallback amounts. The Stripe Price object is authoritative at charge
// time; these are used for the public /status display and as the recorded
// unit_amount when the price is resolved via env-id fallback (no Stripe object
// to read the amount from). Keep in sync with the Stripe prices — see
// docs/university-founding-pricing.md.
const FOUNDING_PRICE_CENTS = Number(
  process.env.UNIVERSITY_FOUNDING_PRICE_CENTS ?? 5000,
);
const STANDARD_PRICE_CENTS = Number(
  process.env.UNIVERSITY_STANDARD_PRICE_CENTS ?? 7900,
);

interface PriceListResponse {
  data: Array<{
    id: string;
    active: boolean;
    lookup_key: string | null;
    unit_amount: number | null;
  }>;
}

export interface ResolvedPrice {
  id: string;
  unitAmountCents: number | null;
}

/** The Founding-100 cap. Env-overridable (UNIVERSITY_FOUNDING_CAP); default 100. */
export function universityFoundingCap(): number {
  const raw = Number(process.env.UNIVERSITY_FOUNDING_CAP);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_FOUNDING_CAP;
}

/**
 * Counts members ever granted the founding rate. MONOTONIC — a cancelled
 * founder keeps is_founding=true, so this only ever grows and the public price
 * never flips back to $50 ("no resets"). This drives BOTH the $50→$79 switch
 * (checkout) and the public /status display.
 */
export async function countFoundingMembers(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(universityMembers)
    .where(eq(universityMembers.isFounding, true));
  return rows[0]?.n ?? 0;
}

/**
 * Resolves a University Stripe price by lookup_key on the Starwise account.
 * Returns null (never throws) so callers decide how a miss is handled — a
 * lookup_key resolve failure is a non-fatal warning that falls through to the
 * env-id path.
 */
async function tryLookup(
  secretKey: string,
  lookupKey: string,
): Promise<ResolvedPrice | null> {
  try {
    const list = await stripeRequest<PriceListResponse>(
      "GET",
      `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&expand[]=data.product&limit=10`,
      undefined,
      secretKey,
    );
    const active = list.data?.find((p) => p.active && p.lookup_key === lookupKey);
    if (active) return { id: active.id, unitAmountCents: active.unit_amount ?? null };
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, lookupKey },
      "university-checkout: lookup_key resolve failed, falling back to env var",
    );
  }
  return null;
}

/**
 * Resolves the FOUNDING ($50) price. lookup_key `university_monthly`, then the
 * `UNIVERSITY_STRIPE_PRICE_ID` env fallback. Throws if neither resolves so the
 * route surfaces a clear 503 (University must always be able to sell the
 * founding rate). The price lives on the University Stripe account (Starwise);
 * the caller passes that key in (defaults to universityStripeKey()).
 */
export async function resolveUniversityFoundingPrice(
  secretKey: string | undefined = universityStripeKey(),
): Promise<ResolvedPrice> {
  const byLookup = secretKey ? await tryLookup(secretKey, LOOKUP_KEY) : null;
  if (byLookup) return byLookup;

  const envId = process.env.UNIVERSITY_STRIPE_PRICE_ID?.trim();
  if (envId) return { id: envId, unitAmountCents: FOUNDING_PRICE_CENTS };

  throw new Error(
    `University founding price not resolvable: no Stripe price with lookup_key="${LOOKUP_KEY}" and UNIVERSITY_STRIPE_PRICE_ID is unset`,
  );
}

/**
 * Resolves the STANDARD ($79) price. lookup_key `university_monthly_standard`,
 * then the `UNIVERSITY_STRIPE_STANDARD_PRICE_ID` env fallback. Returns null when
 * neither is configured — the caller (checkout) FAILS CLOSED rather than
 * silently selling the founding rate past the cap.
 */
export async function resolveUniversityStandardPrice(
  secretKey: string | undefined = universityStripeKey(),
): Promise<ResolvedPrice | null> {
  const byLookup = secretKey ? await tryLookup(secretKey, STANDARD_LOOKUP_KEY) : null;
  if (byLookup) return byLookup;

  const envId = process.env.UNIVERSITY_STRIPE_STANDARD_PRICE_ID?.trim();
  if (envId) return { id: envId, unitAmountCents: STANDARD_PRICE_CENTS };

  return null;
}

/**
 * Back-compat shim (kept for existing callers/tests): the founding price id.
 */
export async function resolveUniversityPriceId(
  secretKey: string | undefined = universityStripeKey(),
): Promise<string> {
  return (await resolveUniversityFoundingPrice(secretKey)).id;
}

interface CheckoutBody {
  email?: unknown;
  displayName?: unknown;
  returnUrl?: unknown;
  ref?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function universityCheckoutRoutes(db: Db): Router {
  const router = Router();

  router.post("/checkout", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CheckoutBody;
    const email = asString(body.email).toLowerCase();
    const displayName = asString(body.displayName);
    const returnUrl = asString(body.returnUrl);
    // Referral attribution code. Accept from the body; tolerate the query param
    // as a fallback (storefront forwards either). NOT validated/rejected here —
    // checkout stays dumb + fast; the webhook validates against the DB.
    const ref = asString(body.ref) || asString(req.query.ref);

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
      // account the University prices live on.
      const secretKey = universityStripeKey();

      // --- Founding-100 price selection -------------------------------------
      // The first `cap` paying members get the founding ($50) price; everyone
      // after gets the standard ($79) price. The count of already-granted
      // founders (is_founding, monotonic) is the source of truth — NOT a
      // hardcoded number. We only READ the count here (no reservation), so a
      // burst of simultaneous checkouts at the exact boundary can grant a small,
      // bounded overage of founders (a "soft" cap). The webhook records which
      // price actually billed, so a member is a founder iff they paid $50.
      const cap = universityFoundingCap();
      const foundingCount = await countFoundingMembers(db);
      const foundingAvailable = foundingCount < cap;

      let priceId: string;
      let planKey: string;
      let unitAmountCents: number | null;
      if (foundingAvailable) {
        const p = await resolveUniversityFoundingPrice(secretKey);
        priceId = p.id;
        unitAmountCents = p.unitAmountCents;
        planKey = "university_monthly";
      } else {
        const p = await resolveUniversityStandardPrice(secretKey);
        if (!p) {
          // Fail CLOSED: the founding window is over but the $79 price isn't
          // configured. NEVER silently sell the founding rate past the cap.
          logger.error(
            { foundingCount, cap },
            "university-checkout: founding cap reached but standard price unconfigured — refusing to undercharge",
          );
          res
            .status(503)
            .json({ error: "standard price not configured" });
          return;
        }
        priceId = p.id;
        unitAmountCents = p.unitAmountCents;
        planKey = "university_monthly_standard";
      }

      const metadata: Record<string, string> = {
        product: "university",
        plan: planKey,
        // The webhook stamps is_founding + the recorded price from these.
        founding: String(foundingAvailable),
        stripe_price_id: priceId,
        customerEmail: email,
      };
      if (unitAmountCents != null) {
        metadata.unit_amount_cents = String(unitAmountCents);
      }
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

  // --------------------------------------------------------------------------
  // GET /status — PUBLIC. Drives the price shown on the storefront (the founding
  // card fetches this to render $50 vs $79). Server-authoritative: the client
  // never decides the price. Cached in-process so a burst of page loads can't
  // hammer the members count.
  // --------------------------------------------------------------------------
  let statusCache: { at: number; body: Record<string, unknown> } | null = null;
  const STATUS_CACHE_MS = 60_000;

  router.get("/status", async (_req: Request, res: Response) => {
    const cap = universityFoundingCap();
    try {
      if (statusCache && Date.now() - statusCache.at < STATUS_CACHE_MS) {
        res.json(statusCache.body);
        return;
      }
      const foundingCount = await countFoundingMembers(db);
      const foundingAvailable = foundingCount < cap;
      const priceCents = foundingAvailable
        ? FOUNDING_PRICE_CENTS
        : STANDARD_PRICE_CENTS;
      const body: Record<string, unknown> = {
        foundingCount,
        cap,
        foundingAvailable,
        seatsRemaining: Math.max(0, cap - foundingCount),
        priceCents,
        priceDisplay: `$${Math.round(priceCents / 100)}`,
      };
      statusCache = { at: Date.now(), body };
      res.json(body);
    } catch (err) {
      logger.error({ err }, "university-status: count failed");
      // Fail SAFE for a public display endpoint: assume the founding window is
      // still open (show $50) rather than 500 the storefront's price card.
      res.json({
        foundingCount: 0,
        cap,
        foundingAvailable: true,
        seatsRemaining: cap,
        priceCents: FOUNDING_PRICE_CENTS,
        priceDisplay: `$${Math.round(FOUNDING_PRICE_CENTS / 100)}`,
      });
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
    };
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
    const sub = event.data.object as { id: string; status: string };
    await handleUniversitySubscriptionUpdated(db, sub);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as { id: string; status: string };
    await handleUniversitySubscriptionDeleted(db, sub);
    return;
  }

  // Unhandled event type — Stripe expects 2xx so it doesn't retry forever.
  logger.debug(
    { eventType: event.type, eventId: event.id },
    "university-webhook: ignoring unhandled event type",
  );
}
