# Affiliate Phase 3 — CRM Pipeline + Shared-Close Attribution

**Date:** 2026-04-20
**Depends on:** [Phase 2](2026-04-19-affiliate-phase-2-commissions.md) (commission ledger + payouts)
**Spec:** [affiliate-system-upgraded.md](../../docs/guides/affiliate-system-upgraded.md)

Turns the lead record from a two-state flag (`trial` / `isPaying`) into a full CRM pipeline, and activates the attribution-type branching that Phase 1 only wrote as a column default (`affiliate_referred_cd_closed` on every row). Also retires the legacy `estimatedEarned` in-memory calc that Phase 2 replaced but still ships on the affiliate dashboard.

---

## Goals

1. Real CRM pipeline stages on leads, visible to both admin + affiliate (with redaction rules).
2. All 5 attribution types live and assignable: `affiliate_referred_cd_closed`, `affiliate_assisted_cd_closed`, `affiliate_led_cd_finalized`, `cd_direct`, `admin_override`.
3. First-touch logging wired into the lead submission form (schema exists on `referral_attribution` — Phase 1 left it unused).
4. Admin attribution-dispute console — resolve duplicates, override ownership, transfer lock, all with recorded reason + audit.
5. Remove `estimatedEarned` from every response and replace with Phase-2 bucket totals.

---

## Schema (`packages/db/src/schema/`)

### Extend: `partners.ts` (`partner_companies`)

Adds pipeline state to the existing lead row. Keep `status` (`trial`/`active`/`churned`) for billing; add `leadStatus` for sales.

```ts
leadStatus: text("lead_status").notNull().default("submitted"),
// Draft · Submitted · Enriched · DuplicateReview · Qualified · Rejected ·
// Locked · Assigned · Contacted · AwaitingResponse · Interested ·
// DemoScheduled · ProposalSent · Negotiation · Won · Lost · Nurture · Expired
assignedRepId: uuid("assigned_rep_id"),          // FK → auth_users.id, nullable
pipelineEnteredAt: timestamp("pipeline_entered_at", { withTimezone: true }),
lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
```

Index: `partner_companies_lead_status_idx ON (company_id, lead_status)`.

### New: `crm_activities.ts`

One row per CRM event. Drives both the lead timeline and affiliate-visible activity feed.

```ts
export const crmActivities = pgTable("crm_activities", {
  id: uuid().primaryKey().defaultRandom(),
  leadId: uuid().notNull().references(() => partnerCompanies.id, { onDelete: "cascade" }),
  actorType: text().notNull(),          // "admin" | "affiliate" | "system" | "owner"
  actorId: uuid(),                      // auth_users.id OR affiliates.id, nullable for system
  activityType: text().notNull(),       // "status_change" | "note" | "contact_attempt" |
                                        // "demo_booked" | "proposal_sent" | "attribution_change"
  fromStatus: text(),
  toStatus: text(),
  note: text(),
  visibleToAffiliate: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadCreatedIdx: index().on(t.leadId, t.createdAt),
  actorIdx: index().on(t.actorType, t.actorId),
}));
```

### Extend: `referral_attribution.ts`

Already has `attributionType`, `firstTouchLogged`, `firstTouchType`, `firstTouchDate`, `firstTouchNotes`, `relationshipWarmth`, `affiliateClosePreference`, `adminOverride`, `overrideReason` (see `packages/db/src/schema/referral_attribution.ts:8-42`). No new columns needed — Phase 3 just starts **writing** to them.

### New: `attribution_overrides.ts`

Audit trail for admin overrides. Keeps the live `referral_attribution` row clean and gives us dispute history.

```ts
export const attributionOverrides = pgTable("attribution_overrides", {
  id: uuid().primaryKey().defaultRandom(),
  leadId: uuid().notNull().references(() => partnerCompanies.id),
  previousAttributionId: uuid().references(() => referralAttribution.id),
  newAttributionId: uuid().references(() => referralAttribution.id),
  previousAffiliateId: uuid().references(() => affiliates.id),
  newAffiliateId: uuid().references(() => affiliates.id),
  overrideType: text().notNull(),  // "transfer" | "release" | "type_change" | "duplicate_resolution"
  reason: text().notNull(),
  overriddenByUserId: uuid().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  leadIdx: index().on(t.leadId),
  overriddenByIdx: index().on(t.overriddenByUserId),
}));
```

### Migration: `0084_affiliate_crm.sql`

Additive + idempotent, applied to prod Neon via psql (same pattern as `0082`, `0083`).

