// ---------------------------------------------------------------------------
// Watchtower — Stripe checkout route + webhook router.
//
// Exposes two surfaces:
//
//   POST /api/watchtower/checkout   — public; storefront proxies here
//   POST /api/watchtower/webhook    — Stripe webhook receiver
//
// The checkout route resolves the price by `lookup_key=watchtower_monthly`
// (preferred — see docs/deploy/stripe-products.md §Notes) and falls back
// to the `WATCHTOWER_STRIPE_PRICE_ID` env var if no lookup_keys are set on
// the account.
//
// The webhook router uses express.raw() and must be mounted BEFORE
// express.json() in app.ts (mirrors creditscoreWebhookRouter / bundleWebhookRouter).
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
} from "../services/stripe-client.js";
import {
  handleWatchtowerCheckout,
  handleWatchtowerSubscriptionUpdated,
  handleWatchtowerSubscriptionDeleted,
} from "../services/watchtower-stripe-handler.js";
import { logger } from "../middleware/logger.js";

// PRD-default cap; the schema's HARD_PROMPT_CEILING (75) is a separate
// runtime backstop, NOT what the public route enforces.
const ROUTE_PROMPT_CAP = 60;
const LOOKUP_KEY = "watchtower_monthly";

interface PriceListResponse {
  data: Array<{
    id: string;
    active: boolean;
    lookup_key: string | null;
  }>;
}

/**
 * Resolves the Stripe price id for Watchtower.
 *
 * Order of preference (matches the convention in docs/deploy/stripe-products.md):
 *   1. `stripe.prices.list({ lookup_keys: ["watchtower_monthly"], expand: ["data.product"] })`
 *      — stable across test/live mode rotations.
 *   2. `WATCHTOWER_STRIPE_PRICE_ID` env var fallback for accounts that
 *      haven't backfilled lookup_keys yet.
 *
 * Throws if neither resolves so the route surfaces a clear 503.
 */
export async function resolveWatchtowerPriceId(): Promise<string> {
  if (stripeConfigured()) {
    try {
      const list = await stripeRequest<PriceListResponse>(
        "GET",
        `/prices?lookup_keys[]=${encodeURIComponent(LOOKUP_KEY)}&active=true&expand[]=data.product&limit=10`,
      );
      const active = list.data?.find(
        (p) => p.active && p.lookup_key === LOOKUP_KEY,
      );
      if (active) return active.id;
    } catch (err) {
      logger.warn(
        { err: (err as Error).message, lookupKey: LOOKUP_KEY },
        "watchtower-checkout: lookup_key resolve failed, falling back to env var",
      );
    }
  }

  const envId = process.env.WATCHTOWER_STRIPE_PRICE_ID?.trim();
  if (envId) return envId;

  throw new Error(
    `Watchtower price not resolvable: no Stripe price with lookup_key="${LOOKUP_KEY}" and WATCHTOWER_STRIPE_PRICE_ID is unset`,
  );
}

interface CheckoutBody {
  brandName?: unknown;
  domain?: unknown;
  prompts?: unknown;
  email?: unknown;
  returnUrl?: unknown;
}

function asString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asPrompts(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const cleaned: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") return null;
    const trimmed = item.trim();
    if (trimmed.length === 0) continue;
    cleaned.push(trimmed);
  }
  return cleaned;
}

