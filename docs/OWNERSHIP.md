# Ownership Matrix — team-dashboard ↔ sibling repos

This repo is the **engine room** for the Coherence Daddy + ShieldnestORG ecosystem. The public-facing properties live in sibling repos, each deployed to its own Vercel project under the `shieldnestorg` account.

| Repo | Local path | GitHub | Vercel project | Public domain(s) |
|---|---|---|---|---|
| **team-dashboard** (this repo) | `/Users/exe/Downloads/Claude/team-dashboard` | `ShieldnestORG/team-dashboard` | n/a (VPS-deployed) | admin only |
| **coherencedaddy-landing** | `/Users/exe/Downloads/Claude/coherencedaddy-landing` | `ShieldnestORG/coherencedaddy` | `shieldnestorg/coherencedaddy` | coherencedaddy.com (+ 8 subdomains) |
| **shieldnest_landing_page** | `/Users/exe/Downloads/shieldnest_landing_page` | `ShieldNEST/shieldnest_landing_page` | `shieldnestorg/shieldnest_landing_page` | shieldnest.org |
| **tokns.fi_landing_page** | `/Users/exe/Downloads/Cursor/tokns_landing_page` | `ShieldNEST/tokns.fi_landing_page` | `shieldnestorg/tokns.fi_landing_page` | tokns.fi |
| **tokns** | `/Users/exe/Downloads/Claude/_blog-network/tokns` | `ShieldnestORG/tokns` | `shieldnestorg/tokns` | app.tokns.fi |

Responsibilities:

- **`team-dashboard`** — Admin API, Postgres schema, Stripe pipeline, entitlement resolver, cron scheduler, all product fulfillment agents, blog generation + multi-target publishing.
- **`coherencedaddy-landing`** — Public CD storefront, SEO/AEO surface, pricing pages, checkout buttons, report viewers, free audit SSE stream, email delivery via Resend, `/blog` read + write endpoints.
- **`shieldnest_landing_page`** — ShieldNest company root site. `/blog` read + write endpoints (mirrors CD pattern, Neon-backed).
- **`tokns.fi_landing_page`** — tokns.fi marketing site. Static HTML. `/lab` renders blog posts client-side by fetching `app.tokns.fi/api/articles`.
- **`tokns`** — app.tokns.fi crypto dashboard. Supabase-backed. Owns the `articles` table + `/api/articles` endpoints (POST auth, GET public); surfaces posts in `/dashboard` "News & Insights" section.

This doc is the canonical cross-repo boundary. When in doubt, defer here — do not re-fork pricing, subscription state, or webhook logic across repos.

---

## Ownership matrix

| Concern | Owner | Notes |
|---------|-------|-------|
| Storefront UI (pricing pages, checkout buttons, report viewer) | coherencedaddy-landing | Public-facing; SEO domain |
| Free audit SSE stream (browser experience) | coherencedaddy-landing | Latency-sensitive; calls the audit microservice directly from the browser |
| Blog, tools, marketing pages | coherencedaddy-landing | Static content + Next.js routes |
| **CreditScore plan definitions** (price cents, Stripe price IDs, tier metadata) | **team-dashboard** (`creditscore_plans` table) | Matches `bundle_plans`, `intel_plans`, directory `LISTING_TIERS` |
| **CreditScore subscription state** (active customers, tiers, status) | **team-dashboard** (`creditscore_subscriptions` table) | Entitlement resolver lives here; bundles must be able to grant CreditScore access |
| **CreditScore report state** (audit results, history) | **team-dashboard** (`creditscore_reports` table) | Co-located with subscription state |
| **Stripe checkout session creation** (all products) | **team-dashboard** | Single Stripe pipeline; storefront proxies |
| **Stripe webhooks** (all products) | **team-dashboard** | Co-located with DB state |
| Email delivery (Resend) | coherencedaddy-landing | Templates in `lib/creditscore-email.ts`; team-dashboard invokes via callback or port |
| **Product fulfillment crons** (rescans, agent runs, report mailing) | **team-dashboard** scheduler | Runs on VPS, not Vercel |
| Site-level crons (metrics push, IndexNow) | coherencedaddy-landing (Vercel crons) | Storefront-only concerns |
| Audit microservice | External (Firecrawl-backed) | Unchanged; both repos call it |
| **Entitlement resolution** (`getEntitlementsForCompany`) | **team-dashboard** | Resolves bundles + standalone subs to tier |
| Intel API (search, company, stats) | team-dashboard (VPS) | Proxied via `vercel.json` rewrite in storefront |
| Partner / directory / bundle state | team-dashboard | Existing pattern, untouched |
| **Owned utility-site registry** (domains we own for ad-revenue arbitrage) | **team-dashboard** (`owned_sites`, `owned_site_metrics` tables) | Sites themselves are static HTML on VPS3 nginx; team-dashboard aggregates GA4/AdSense metrics and exposes the portfolio at `/owned-sites`. Strategy doc: `docs/products/utility-network/README.md`. |
| **House ads** (in-house creatives served to `*.coherencedaddy.com` ad slots while AdSense approval is pending) | **team-dashboard** (`house_ads` table) | Admin CRUD at `/house-ads`; public fetch at `/api/house-ads/active?slot=X`. Storefront owns the `<AdSlot>` component. Spec: `docs/products/house-ads.md`. |

