// Reusable Stripe Checkout session helper.
// Extracted so any service (directory listings, partner billing, future tiers)
// can call createCheckoutSession() without duplicating Stripe plumbing.

import { stripeRequest, stripeConfigured } from "./stripe-client.js";

export interface CheckoutOptions {
  email: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  /** Optional: reuse an existing Stripe customer (skips customer_email lookup). */
  customerId?: string;
  /**
   * Optional Stripe account override. Defaults to STRIPE_SECRET_KEY (shared
   * Coherence Daddy account). University passes universityStripeKey() so the
   * session is created on the Starwise account where the university price lives.
   */
  secretKey?: string;
}

export interface CheckoutResult {
  checkoutUrl: string;
  sessionId: string;
}

/**
 * Creates a Stripe Checkout session in `subscription` mode.
 * Throws if STRIPE_SECRET_KEY is not configured.
 */
export async function createCheckoutSession(
  opts: CheckoutOptions,
): Promise<CheckoutResult> {
  // An explicit secretKey (e.g. University → Starwise) is sufficient on its
  // own; otherwise require the shared STRIPE_SECRET_KEY.
  if (!opts.secretKey && !stripeConfigured()) {
    throw new Error("STRIPE_SECRET_KEY not configured");
  }

  const params: Record<string, unknown> = {
    mode: "subscription",
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": 1,
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
  };

  // Prefer customer ID when available (avoids duplicate Stripe customers).
  if (opts.customerId) {
    params.customer = opts.customerId;
  } else {
    params.customer_email = opts.email;
  }

  // Flatten metadata key-value pairs into the form body.
  for (const [k, v] of Object.entries(opts.metadata)) {
    params[`metadata[${k}]`] = v;
  }

  const session = await stripeRequest<{ id: string; url: string }>(
    "POST",
    "/checkout/sessions",
    params,
    opts.secretKey,
  );

  return { checkoutUrl: session.url, sessionId: session.id };
}
