# Affiliate Phase 4 — Engagement + Compliance

**Date:** 2026-04-20
**Depends on:** [Phase 3](2026-04-20-affiliate-phase-3-crm.md) (CRM pipeline + attribution types live)
**Spec:** [affiliate-system-upgraded.md](../../docs/guides/affiliate-system-upgraded.md)

Closes the loop on the affiliate program: turns passive referrers into engaged partners via tiers + leaderboards + merch, and protects the business from policy violations via a misrepresentation-detection pipeline that integrates with the commission state machine already built in Phase 2 (`held` / `reversed` / `clawed_back`).

---

## Goals

1. **Tier system** — affiliate commission rate scales with performance (e.g., Bronze 10% → Silver 12% → Gold 15%).
2. **Leaderboard** — monthly ranking visible to affiliates + admins, feeds giveaway eligibility.
3. **Merch / promo loop** — request a starter shirt, track posts, earn giveaway entries.
4. **Compliance engine** — detect misrepresentation (policy §6) in affiliate notes and outreach, warn/suspend/remove, auto-clawback commissions tied to violating affiliates.
5. **Inactive re-engagement** — nudge affiliates who haven't submitted in N days.

---

## Schema (`packages/db/src/schema/`)

### Extend: `affiliates.ts`

```ts
tier: text("tier").notNull().default("bronze"),
// bronze · silver · gold · platinum
tierUpgradedAt: timestamp("tier_upgraded_at", { withTimezone: true }),
violationCount: integer("violation_count").notNull().default(0),
suspendedAt: timestamp("suspended_at", { withTimezone: true }),
suspensionReason: text("suspension_reason"),
promoOptIn: boolean("promo_opt_in").notNull().default(false),
lastLeadSubmittedAt: timestamp("last_lead_submitted_at", { withTimezone: true }),
```

`commissionRate` stays the source of truth for the webhook but is recomputed by the tier cron (see below).

### New: `affiliate_tiers.ts`

Config table, seeded once. Admin-editable.

