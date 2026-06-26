<!-- Generated 2026-06-18 by an 8-agent Opus planning workflow (6 design tracks + integration architect + red team). Plan-only; no code. Grounded in master + fix/affiliate-quick-wins. -->


# Unified Affiliate Hub — Implementation Plan

> **Cluster:** Plans · **Tags:** affiliate, commission-ledger, attribution, payouts, shop, polymorphic-source · **Related:** [Affiliate System Upgraded](../guides/affiliate-system-upgraded.md), [Affiliate User Journeys](../guides/affiliate-user-journeys.md), [Admin Affiliate Testing](../guides/admin-affiliate-testing.md), [Docs Index](../README.md)

**Status:** Design / sequencing doc. No code in this document.
**Author:** Integration Architect (synthesis of 6 design tracks, all grounded in current `master` + `fix/affiliate-quick-wins` code).
**Date:** 2026-06-18
**Locked decisions (user):** shop commission = 30% flat; scope = everything (Partner Network + WooCommerce shop + all Stripe services); CreditScore prices = PRD canonical ($19 one-time / $49 Starter / $199 Growth / $499 Pro); recurring commission = NO cap, paid per paid-invoice; shop attribution path = our recommendation below.

**Ratified policy decisions (user, 2026-06-18) — these resolve the red-team's escalated open items and OVERRIDE any contrary track guidance:**
1. **Clawback netting = SOURCE-SCOPED, not one-wallet.** A refund/clawback in product X may only net against earnings from product X — never reduce a payout earned from a different product. This makes `clawback.ts` (FIFO `applyClawbackRecovery`) source-scoped: change Phase 5 from "unified wallet" to per-`source_type` netting, and resolves R12.
2. **Rate is DECOUPLED from tier** (Phase 2 Step 5 is now mandatory, not optional). The tier cron stops writing `affiliates.commission_rate`; tiers still rank/perk by source-agnostic total earnings, but a non-partner sale must NOT auto-raise the Partner Network rate. Resolves R21. (Tier *qualification* stays source-agnostic — all earnings count toward rank — only the rate coupling is removed.)
3. **Shop is USD-only, guarded loudly.** Add `currency` columns up front; assert `order.currency==='usd'` in the Woo ingest and on Stripe invoices; on any non-USD, skip + alert (never silently coerce). No FX in v1. Resolves R17.

The red-team's "Top 5 must-fix-before-any-code" (R2 text-not-uuid `source_ref`; R4/R5 nullable `attribution_id`; R7/R9 per-session idempotency + source-filtered refund handlers; R14/R15 Woo webhook hardening + reconciliation-as-fraud-control; R6 verify/fix the Date-vs-Neon-pooler footgun before cloning) are BINDING amendments to the phase work below.

---

## Executive Summary

Today the affiliate program is structurally single-source: every `commissions` row is hard-FK'd to a Partner Network lead (`commissions.lead_id NOT NULL → partner_companies`, `packages/db/src/schema/commissions.ts:15`), the only commission writer is `handlePartnerStripeEvent` (`server/src/routes/directory-listings.ts:344`), reached only when a Stripe event carries `metadata.source === 'partner_network'` (`directory-listings.ts:753-756`). The end state is **one hub at `affiliates.coherencedaddy.com` where an affiliate logs into a single area and earns from many sources** — the Partner Network, the WooCommerce shop at 30%, and all five Stripe services (CreditScore, Directory Listings, Watchtower, Bundles, 100 Agents) — seeing one blended balance, one monthly payout, and one statement that breaks down by source. The **single keystone dependency is generalizing the commission ledger**: making `commissions` and `referral_attribution` able to point at any revenue source via a polymorphic `(source_type, source_ref, product_slug)` shape, additively and without breaking the just-fixed recurring/refund routing or any live partner data. Everything else — shop ingest, per-service commission shims, the per-product rate card, the hub UX, and multi-source payouts — wires in *on top of* that generalized ledger and is otherwise blocked. The plan below sequences the ledger first (with a deliberately staged, two-migration safe path against live data), then fans out the revenue sources, then the rate model, hub UX, and payout hardening.

---

## Verified Ground Truth (corrections to the design tracks)

These were checked against the real code while writing this plan; two design-track claims were **wrong** and are corrected here so they don't propagate into implementation:

1. **Next migration number is `0122`, not `0125`.** `packages/db/src/migrations/` highest committed is `0121_affiliate_clawbacks.sql`, and `_journal.json` ends at `idx: 121`. The ledger track's `0122`/`0123` is correct; the **rates track's `0125` is wrong** — renumber to whatever sequence number it actually lands on. There is also a real **collision**: two files share `0119` (`0119_creditscore_audit_runs.sql` and `0119_watchtower_rank.sql`). This is pre-existing and only cosmetic (the journal sorts on `idx`), but every new migration in this plan must append a fresh monotonic `idx` to `_journal.json` and not reuse a number.
2. **The partner/Directory webhook does NOT mount before `express.json`.** The four product webhooks mount before the parser (`app.ts:196-199`), but the partner/Directory webhook is mounted *inside* the `api` Router at `app.ts:311` (`api.use("/stripe", directoryListingsWebhookRoutes(db))`), **after** `express.json` at `app.ts:200`. It works by reading `req.rawBody` captured by the global `express.json({ verify })` hook (`directory-listings.ts:738`, comment at `:5`). The new WooCommerce webhook therefore has two valid mount choices — mirror the partner pattern (use the global rawBody) or mount before the parser like the product webhooks. **Recommendation: mount it before the parser** (`app.ts:196-199` block) because WooCommerce HMAC needs the exact raw bytes and that block is the established "needs raw body" location; do not rely on the global hook for a non-Stripe signature scheme.
3. **`affiliate_clawbacks.reason` is a bare `text` with three documented values** (`stripe_refund | compliance_violation | admin_manual`, `affiliate_clawbacks.ts:27`). Widening it to add `woo_refund` is a no-DDL change (just a new string the writer passes). Confirmed.
4. **`affiliate_tiers.min_active_partners` exists and is read at `affiliate-crons.ts:648`** against `activeCount` computed by the partner-only inner join at `:632-643`. Confirmed. The lifetime query at `:617-627` is genuinely source-agnostic (no partner join). Confirmed.
5. **The lock-expiration cron is correctly partner-scoped** (`affiliate-crons.ts:450` inner-joins `partnerCompanies` on `referralAttribution.leadId`), so polymorphic NULL-leadId attribution rows are naturally excluded — no change needed, but document it.

---

## Source Taxonomy (fixed vocabulary, decided once, used by every track)

Closed set for `source_type` / `product_slug` and the UI `EarningSource` union. **Confirm before Phase 1** — it becomes a backfilled constant and a CHECK domain:

```
partner_network | woo_shop | creditscore | directory_listing | watchtower | bundle | agents
```

UI display metadata (label, blurb, rate copy, "how you earn" verb, card kind) lives in a new `ui/src/lib/affiliateSources.ts`, mirroring the existing `ui/src/lib/affiliateTiers.ts` pattern.

---

## Phased Rollout

Phases are ordered strictly by dependency. **Phase 1 (ledger) gates everything.** Phases 3a–3e (revenue sources) can parallelize among themselves once Phase 1 + 2 land. Phases 4–6 follow.

Every phase's gate is the project's mandatory verify command (from `CLAUDE.md`):
```bash
npx tsc --noEmit --project server/tsconfig.json
cd ui && npx tsc --noEmit
```
plus the relevant test suites (`payout-batcher.test.ts`, commission/clawback tests) and `./scripts/predeploy.sh` for any deploy.

---

### Phase 0 — Merge the routing fix; lock the taxonomy *(size: S)*

**Goal:** establish a clean base. The just-fixed recurring/refund routing must be on `master` before any insert-site edits, because Phase 1 Step 3 edits the same insert sites.

**Work items**
- Merge `fix/affiliate-quick-wins` to `master` (routes recurring on `partnerCompanies.stripeSubscriptionId`, refunds on `commissions.stripeInvoiceId`). **Manual Stripe step from that branch's memo still pending: subscribe `/api/stripe/webhook` to `charge.refunded`** — do this now or partner clawbacks stay dead.
- User signs off on the source-type vocabulary above.
- Open the new feature branch (e.g. `feat/unified-affiliate-ledger`). One-writer-per-branch rule applies.