- `ALTER TABLE partner_companies ADD COLUMN IF NOT EXISTS lead_status … DEFAULT 'submitted'`
- Backfill: `UPDATE partner_companies SET lead_status = CASE WHEN is_paying THEN 'won' WHEN subscription_status = 'canceled' THEN 'lost' ELSE 'submitted' END WHERE lead_status = 'submitted'` (guarded by `WHERE …` to be safely re-runnable — only touches default-value rows).
- `CREATE TABLE IF NOT EXISTS crm_activities …`
- `CREATE TABLE IF NOT EXISTS attribution_overrides …`
- Indexes with `IF NOT EXISTS`.

---

## Routes (`server/src/routes/`)

### Extend: `affiliates.ts`

**`POST /api/affiliates/leads`** (existing submission endpoint) — accept first-touch payload:
```ts
firstTouchStatus?: boolean;
firstTouchType?: "in_person" | "call" | "text" | "email" | "social_dm";
firstTouchDate?: string;          // ISO
firstTouchNotes?: string;
relationshipWarmth?: "strong" | "medium" | "weak";
closePreference?: "cd_closes" | "affiliate_assists" | "affiliate_attempts_first";
```
Write these onto the `referralAttribution` row created during submission. If `closePreference === "affiliate_attempts_first"`, emit admin notification (reuses `sendTransactional` from email-templates).

**`GET /api/affiliates/leads/:id/timeline`** — returns `crmActivities` filtered by `visibleToAffiliate = true`, ordered by `createdAt DESC`. 404 if lead is not on an attribution row owned by the requesting affiliate.

**`GET /api/affiliates/leads/:id`** — extend existing response with `leadStatus`, `lastActivityAt`, pipeline stage label. Never return admin-only notes or internal CRM notes (those are `visibleToAffiliate = false`).

### New: admin CRM endpoints under `affiliateAdminRoutes` (`/api/affiliates/admin`)

- `GET /leads` — paginated, filters: `leadStatus`, `assignedRepId`, `affiliateId`, `attributionType`.
- `PUT /leads/:id/status` — body `{ toStatus, note? }`. Transactional: update `partner_companies.leadStatus` + insert `crmActivities` row. 409 on invalid transition (define allowed transitions in a `const STATUS_TRANSITIONS: Record<Status, Status[]>`).
- `PUT /leads/:id/assign` — body `{ repId }`. Writes `assignedRepId` + activity.
- `POST /leads/:id/notes` — body `{ note, visibleToAffiliate }`. Activity-only write.
- `PUT /leads/:id/attribution` — body `{ attributionType, reason }`. Updates `referralAttribution.attributionType` and inserts `attributionOverrides` row. When changing from referred → assisted/led, this is the signal that Phase 2's commission creator (`server/src/routes/directory-listings.ts` webhook) should use for future commissions — but existing commissions are NOT re-rated. Document this explicitly.
- `POST /leads/:id/transfer` — body `{ newAffiliateId, reason }`. Transaction: mark old `referralAttribution.lockReleasedAt = NOW()`, insert new `referralAttribution` row with same `leadId` (partial-unique index on `lock_released_at IS NULL` guarantees exactly one active owner), insert `attributionOverrides` row.
- `POST /leads/:id/duplicate-resolve` — resolves Phase 1's `duplicate_review` state by picking winner affiliate + releasing loser's lock.

All admin endpoints require `requireCompanyAdmin` middleware (same pattern as Phase 2 admin payouts).

### Extend: `server/src/routes/directory-listings.ts`

In the `checkout.session.completed` commission insert (existing Phase-2 block), pull `attributionType` from `referralAttribution` and choose rate from a lookup:

```ts
const RATE_BY_ATTRIBUTION: Record<string, string> = {
  affiliate_referred_cd_closed: affiliate.commissionRate,        // default rate
  affiliate_assisted_cd_closed: affiliate.commissionRate,        // same — affiliate still does work
  affiliate_led_cd_finalized:   String(Number(affiliate.commissionRate) * 1.25),  // bonus for leading
  cd_direct:                    "0",                              // skip insert
  admin_override:               affiliate.commissionRate,
};
```
If rate is `"0"`, skip the insert entirely (log + return). This replaces the single-rate assumption in Phase 2's webhook.

---

## Crons (`server/src/services/affiliate-crons.ts`)

### New: `affiliate:lead-expiration` (daily, `30 3 * * *` UTC)

Leads stuck in non-terminal stages too long expire to `nurture` or `expired`.
- `Submitted` > 7 days → `Expired` (affiliate never followed up, no admin review).
- `DemoScheduled` with `lastActivityAt` > 14 days → `Nurture`.
- `ProposalSent` > 30 days → `Nurture`.
Each transition writes a `crmActivities` row with `actorType = "system"`.

### New: `affiliate:lock-expiration` (daily, `45 3 * * *` UTC)

