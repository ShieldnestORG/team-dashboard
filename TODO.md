# TODO — PRD 1 (CreditScore Reconciliation)

> Synced with `coherencedaddy-landing/TODO.md` — edit both when updating. Source PRD: `/Users/exe/.claude/plans/prd-1-looks-good-fluffy-parnas.md`. Canonical product spec: `docs/products/creditscore-prd.md`.

## Phase 0 — Lock PRDs & scaffolding

- [x] Overwrite `docs/products/creditscore-prd.md` with reconciled PRD (v2, 2026-04-21).
- [x] Create `docs/OWNERSHIP.md` (canonical cross-repo matrix).
- [x] Create this `TODO.md`.
- [x] Edit root `CLAUDE.md` — add "Ownership Matrix" section pointing to `docs/OWNERSHIP.md`.
- [ ] Confirm Agent A's mirror files in `coherencedaddy-landing` are in place (`OWNERSHIP.md`, `TODO.md`, `CLAUDE.md` edit).
- [ ] Confirm coherencedaddy-landing ran `/update-architecture` to refresh its mermaid diagram.

## Phase 1 — team-dashboard substrate (Agent C owns)

### Schema

- [x] `packages/db/src/schema/creditscore.ts` — tables: `creditscore_plans`, `creditscore_subscriptions`, `creditscore_reports`.
- [x] Migration written at `packages/db/src/migrations/0088_creditscore.sql` (seed included; not yet applied — run `pnpm --filter @paperclipai/db migrate` when ready).
- [x] Seed: 5 plan rows at locked pricing, each with its live Stripe price ID populated.
- [x] Indexes: email, domain, status, company, stripe_subscription_id unique (subs); subscription_id, domain, status, shareable_slug unique (reports).

### Service