```ts
export const affiliateTiers = pgTable("affiliate_tiers", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull().unique(),                      // bronze / silver / gold / platinum
  displayOrder: integer().notNull(),
  commissionRate: numeric({ precision: 5, scale: 4 }).notNull(),
  minLifetimeCents: integer().notNull(),                // total commissions paid to reach
  minActivePartners: integer().notNull().default(0),    // current live paying referrals
  perks: jsonb().$type<string[]>().notNull().default([]),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

### New: `affiliate_engagement.ts`

Posts / social mentions / giveaway entries.

```ts
export const affiliateEngagement = pgTable("affiliate_engagement", {
  id: uuid().primaryKey().defaultRandom(),
  affiliateId: uuid().notNull().references(() => affiliates.id),
  campaignId: uuid(),                                   // optional — FK to promo_campaigns
  kind: text().notNull(),                               // "post" | "hashtag" | "merch_request" | "giveaway_entry"
  postUrl: text(),
  hashtagUsed: text(),
  score: integer().notNull().default(0),
  giveawayEligible: boolean().notNull().default(false),
  occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateOccurredIdx: index().on(t.affiliateId, t.occurredAt),
  kindIdx: index().on(t.kind),
}));
```

### New: `promo_campaigns.ts`

```ts
export const promoCampaigns = pgTable("promo_campaigns", {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  hashtag: text(),
  startAt: timestamp({ withTimezone: true }).notNull(),
  endAt: timestamp({ withTimezone: true }).notNull(),
  giveawayPrize: text(),
  status: text().notNull().default("draft"),            // draft | live | ended
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

### New: `affiliate_violations.ts`

Append-only audit of every flagged or admin-issued violation. Feeds the compliance-clawback pipeline.

```ts
export const affiliateViolations = pgTable("affiliate_violations", {
  id: uuid().primaryKey().defaultRandom(),
  affiliateId: uuid().notNull().references(() => affiliates.id),
  leadId: uuid().references(() => partnerCompanies.id),     // optional — some violations aren't lead-specific
  detectionType: text().notNull(),                           // "automated" | "admin_reported"
  ruleCode: text().notNull(),                                // "pricing_promise" | "guarantee" | "territory" | …
  severity: text().notNull(),                                // "warning" | "strike" | "terminal"
  evidence: jsonb().$type<{
    source: string;                                          // "affiliate_notes" | "crm_note" | "email" | "admin_report"
    excerpt: string;
    matchedPattern?: string;
  }>().notNull(),
  status: text().notNull().default("open"),                  // open | acknowledged | overturned | enforced
  commissionsClawedBack: integer().notNull().default(0),     // count
  reviewedByUserId: uuid(),
  reviewedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateOpenIdx: index().on(t.affiliateId, t.status),
  severityIdx: index().on(t.severity),
}));
```

### New: `merch_requests.ts`

```ts
export const merchRequests = pgTable("merch_requests", {
  id: uuid().primaryKey().defaultRandom(),
  affiliateId: uuid().notNull().references(() => affiliates.id),
  itemType: text().notNull(),                               // "starter_shirt" | "hat" | "sticker_pack"
  sizeOrVariant: text(),
  shippingAddress: jsonb().$type<{
    name: string; street1: string; street2?: string;
    city: string; region: string; postalCode: string; country: string;
  }>().notNull(),
  status: text().notNull().default("requested"),            // requested | approved | shipped | canceled
  trackingNumber: text(),
  notes: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});
```

### Migration: `0085_affiliate_engagement.sql`

Additive + idempotent. Seeds 4 default tiers on first run:

```sql
INSERT INTO affiliate_tiers (name, display_order, commission_rate, min_lifetime_cents, min_active_partners)
VALUES ('bronze', 1, 0.10, 0, 0),
       ('silver', 2, 0.12, 100000, 3),
       ('gold',   3, 0.15, 500000, 10),
       ('platinum', 4, 0.20, 2000000, 25)
ON CONFLICT (name) DO NOTHING;
```

---

## Routes (`server/src/routes/`)

### New: `affiliate-engagement.ts`

Affiliate-facing:
- `GET /api/affiliates/me/tier` → current tier + next tier + progress bars.
- `GET /api/affiliates/leaderboard?period=month|all_time` → top 20, current affiliate's rank highlighted.
- `GET /api/affiliates/promo/campaigns` → active campaigns.
- `POST /api/affiliates/promo/posts` → submit a post URL for a campaign.
- `POST /api/affiliates/merch-requests` → request merch (rate-limited: 1 per quarter).
- `GET /api/affiliates/merch-requests` → own history.

Admin-facing (`affiliateAdminRoutes`):
- `GET /admin/tiers` · `PUT /admin/tiers/:id` (config editing).
- `GET /admin/promo/campaigns` · `POST /admin/promo/campaigns` · `PUT /admin/promo/campaigns/:id`.
- `GET /admin/engagement/posts` (review queue for scoring).
- `PUT /admin/engagement/posts/:id/score` → set score + giveaway eligibility.
- `GET /admin/merch-requests` · `PUT /admin/merch-requests/:id/status`.

### New: `affiliate-compliance.ts`

- `GET /admin/compliance/violations` — filter by affiliate, status, severity.
- `POST /admin/compliance/violations` — manually report a violation (admin).
- `PUT /admin/compliance/violations/:id/status` — body `{ toStatus, commissionAction? }`. When `status → enforced` AND `commissionAction === "clawback"`: reuse Phase 2's commission state-machine transition (bulk update `commissions SET status = CASE WHEN status = 'paid' THEN 'clawed_back' ELSE 'reversed' END WHERE affiliate_id = :id AND lead_id = :leadId?`). Writes `commissionsClawedBack` count back onto the violation row. Wrapped in `db.transaction`.
- `PUT /admin/affiliates/:id/suspend` — body `{ reason }`. Sets `suspendedAt` + denies future lead submissions in middleware.

### Middleware: affiliate auth

Existing affiliate-session middleware must check `suspendedAt IS NULL` before allowing lead submission, merch request, or new attribution creation. Suspended affiliates can still view their dashboard (read-only).

---

## Compliance Detection (`server/src/services/compliance-scanner.ts`)

**New service.** Scans all text fields an affiliate can write:
- `partner_companies.affiliate_notes`
- `crm_activities.note` WHERE `actor_type = 'affiliate'`
- Lead submission `firstTouchNotes`

Pattern-based + LLM pass:

```ts
const PATTERNS: { rule: string; regex: RegExp; severity: Severity }[] = [
  { rule: "pricing_promise",  regex: /\b(guarantee|promise|locked[- ]?in)\b.*\b(price|rate|discount)\b/i, severity: "warning" },
  { rule: "custom_discount",  regex: /\b(\d{1,2})%\s*(off|discount)\b/i, severity: "warning" },
  { rule: "exclusive_territory", regex: /\bexclusive\s+(territory|region|area)\b/i, severity: "strike" },
  { rule: "guarantee",        regex: /\b(guaranteed|will definitely)\b.*\b(results?|outcomes?|leads?)\b/i, severity: "strike" },
];
```

If regex hits, also call Claude Haiku 4.5 via existing `server/src/services/ai-client.ts` for a second opinion — reduces false positives on paraphrase ("we ensure you'll see results" slips past regex but LLM catches it). On confirmed match, insert `affiliate_violations` row + email admin.

This is the same pattern the intel pipeline uses for content quality signals — reuse that infrastructure.

---

## Crons (`server/src/services/affiliate-crons.ts`)

### New: `affiliate:tier-recompute` (daily, `0 5 * * *` UTC)

For each affiliate, compute lifetime paid commissions + active paying referrals, match against `affiliate_tiers` thresholds, update `affiliates.tier` + `commissionRate` if changed. Email affiliate on upgrade (`buildAffiliateTierUpgraded`). Writes `crm_activities`-style log row? No — this is affiliate-scoped, just use `activity_log`.

### New: `affiliate:engagement-scan` (daily, `30 5 * * *` UTC)

Runs `compliance-scanner` across any rows changed since last run (cursor in `system_crons.lastRunAt`). Batches LLM calls.

### New: `affiliate:inactive-reengagement` (weekly, `0 14 * * MON` UTC)

Find affiliates with `status = 'active'`, `suspendedAt IS NULL`, and `lastLeadSubmittedAt < NOW() - interval '45 days'`. Email `buildAffiliateReengagement` — one-off, throttled (don't email same affiliate twice in 30 days; track via `activity_log`).

### New: `affiliate:leaderboard-snapshot` (monthly, `0 6 1 * *` UTC)

Snapshot last month's leaderboard. Used for giveaway eligibility cutoffs + historical views. Could be a materialized table or just a `leaderboard_snapshots(period text, rank int, affiliate_id uuid, score numeric)` table.

### New: `affiliate:giveaway-eligibility` (monthly, `30 6 1 * *` UTC)

For each ended campaign last month, select top-N scored `affiliate_engagement` rows, mark `giveawayEligible = true`, email winners.

---

## UI (`ui/src/`)

### Extend: `pages/AffiliateDashboard.tsx`

Add three widgets:
1. Tier card — current tier badge, progress bar to next tier, thresholds listed.
2. Leaderboard preview — top 5 this month + "you are #X".
3. Promo banner if any `promoCampaigns.status = 'live'`.

### New: `pages/AffiliateLeaderboard.tsx`
Full leaderboard, toggle period (month / all-time). Highlights current affiliate.

### New: `pages/AffiliatePromo.tsx`
Active campaigns, submit post URL form, own submission history, giveaway entries.

### New: `pages/AffiliateMerch.tsx`
Request form + own request history. Hide form if last approved < 90 days.

### New: `pages/AffiliateTiers.tsx`
Public-ish page: tier breakdown, perks, thresholds. Linked from marketing copy.

### New admin pages
- `AffiliateAdminCompliance.tsx` — violations queue, severity filter, click through to evidence excerpt + action panel.
- `AffiliateAdminEngagement.tsx` — post scoring queue.
- `AffiliateAdminTiers.tsx` — tier config editor.
- `AffiliateAdminCampaigns.tsx` — campaign CRUD.
- `AffiliateAdminMerch.tsx` — merch request fulfillment (approve, mark shipped with tracking).

### Extend: `components/AffiliateAdminTabs.tsx`
Add tabs: `Compliance` · `Engagement` · `Tiers` · `Campaigns` · `Merch`.

### Email templates (`server/src/services/email-templates.ts`)

New builders:
- `buildAffiliateTierUpgraded`
- `buildAffiliateViolationWarning`
- `buildAffiliateSuspended`
- `buildAffiliateGiveawayWinner`
- `buildAffiliateReengagement`
- `buildAffiliateMerchShipped`

---

## Build Order + Parallelization

1. **Schema + migration** — me. `0085_affiliate_engagement.sql`, apply to prod Neon, wire exports in `packages/db/src/schema/index.ts`.
2. **Parallel agents** after schema:
   - **Agent A** — tier recompute cron + commission webhook rate lookup via tier + leaderboard snapshot cron + inactive-reengagement cron + tests.
   - **Agent B** — compliance scanner service + violations routes + suspension middleware + commission clawback integration + tests.
   - **Agent C** — affiliate-facing UI (tier card, leaderboard page, promo, merch).
   - **Agent D** — admin UI (compliance, engagement, tiers, campaigns, merch).
3. **Email templates** — me, after A + B land the shape of each notification.
4. **Manual QA** — seed data: 2 affiliates across tiers, 1 live campaign, 1 violation, 1 pending merch request. Walk every page.

---

## Risk & Rollback

- **LLM false positives on compliance** — start with `severity = 'warning'` for all auto-detected violations, never auto-enforce. Admin must manually move to `enforced` before any clawback triggers.
- **Tier downgrades** — spec doesn't address. Decision: tier recompute is one-way (upgrades only) unless admin manually downgrades. Prevents churn from temporarily inactive affiliates losing rate mid-deal.
- **Merch fulfillment** — no shipping integration in Phase 4. Admin manually enters tracking. If we add ShipStation/EasyPost later, it slots into `PUT /admin/merch-requests/:id/status`.

---

## Out of Scope (→ future phases)

- Business-owner self-serve portal.
- Attribution dispute resolution via third-party arbitration.
- Automated payout method verification (Plaid etc.).
- Multi-currency commissions.
- Sub-affiliate / team structures.

---

## Acceptance Checklist

- [ ] Migration `0085` applied to prod Neon, 4 default tiers seeded.
- [ ] `npx tsc --noEmit --project server/tsconfig.json` → 0 errors.
- [ ] `cd ui && npx tsc --noEmit` → 0 errors.
- [ ] Tier recompute cron moves a seeded-lifetime-paid affiliate from bronze → silver; webhook on next commission uses new rate.
- [ ] Compliance scanner flags pattern + LLM-confirmed text, writes violation row, admin sees in queue.
- [ ] Admin-enforced clawback flips linked commissions to `reversed`/`clawed_back` and sets `commissionsClawedBack` count.
- [ ] Suspended affiliate cannot submit a lead (403 + message).
- [ ] Leaderboard page loads with snapshot + live rank; current user highlighted.
- [ ] Merch request throttled to 1 per 90 days.
- [ ] Every new email template renders in the existing `sendTransactional` harness.