When `referralAttribution.lockExpiresAt < NOW()` AND lead has not progressed past `Qualified`:
- Set `lockReleasedAt = NOW()` on the attribution row.
- Insert `crmActivities` row `actorType = "system", activityType = "lock_expired"`.
- Emit affiliate email (`buildAffiliateLockExpired`).

---

## UI (`ui/src/`)

### Extend: `pages/AffiliateDashboard.tsx`

**Remove** the `estimatedEarned` display card and any fallback calculation. The bucket row from Phase 2 (`Pending` / `Approved` / `Scheduled` / `Paid` / `Lifetime`) is now authoritative. Search/replace every `estimatedEarned` reference — api types (`ui/src/api/affiliates.ts`), route handler (`server/src/routes/affiliates.ts`), test fixtures.

### Extend: `pages/AffiliateLeadForm.tsx` (new or existing submission form)

Add first-touch fieldset:
- Radio: "Already spoken with owner?" (yes/no) — expands when yes.
- Select: contact type · datepicker · warmth radio · textarea for notes.
- Close preference radio (3 options). Copy matches spec §3 (CD-first recommendation).

### New: `pages/AffiliateLeadDetail.tsx`

Timeline of activities (affiliate-visible only) + current pipeline stage pill + CD notes if `visibleToAffiliate = true`. No admin-only data.

### New: `pages/AffiliateAdminLeads.tsx` (admin CRM board)

Kanban-style columns per `leadStatus`. Drag to transition (hits `PUT /leads/:id/status`). Lead card shows affiliate name, attribution type badge, days-in-stage. Hover → quick actions (reassign, add note, view full).

### New: `pages/AffiliateAdminLeadDetail.tsx`

All activities (incl. internal), first-touch info, attribution history from `attribution_overrides`, action panel (transfer, override, resolve duplicate).

### Extend: `components/AffiliateAdminTabs.tsx`

Add `Leads` and `Attribution` tabs alongside existing `Affiliates` / `Commissions` / `Payouts`.

### Routes: `App.tsx`

- `/admin/affiliates/leads` + `/admin/affiliates/leads/:id` (admin board + detail)
- `/admin/affiliates/attribution` (dispute queue — filter `leadStatus = 'DuplicateReview'`)
- `/affiliate/leads/:id` (affiliate-facing detail)

---

## Build Order + Parallelization

Serial foundation, then fan-out (same model as Phase 2):

1. **Schema + migration** — me, alone. Writes `0084_affiliate_crm.sql`, applies to prod Neon, updates `packages/db/src/schema/index.ts` exports.
2. **Parallel agents** once schema lands:
   - **Agent A** — webhook attribution-rate logic + `affiliates.ts` lead submission + timeline route + admin CRM endpoints.
   - **Agent B** — `affiliate-crons.ts` lead-expiration + lock-expiration crons + tests.
   - **Agent C** — UI: affiliate lead form (first-touch) + affiliate lead detail page + dashboard `estimatedEarned` removal.
   - **Agent D** — UI admin: kanban board + lead detail + attribution override console.
3. **Email templates** (me, after A lands) — `buildAffiliateLockExpired`, `buildAffiliateLeadStatusChange`.
4. **Tests** — Each agent writes vitest specs for their slice. Reuse Phase 2 pattern (mocked email, real DB).

---

## Deprecations

- `estimatedEarned` — removed from API response, UI, docs. Keep DB column (none exists — was purely computed) so no migration drop.
- Phase 1's implicit assumption that all commissions come from `affiliate_referred_cd_closed` — now explicit per attribution type.
- Phase 2's single-rate commission insert path — replaced by attribution-type lookup.

---

## Out of Scope (→ Phase 4)

- Leaderboards, tiers, promo merch, giveaway tracking — all engagement-layer.
- Compliance/misrepresentation flagging + affiliate violation records.
- SLA logic for outreach windows (we track `lastActivityAt` but don't alert on SLA breaches yet).
- Business-owner self-serve portal (booking / proposal acceptance).
- Advanced analytics dashboards.

---

## Acceptance Checklist

- [ ] Migration `0084` applied to prod Neon, verified via `\d+ partner_companies`.
- [ ] `npx tsc --noEmit --project server/tsconfig.json` → 0 errors.
- [ ] `cd ui && npx tsc --noEmit` → 0 errors.
- [ ] Every attribution type produces correct commission rate (unit test per type).
- [ ] First-touch submission writes to `referral_attribution` columns (integration test).
- [ ] Admin can transfer lead ownership; both attribution rows + override audit row visible.
- [ ] `estimatedEarned` returns 0 grep hits in `server/src/` and `ui/src/`.
- [ ] Affiliate-facing lead detail does not leak admin-only activity notes.