**Ships:** nothing new; a clean base + confirmed vocabulary.
**Gate:** `master` typechecks clean both projects; partner refund webhook confirmed live in Stripe dashboard (the correct account `acct_1TJQywQvkbvTR7Og`, per `docs/deploy/stripe-runbook.md` — CLI is authed to the wrong account, use the `.env` key).

---

### Phase 1 — Generalize the commission ledger (KEYSTONE) *(size: M)*

**Goal:** make `commissions` and `referral_attribution` able to reference any source, additively, with a two-migration safe path so live partner data is never at risk.

**Work items (in strict order):**

1. **Migration `0122_generalized_commission_ledger.sql` (additive, zero behavior change):**
   - `ALTER TABLE commissions ADD COLUMN source_type text, source_ref uuid, product_slug text, source_event_id text;` (all nullable, unread → safe to apply to prod immediately).
   - `ALTER TABLE referral_attribution ADD COLUMN source_type text, source_ref uuid, product_slug text;`
   - **Backfill in the same migration:** `UPDATE commissions SET source_type='partner_network', source_ref=lead_id, product_slug='partner_network' WHERE source_type IS NULL;` identical on `referral_attribution`.
   - Add partial unique index `commissions_source_event_uq ON (source_type, source_event_id) WHERE source_event_id IS NOT NULL` — the Woo idempotency key. Leave `commissions_stripe_invoice_uq` (`commissions.ts:42-44`) untouched; it already covers every Stripe product.
   - Use SQL `now()` in any timestamp writes (Drizzle Date-param footgun against the Neon pooler — `feedback_drizzle_date_neon_pooler`).
   - Append `idx: 122` to `_journal.json`.
   - Schema files: `commissions.ts`, `referral_attribution.ts` get the new nullable columns + the new index.

2. **Step 3 — teach the partner writer the new shape (still partner-only path, deploy WITH `0122`):** in `handlePartnerStripeEvent` every `commissions.insert` (`directory-listings.ts:457`, `:578`) and every `referralAttribution.insert` (`affiliates.ts:684,778,2696,2750,2830`) additionally sets `source_type='partner_network'`, `source_ref=leadId`, `product_slug='partner_network'`. `lead_id` keeps being set. After this deploys, **no NULL-source rows can be created.**

3. **Migration `0123_commission_leadid_nullable.sql` (the only risky step — deploy on the NEXT deploy, after verifying prod has zero NULL `source_type` rows):**
   - `ALTER TABLE commissions ALTER COLUMN lead_id DROP NOT NULL; ALTER TABLE referral_attribution ALTER COLUMN lead_id DROP NOT NULL;`
   - `SET NOT NULL` on `source_type/source_ref/product_slug` (safe: backfill + writer guarantee population).
   - `ADD CONSTRAINT` (CHECK) on both tables: `(source_type='partner_network') = (lead_id IS NOT NULL)` — preserves the partner FK guarantee and forbids non-partner rows from setting `lead_id`.
   - Replace `referral_attribution_active_lead_uq` (on `lead_id`): **CREATE the new `ON (source_type, source_ref) WHERE lock_released_at IS NULL` first, verify, THEN drop the old** — never drop-before-create (brief uniqueness gap). `CREATE UNIQUE INDEX CONCURRENTLY` is not transaction-safe, so run it in its own statement.
   - Append `idx: 123`.

4. **Reads (additive):** every commission-list read is already `leftJoin(partnerCompanies)` (`affiliates.ts:1166,1240,1632,2251`), so NULL `lead_id` yields NULL name, not a dropped row. Add `source_type`/`product_slug` to the SELECT projections so the hub can render a source label instead of a blank. No schema-forced read change.

**Ships:** a polymorphic ledger that still behaves byte-identically for partner commissions. No new revenue yet.
**Gate:** typecheck both projects; commission + clawback test suites green; **manual prod check after `0122` deploy: `SELECT count(*) FROM commissions WHERE source_type IS NULL` returns 0** before `0123` is allowed to ship.

**Hard ordering hazard (call out in the PR):** `0123` before Step 3 is live would allow a NULL-source insert that later violates the CHECK. `0122`+writer deploy together; `0123` only on the subsequent deploy.

---

### Phase 2 — Rate model + per-product rate card *(size: L)*

**Goal:** replace the inline `rate: affiliates.commissionRate` JOIN with a deterministic resolver that supports a per-source rate, keeping partner economics byte-identical and adding the locked shop 30%.

**Work items**
- **New table `product_commission_rates`** (migration after Phase 1, next free seq — e.g. `0124`): `source_type text UNIQUE NOT NULL`, `rate_mode text ('flat'|'tiered')`, `flat_rate numeric(5,4) NULL`, `applies_attribution_multiplier boolean DEFAULT false`, `active boolean DEFAULT true`, `notes`, `updated_by_user_id`, timestamps. New schema file + register in `packages/db/src/schema/index.ts`. **Seed** in the same migration per the rate card below.
- **New `server/src/services/commission-rate.ts`** exposing `resolveCommissionRate({ sourceType, affiliateId, affiliateTier, attributionType })`. Logic: look up `product_commission_rates`; `tiered` → base from `affiliate_tiers.commission_rate` for the affiliate's tier (fallback `affiliates.commission_rate`, then `0.10`); `flat` → `flat_rate`; if `applies_attribution_multiplier` → run the **existing** `rateForAttribution` (×1.25 / ×0 / base, `directory-listings.ts:36-52`) moved verbatim into this shared util. Pure deterministic code (Rule 5).
- **Rewire the partner writer** to call `resolveCommissionRate({ sourceType:'partner_network', ... })` replacing the two inline JOINs (`directory-listings.ts:431,548`) + local `rateForAttribution` call. Byte-for-byte identical behavior today — this proves the resolver before any new product uses it. The `rate==='0'` skip (`:447,:566`) stays, now driven by the resolver.
- **Decouple the tier cron from rate:** stop `affiliate:tier-recompute` writing `affiliates.commission_rate` (`affiliate-crons.ts:665`). Keep writing `tier`/`tierUpgradedAt`. The tiered resolver reads `affiliate_tiers.commission_rate` directly. Repurpose `affiliates.commission_rate` as a nullable per-affiliate OVERRIDE (resolver prefers it when present and non-default). **Audit all readers of `affiliates.commission_rate`** (`affiliate-engagement.ts:81,138`, admin views, dashboard hero subtitle at `AffiliateDashboard.tsx:689`) — they must show the resolved/tier rate, not the override, or they mislead affiliates (Rule 7).
- **Admin UI:** add `GET /product-rates` + `PUT /product-rates/:sourceType` (board-only, audited) alongside the existing tiers CRUD in `affiliate-engagement.ts:417-454`; new `ui/src/pages/AffiliateAdminProductRates.tsx` (or a tab in `AffiliateAdminTiers.tsx`), reusing the inline-editable-row pattern.
- **Tier-qualification note:** the lifetime query (`affiliate-crons.ts:617-627`) is already source-agnostic and **will start counting shop + service commissions toward tier promotion** the moment those writers ship. This is intended (unified hub) — confirm with user (open decision). Leave the `activeCount` partner-only inner join as-is and **document it loudly** so a future dev doesn't "fix" it.

#### Rate Card

| Source | Rate | Mode | Attribution multiplier? | Status |
|---|---|---|---|---|
| **WooCommerce shop** (`woo_shop`) | **30%** | flat | no | **LOCKED (user)** |
| Partner Network (`partner_network`) | tier base 10/12/15/20% × attribution (×1.25 led / ×0 direct) | tiered | yes | Unchanged from today |
| CreditScore (`creditscore`) — $19 one-time + $49/$199/$499 tiers | 20% | flat | no | **PROPOSED — user sets** |
| Directory Listings (`directory_listing`) — $199/$499/$1499 | 10% | flat | no | **PROPOSED — user sets** |
| Watchtower (`watchtower`) — $29/mo | 20% | flat | no | **PROPOSED — user sets** |
| Bundles (`bundle`) — $199–$2499/mo | 15% | flat | no | **PROPOSED — user sets** |
| 100 Agents (`agents`) — $79–$1499/mo | 20% | flat | no | **PROPOSED — user sets; blocked on 100 Agents MVP** |

All non-shop rates are editable in admin; the table above seeds the defaults. Recurring products pay per paid-invoice, **no cap** (locked).