---

## Inter-repo contract

New team-dashboard routes the storefront calls:

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/creditscore/plans` | GET | Active tiers + prices for storefront rendering (ISR-cached, fallback in code) |
| `/api/creditscore/checkout` | POST | Creates Stripe session; returns checkout URL. Body: `{ tier, url, email?, audit_result_id? }` |
| `/api/creditscore/entitlement?domain=X&email=Y` | GET | Returns active tier for a domain/email combo (for gated report viewer) |
| `/api/creditscore/audit/store` | POST | Persists a free-audit result originated in the browser |
| `/api/creditscore/report/:id` | GET | Fetch a stored report (public, token-authenticated) |
| `/api/creditscore/webhook` | POST | Stripe webhook for CreditScore products |
| `/api/house-ads/active?slot=X` | GET | Returns the currently-serving in-house ad for a named slot (or 204 if pool empty). Consumed by the storefront `<AdSlot>` component. |
| `/api/house-ads/:id/image` | GET | Streams ad creative bytes. Public. |
| `/api/house-ads/:id/click` | GET | 302 redirects to the ad's click URL; records a click. |

All three public-facing routes are reachable from the storefront via `vercel.json` rewrites following the existing `/api/intel/*`, `/api/trends/*`, `/api/content/*`, `/api/partner-directory/*` pattern.

Storefront-side route changes (coherencedaddy-landing):

| Route | Before | After |
|-------|--------|-------|
| `/api/creditscore/checkout/starter`, `/growth`, `/report/checkout` | Create Stripe session locally | Proxy to team-dashboard `/api/creditscore/checkout` |
| `/api/creditscore/webhook` | Handle Stripe events | **Deleted.** team-dashboard owns it. |
| `/api/creditscore/rescan` | Vercel cron | **Deleted.** team-dashboard scheduler owns it. |
| `/api/creditscore/store` | Store audit result locally | Proxy to team-dashboard `/api/creditscore/audit/store` |
| `app/creditscore-home/page.tsx` pricing UI | Hardcoded `TIERS` array | Fetch `/api/creditscore/plans` (ISR) with hardcoded fallback |

---

## Rules

- **Where new pricing goes:** team-dashboard DB (`creditscore_plans`, `bundle_plans`, etc.) — **never** hardcoded in storefront.
- **Where new Stripe webhooks go:** team-dashboard — single pipeline, one signature verifier, one pool of event handlers.
- **Where UI lives:** coherencedaddy-landing — pricing pages, checkout CTAs, report viewers, marketing copy.
- **Where crons run:**
  - team-dashboard scheduler → product fulfillment (rescans, agent runs, report emails)
  - Vercel crons (coherencedaddy-landing) → site-level tasks only (metrics push, IndexNow ping)
- **Where email templates live:** coherencedaddy-landing (`lib/creditscore-email.ts`). team-dashboard invokes via callback or ports to a shared package. Do **not** duplicate templates.
- **Where entitlement logic lives:** team-dashboard (`bundle-entitlements.ts`). Storefront **consumes** entitlements, never computes them.

---

## How a product lives across the two repos

1. **Add to team-dashboard DB** — new `*_plans` and `*_subscriptions` tables (or extend existing); seed pricing via migration.
2. **Create Stripe products** in the Stripe dashboard; record price IDs in team-dashboard env vars.
3. **Add service + route** — `server/src/services/<product>.ts` (`createCheckout`, `handleWebhook`, `generateX`) + `server/src/routes/<product>.ts` (`/plans`, `/checkout`, `/webhook`, entitlement endpoints).
4. **Add checkout UI to coherencedaddy-landing** — pricing page pulls from `/api/<product>/plans`, checkout buttons POST to `/api/<product>/checkout` (proxied via `vercel.json` rewrite).
5. **Add entitlement check** — extend `getEntitlementsForCompany` in team-dashboard to resolve the new product from both bundles and standalone subs.
6. **Document in PRD** — write/update `docs/products/<product>-prd.md`, add row to this ownership matrix if it introduces new boundaries.
