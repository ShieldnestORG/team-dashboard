# TODO — Product Delivery

> Originally PRD 1 (CreditScore Reconciliation). Now also tracks post-Phase-1
> shipping work for Shop Sharers, House Ads, and ongoing agent work.
>
> Synced with `coherencedaddy-landing/TODO.md` — edit both when updating.
> Source PRD: `/Users/exe/.claude/plans/prd-1-looks-good-fluffy-parnas.md`.
> Canonical product spec: `docs/products/creditscore-prd.md`.
>
> **Last audited: 2026-04-28.** Re-audited after the KG cleanup sprint
> (PRs #14–#18) and Phase 1 silent enrichment (PR #20). New section
> "KG Cleanup + Phase 1" appended at the bottom; nothing earlier was
> changed except a few cross-references where KG work touched them.

## Phase 0 — Lock PRDs & scaffolding

- [x] Overwrite `docs/products/creditscore-prd.md` with reconciled PRD (v2, 2026-04-21).
- [x] Create `docs/OWNERSHIP.md` (canonical cross-repo matrix).
- [x] Create this `TODO.md`.
- [x] Edit root `CLAUDE.md` — add "Ownership Matrix" section pointing to `docs/OWNERSHIP.md`.
- [ ] Confirm `coherencedaddy-landing/docs/OWNERSHIP.md` mirror exists (landing has `CLAUDE.md` + `TODO.md`; OWNERSHIP mirror not yet confirmed).
- [ ] Confirm coherencedaddy-landing ran `/update-architecture` to refresh its mermaid diagram post-Phase-1.5.

## Phase 1 — team-dashboard substrate (Agent C owns)

### Schema

- [x] `packages/db/src/schema/creditscore.ts` — tables: `creditscore_plans`, `creditscore_subscriptions`, `creditscore_reports`.
- [x] Migration `0088_creditscore.sql` applied to prod Neon.
- [x] Seed: 5 plan rows at locked pricing with live Stripe price IDs.
- [x] Indexes: email, domain, status, company, stripe_subscription_id unique (subs); subscription_id, domain, status, shareable_slug unique (reports).

### Service

- [x] `server/src/services/creditscore.ts` — `listPlans`, `getPlanBySlug`, `getReport`, `resolveEntitlement`, `createCheckout`, `handleWebhook`, `generateReport`, `scheduleScans` all implemented (2026-04-22 cutover).
- [x] Reuses `stripe-client.ts` `verifyStripeSignature` (no duplicate crypto).
- [x] Webhook handles: `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted` (`creditscore.ts:216–299`).
- [ ] Unit tests for each service method. Helpers covered in `server/src/__tests__/creditscore-helpers.test.ts` (6 cases for `higherCreditscoreTier`); integration tests for `createCheckout` / `handleWebhook` / `generateReport` not yet written.

### Routes

- [x] `server/src/routes/creditscore.ts` — all endpoints implemented (no more 501 stubs).
- [x] Routes registered in `server/src/app.ts` (webhook router mounted before `express.json()`).
- [x] Route docs at `docs/api/creditscore.md` (50+ lines, covers all endpoints).

### Entitlements

- [x] `server/src/services/bundle-entitlements.ts` — `getEntitlementsForCompany` resolves CreditScore from active `creditscore_subscriptions` + `entitlements.creditscore` on any active bundle, picks the higher tier. `BundleEntitlements` widened to `report | starter | growth | pro`.
- [ ] Integration test for full `getEntitlementsForCompany` path covering: standalone-only, bundle-only, both (higher wins), neither. Helper-level tests exist; end-to-end path not yet covered.

### Stripe

- [x] 5 Stripe products recreated 2026-04-23 on `acct_1TJQyw` (Coherence Daddy) after old-account archive. IDs stored in local `.env` + coherencedaddy-landing `.env.local`.
- [x] Record price IDs in prod VPS `.env` (`STRIPE_PRICE_CREDITSCORE_*`). Pushed 2026-04-23.
- [x] `STRIPE_WEBHOOK_SECRET_CREDITSCORE` — documented (`docs/deploy/env-vars.md:102`), read in `creditscore.ts:217`. Verify endpoint registered in Stripe dashboard + secret present in VPS env.

### Env + callback

- [x] `CREDITSCORE_CALLBACK_KEY` documented (`docs/deploy/env-vars.md:105`), read in `creditscore-email-callback.ts:8`. Verify secret rotated into VPS env.
- [x] `docs/deploy/env-vars.md` updated with full CreditScore env-var table.

## Phase 2 — coherencedaddy-landing cutover (shipped 2026-04-22)

- [x] (coherencedaddy) Swap hardcoded `TIERS` for `/api/creditscore/plans` fetch with ISR + fallback.
- [x] (coherencedaddy) Rewrite `checkout/starter`, `checkout/growth`, `report/checkout` routes to proxy here.
- [x] (coherencedaddy) Soft-delete `webhook`, `rescan`, `store` routes (410 stubs).
- [x] (coherencedaddy) Remove `/api/creditscore/rescan` from `vercel.json` crons.
- [x] (coherencedaddy) Add Pro tier checkout wiring to UI.
- [x] (coherencedaddy) Bump report price $4 → $19 in UI and copy.
- [x] (coherencedaddy) `/api/email/creditscore` HMAC-validated email callback receiver live.

## Phase 3 — cron cutover & agent wiring

- [ ] Enable team-dashboard monthly rescan cron in VPS scheduler. `creditscore-crons.ts → runScheduledScans()` implemented — waiting on live activation + first-cycle verification.
- [ ] Coordinate with coherencedaddy to disable Vercel rescan cron same day as team-dashboard cron activation (cutover window, not overlap).
- [x] Wire Content Agent skill — `creditscore-content-agent.ts` + `creditscore-content-agent-cron.ts`. Uses Ollama Cloud, not Claude API (Claude API upgrade tracked in Phase 4).
- [x] Wire Schema Agent skill — `creditscore-schema-agent.ts` implemented.
- [x] Wire Report Agent — `creditscore-report-agent.ts` calls coherencedaddy Resend callback for template rendering.
- [ ] Monitor first full monthly cycle; compare report counts against coherencedaddy legacy baseline.

> Removed: "Wire Auditor agent skill" — no separate Auditor agent exists; `runAudit` is called directly from `generateReport()`, and the report/content/schema/competitor/sage agents fan out from there.

## Phase 4 — agent deliverables backfill

### Content Agent

- [ ] Migrate Content Agent from Ollama Cloud to Claude API (use `skills/claude-api`).
- [ ] Prompt: "Given audit result + domain context, draft an AEO-optimized page draft in HTML."
- [ ] Draft lands in a review queue (human approval before publish).
- [ ] Rate limit: 2/mo per Growth sub, 4/mo per Pro sub.

### Schema Agent

- [x] Generates JSON-LD blocks for common schema types (Organization, Product, Article, FAQPage) — `creditscore-schema-agent.ts`.
- [ ] Output as copy-paste block + PR-ready snippet for GitHub-hosted sites.
- [ ] Rate limit: 1/mo per Growth, 2/mo per Pro.

### Competitor Agent

- [x] Monthly scan of 3 domains (Growth) or 5 domains (Pro) — `creditscore-competitor-agent.ts`.
- [x] Outputs: comparative score table + top 3 gaps.
- [x] Uses Auditor under the hood; separate report row.

### Sage (Pro only)

- [x] Named strategist persona — weekly strategy doc — `creditscore-sage-strategist.ts`.
- [x] Synthesizes latest audit + competitor scan + content + schema into 1-page action plan.
- [x] Delivered via Report Agent.

## Blockers / open decisions

- [ ] **Email templates location** — keep in coherencedaddy-landing (current plan) or port to a shared package? Decision deferred until second template set lands.
- [ ] **Grandfathering for $4 report buyers** — product call. Default: Stripe price IDs grandfathered; new $19 price for new customers only.
- [x] **Pro tier UI-only status** — resolved. Pro shipped in Phase 2 cutover (checkout) + Phase 3 (Sage + Competitor agents).
- [ ] **Review queue location for Content Agent drafts** — team-dashboard admin UI vs. coherencedaddy. Lean toward team-dashboard; revisit when Claude API integration begins.

## Verification

### Phase 2 smoke (2026-04-22 cutover) — all confirmed

- [x] Pricing renders from `/api/creditscore/plans` on `freetools.coherencedaddy.com/creditscore-home`.
- [x] Starter/Growth/Pro checkouts redirect to Stripe sessions created by team-dashboard.
- [x] Test purchase → webhook fires here → row in `creditscore_subscriptions` → welcome email delivered.
- [x] `GET /api/creditscore/entitlement?domain=<test>&email=<test>` returns correct tier.
- [x] AEO Starter bundle → `getEntitlementsForCompany` returns `creditscore.tier=starter` from bundle path.

### Phase 3 smoke (pending VPS scheduler activation)

- [ ] Manually trigger rescan cron → `creditscore_reports` populated → monthly emails sent.
- [ ] Vercel cron logs confirm coherencedaddy rescan no longer running.

---

# Post-Phase-1 shipping work (2026-04-22 → 2026-04-23)

Tracks feature work shipped after PRD 1 cutover. Unrelated to CreditScore.

## Shop Sharers (`docs/products/shop-sharers.md`)

Shipped 2026-04-22 (migration `0094_shop_sharers.sql`, team-dashboard backend +
admin UI) and 2026-04-23 (storefront email-capture + redirect, landing@a9ae317).

- [x] Backend: `shop_sharers` + `shop_referral_events` tables, `/api/shop/*` routes (public + board), admin page at `/shop-sharers`.
- [x] Storefront: email-capture hero band (`components/shop/share-capture.tsx`), `/shop/share?code=<code>` result page, ref-hit beacon, vercel.json `/api/shop/*` rewrite.
- [ ] **Purchase attribution writer** — `shop_referral_events.event_type = 'purchase'` is reserved but no writer exists. Wire when shop Stripe checkout is live.
- [ ] **Rate-limit `/api/shop/sharers/:code/apply-affiliate`** — currently idempotent but not rate-limited; nice-to-have before abuse surfaces.
- [ ] **Prize program copy → concrete program** — `/shop/share` page tells sharers "top sharers win prizes, details TBA." No entitlement logic exists yet. Needs product decision on what the prize mechanic actually is before coding.
- [ ] **Commission-engine read of `shared_marketing_eligible`** — flag flips `true` on approval but the commission engine doesn't consult it yet. Wire `EXISTS (... shop_sharers ... shared_marketing_eligible = true)` filter when shared-marketing revenue splits land.

## House Ads (`docs/products/house-ads.md`)

Shipped 2026-04-22 (migration `0093_house_ads.sql`, admin CRUD + public slot endpoint).

- [x] Backend: `house_ads` table, `/api/house-ads/*` routes, admin CRUD at `/house-ads`.
- [x] Storefront: `<AdSlot>` component registry + blog article slot migrated from raw AdSense (`landing@6698bd2`, 2026-04-23).
- [ ] **Flip blog-article slot providers `['adsense']` → `['adsense','house']`** once AdSense approval lands, so house-ads fills the no-fill impressions. File: `coherencedaddy-landing/lib/ad-slots.ts`.
- [ ] **Populate house-ads inventory targeting `blog-article` slot** — admin-create at least one creative weighted for blog article placement before the provider flip above.
- [ ] **Merch-promo banner wiring** — `MerchPromo` component currently hardcodes content. Consider routing through house-ads when the inventory story stabilizes.

## Blog Distribution (`docs/products/blog-distribution.md`)

Shipped progressively through 2026-04-22 (blog#9 merge + retry + per-target visibility).

- [ ] **Onboarding-wizard Playwright flake is now chronic.** Every recent PR run (Apr 22 → Apr 28) shows `e2e fail` on `tests/e2e/onboarding.spec.ts` "completes full wizard flow" — locator times out at 15s with `429 Too Many Requests` warnings on Vite source files. Team has been merging through it, but it makes `e2e` worthless as a signal. Either fix the rate-limit on the dev server during e2e, raise the locator timeout, or quarantine the test.

## CI / Infra

- [ ] **Dependabot** — GitHub flags 4 moderate vulnerabilities on `team-dashboard` default branch. Review at https://github.com/ShieldnestORG/team-dashboard/security/dependabot and patch or suppress.
- [ ] **NPM_TOKEN for canary publish** — release canary publish gated on `NPM_PUBLISH_ENABLED` repo variable (currently `false`). When token lands, flip variable to `true`.

---

# KG Cleanup Sprint + Phase 1 Silent Enrichment (2026-04-28)

Full handoff: [`docs/architecture/kg-2026-04-28-handoff.md`](docs/architecture/kg-2026-04-28-handoff.md).
Strategy: [`docs/products/knowledge-graph-positioning.md`](docs/products/knowledge-graph-positioning.md).
60-day kill metric deadline: **2026-06-26**.

## Shipped to prod 2026-04-28

- [x] PR [#14](https://github.com/ShieldnestORG/team-dashboard/pull/14) — extractor prompt: 6 SUBJECT SCOPING RULES + 3 negative examples (kills subject bleed + Dependabot edges).
- [x] PR [#15](https://github.com/ShieldnestORG/team-dashboard/pull/15) — harvester slug attribution: `OVERLOADED_REPO_MAP` + `intel_reports.source_repo` column populated.
- [x] PR [#16](https://github.com/ShieldnestORG/team-dashboard/pull/16) — Nexus cron doc 4h → 3h (cosmetic).
- [x] PR [#17](https://github.com/ShieldnestORG/team-dashboard/pull/17) — `resolveEntity()` denylist drops version strings, SHAs, file extensions; `node24` etc. no longer create edges.
- [x] PR [#18](https://github.com/ShieldnestORG/team-dashboard/pull/18) — deterministic SBOM parser for `package.json` + `go.mod` emits `depends_on` edges with `scope` (runtime/devDependency).
- [x] PR [#20](https://github.com/ShieldnestORG/team-dashboard/pull/20) — **Phase 1 silent dependencies block** on `GET /api/intel/company/:slug`. `bucketDependencyRows()` pure helper + 9 unit tests. Live in prod on `c165e8a4`.
- [x] Migrations `0098_intel_reports_source_repo.sql` + `0099_depends_on_edges.sql` applied to prod Neon (via direct psql — Drizzle migrator is broken; see P1 below).
- [x] DB cleanup: 48 H2-mismatched rows flagged with `verified=false`; 3 confirmed-garbage rows deleted (38, 40, 82) with backup; 1 orphan `knowledge_tags` row deleted (`node24`); 1 row added to `intel_companies` (`argo-workflows`).
- [x] Validation infra: `scripts/audit/kg-phase1-validation.ts` (re-runnable post-deploy script comparing live state to baseline).
- [x] 48h validation scheduled: remote routine `trig_015aSfHYBvkGEMdguvhfvZfk` (code-level, posts to PR #20) + local cron `18f2281c` (prod-state, posts to PR #20). Both fire 2026-05-01T00:43:00Z.

## Open — surfaced by validation script run 2026-04-28T17:41 PDT

- [ ] **Verified edge count dropped 87 → 81 (-6) within 30min of merge.** Six rows flipped from `verified=true` → `verified=false`. Suspect either the patched extractor or `kg:deduplicate-tags` / `kg:prune-edges` is resetting the verified flag on re-extraction. If this keeps draining, the 60-day kill-metric is at risk. Investigate by:
  - Pulling the 6 affected rows (`SELECT * FROM company_relationships WHERE updated_at > '2026-04-28 17:30' AND verified = false`)
  - Reading `extractor.extractFromReports()` for upsert behavior on existing rows
  - Reading `pruneEdges()` and `deduplicateTags()` for any path that flips `verified`
- [ ] **Pre-existing `kg:deduplicate-tags` UNIQUE-key bug** — `offchainlabs → offchain-labs` consolidation fails on every run with "duplicate key value violates unique constraint". Root cause: trying to UPDATE `source_id` to a slug that already has the same `(source_type, relationship, target_type, target_id)` tuple. Need to switch to upsert-then-delete-loser, or merge confidence via DO UPDATE.

## Open — P0/P1 from the handoff

- [ ] **Drizzle migrator is broken.** `pnpm db:migrate` thinks 40 migrations are pending and errors on `type "vector" does not exist`. `_journal.json` only tracks up to migration 0050; everything from 0051+ is treated as pending; runner doesn't bootstrap pgvector before migrations that reference `vector` type. Workaround used this sprint: apply SQL via direct psql. Root-cause investigation owners: `packages/db/src/client.ts:applyPendingMigrations` and `inspectMigrations`.
- [ ] **YT branch redeploy.** VPS1 was on `fix/yt-caption-sync` (10+ in-flight YT commits, `b2391d15`) before this sprint pulled it onto master. The branch is safely on origin. Either rebase `fix/yt-caption-sync` onto current master and re-deploy, or merge YT into master, before re-deploying YT work to prod.

## Open — Phase 1 follow-through (drives the kill metric)

- [ ] **Wait 24–48h for ingestion to fill in `depends_on` and re-verify rows.** `intel:github` cron last fired before deploy; SBOM parser hasn't had a `package.json` to chew on yet. The two scheduled validation agents (above) will report state on 2026-05-01.
- [ ] **2026-06-26 kill-metric tracker.** Concrete check: ≥200 enriched paid Intel API responses in any rolling 7-day window AND ≥75% accuracy on a 50-edge spot-check of dependency blocks served to paid customers. Needs:
  - Request-logging on Intel API that distinguishes paid vs free
  - A non-empty-`dependencies` filter on those logs
  - A 50-row spot-check sampling script (similar to existing `kg-accuracy-sample.sql`)
  - Calendar reminder set for 2026-06-26 (or scheduled remote agent)
- [ ] **P3 — Dogfood the KG for one real operator decision.** Council put this *before* full Phase 1 wiring. Before the next product / partner / tutorial decision, run `GET /api/intel/company/<candidate>` and let the `dependencies` block influence the call. If it doesn't change behavior, the customer-facing version won't change theirs.
- [ ] **Re-run A/B test on substantive prose.** After 3+ days of fresh ingestion under the new code, re-run `scripts/audit/kg-extractor-ab-test.ts` on substantive release notes (≥500-char body) to confirm the patched prompt isn't over-correcting on real architecture text.
- [ ] **Phase 2 (only if Phase 1 earns it):** single `GET /v1/entity/:slug/dependencies` endpoint on existing Pro tier. Triggered by ≥200 enriched paid responses in 7d. Killed plays (do not resurrect): Crayon/Klue competitive-intel upsell, CreditScore competitive landscape, programmatic vs/alternatives SEO, standalone KG SaaS, embedding licensing.

## Killed plays (for the record — do not resurrect without re-reading the council transcript)

- ❌ Competitive-intel SaaS positioning (vs Crayon/Klue)
- ❌ CreditScore competitive landscape upsell
- ❌ Programmatic "X vs Y / alternatives" SEO landing pages
- ❌ Standalone KG SaaS product
- ❌ KG embedding licensing
