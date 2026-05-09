# Stripe Products & Prices

> Append-only registry of Stripe products + price IDs that team-dashboard
> is the source of truth for. Per [docs/OWNERSHIP.md](../OWNERSHIP.md),
> all checkout-session creation + webhook handling lives in this repo;
> the storefront proxies `/checkout` and `/webhook` paths.

## Conventions

- One Stripe **Product** per shippable thing.
- One or more **Prices** per Product (one-time or recurring).
- Use `lookup_key` on each Price so the backend can resolve by stable key
  rather than hard-coded `price_xxx` IDs that change between accounts.
- Test-mode and Live-mode have different IDs. Set the test-mode ID in
  `.env.local` and the live-mode ID in production env vars.

## Registry

| Product | Plan / Price | Stripe price ID | Recurring | Owner | Code references |
|---|---|---|---|---|---|
| llms.txt generator | $19 one-time | _pending — see lookup_key_ | one-time | llms-txt-generator | `server/src/services/llms-txt-generator.ts` |
| Watchtower | $29/mo | _pending — set in env_ | monthly | watchtower | `server/src/services/watchtower-monitor.ts`, `server/src/services/watchtower-cron.ts` |

## llms.txt generator — $19 one-time

- **Stripe Product name:** `llms.txt generator`
- **Description:** "One-shot generation of llms.txt + llms-full.txt + agents.json files for your domain. Crawls your sitemap, summarizes each page, returns three files. Free with any $49+/mo bundle."
- **Statement descriptor:** `CD LLMS-TXT`
- **Tax behavior:** Inclusive
- **Prices:**
  - `llms_txt_generator_one_time` — **$19.00 USD one-time**.
- **Webhook event of interest:** `checkout.session.completed` with
  `metadata.product = "llms_txt_generator"` and `metadata.domain = "<customer-domain>"`.
- **Backend handler:**
  `handleLlmsTxtCheckout(db, session)` in `server/src/services/llms-txt-generator.ts`.
  Inserts a `llms_txt_jobs` row and kicks off generation.
- **Wire-up status (2026-05-09):** Webhook handler **exists** but is **not
  yet routed** in the consolidated Stripe webhook router. Once the shared
  dispatcher lands, add a case for `metadata.product = "llms_txt_generator"`
  that calls `handleLlmsTxtCheckout`.
- **Until then:** Anonymous public-form requests use
  `POST /api/llms-txt/generate` directly (no Stripe in the loop).

## Watchtower — $29/mo

Brand-mention monitor. See [docs/products/watchtower.md](../products/watchtower.md).

- **Stripe product name:** `Watchtower`
- **Price:** $29 USD recurring monthly
- **Price ID env var:** `WATCHTOWER_STRIPE_PRICE_ID`
- **Customer-portal allowed actions (planned, follow-up):** cancel, pause (mapped to `watchtower_subscriptions.status='paused'`)
- **Webhook events handled (planned, follow-up):**
  - `checkout.session.completed` → INSERT `watchtower_subscriptions`
  - `customer.subscription.updated` → mirror `status` to `active`/`paused`
  - `customer.subscription.deleted` → set `status='cancelled'`
- **Fulfillment:** monthly bill triggers no immediate fulfillment;
  weekly cron `watchtower:weekly-runs` (Mon 09:00 UTC) does the work.

## Adding a new product

1. Create the product + price in the Stripe dashboard (live mode).
2. Append a row to the registry table above.
3. Add a section with: env var name, allowed portal actions, webhook
   events handled, fulfillment behavior.
4. Code: add the price ID env var to `docs/deploy/env-vars.md`.

## Notes

- When creating prices in the Stripe dashboard, set the `lookup_key` field
  to the snake_case key shown above. The backend resolves via
  `stripe.prices.list({ lookup_keys: [key], expand: ["data.product"] })`.
- After creating in the dashboard, copy the test-mode + live-mode IDs into
  this file so future engineers don't have to log into Stripe to find them.
