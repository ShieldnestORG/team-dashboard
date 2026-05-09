# Stripe Products & Prices

> Append-only registry of Stripe products + price IDs that team-dashboard
> is the source of truth for. Per [docs/OWNERSHIP.md](../OWNERSHIP.md),
> all checkout-session creation + webhook handling lives in this repo;
> the storefront proxies `/checkout` and `/webhook` paths.

| Product | Plan / Price | Stripe price ID | Recurring | Owner | Code references |
|---|---|---|---|---|---|
| Watchtower | $29/mo | _pending — set in env_ | monthly | watchtower | `server/src/services/watchtower-monitor.ts`, `server/src/services/watchtower-cron.ts` |

## Watchtower — $29/mo

Brand-mention monitor. See [docs/products/watchtower.md](../products/watchtower.md).

- **Stripe product name:** `Watchtower`
- **Price:** $29 USD recurring monthly
- **Price ID env var:** `WATCHTOWER_STRIPE_PRICE_ID`
- **Customer-portal allowed actions (planned, Worker A):** cancel, pause (mapped to `watchtower_subscriptions.status='paused'`)
- **Webhook events handled (planned, Worker A):**
  - `checkout.session.completed` → INSERT `watchtower_subscriptions`
  - `customer.subscription.updated` → mirror `status` to `active`/`paused`
  - `customer.subscription.deleted` → set `status='cancelled'`
- **Fulfillment:** monthly bill triggers no immediate fulfillment;
  weekly cron `watchtower:weekly-runs` (Mon 09:00 UTC) does the work.

## Adding a new product

1. Create the product + price in the Stripe dashboard (live mode).
2. Append a row to the table above.
3. Add a section with: env var name, allowed portal actions, webhook
   events handled, fulfillment behavior.
4. Code: add the price ID env var to `docs/deploy/env-vars.md`.