export function watchtowerCheckoutRoutes(db: Db): Router {
  const router = Router();
  // db is reserved for future per-checkout side effects (e.g. dedup lookups).
  void db;

  router.post("/checkout", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as CheckoutBody;
    const brandName = asString(body.brandName);
    const domain = asString(body.domain);
    const email = asString(body.email).toLowerCase();
    const returnUrl = asString(body.returnUrl);
    const prompts = asPrompts(body.prompts);

    // Validation
    if (!brandName) {
      res.status(400).json({ error: "brandName required" });
      return;
    }
    if (!domain) {
      res.status(400).json({ error: "domain required" });
      return;
    }
    if (!email) {
      res.status(400).json({ error: "email required" });
      return;
    }
    if (prompts === null) {
      res.status(400).json({ error: "prompts must be an array of strings" });
      return;
    }
    if (prompts.length < 1) {
      res.status(400).json({ error: "at least 1 prompt required" });
      return;
    }
    if (prompts.length > ROUTE_PROMPT_CAP) {
      res.status(400).json({
        error: `at most ${ROUTE_PROMPT_CAP} prompts allowed`,
      });
      return;
    }

    if (!stripeConfigured()) {
      res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
      return;
    }

    // Success → the Watchtower page in the portal (not the generic dashboard)
    // so a fresh buyer lands directly on the product they paid for. The
    // page renders a sample preview until the first real run, and the
    // contextual upsell shelf surfaces companion products. Cancel → back
    // to the storefront signup page so a bounced checkout doesn't dump
    // the visitor into a logged-out portal. Caller can override either
    // via the body's returnUrl (legacy) or the env vars; we keep the
    // legacy single-URL knob for backwards compat (used as a unified base
    // when explicitly set).
    const successBase =
      returnUrl
      || process.env.WATCHTOWER_SUCCESS_URL
      || process.env.WATCHTOWER_RETURN_URL
      || "https://app.coherencedaddy.com/watchtower";
    const cancelBase =
      process.env.WATCHTOWER_CANCEL_URL
      || returnUrl
      || process.env.WATCHTOWER_RETURN_URL
      // The storefront signup page lives at /watchtower. The old default
      // ("/watchtower-home") 404s — a bounced checkout would land the
      // visitor on a dead page. Verified live 2026-05-14: /watchtower → 200,
      // /watchtower-home → 404.
      || "https://coherencedaddy.com/watchtower";
    const successSep = successBase.includes("?") ? "&" : "?";
    const cancelSep = cancelBase.includes("?") ? "&" : "?";
    const successUrl = `${successBase}${successSep}status=success&session_id={CHECKOUT_SESSION_ID}&product=watchtower`;
    const cancelUrl = `${cancelBase}${cancelSep}status=cancelled`;

    try {
      const priceId = await resolveWatchtowerPriceId();
      const { checkoutUrl, sessionId } = await createStripeCheckoutSession({
        email,
        priceId,
        successUrl,
        cancelUrl,
        metadata: {
          product: "watchtower",
          plan: "watchtower_monthly",
          brandName,
          domain,
          // Stripe metadata values are capped at 500 chars per key. Prompts
          // can be long; we JSON.stringify and truncate to be safe. The
          // webhook handler tolerates a malformed payload by defaulting to
          // an empty array (handler logs the parse failure).
          prompts: JSON.stringify(prompts).slice(0, 490),
          customerEmail: email,
        },
      });

      res.json({ url: checkoutUrl, sessionId });
    } catch (err) {
      logger.error(
        { err, brandName, domain, promptCount: prompts.length },
        "watchtower-checkout: create session failed",
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

export function watchtowerWebhookRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string | undefined;
      // Watchtower-specific secret if set, else fall back to the global one.
      const secret =
        process.env.STRIPE_WEBHOOK_SECRET_WATCHTOWER
        || process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        logger.error(
          {},
          "watchtower-webhook: no STRIPE_WEBHOOK_SECRET_WATCHTOWER or STRIPE_WEBHOOK_SECRET configured",
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
        logger.error({ err }, "watchtower-webhook: failed to parse event body");
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      try {
        await dispatchWatchtowerEvent(db, event);
        res.json({ received: true, type: event.type });
      } catch (err) {
        logger.error(
          { err, eventId: event.id, eventType: event.type },
          "watchtower-webhook: handler failed",
        );
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  return router;
}

/**
 * Dispatches a verified Stripe event to the right Watchtower handler.
 *
 * Exported for unit testing without spinning up a full Express app /
 * mocking signature verification.
 */
export async function dispatchWatchtowerEvent(
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
    if (session.metadata?.product !== "watchtower") return;
    await handleWatchtowerCheckout(db, session);
    return;
  }

  if (event.type === "customer.subscription.updated") {
    const sub = event.data.object as { id: string; status: string };
    await handleWatchtowerSubscriptionUpdated(db, sub);
    return;
  }

  if (event.type === "customer.subscription.deleted") {
    const sub = event.data.object as { id: string; status: string };
    await handleWatchtowerSubscriptionDeleted(db, sub);
    return;
  }

  // Unhandled event type — Stripe expects 2xx so it doesn't retry forever.
  logger.debug(
    { eventType: event.type, eventId: event.id },
    "watchtower-webhook: ignoring unhandled event type",
  );
}