- [x] `server/src/services/creditscore.ts` — scaffolded. `listPlans`, `getPlanBySlug`, `getReport`, `resolveEntitlement` implemented. `createCheckout`, `handleWebhook`, `generateReport`, `scheduleScans` stubbed (501 / throws / zero counts) with Phase 3 TODO comments pointing at the bundle pattern to mirror.
- [x] Reuses `stripe-client.ts` `verifyStripeSignature` (no duplicate crypto).
- [ ] Webhook handles: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` — deferred to Phase 3.
- [ ] Unit tests for each service method. Aim for parity with `bundle.ts` test coverage.

### Routes

- [x] `server/src/routes/creditscore.ts` — `GET /plans`, `POST /checkout` (501 stub), `POST /webhook` (stub handler), `GET /report/:id`, `GET /entitlement`, `POST /audit/store` (501 stub).
- [x] Routes registered in `server/src/app.ts` (webhook router mounted before `express.json()`).
- [ ] Add route docs at `docs/api/creditscore.md`.

### Entitlements

- [x] Extended `server/src/services/bundle-entitlements.ts` — `getEntitlementsForCompany` now resolves CreditScore from (a) active `creditscore_subscriptions` for the company and (b) `entitlements.creditscore` on any active bundle, picking the higher tier. `BundleEntitlements` type widened to include `report | starter | growth | pro`. New `source: "standalone"` value for standalone-only customers.
- [ ] Add unit test covering: standalone-only, bundle-only, both (higher wins), neither.

### Stripe

- [x] 5 Stripe products created in live mode (done in `coherencedaddy-landing` Phase 1.5, price IDs in seed migration).
- [ ] Record price IDs in team-dashboard `.env` + production VPS env (`STRIPE_PRICE_CREDITSCORE_*`). Currently only in the migration seed.
- [ ] Set `STRIPE_WEBHOOK_SECRET_CREDITSCORE` env var (point Stripe webhook endpoint at `/api/creditscore/webhook`).

### Env + callback

- [ ] Add `CREDITSCORE_CALLBACK_KEY` env var for email-render callbacks to coherencedaddy-landing.
- [ ] Document in `docs/deploy/env-vars.md`.

## Phase 2 — coherencedaddy-landing cutover (done by coherencedaddy side)

> Tracked here for visibility. Work lives in the sibling repo.

- [ ] (coherencedaddy) Swap hardcoded `TIERS` for `/api/creditscore/plans` fetch with ISR + fallback.
- [ ] (coherencedaddy) Rewrite `checkout/starter`, `checkout/growth`, `report/checkout` routes to proxy here.
- [ ] (coherencedaddy) Soft-delete `webhook`, `rescan`, `store` routes (return 410 for 1 week before hard delete).
- [ ] (coherencedaddy) Remove `/api/creditscore/rescan` from `vercel.json` crons.
- [ ] (coherencedaddy) Add Pro tier checkout wiring to UI.
- [ ] (coherencedaddy) Bump report price $4 → $19 in UI and copy.

## Phase 3 — cron cutover & agent wiring

- [ ] Enable team-dashboard monthly rescan cron (via existing VPS scheduler). Verify one full cycle end-to-end.
- [ ] Coordinate with coherencedaddy to disable Vercel rescan cron same day (cutover window, not overlap).
- [ ] Wire Auditor agent skill to `generateReport()` in `services/creditscore.ts`.
- [ ] Wire Content Agent skill (stub OK — delivers "coming soon" notice to Growth+ customers until Phase 4 lands).
- [ ] Wire Schema Agent skill (stub OK).
- [ ] Wire Report Agent — calls coherencedaddy Resend callback for template rendering.
- [ ] Monitor first full monthly cycle; compare report counts against coherencedaddy legacy baseline.

## Phase 4 — agent deliverables backfill

### Content Agent

- [ ] Claude API integration (use `skills/claude-api`).
- [ ] Prompt: "Given audit result + domain context, draft an AEO-optimized page draft in HTML."
- [ ] Draft lands in a review queue (human approval before publish).
- [ ] Rate limit: 2/mo per Growth sub, 4/mo per Pro sub.

### Schema Agent

- [ ] Generates JSON-LD blocks for common schema types (Organization, Product, Article, FAQPage).
- [ ] Output is a copy-paste block for customer to install, plus a PR-ready snippet if their site is GitHub-hosted.
- [ ] Rate limit: 1/mo per Growth, 2/mo per Pro.

### Competitor Agent

- [ ] Monthly scan of 3 domains (Growth) or 5 domains (Pro).
- [ ] Outputs: comparative score table + top 3 gaps this customer should close.
- [ ] Uses Auditor under the hood; separate report row.

### Sage (Pro only)

- [ ] Named strategist persona — weekly strategy doc.
- [ ] Synthesizes latest audit + competitor scan + content + schema work into a 1-page action plan.
- [ ] Delivered via Report Agent.

## Blockers / open decisions

- [ ] **Email templates location** — keep in coherencedaddy-landing (current plan) or port to a shared package? Decision deferred until second template set lands.
- [ ] **Grandfathering for $4 report buyers** — product call (not engineering). Default assumption: Stripe price IDs grandfathered; new $19 price for new customers only.
- [ ] **Pro tier UI-only status** — confirmed Pro will ship checkout in Phase 2 cutover, not deferred further.
- [ ] **Review queue location for Content Agent drafts** — team-dashboard admin UI vs. a net-new coherencedaddy admin route. Lean toward team-dashboard.

## Verification

End-to-end smoke after Phase 2:

- [ ] Pricing renders from `/api/creditscore/plans` (check network tab on `freetools.coherencedaddy.com/creditscore-home`).
- [ ] Starter checkout redirects to a Stripe session created by this repo (inspect Stripe dashboard metadata).
- [ ] Test purchase → webhook fires here → row in `creditscore_subscriptions` → welcome email delivered.
- [ ] `GET /api/creditscore/entitlement?domain=<test>&email=<test>` returns Starter.
- [ ] Create AEO Starter bundle → `getEntitlementsForCompany` returns `creditscore.tier=starter` from bundle path.

End-to-end smoke after Phase 3:

- [ ] Manually trigger rescan cron → `creditscore_reports` populated → monthly emails sent.
- [ ] Vercel cron logs confirm coherencedaddy rescan no longer running.
