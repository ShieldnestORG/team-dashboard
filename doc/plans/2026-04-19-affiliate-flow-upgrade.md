# Affiliate Flow Upgrade — Implementation Plan

**Date:** 2026-04-19
**Spec:** [docs/guides/affiliate-system-upgraded.md](../../docs/guides/affiliate-system-upgraded.md)
**Current baseline:** [docs/guides/affiliate-user-journeys.md](../../docs/guides/affiliate-user-journeys.md)

Takes the affiliate program from "refer and hope" (today: registration, prospect submission, `is_paying` flag) to a full partner revenue system with attribution, lock windows, CRM pipeline, commission state machine, payouts, and engagement.

---

## Baseline vs. Target

| Area | Today | Target |
|---|---|---|
| Affiliate fields | status, commissionRate, totalEarned | + tier, policy_accepted_at, payout_method, payout_account, violation_count, promo_opt_in |
| Prospect model | `partner_companies` w/ affiliateId, isPaying, convertedAt, monthlyFee | + pipeline_stage, fit_score, priority_score, duplicate_status, assigned_rep, close_type |
| Attribution | implicit (affiliateId column) | explicit `referral_attribution` rows w/ lock window, first-touch, warmth, close-path, override |
| Commissions | computed in-memory (`monthlyFee × commissionRate`) | `commissions` table w/ state machine: PendingActivation → Approved → Scheduled → Paid / Reversed |
| Payouts | none | `payouts` table, monthly batch, threshold, hold period |
| CRM stages | `partner_companies.status` | full lead-status enum + `crm_activity` timeline |
| Admin surface | approve / suspend | review queue, duplicate resolver, pipeline board, attribution manager, commission approval, payout mgmt, policy panel |
| Affiliate surface | dashboard + prospect detail | + first-touch form, close-path selector, pipeline visibility, earnings breakdown, tier progress, promo/leaderboard |
| Emails | 4 templates | ~15 templates (lead contacted, demo scheduled, proposal, won/lost, commission created/approved, payout sent, tier unlock, violation) |
| Crons | `affiliate:pending-digest` | + lock expiry sweeper, commission maturation, payout batcher, inactive-affiliate re-engage, leaderboard refresh |
| Webhook | `is_paying=true` on checkout | + create commission row, create recurring commission on each invoice, reverse on refund |

---

## Phase 1 — Foundation (attribution + lead lock)

Unlocks everything downstream; must ship first.

### 1.1 Schema migrations (`packages/db/src/schema/`)
- **New:** `referral_attribution` table (attribution_id, lead_id FK → partner_companies, affiliate_id FK, attribution_type enum, lock_start_at, lock_expires_at, first_touch_logged, first_touch_type, first_touch_date, relationship_warmth, affiliate_close_preference, admin_override, override_reason).
- **Extend:** `affiliates` — add `policy_accepted_at`, `affiliate_tier`, `payout_method`, `payout_account`, `violation_count`, `promo_opt_in`.
- **Extend:** `partner_companies` — add `pipeline_stage` enum, `fit_score`, `priority_score`, `duplicate_status`, `assigned_rep`, `close_type`.
- **Backfill:** existing `partner_companies.affiliateId` rows → one `referral_attribution` row each, `attribution_type='affiliate_referred_cd_closed'`, lock fields null (grandfathered).

### 1.2 Submission endpoint (`server/src/routes/affiliates.ts` — `POST /prospects`)
- Accept optional payload: `firstTouch {status, type, date, warmth}`, `closePath` ('cd'|'shared'|'affiliate').
- On validated insert, create `referral_attribution` row with `lock_start_at = now()`, `lock_expires_at = now() + 30d`.
- Duplicate check becomes: valid-lock attribution for same normalized website blocks other affiliates (existing 409), but allows admin override.

### 1.3 Policy acceptance
- Add `/api/affiliates/accept-policy` route; gate first prospect submission until accepted.
- Policy copy block on affiliate onboarding screen (`ui/src/pages/AffiliateLanding.tsx`) with the misrepresentation rules.

### 1.4 Lock expiry cron
- Add `affiliate:lock-expiry` to `server/src/services/affiliate-crons.ts` — daily sweep, release attribution on expired locks with no conversion.

**Exit:** new submission captures first-touch + close-path; duplicate protection is attribution-backed; policy acceptance enforced.

---

## Phase 2 — Commissions + payouts

### 2.1 Schema
- **New:** `commissions` (id, affiliate_id, lead_id, client_id, type, rate, period_start, period_end, amount, status enum, payout_batch_id, clawback_reason).
- **New:** `payouts` (id, affiliate_id, amount, status, method, date, batch_month).

### 2.2 Stripe webhook (`server/src/routes/directory-listings.ts:309-410`)
- On `checkout.session.completed` (line 344): after setting `is_paying=true`, look up active attribution for the lead; insert `commission` row `status='pending_activation'`.
- On `invoice.payment_succeeded` (line 383): insert new monthly recurring `commission` row.
- On refund events: mark matching commission `status='reversed'` if within refund window.

### 2.3 State machine cron
- New `affiliate:commission-maturation` cron — moves pending_activation → approved after hold period (default 30d); moves approved → scheduled_for_payout at cycle boundary.
- New `affiliate:payout-batcher` — monthly batch creates `payouts` row for each affiliate above threshold, marks commissions `paid`.

### 2.4 Affiliate dashboard (`ui/src/pages/AffiliateDashboard.tsx`, `ui/src/api/affiliates.ts`)
- Replace in-memory `estimatedEarned` with real buckets: pending, approved, scheduled, paid, lifetime.
- New `/earnings` subroute with commission-level timeline.
- New `/payouts` subroute with `payouts` history.