**Ships:** working per-source rate resolution; partner economics provably unchanged; admin can set service rates.
**Gate:** typecheck both; commission tests green; manual check that a partner commission inserted post-deploy carries the identical `rate` it would have pre-refactor (regression-test the resolver against `rateForAttribution`).

---

### Phase 3 — Wire the revenue sources (parallelizable after Phase 2)

A shared **`server/src/services/commission-writer.ts`** is extracted first (from `handlePartnerStripeEvent`'s insert/reverse logic, `directory-listings.ts:457-712`) exposing `writeInitialCommission()`, `writeRecurringCommission()`, `reverseCommissionByInvoice()`. Each takes `{ affiliateId, sourceType, sourceRef, productSlug, basisCents, period, stripeInvoiceId|sourceEventId, rate }`. It reuses the existing `onConflictDoNothing` idempotency, the 30-day `holdExpiresAt`, and the exact `charge.refunded` snapshot-flip / `decrementUnsentPayouts` / idempotent `recordClawback` transaction. **Non-partner sources must first create a `referral_attribution` row** (source-scoped) because `commissions.attributionId` is still NOT NULL (`commissions.ts:16`) — this is a writer-contract requirement for every track below.

#### Phase 3a — Affiliate referral code + Stripe promo machinery *(size: M)*
**Goal:** give every affiliate one stable ref code, the prerequisite for all self-serve attribution.
- Add `affiliates.referral_code` (UNIQUE, auto-minted on approval), `stripePromotionCodeId`, `stripeCouponId`.
- New `server/src/services/affiliate-stripe-codes.ts` lifted from CreditScore's existing `createPromoCode` (`creditscore.ts:265-324`) — mints one 0%-off-coupon-wrapped `promotion_code` per affiliate carrying `metadata[affiliate_id]`.
- `GET /me` returns `affiliate.referralCode`.
**Ships:** every affiliate has a ref code + a Stripe promo code.
**Gate:** typecheck; mint is idempotent (one promo per affiliate).

#### Phase 3b — WooCommerce shop ingest *(size: L)* — **RECOMMENDED PATH: ?ref rail (Path B)**
**Goal:** earn 30% on shop orders.
- **New `server/src/routes/shop-woocommerce.ts`**, `POST /api/shop/woocommerce/webhook`, mounted **before `express.json`** (the `app.ts:196-199` block). Auth = WooCommerce HMAC: timing-safe compare `base64(HMAC-SHA256(rawBody, WOO_WEBHOOK_SECRET))` against `x-wc-webhook-signature`; pin `x-wc-webhook-source` to `WOO_STORE_URL`. **Do NOT reuse `verifyStripeSignature`** — different scheme; unit-test against a real Woo payload.
- **New `shop_orders` table** (`external_order_id text UNIQUE NOT NULL`, `currency`, `total_cents`, `status`, `sharer_id` FK, `commission_id` FK, `refunded_cents`, timestamps) for clean refund accounting. Also finally write the reserved `shop_referral_events.event_type='purchase'` + `amountCents` rows (`shop_sharers.ts:57,65`).
- **Attribution (Path B):** storefront (`coherencedaddy-landing`) carries `?ref=<code>` into checkout as `cd_ref` order meta; webhook resolves `shop_sharers` by `referralCode → affiliateId`; mint only when `affiliateId` set AND `shared_marketing_eligible=true` (`shop-sharers.ts:157`). Pre-approval sharers get a `purchase` event but no commission.
- Mint on payment-complete (`processing`/`completed` — see open decision), `basisCents` = subtotal ex-shipping/tax (open decision), `rate=0.30` from `product_commission_rates`, `source_type='woo_shop'`, `source_event_id=order_id`, `source_ref=shop_sharers.id`, 30-day hold (covers POD returns). `onConflictDoNothing` on `commissions_source_event_uq`.
- **Refund handler:** Woo `order.refunded` → find commission by `source_event_id`, apply the same state machine (pending/approved → reversed; paid → clawed_back + `recordClawback(reason='woo_refund')`); proportional clawback on partial refunds; `notInArray` guard against re-delivery.
- **Currency:** assert `order.currency==='USD'`, else log-loud-and-skip (no FX in v1).
- Update `docs/architecture/org-structure.md:153` (remove "no webhook yet"), `docs/products/shop-sharers.md:114`, `docs/OWNERSHIP.md:46`; document `WOO_WEBHOOK_SECRET`/`WOO_STORE_URL` in env-vars + Stripe runbook.

**Cross-repo:** `coherencedaddy-landing` must carry `cd_ref` into the order (one Hostinger checkout snippet) and the Hostinger admin must register the webhook at `api.coherencedaddy.com/api/shop/woocommerce/webhook`.

#### Phase 3c — Stripe services (CreditScore, Watchtower, Bundles, Directory) *(size: XL)*
**Goal:** all four existing Stripe products commissionable via ?ref-rail (primary) + promo-code (Stripe-native fallback).
- Add `affiliate_id` + `affiliate_code` columns to `creditscore_subscriptions`, `watchtower_subscriptions`, `bundle_subscriptions` so the recurring invoice handler resolves the affiliate by subscription id (mirrors `partnerCompanies.stripeSubscriptionId`).
- Each checkout sets `allow_promotion_codes:'true'` (only CreditScore has it today, `creditscore.ts`) and accepts `?ref=CODE` → stamps `metadata[affiliate_id]`.
- Wire each existing webhook handler to call the shared writer: CreditScore (`creditscore.ts:454-557`) — one-time tier writes initial from `checkout.session.completed` (no invoice stream — writer must branch on `mode`/`billing_interval`), recurring tiers from `invoice.paid`, **add a `charge.refunded` case**; Watchtower (`watchtower-stripe-handler.ts`) recurring + refund; Bundles (`bundle-entitlements.ts:245-314`) — **add `invoice.paid` + `charge.refunded`** (currently handles only 3 events). Directory already works via `handlePartnerStripeEvent` — just route to the shared writer.
- **Mandatory Stripe dashboard step (no code substitute):** subscribe `charge.refunded` on creditscore+watchtower+directory+bundles webhooks; subscribe `invoice.paid` on watchtower+bundles. In the correct account; follow the runbook. Update the runbook event table.
- **Attribution precedence:** typed promo code wins, else `?ref` (decided in code, open decision).
- Self-serve commissions carry `lead_id=NULL` → naturally excluded from the lock-expiration cron (`affiliate-crons.ts:450`). Verify they never acquire a prospect lock.

#### Phase 3d — 100 Agents *(size: XL, blocked)*
100 Agents has **zero Stripe code** (`docs/products/geo-tactics-roadmap.md:119`). Blocked until its checkout+webhook MVP exists. Design it born commission-aware: `?ref`/promo, `metadata[affiliate_id]`, an agents subscription table with `affiliate_id`, calling the shared writer on `invoice.paid`+`charge.refunded`.

**Ships (3b–3c):** shop + four Stripe services pay commissions into the unified ledger; refunds claw back.
**Gate per sub-track:** typecheck both; refund state-machine preserves FIFO clawback netting (regression vs `directory-listings.ts:652-699`); HMAC verifier unit-tested; **dashboard event subscriptions confirmed live** (fail-loud log when a handler is reached for an unexpected event).

---

### Phase 4 — Hub UX (multi-source, read-side) *(size: L)*
**Goal:** one area where the affiliate sees blended earnings, per-source breakdown, and gets a link for every source.
- Extend `GET /me` (`affiliates.ts:342-435`) additively with `bySource[]` (change the `groupBy(status)` at `:382-389` to `groupBy(source_type, status)`) + `affiliate.referralCode`. New `GET /me/earnings-by-source`. Add `source` filter to `GET /earnings`.
- Reskin `AffiliateDashboard.tsx` hero: keep 3 blended tiles, relabel the Lifetime subtitle ("Across all programs", was `:689`), add an "Earnings by source" grid; $0 sources render muted with "Get your link →".
- **New page `ui/src/pages/AffiliateLinks.tsx`** (`/links` route in `App.tsx` `AffiliateSite()`, nav entry in `AffiliateNav.tsx` — also add the missing `/clawbacks` item): one card per source — Partner (extract the existing prospect-submit modal to a shared component, don't fork ~300 lines), Shop (?ref link + QR from `shop_sharers`), service cards (`<storefront>/<product>?ref=<code>`, copy-to-clipboard).
- `AffiliateEarnings.tsx`: add Source column (`SourcePill` driven by `affiliateSources.ts`), source filter chips, generalize "Lead" → "Reference", update empty-state copy.
- Rewrite onboarding to 4 multi-source steps; add 2 source-agnostic `POLICY_STEPS`.
- `ui/src/api/affiliates.ts`: `EarningSource` type, `source` fields on `Commission`/`AffiliateMeResponse`, new calls.
- **Storefront (`coherencedaddy-landing`) — call out, do NOT build here:** capture `?ref` on shop + service pages, forward into Stripe checkout metadata, fire the shop purchase webhook.

**Ships:** the unified hub experience.
**Gate:** typecheck UI; gate "Earnings by source" behind `bySource.length > 1` until the ledger source column is populated so it never shows a misleading all-$0 board (Rule 10). Each service card shows live vs coming-soon based on which products the backend confirms attributable (the 2026-06-17 silent-attribution lesson).

---

### Phase 5 — Payout hardening *(size: L)*
**Goal:** the single-aggregate monthly payout already works multi-source by construction (`affiliate:payout-batcher`, `affiliate-crons.ts:149-274`, groups by `affiliateId`/status, no product filter). Do NOT build a per-source payout. Harden the edges.
- **Per-source statement:** extend `GET /payouts` with a per-source breakdown (SUM by `source_type` over commissions linked by `payoutBatchId`) — "Partner $X + Shop $Y + Services $Z".
- **Clawback source tag:** widen `affiliate_clawbacks.reason` (no DDL) to record `woo_refund`/`stripe_refund`/`partner_cancel`; FIFO netting (`clawback.ts:applyClawbackRecovery`) stays unified.
- **Currency safety:** add `currency text DEFAULT 'usd'` to `commissions` + `payouts`; batcher groups by `(affiliateId, month, currency)`; widen the `payouts_affiliate_batch_uq` index to include currency (test against `payout-batcher.test.ts`). No FX in v1.
- **Activate the dormant destination columns:** `POST /me/payout-settings` writing `payoutMethod`/`payoutAccount` (currently never written), new `AffiliatePayoutSettings.tsx`. **Tokenize `payoutAccount` — never store raw bank/PayPal creds in plaintext** (currently bare text). Batcher writes `pending_destination` when no method set.
- **W-9/1099:** new `affiliate_tax_profiles` table; YTD-paid aggregate; fail-loud block on `mark-sent` for over-$600 US affiliates with no W-9. 1099 issuance out-of-band (CSV export) for v1.
- **Disclosure (no code):** unified FIFO netting means a shop refund can reduce a partner payout. Document loudly in the affiliate statement + docs.

**Ships:** source-aware statements, currency guard, self-serve payout method, tax tracking.
**Gate:** `payout-batcher.test.ts` green with the new currency-keyed index; SQL `now()`/`interval` only (Drizzle/Neon footgun).

---

### Phase 6 — Stripe Connect auto-payout *(size: L, volume-gated, LAST)*
Only after Phases 1–5 are stable. Add `affiliates.stripeConnectAccountId`; Express onboarding; replace manual `mark-sent` for connect affiliates with an idempotent (`idempotency-key = payout.id`) transfer write to `payouts.externalId`; keep manual path for ACH/PayPal/check. Connect subsumes much of Phase 5's W-9/1099 work — re-scope then. Trigger on a payout-volume/affiliate-count threshold, not calendar.

---

## Cross-Cutting Concerns

- **Idempotency (two non-overlapping keys, never unified):** Stripe rows dedupe on `commissions_stripe_invoice_uq` (existing); Woo rows on `commissions_source_event_uq` (new). Enforce in the writer: Stripe products NEVER set `source_event_id`, Woo NEVER sets `stripe_invoice_id`. Connect transfers (Phase 6) use Stripe idempotency keys.
- **Refund / clawback across Woo + Stripe:** Stripe refunds resolve commissions by `stripeInvoiceId` (`directory-listings.ts:665`); Woo refunds by `source_event_id`. Both apply the identical state machine + `recordClawback`; the FIFO netting (`clawback.ts`) is deliberately unified across all sources (one wallet). Partial refunds claw back proportionally.
- **Multi-currency:** v1 is USD-only; the `currency` column + batcher partition + log-loud-skip on non-USD orders prevent silently summing foreign cents. No FX until volume justifies it.
- **Attribution conflicts (one customer, two sources):** deterministic precedence, decided in code not averaged (Rule 6) — for Stripe services: typed promo code wins, else `?ref`. A shop order and a Stripe service are distinct `source_event_id`/`stripe_invoice_id` so they cannot collide on idempotency. If Path A (coupon plugin) is ever added alongside Path B, the ingest must pick one source of truth per order.
- **Hostinger / coherencedaddy-landing boundary (`docs/OWNERSHIP.md`):** team-dashboard owns the ledger, rate resolution, webhooks, and the hub's read/display. The storefront owns `?ref` capture, forwarding into checkout metadata, and the shop hero/share pages. Never re-fork pricing/webhook logic across repos. The hub renders links here; the destinations are served there.

---

## Open Decisions (for the user)

1. **Tier promotion from non-partner earnings?** Default = yes (unified hub) — the source-agnostic lifetime query already does this. If partner-only tiers wanted, add a `source_type` filter at `affiliate-crons.ts:621`.
2. **Service rates** — the PROPOSED column in the rate card (CreditScore 20%, Directory 10%, Watchtower 20%, Bundles 15%, Agents 20%). Confirm or edit (all admin-editable).
3. **Does CreditScore's $19 one-time pay commission**, at the same rate as its recurring tiers? (Distinguishable via `mode`/`billing_interval`.)
4. **Shop `basisCents`** — subtotal ex-shipping/tax (recommended), or include shipping/total?
5. **Mint shop commission at `processing` (payment captured) or `completed` (fulfilled)?** Recommend `completed` for POD safety; delays credit.
6. **Attribution precedence** when `?ref` and a typed promo code disagree — recommend promo-code-wins.
7. **Affiliate promo codes: real discount (e.g. 10% off) or 0%-off pure-tracking?**
8. **Bundles buyer is authenticated** — use a checkout "referred by" field instead of cookie ?ref?
9. **Payout-account storage** — processor vault token vs last-4 + internal opaque ref.
10. **1099 issuance** — CSV-for-accountant vs Stripe Tax vs defer to Connect.
11. **Minimum payout floor** — is $50 still right when a 30% cut of a $25 shirt is $7.50? Lower floor for shop-only affiliates?

---

## Effort / Size Summary

| Phase | Scope | Size |
|---|---|---|
| 0 | Merge routing fix, lock taxonomy | S |
| 1 | Generalize ledger (keystone, 2 migrations) | M |
| 2 | Rate model + rate card + admin | L |
| 3a | Affiliate ref code + promo machinery | M |
| 3b | WooCommerce shop ingest (Path B) | L |
| 3c | Four Stripe services commissionable | XL |
| 3d | 100 Agents (blocked on MVP) | XL |
| 4 | Hub UX | L |
| 5 | Payout hardening (currency, W-9, destinations) | L |
| 6 | Stripe Connect auto-payout (volume-gated) | L |

---

## Shop Path Recommendation (user requested)

**RECOMMEND Path B — our own `shop_sharers` `?ref` + QR rail — over Path A (per-affiliate WooCommerce coupon plugin).** Grounded reasoning:

1. **We already own the entire Path-B entity end-to-end:** `shop_sharers` code minting + QR (`shop_sharers.ts:21-46`), the approve-to-affiliate promotion (`services/shop-sharers.ts:121-164`), the `shared_marketing_eligible` gate (`:157`), and the reserved-but-unwritten `shop_referral_events.event_type='purchase'` + `amountCents` columns (`shop_sharers.ts:57,65`). Path B just adds the "purchase" writer the docs already anticipate (`docs/products/shop-sharers.md:114`).
2. **Single source of commission truth inside team-dashboard,** honoring the ownership boundary (`docs/OWNERSHIP.md:21`). Path A puts a second commission-of-record on Hostinger that we'd have to reconcile, plus per-affiliate coupon provisioning, an affiliate-list sync into WordPress, and a paid plugin we don't control.
3. **Both paths require the identical new WooCommerce order webhook,** so Path B is strictly less total work for the same ingest surface, and the ledger's `commissions_source_event_uq` idempotency was designed precisely for a server-authoritative order id.

Path B's one weakness is attribution robustness (cookie/ref loss at checkout). Mitigate with the `cd_ref` order-meta carry + QR/landing persistence, and **hold Path A in reserve as a coupon-code fallback only if prod data shows material leakage.**


---

# RED TEAM RISK REGISTER — Unified Affiliate Commission System (6 tracks)

**Verification stance:** Every risk below is grounded in code I read this session. Where a design track's stated current-state is *wrong* or *materially incomplete*, I flag it as a CORRECTION before the risk, because a design built on a false premise is the most dangerous failure mode. Likelihood/Impact are L/M/H.

---

## CORRECTIONS TO THE DESIGNS' STATED CURRENT-STATE (read these first)

**C1 — The partner webhook is NOT mounted before `express.json`, and it is a SHARED endpoint, not a partner endpoint.**
The shop track says to "mount the new WooCommerce webhook router BEFORE express.json so rawBody is captured (mirror app.ts:195-206)." But the partner/directory webhook it is modeling itself on is **not** in that 196-199 block. The four product webhooks (intel-billing, bundles, creditscore, watchtower) mount at `app.ts:196-199` before `express.json` and each captures its own raw body. The partner webhook mounts at **`app.ts:311` under `/api/stripe`** and relies on the **global** `express.json({verify})` rawBody (app.ts:200-206). Worse, that `/api/stripe` handler (directory-listings.ts:725-772) is a **multiplexer**: it routes `metadata.source==='partner_network'` to the commission writer, routes `directory_listings` to `svc.handleStripeEvent`, and **explicitly claims any `checkout.session.completed` whose source ≠ directory_listings and returns `{ignored:true}`** (761-765). This is load-bearing context the ledger/stripe-services tracks gloss over.

**C2 — `affiliate_clawbacks` has NO source column today.** Confirmed `reason text NOT NULL` (affiliate_clawbacks.ts:28), no `source`. The payouts track's "widen reason / add source" is genuine net-new schema, and FIFO netting (clawback.ts:108 `asc(createdAt)`) is genuinely source-blind. The "source-agnostic netting is correct" framing is a *policy choice the user has not actually ratified* — see R12.

**C3 — Bundles webhook cannot fire recurring/refund commissions even with perfect code.** Verified bundles handles only `checkout.session.completed` / `customer.subscription.updated` / `customer.subscription.deleted` (bundle-entitlements.ts:257/289/307). No `invoice.paid`, no `charge.refunded`. This is the *exact* silent-failure class the 2026-06-17 memory records ("recurring commissions NEVER fired in prod"). See R8.

**C4 — `GET /me` lifetimeCents is computed in JS, not SQL, and excludes `pending_activation`.** affiliates.ts:414 sums approved+scheduled+paid in application code (not the `bucketRows` query). The hub-ux track's claim that it can "change the existing groupBy at affiliates.ts:382-389 from groupBy(status) to groupBy(source, status)" is right about the query but the JS reduction at 395-414 must also change. Minor, but the track under-scopes it.

---

## A. LEDGER MIGRATION SAFETY (live money, no loss/double-count, don't break recurring routing)

### R1 — The 0123 "DROP NOT NULL + add CHECK" migration races the writer deploy. **Likelihood: M · Impact: H**
The ledger track's own STEP-4 risk note acknowledges the ordering hazard but **under-rates it**. The real hazard: the partner webhook (`/api/stripe`) is a *shared multiplexer* (C1). If 0123 drops `lead_id NOT NULL` and adds CHECK `(source_type='partner_network') = (lead_id IS NOT NULL)` while ANY other code path that inserts into `commissions` is still live and not source-aware, you get a **constraint-violation 500 inside a webhook handler** — and the partner handler swallows insert errors in a non-fatal try/catch (directory-listings.ts:606-611), so the commission is *silently lost*, not loud. The CHECK turns a missing-column bug into a silent money-loss bug behind a swallowed exception.
**Mitigation:** (a) Before 0123, `grep` every `insert(commissions)` site — there is exactly one today (handlePartnerStripeEvent), but the shop/stripe-services tracks add more; gate 0123 behind *all* writers being source-aware in prod. (b) Run `SELECT count(*) FROM commissions WHERE source_type IS NULL` and assert 0 immediately before 0123, in the migration itself (fail the migration, not the webhook). (c) Add the CHECK as `NOT VALID` first, then `VALIDATE CONSTRAINT` in a separate step so a bad row blocks the validate, not live inserts. (d) Make the partner writer's commission insert **fail loud** (remove the swallow, or log+alert) for the migration window so a CHECK violation is visible.

### R2 — Backfill `source_ref = lead_id` is a type/semantics trap. **Likelihood: M · Impact: M**
`commissions.lead_id` is `uuid` and `source_ref` is proposed `uuid`. Fine for partner. But the ledger track then wants `source_ref` to hold `shop_sharers.id` (uuid) AND the stripe-services track wants `source_ref` to hold "the product subscription/customer id, e.g. stripe_subscription_id" — **Stripe subscription ids are strings (`sub_...`), not uuids.** A `uuid` `source_ref` column **cannot hold `sub_...`**. The two dependent tracks have already contradicted the ledger track's column type. This is a Rule-6 conflict that will surface as a migration/insert failure.
**Mitigation:** Make `source_ref` `text`, not `uuid`. Lose the FK-to-uuid neatness but gain the ability to hold any source's native key. If you want referential integrity for the partner case, keep `lead_id` as the typed FK (you are) and treat `source_ref` as an opaque text correlation key. Decide this *before* STEP 1 — it is baked into the backfill.

### R3 — The active-attribution unique-index swap can permit double-active attribution mid-migration. **Likelihood: M · Impact: H**
The ledger track replaces `referral_attribution_active_lead_uq` (on lead_id WHERE lock_released_at IS NULL) with one on `(source_type, source_ref) WHERE lock_released_at IS NULL`. During the swap, the track says "CREATE new first, then DROP old." But the new index `(source_type, source_ref)` and old index `(lead_id)` enforce **different** uniqueness predicates. After backfill, partner rows have `source_ref = lead_id`, so the new index is equivalent *for partner rows* — **only if every active partner row has a non-null `source_ref`.** If backfill of `referral_attribution.source_ref` missed even one active row (e.g. a row created between the ADD COLUMN and the UPDATE in the same migration — non-issue if single-statement, but a real issue if the writer is live during a multi-statement migration), the new unique index has a NULL `source_ref` and Postgres treats NULLs as distinct, so **two active attributions for the same partner can coexist** → double recurring commissions on the next invoice.
**Mitigation:** Take the partner webhook offline (or pause the cron + reject /enroll) for the index swap, OR add `source_ref IS NOT NULL` to the partial predicate AND verify zero active rows have null source_ref before creating. Belt-and-suspenders: keep BOTH indexes for one release (old on lead_id, new on source_ref) so partner uniqueness is double-guarded.

### R4 — `commissions.attributionId` is NOT NULL and every non-partner source must fabricate an attribution row. **Likelihood: H · Impact: H**
The ledger track flags this in its own risks (good), but **does not solve it** — it leaves it as a "writer-contract risk for downstream tracks." That is hand-waving on the single most expensive integration point. `commissions.attributionId NOT NULL → referral_attribution` (commissions.ts:16) means a shop order or a CreditScore sale **must** create a `referral_attribution` row first. But `referral_attribution.lead_id` is ALSO `NOT NULL → partner_companies` (referral_attribution.ts:12) — so to write a shop commission you must *either* (a) also make `referral_attribution.lead_id` nullable (the track does plan this) *and* create a synthetic attribution row per shop order, OR (b) make `commissions.attributionId` nullable too. The track makes lead_id nullable but **keeps attributionId NOT NULL**, forcing option (a): every shop order and every Stripe-service sale creates a `referral_attribution` row. That pollutes the attribution table (designed for B2B prospect locks) with one row per merch sale, and those rows will be swept by the lock-expiration cron (R5).
**Mitigation:** Make `commissions.attributionId` **nullable** alongside lead_id, and only require it for `source_type='partner_network'` (extend the CHECK: attributionId follows the same partner-only rule as lead_id). Self-serve commissions carry `attributionId=NULL`. This avoids minting millions of junk attribution rows and avoids R5 entirely. The ledger track's design is *incomplete* here — flag as a required amendment.

### R5 — The lock-expiration cron will sweep synthetic shop/service attribution rows and fire bogus "lock expired" CRM emails. **Likelihood: M (H if R4 unfixed) · Impact: M**
The stripe-services track correctly identifies the `affiliate:lock-expiration` cron (affiliate-crons.ts:438-466) as partner-coupled and says self-serve rows "already fall outside that join" because they carry leadId=NULL. **But that is only true if R4 is fixed by making attributionId nullable.** If R4 is solved by minting synthetic attribution rows (the ledger track's actual plan), those rows have a `lock_expires_at` and WILL be picked up by the lock cron unless explicitly filtered. Result: an affiliate who sold a $25 shirt gets a "your lead lock expired" email.
**Mitigation:** Adopt R4's nullable-attributionId fix. If synthetic rows are unavoidable, add `source_type='partner_network'` filter to the lock-expiration cron's WHERE clause AND set `lock_expires_at` far in the future / `lock_released_at` immediately for synthetic rows.

### R6 — Drizzle `Date` param footgun is ALREADY PRESENT in the code the writers will be cloned from. **Likelihood: H · Impact: H**
The ledger track says "new product writers must use sql\`now()\`." But I verified the partner recurring writer **already passes `new Date(...)`** for `periodStart`/`periodEnd` (directory-listings.ts:588-589) and for `currentPeriodEnd` (525). Per the memory `feedback_drizzle_date_neon_pooler`, JS `Date` bound params against the prod Neon **pooler** silently fail (cost the 10-day `/admin-impersonate` 500). Any track that says "clone the proven partner writer verbatim" (stripe-services STEP 3, shop refund handler "mirror the state machine") will **propagate this footgun into 4 new products.** The partner code may be tolerated only because those particular inserts go through a path that happens to work, or because it's latently broken and nobody noticed (the recurring path was only just fixed). This is a Rule-7 "read before you write" trap baked into the reference implementation.
**Mitigation:** Before cloning, confirm whether directory-listings.ts:588-589 actually works against the prod pooler (it's in a swallowed try/catch — it may be *silently failing right now*). Convert all `new Date(epoch*1000)` to `to_timestamp(epoch)` SQL in the shared `commission-writer.ts` extraction. Make this the *first* thing the extraction fixes, not a footnote.

---

## B. DOUBLE-ATTRIBUTION (one sale → two affiliates / two sources)

### R7 — A partner who also shares a ?ref shop/service link double-earns, and nothing prevents it. **Likelihood: M · Impact: H**
This is the user's explicitly-named worst case and **no track actually closes it.** Concretely: affiliate A is a Partner-Network affiliate. A also has a shop `?ref` code and a service `?ref` code. A customer A referred as a B2B partner ALSO clicks A's shop link and buys merch. That's legitimately two sales → fine. But the dangerous variant: the **same Stripe customer** buys a CreditScore subscription, and the storefront stamps `metadata[affiliate_id]=A` via ?ref, AND that customer is *also* the partner_company A is credited for. Now one human's spend generates a partner recurring commission AND a creditscore recurring commission, both to A, both at full rate. If shop=30% and services=base, A is earning on the same customer through two ledgers with no dedup. There is **no cross-source "one commissionable event" guard** anywhere in the designs.
**Mitigation:** This may be *intended* (different products = different commissions). The real risk is the *accidental* double-count: (a) the same Stripe `checkout.session` matching both the partner multiplexer (metadata.source=partner_network) AND a service handler. Because the partner webhook at `/api/stripe` and the service webhooks are **separate Stripe endpoints**, Stripe delivers the *same event to every endpoint subscribed to it*. If a session carries `metadata.source=partner_network` AND `metadata.product=creditscore` (misconfiguration, or a partner buying CreditScore through their own link), both the partner handler and the creditscore handler fire and **both insert a commission for the same invoice** — but they dedupe on `stripe_invoice_id` via the SAME unique index (commissions_stripe_invoice_uq), so the SECOND insert is a no-op... **only if both use the same invoice id.** Initial checkout commissions have `stripe_invoice_id=NULL` for one-time, so the unique index does NOT dedupe them. **Two NULL-invoice initial commissions for one session would both succeed.** Mitigation: add `source_event_id` (the track's Woo idempotency key) to ALSO cover Stripe session id for initial commissions, and make `(source_type, source_event_id)` unique cover the checkout-session id, not just Woo orders. Define a hard precedence: a session may produce **at most one** commission across all handlers — enforce with a unique key on the session id regardless of source.

### R8 — ?ref vs typed-promo-code precedence is "decide in code" in two tracks with DIFFERENT defaults. **Likelihood: M · Impact: M**
The stripe-services track recommends **"promo-code wins, else ?ref."** The shop track and hub-ux track lean **?ref-primary.** That is a Rule-6 contradiction across tracks: if a buyer arrives via affiliate A's ?ref link but types affiliate B's promo code, services credit B, shop credits A — for the *same buyer* in one session if they buy a bundle (service) + merch (shop) together. Inconsistent precedence across surfaces is exactly how double/mis-attribution slips in.
**Mitigation:** Pick ONE global precedence rule and write it in the shared resolver, not per-track. Recommend **explicit code (promo or coupon) always wins over passive ?ref**, applied identically to shop and Stripe. Document it in one place (the rates/ledger resolver). Surface the conflict to admin (log when ?ref ≠ applied-code) rather than silently choosing.

### R9 — Stripe fan-out: every product webhook receives every event for shared event types. **Likelihood: M · Impact: H**
Verified there are 5+ separate Stripe webhook endpoints, each with its own secret, **all on the same Stripe account** (`acct_...QvkbvTR7Og`). Stripe sends each subscribed event to **all** endpoints subscribed to that type. `charge.refunded` and `invoice.paid` are account-wide, not product-scoped. Once stripe-services subscribes `charge.refunded` on the creditscore + watchtower + directory + bundles endpoints (its STEP 6), a single refund of a partner charge will be delivered to **all five** handlers. Each handler must correctly *ignore* charges that aren't theirs. The partner handler matches by `commissions.stripeInvoiceId` (directory-listings.ts:665) — if a creditscore handler ALSO matches commissions by invoice id without a source filter, two handlers race to flip the same commission row, and `decrementUnsentPayouts` could be applied **twice** (double-decrementing a payout total) if the snapshot/flip isn't atomic across handlers.
**Mitigation:** Every refund handler MUST filter by its own `source_type` when matching commissions, not just by invoice id. The `notInArray(status, ['reversed','clawed_back'])` guard (directory-listings.ts:679) protects against re-delivery to the *same* handler but NOT against two *different* handlers both processing one refund. Add `eq(commissions.source_type, '<thisproduct>')` to every refund match. Test the cross-endpoint fan-out explicitly.

---

## C. REFUND / CLAWBACK CORRECTNESS ACROSS SOURCES

### R10 — Woo refunds have no invoice id, so the entire proven refund state machine doesn't apply. **Likelihood: H · Impact: H**
The shop track says its refund handler will "apply the EXACT same state machine" as charge.refunded but "key on external order id instead of stripeInvoiceId." Verified the partner state machine (directory-listings.ts:653-699): snapshot → CASE flip → `decrementUnsentPayouts(affected)` → `recordClawback` for paid rows. **This is reusable ONLY if the shop commission row was found the same way.** The dedup for re-delivered Woo refunds depends on `notInArray(status,...)` — fine. But the bigger gap: **partial Woo refunds.** WooCommerce supports partial refunds (refund 1 of 3 line items). The partner state machine is **all-or-nothing** (it flips the whole commission to reversed/clawed_back). The shop track *acknowledges* "clawback proportional to refunded amount" in prose but the cloned state machine has **no proportional logic** — it sets status, it doesn't reduce `amountCents`. A partial refund would either claw back the *full* commission (over-claw) or nothing.
**Mitigation:** Partial refunds need a *new* code path, not a clone. Options: (a) reduce `commissions.amountCents` proportionally and record a partial clawback (but `amountCents` reduction breaks the audit trail and the `decrementUnsentPayouts` math which assumes full amount); (b) model partial refunds as a **negative adjustment commission row** (cleaner — preserves history, nets naturally in the payout batcher). Recommend (b). Do NOT pretend the all-or-nothing partner machine handles this.

### R11 — Refund arriving AFTER the 30-day hold + after payout = manual clawback, and the shop's POD return window may exceed 30 days. **Likelihood: M · Impact: M**
The shop track mints on payment-complete with a 30-day hold to cover POD returns. But Printful/Printify return/chargeback windows and customer disputes can exceed 30 days; a Stripe chargeback on the *underlying* shop payment can land 60-120 days out. After the hold expires → maturation approves → payout batcher pays → then a late refund forces `recordClawback` with a 180-day FIFO recovery window. That works mechanically, but the affiliate may have **already cashed out and churned** (no future payouts to net against) → write-off → the program eats the loss. The 30-day hold is a guess presented as safe.
**Mitigation:** Set the shop hold to the *actual* max POD return + dispute window (likely 45-60 days), not 30. Surface "held" balances distinctly so an affiliate can't be surprised. Accept that late-chargeback write-offs are a real cost line and budget for it (Rule 10: don't pretend the hold eliminates the risk).

### R12 — Cross-source FIFO netting is presented as "correct unified-wallet behavior" but is an unratified policy with dispute + possibly legal exposure. **Likelihood: H · Impact: M**
The payouts track is honest that "a Stripe-service refund can reduce a SHOP payout." But it files this under "documentation/UX, not code." Adversarially: an affiliate earns $500 in shop commissions, separately a CreditScore customer they referred refunds, and the affiliate's **shop payout is silently cut.** That is a chargeable-dispute generator and, depending on jurisdiction and the affiliate agreement wording, potentially a contractual problem (netting unrelated-product refunds against earned-and-approved commissions from a different product). The design *assumes* "one wallet" is the user's intent. **The locked decisions did NOT ratify cross-source netting** — they only set shop=30%, scope=everything, recurring=no-cap. This is the design inferring policy.
**Mitigation:** Surface as an explicit **open decision for the user**, not a doc task: "Should a refund in product X reduce an affiliate's payout earned from product Y?" If yes, the affiliate agreement (owned in coherencedaddy-landing) must say so before launch. If no, netting must become source-scoped (a much bigger change to clawback.ts). Do not ship cross-source netting on the assumption it's wanted.

### R13 — `affiliate_clawbacks` reason is free-text; loss of source provenance breaks 1099 reconciliation and dispute triage. **Likelihood: M · Impact: M**
Verified `reason text NOT NULL` with no source (C2). Once Woo + 5 Stripe products all write clawbacks, `reason='stripe_refund'` is ambiguous across creditscore/watchtower/bundles/directory. The payouts track's Phase-3 1099 reconciliation (paid minus recovered, per affiliate, per tax year) cannot attribute a recovery to a product, and admin dispute triage ("which sale caused this clawback?") requires joining back through `source_commission_id → commissions.source_type`.
**Mitigation:** Add `source_type` (or a typed `origin`) to `affiliate_clawbacks` in the same migration that adds it to commissions, populated from the source commission. Low cost now, expensive to backfill later.

---

## D. WOOCOMMERCE WEBHOOK AS A TRUST BOUNDARY

### R14 — WooCommerce HMAC is genuinely different from Stripe's and the "mirror verifyStripeSignature" framing invites a signature-bypass. **Likelihood: M · Impact: H**
The shop track correctly notes WooCommerce signs the **base64 HMAC-SHA256 of the body** in `x-wc-webhook-signature` and that you must NOT reuse `verifyStripeSignature`. Good. But the *severity* is under-stated. A spoofed/forged Woo order webhook **mints real commission money** (and a spoofed refund claws it back, or a spoofed huge-total order inflates a payout). This is a **money-minting endpoint with a hand-rolled crypto verifier** — the single highest-value attack surface in the whole design. WooCommerce HMAC pitfalls that cause silent bypass: (a) the signature is over the **exact raw bytes** Woo sent — any body re-serialization (which `express.json` does) breaks it, so the rawBody capture (R-C1) must be correct for THIS router; (b) timing-unsafe string compare; (c) accepting requests when the secret env var is unset (the directory webhook returns 503 if no secret — copy that, don't default-allow); (d) WooCommerce also does NOT include a **timestamp**, so there is no native replay protection (unlike Stripe's 300s tolerance).
**Mitigation:** (a) Mount the Woo router in the `app.ts:196-199` pre-`express.json` group with its OWN `express.raw` body, NOT under `/api/stripe`. (b) `crypto.timingSafeEqual`. (c) Hard-fail (503) if `WOO_WEBHOOK_SECRET` unset — never default-allow. (d) **Add explicit replay protection** since Woo gives none: dedup on Woo order id (the design has this) BUT also reject orders whose Woo `date_modified` is older than N minutes, OR store processed webhook delivery ids. (e) Pin `x-wc-webhook-source` to `WOO_STORE_URL`. (f) Unit-test against a *real* captured Woo payload, and add a test that a 1-byte mutation fails verification.

### R15 — Spoofed-order amount drives commission basis with no server-side price authority. **Likelihood: M · Impact: H**
Even with valid HMAC (e.g., a compromised Woo secret, or Hostinger-side compromise — and per memory, this ecosystem has *already had* a VPS compromise + XMRig in 2026-05), the order total in the webhook payload is **the only source of the commission basis**. team-dashboard has no independent price authority for shop SKUs (those live in WooCommerce/Printful). A manipulated order total → inflated 30% commission. Unlike Stripe products (where price ids are server-controlled), the shop has **no server-truth price to validate against.**
**Mitigation:** (a) Cap per-order commission basis at a sane ceiling and alert on outliers. (b) The reconciliation pull (the track's "safety net") should be promoted from optional to **a fraud control**: periodically pull orders from the WooCommerce REST API and assert the webhook-reported totals match the API totals before *approving* (not before minting) the commission — the 30-day hold gives time for this. (c) Rotate `WOO_WEBHOOK_SECRET` on any Hostinger incident.

### R16 — Dropped Woo webhook = missing commission, and there is no delivery guarantee. **Likelihood: M · Impact: M**
The shop track flags this. Confirmed there is no retry infra. WooCommerce webhook delivery is best-effort; a dropped `order.completed` silently under-pays an affiliate (the inverse of the partner program's just-fixed silent-under-pay — same failure family, per memory).
**Mitigation:** The reconciliation pull (R15) doubles as the gap-filler. Make it mandatory for v1, not "only if reliability proves insufficient." Idempotent ingest makes a re-pull safe.

---

## E. MULTI-CURRENCY

### R17 — Zero currency columns + integer cents = silent FX corruption the moment a non-USD order arrives. **Likelihood: L (if shop is USD-only) / H (if not) · Impact: H**
Verified: no `currency` column anywhere in commissions/payouts/affiliates/shop schemas. The payouts track's guard is correct but the **likelihood depends entirely on an unverified premise** — "the shop is USD-only today." Hostinger WooCommerce + Printful/Printify routinely sell internationally; if even one EUR order lands, `amount_cents` sums 100 EUR-cents as 100 USD-cents into a payout. This is silent and uncapped.
**Mitigation:** Add `currency text NOT NULL DEFAULT 'usd'` to commissions + payouts **before any shop commission writes**, not in a later phase. The batcher's unique index `payouts_affiliate_batch_uq` must include currency (one payout per affiliate/month/currency) — and that index change must be tested against `payout-batcher.test.ts` (R22). For v1, **assert `order.currency==='usd'` in the Woo ingest and loud-skip + alert otherwise** (Rule 10) — do not silently coerce. Confirm with the user whether the shop actually restricts to USD; if not, this jumps to High likelihood.

### R18 — Stripe products can also be multi-currency. **Likelihood: L · Impact: M**
The currency risk is framed as shop-only, but Stripe Checkout can present localized currencies if the prices are configured that way. CreditScore/Watchtower invoices carry their own currency. If any Stripe price is multi-currency, the same integer-cents corruption applies to service commissions.
**Mitigation:** Read `currency` off the Stripe invoice/charge object in every service writer and store it. Same USD-assert-and-alert guard.

---

## F. HOSTINGER BOUNDARY (we don't control the Woo/Printify side)

### R19 — The ?ref→`cd_ref` order-meta carry depends entirely on a cross-repo + WordPress change we can't enforce or test from here. **Likelihood: H · Impact: H**
The shop track's recommended Path B hinges on the storefront (coherencedaddy-landing) + WooCommerce checkout reliably writing `cd_ref` into order meta. We own neither. If the WordPress checkout snippet is mis-installed, dropped on a theme update, or stripped by a caching plugin, **every shop order is unattributed and silently earns nobody** — the precise failure the 2026-06-17 memory records for the partner program (attribution unwired in prod, commissions silently $0). The hub-ux track even flags this self-aware risk. The Hostinger side is a black box on a host that was compromised within the last 6 weeks.
**Mitigation:** (a) Instrument loudly: a dashboard metric for "shop orders received vs shop orders with cd_ref present" — alert if attribution rate drops. (b) Reconciliation pull (R15/16) can recover `cd_ref` from the order meta even if the webhook is lossy. (c) Do NOT show affiliates a "Shop link" in the hub until the backend has *confirmed* at least one end-to-end attributed test order (hub-ux's "live vs coming soon" state — make it gated on real data, not optimism). (d) Treat Path-A coupon fallback as a genuine contingency, pre-scoped, not "shelved."

### R20 — Printful/Printify fulfillment cancellations arrive on a timeline and shape we don't control and may not even receive. **Likelihood: M · Impact: M**
The shop track mints on payment-complete and relies on a `order.cancelled` webhook arriving within the hold to reverse. But provider-initiated cancellations (out-of-stock, print failure) flow Printful→WooCommerce→(maybe)→us. If WooCommerce doesn't emit an order status change we're subscribed to, or emits a status we don't map, the reversal never fires and we pay commission on an unfulfilled order.
**Mitigation:** Enumerate the *exact* WooCommerce status transitions for provider cancellations (requires Hostinger-side investigation — flag as a prerequisite, not an assumption). Subscribe to `order.updated` broadly and map ALL terminal-negative statuses (cancelled, failed, refunded) to reversal. The reconciliation pull catches what webhooks miss.

---

## G. CROSS-CUTTING / SECOND-ORDER

### R21 — Tier math silently changes the moment any non-partner commission writes, raising the PARTNER base rate for everyone near a threshold. **Likelihood: H · Impact: M**
Verified `lifetimeCents` (affiliate-crons.ts:617-627) is source-agnostic — it sums ALL commissions by affiliateId. The ledger track says "no code change needed; document it." But the **rates track** notes the second-order effect the ledger track misses: because the tier cron writes `affiliates.commissionRate = matched.commissionRate` (affiliate-crons.ts:665), and that column is the JOINed rate source for **partner** commissions (directory-listings.ts:548), a shop-heavy affiliate crossing a lifetime threshold gets **promoted, which raises their PARTNER recurring rate.** So shop earnings silently inflate partner payouts. This is a money change disguised as a "documentation" item. The two tracks **contradict** (ledger: "no change, intended"; rates: "confirm with user, it's a cost"). Rule 6: surface, don't average.
**Mitigation:** This is a user decision (locked decisions are silent on it). Either (a) tier qualification counts only `source_type='partner_network'` (add the filter the ledger track explicitly says NOT to add), or (b) decouple rate from tier (the rates track's STEP 5) so promotion doesn't retro-bump the partner rate. Recommend (b) — it's the rates track's plan and resolves the contradiction. The ledger track's "leave the cron alone" guidance is **unsafe** if rate stays coupled to tier.

### R22 — Changing `payouts_affiliate_batch_uq` to include currency can break the batcher idempotency it depends on. **Likelihood: M · Impact: H**
The payouts track flags this but it deserves elevation: the monthly batcher relies on `onConflictDoNothing` against `payouts_affiliate_batch_uq` to be idempotent (re-running the cron in a month doesn't double-create payouts). Adding `currency` to that index changes its conflict target; if the batcher's `onConflict` clause isn't updated in lockstep, **either the cron starts creating duplicate payouts (double-pay) or the migration's index swap drops idempotency for the window.**
**Mitigation:** Migrate the index and the `onConflictDoNothing` target in the same deploy; run `payout-batcher.test.ts` against the new index; add a test that double-running the batcher in one month is still a no-op with the currency dimension.

### R23 — `commissions.attributionId` and the hub `lifetimeCents` mismatch will surface inconsistent numbers to affiliates. **Likelihood: M · Impact: L**
Verified two *different* lifetime definitions already exist: the tier cron counts paid+approved+scheduled (617-627), but `GET /me` computes `lifetimeCents = approved+scheduled+paid` in JS (414) — these happen to match today. The hub-ux track adds a *third* per-source aggregation. Three independent SUM definitions of "lifetime" across cron, /me, and the new bySource endpoint will drift (e.g. one includes `pending_activation`, one doesn't).
**Mitigation:** Centralize the "what counts as lifetime earnings" predicate in one shared SQL fragment used by all three. Don't let the hub-ux track invent a fourth.

### R24 — Per-affiliate Stripe promotion_code minting (stripe-services STEP 1) creates N Stripe objects on the WRONG account if run via CLI. **Likelihood: M · Impact: M**
Per memory `reference_stripe_accounts`: the Stripe CLI is authed to the WRONG account; all CD products live in `acct_...QvkbvTR7Og` via the `.env` key. The stripe-services track plans to mint one promotion_code per affiliate (lazily). If any automation or one-off provisioning uses the CLI, codes land in the wrong account and silently never apply. Also: minting a coupon+promotion_code **per affiliate** at scale hits Stripe object limits and clutters the dashboard; a 0%-off "tracking-only" coupon is, as the track admits, a hack.
**Mitigation:** Mint via the `.env` key only (follow stripe-runbook). Prefer **?ref metadata pass-through as primary** (which needs zero Stripe objects) and reserve promo-codes for the WooCommerce shop where ?ref-into-Checkout isn't possible. Reconsider whether per-affiliate Stripe codes are needed at all for the Stripe products — they mostly aren't if ?ref works.

### R25 — Plaintext `payoutAccount` write path is a breach risk on a previously-compromised infrastructure. **Likelihood: M · Impact: H**
The payouts track flags this. Elevating because of the memory: this ecosystem had a real VPS compromise (XMRig, 2026-05-08). Activating a write path that stores bank/PayPal details in Neon as plaintext on infra with a compromise history is a serious exposure.
**Mitigation:** Never store raw payout credentials. Tokenize (last-4 + processor vault reference) or defer the whole destination-capture phase until Stripe Connect (Phase 4) handles KYC + payout details off our DB entirely. Hard gate Phase 2 on this.

---

## SUMMARY — Top 5 must-fix-before-any-code

1. **R4 + R5:** Make `commissions.attributionId` nullable (partner-only via CHECK), or you mint junk attribution rows and trigger bogus CRM emails. The ledger track is *incomplete* here.
2. **R2:** `source_ref` must be `text`, not `uuid` — Stripe subscription ids aren't uuids. Two dependent tracks already contradict the ledger track's column type.
3. **R7 + R9:** Add a per-checkout-session unique idempotency key covering NULL-invoice initial commissions, and source-filter every refund handler — the multi-endpoint Stripe fan-out + shared invoice-id dedup has a double-insert hole for one-time/initial commissions.
4. **R14 + R15:** The Woo webhook is a money-minting endpoint with hand-rolled crypto, no native replay protection, and no server-side price authority, on a host with a compromise history. Mount it correctly (pre-`express.json`, own raw body, NOT under `/api/stripe`), add replay protection, and make the reconciliation pull a mandatory fraud control.
5. **R6:** The reference partner writer it's all being cloned from **already contains the Drizzle-Date-Neon-pooler footgun** (directory-listings.ts:588-589) inside a swallowed try/catch — it may be silently broken in prod right now. Verify it works against the pooler before cloning it into 4 products.

**Unratified policy decisions masquerading as design (escalate to user):** R12 (cross-source refund netting), R21 (non-partner earnings raising partner tier rate), R17 (is the shop actually USD-only?). The locked decisions do not cover these and the tracks disagree among themselves.

**Files cited (all `/Users/exe/Downloads/Claude/team-dashboard/`):** `packages/db/src/schema/commissions.ts:15-16,42-44`; `referral_attribution.ts:12,36-38`; `shop_sharers.ts:32,56,65`; `affiliate_clawbacks.ts:28`; `server/src/routes/directory-listings.ts:36-52,531-532,548,588-589,606-611,640-712,725-772`; `server/src/services/affiliate-crons.ts:617-627,632-644,665`; `server/src/services/clawback.ts:48,108`; `server/src/services/payout-adjust.ts:31-67`; `server/src/services/shop-sharers.ts:208`; `server/src/services/creditscore.ts:143,151,478,501`; `server/src/services/bundle-entitlements.ts:257,289,307`; `server/src/routes/affiliates.ts:342-435`; `server/src/app.ts:196-206,311`.
