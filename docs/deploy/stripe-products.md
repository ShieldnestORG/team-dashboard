# Stripe Products & Prices

Authoritative list of Stripe products + prices configured in the Stripe
dashboard for the Coherence Daddy ecosystem. This file documents what to
create / verify by hand. We do **not** create products programmatically —
the Stripe dashboard is the source of truth. The IDs below are then
referenced from `*_plans` rows in the DB.

## Conventions

- One Stripe **Product** per shippable thing (e.g. "llms.txt generator").
- One or more **Prices** per Product (one-time or recurring).
- Use `lookup_key` on each Price so the backend can resolve by stable key
  rather than hard-coded `price_xxx` IDs that change between accounts.
- Test-mode and Live-mode have different IDs. Set the test-mode ID in
  `.env.local` and the live-mode ID in production env vars.

## Products

### llms.txt generator (one-time)

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
  yet routed** in the consolidated Stripe webhook router. Worker A is
  factoring `routes/creditscore.ts`'s webhook router into a shared
  dispatcher; once that lands, add a case for `metadata.product =
  "llms_txt_generator"` that calls `handleLlmsTxtCheckout`.
- **Until then:** Anonymous public-form requests use
  `POST /api/llms-txt/generate` directly (no Stripe in the loop).

## Notes

- When creating prices in the Stripe dashboard, set the `lookup_key` field
  to the snake_case key shown above. The backend resolves via
  `stripe.prices.list({ lookup_keys: [key], expand: ["data.product"] })`.
- After creating in the dashboard, copy the test-mode + live-mode IDs into
  this file so future engineers don't have to log into Stripe to find them.
  (TODO once first creation happens.)