### 2.5 Admin commission + payout panels (`ui/src/pages/AffiliatesAdmin.tsx`)
- New `CommissionApproval.tsx` — approve / hold / reverse.
- New `PayoutManagement.tsx` — view batches, mark sent, record payout method.

### 2.6 Emails (`server/src/services/email-templates.ts`)
- Add: `commission-created`, `commission-approved`, `payout-sent`, `payout-held`.

**Exit:** commissions flow end-to-end from Stripe event to payout record; affiliate sees real numbers by state.

---

## Phase 3 — CRM pipeline + shared close

### 3.1 Schema
- **New:** `crm_activity` (id, lead_id, actor_type, actor_id, activity_type, note, timestamp, visible_to_affiliate, visible_internal_only).
- Expand `pipeline_stage` enum to full lead-status list (Draft … Expired).

### 3.2 Admin CRM board
- New `ui/src/pages/LeadsAdmin.tsx` — kanban by pipeline_stage, filters by attribution_type, assigned_rep, warmth.
- New `LeadDetailAdmin.tsx` — activity timeline, attribution manager (override w/ reason), duplicate resolver, assign rep, flip close_type.

### 3.3 Affiliate pipeline visibility (`ui/src/pages/AffiliateProspectDetail.tsx`)
- Show current `pipeline_stage` + admin-facing activity filtered to `visible_to_affiliate=true`.
- Follow-up note submission writes to `crm_activity` as `actor_type='affiliate'`.

### 3.4 Attribution rules service
- `server/src/services/attribution.ts` — single source of truth for attribution decisions (first-valid wins, warm upgrades, override trail). Called by admin panel + submission endpoint.

### 3.5 Emails
- Add: `lead-contacted`, `lead-demo-scheduled`, `lead-proposal-sent`, `lead-won`, `lead-lost`, `lead-nurture`.
- Triggered by `pipeline_stage` transitions via activity log.

### 3.6 Admin notifications
- Warm-lead-submitted, duplicate-conflict, affiliate-led-close-flagged, inactive-lead, commission-dispute, policy-violation — either in-app inbox or email.

**Exit:** CRM activity is captured per lead; affiliates see visible updates; attribution conflicts resolved through a rules engine.

---

## Phase 4 — Engagement + compliance

### 4.1 Schema
- **New:** `engagement` (id, affiliate_id, campaign_id, post_url, hashtag_used, score, giveaway_eligible).
- **New:** `policy_violations` (id, affiliate_id, flagged_text, severity, resolved_at, resolution_note).

### 4.2 Tiers + leaderboard
- Tier logic in `server/src/services/affiliate-tiers.ts` — compute from `active_partner_count`, `lifetime_earnings`. Surface next-tier progress on dashboard.
- Monthly `affiliate:leaderboard-refresh` cron.
- `ui/src/pages/AffiliateLeaderboard.tsx` + admin leaderboard/giveaway management.

### 4.3 Promo merch loop
- Merch request endpoint + affiliate UI for starter shirt / brand kit.
- `ui/src/pages/AffiliateBrandKit.tsx` — downloadable assets, post hashtag, submit engagement URL.

### 4.4 Compliance
- Heuristic scan on affiliate notes (`crm_activity` where `actor_type='affiliate'`) for forbidden promise keywords (pricing, discount, guarantee, exclusive).
- Admin `PolicyViolationPanel.tsx` — review flagged activity, warn / suspend.
- Affiliate violation_count exposed on admin directory; auto-suspend threshold configurable.

### 4.5 Re-engagement
- `affiliate:inactive-reengage` cron — affiliates with no submissions in 60d get nudge email + "your tier will drop" warning.

**Exit:** retention loop (merch, tiers, leaderboard, giveaways) running; compliance automations flag risky behavior.

---

## Cross-cutting work

### Type checking
Per [CLAUDE.md](../../CLAUDE.md): after each phase, run
```
npx tsc --noEmit --project server/tsconfig.json
cd ui && npx tsc --noEmit
```

### Branch strategy
Each phase lands on its own feature branch. Schema migrations ship ahead of code that depends on them (two-phase deploy: migrate → deploy service).

### Structure diagram
After Phase 1 and Phase 3 add new backend routes, update `ui/src/pages/Structure.tsx` fallback + persisted diagram per the structure-diagram rule in CLAUDE.md.

### Docs to keep in sync
- `docs/guides/affiliate-user-journeys.md` — add a note at top pointing to the upgraded spec.
- `docs/guides/admin-affiliate-testing.md` — extend with phases 2–4 test flows as each ships.
- `docs/api/partners.md` — update schema sections when `partner_companies` gets new columns.
- `docs/operations/cron-inventory.md` — register each new cron.

---

## Risks / open questions

1. **Grandfathering.** Existing affiliates have no policy_accepted_at. Force acceptance on next login or grandfather them? Recommend: force re-acceptance, one modal, to establish the legal record.
2. **Commission recompute on historical.** Switching from computed earnings to ledger means a one-time backfill of `commissions` from historical `is_paying=true` rows and their Stripe invoice history. Decide: start fresh (ledger only covers new events) or backfill.
3. **Refund window definition.** Spec says "first 30 days" refund protection. Need Stripe metadata to track the subscription start so we can compute the hold window correctly.
4. **Lock window edge cases.** What happens when a lead expires during active CD outreach? Auto-extend vs. notify admin. Recommend: auto-extend while `pipeline_stage` is past `Contacted`; otherwise release.
5. **Visibility rules.** Affiliate-facing vs. internal-only notes need a clear default. Recommend: default to `visible_to_affiliate=false` for admin notes, opt-in per note.

---

## Suggested order of delivery

Ship Phase 1 and the schema for Phase 2 together (they're tightly coupled). Phases 3 and 4 can parallelize once Phase 2 is stable.
