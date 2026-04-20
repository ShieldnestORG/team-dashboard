# Affiliate Phase 2 — Commissions + Payouts

**Date:** 2026-04-19
**Depends on:** [Phase 1](2026-04-19-affiliate-flow-upgrade.md) (attribution ledger + `policy_accepted_at`)
**Spec:** [affiliate-system-upgraded.md](../../docs/guides/affiliate-system-upgraded.md)

Replaces the in-memory `estimatedEarned = monthlyFee × commissionRate` calculation with a real commission ledger backed by Stripe events, a state machine (PendingActivation → Approved → Scheduled → Paid / Reversed), and a monthly payout batcher.

Stripe is already wired for partner subscriptions — the webhook at `server/src/routes/directory-listings.ts:316-436` handles `checkout.session.completed`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.deleted`. Phase 2 extends that handler and adds a `charge.refunded` / refund-within-window path for clawbacks.

---

## Schema (`packages/db/src/schema/`)

### New: `commissions.ts`

```ts
export const commissions = pgTable("commissions", {
  id: uuid().primaryKey().defaultRandom(),
  affiliateId: uuid().notNull().references(() => affiliates.id),
  leadId: uuid().notNull().references(() => partnerCompanies.id),
  attributionId: uuid().notNull().references(() => referralAttribution.id),

  // 'initial' for the first subscription payment, 'recurring' for each renewal
  type: text().notNull(),

  rate: numeric({ precision: 5, scale: 4 }).notNull(),   // snapshot at creation
  amountCents: integer().notNull(),                       // final payable amount
  basisCents: integer().notNull(),                        // the invoice amount the rate was applied to

  periodStart: timestamp({ withTimezone: true }).notNull(),
  periodEnd: timestamp({ withTimezone: true }).notNull(),

  // State machine:
  // pending_activation → approved → scheduled_for_payout → paid
  //                                                      ↘ held  (admin)
  // * → reversed / clawed_back (refund or policy violation)
  status: text().notNull().default("pending_activation"),

  // Idempotency — Stripe invoice or charge id. Unique per commission event.
  stripeInvoiceId: text(),
  stripeChargeId: text(),

  holdExpiresAt: timestamp({ withTimezone: true }),       // 30 days after created_at on initial rows
  payoutBatchId: uuid().references(() => payouts.id),
  clawbackReason: text(),

  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateStatusIdx: index().on(t.affiliateId, t.status),
  leadIdx: index().on(t.leadId),
  stripeInvoiceUq: uniqueIndex().on(t.stripeInvoiceId).where(sql`stripe_invoice_id IS NOT NULL`),
  holdExpiresIdx: index().on(t.holdExpiresAt).where(sql`status = 'pending_activation'`),
}));
```

### New: `payouts.ts`

```ts
export const payouts = pgTable("payouts", {
  id: uuid().primaryKey().defaultRandom(),
  affiliateId: uuid().notNull().references(() => affiliates.id),

  amountCents: integer().notNull(),
  commissionCount: integer().notNull(),

  // 'stripe_connect' (future), 'manual_ach', 'manual_paypal', 'manual_check'
  method: text().notNull().default("manual_ach"),
  externalId: text(),                                     // Stripe transfer id or manual reference

  // scheduled → sent → paid / failed
  status: text().notNull().default("scheduled"),

  batchMonth: text().notNull(),                           // 'YYYY-MM' — what the batch covers
  scheduledFor: timestamp({ withTimezone: true }).notNull(),
  sentAt: timestamp({ withTimezone: true }),
  paidAt: timestamp({ withTimezone: true }),

  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  affiliateBatchUq: uniqueIndex().on(t.affiliateId, t.batchMonth),
  statusIdx: index().on(t.status),
}));
```

### Extend: `affiliates.ts`

```ts
payoutMethod: text(),                                     // 'stripe_connect' | 'manual_ach' | 'manual_paypal' | 'manual_check'
payoutAccount: text(),                                    // opaque identifier (routing details, paypal email, etc.) — encrypted at rest ideally
minimumPayoutCents: integer().notNull().default(5000),    // $50 threshold default
```

### Migration `0083_affiliate_commissions.sql`

Three `CREATE TABLE IF NOT EXISTS` + two `ALTER TABLE affiliates ADD COLUMN IF NOT EXISTS`. Partial unique index on `stripe_invoice_id` enforces webhook idempotency without blocking legacy NULLs. No backfill — Phase 2 starts a fresh ledger. (Historic earnings stay computed via the existing `estimatedEarned` display until Phase 3 deprecates it.)

Index update docs/plans/2026-04-19-affiliate-flow-upgrade.md cross-cutting section's "Commission recompute on historical" risk is **decided: no backfill** — ledger covers new events only.

---

## Stripe webhook (`server/src/routes/directory-listings.ts`)

### `checkout.session.completed` (after line 380)

After the `partnerCompanies` update that sets `is_paying = true`:

```ts
// Create initial commission row if this lead has an active attribution
const [attribution] = await db
  .select({ id: referralAttribution.id, affiliateId: referralAttribution.affiliateId })
  .from(referralAttribution)
  .innerJoin(partnerCompanies, eq(partnerCompanies.id, referralAttribution.leadId))
  .where(and(
    eq(partnerCompanies.slug, partnerSlug),
    isNull(referralAttribution.lockReleasedAt),
  ))
  .limit(1);

if (attribution) {
  const [aff] = await db.select({ rate: affiliates.commissionRate })
    .from(affiliates).where(eq(affiliates.id, attribution.affiliateId)).limit(1);

  const invoiceAmountCents = session.amount_total ?? 0;  // Stripe session amount
  const rate = Number(aff?.rate ?? "0.10");
  const amount = Math.round(invoiceAmountCents * rate);
  const now = new Date();

  await db.insert(commissions).values({
    affiliateId: attribution.affiliateId,
    leadId: /* partner id */,
    attributionId: attribution.id,
    type: "initial",
    rate: aff.rate,
    amountCents: amount,
    basisCents: invoiceAmountCents,
    periodStart: now,
    periodEnd: currentPeriodEnd ?? now,
    status: "pending_activation",
    stripeInvoiceId: session.invoice ?? session.id,
    holdExpiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
  }).onConflictDoNothing();  // idempotent on stripe_invoice_id
}
```

### `invoice.payment_succeeded` / `invoice.paid` (after line 409)

After updating `is_paying = true`:

```ts
const invoice = obj as {
  id: string;
  subscription?: string;
  amount_paid?: number;
  period_start?: number;
  period_end?: number;
  billing_reason?: string;
};

// Skip — initial invoice already handled by checkout.session.completed
if (invoice.billing_reason === "subscription_create") break;

// Find the attribution via partner company subscription id
const [row] = await db
  .select({
    leadId: partnerCompanies.id,
    attributionId: referralAttribution.id,
    affiliateId: referralAttribution.affiliateId,
    rate: affiliates.commissionRate,
  })
  .from(partnerCompanies)
  .innerJoin(referralAttribution, and(
    eq(referralAttribution.leadId, partnerCompanies.id),
    isNull(referralAttribution.lockReleasedAt),
  ))
  .innerJoin(affiliates, eq(affiliates.id, referralAttribution.affiliateId))
  .where(eq(partnerCompanies.stripeSubscriptionId, invoice.subscription!))
  .limit(1);

if (!row) break;

const amount = Math.round((invoice.amount_paid ?? 0) * Number(row.rate));

await db.insert(commissions).values({
  affiliateId: row.affiliateId,
  leadId: row.leadId,
  attributionId: row.attributionId,
  type: "recurring",
  rate: row.rate,
  amountCents: amount,
  basisCents: invoice.amount_paid ?? 0,
  periodStart: new Date((invoice.period_start ?? 0) * 1000),
  periodEnd: new Date((invoice.period_end ?? 0) * 1000),
  status: "pending_activation",
  stripeInvoiceId: invoice.id,
  holdExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
}).onConflictDoNothing();
```

### New case: `charge.refunded`

```ts
case "charge.refunded": {
  const charge = obj as { id: string; invoice?: string };
  if (!charge.invoice) return;

  // Reverse any unpaid commission tied to that invoice.
  // Commissions already in 'paid' require admin review — mark 'clawed_back' only.
  await db.update(commissions)
    .set({
      status: sql`CASE WHEN status = 'paid' THEN 'clawed_back' ELSE 'reversed' END`,
      clawbackReason: "stripe_refund",
      updatedAt: new Date(),
    })
    .where(eq(commissions.stripeInvoiceId, charge.invoice));
  break;
}
```

Add `"charge.refunded"` to the handler switch. Webhook signature check at line 448 already covers it.

### Idempotency summary

Every insert uses `onConflictDoNothing()` on `stripe_invoice_id`. Stripe retries / replays produce no duplicates. `charge.refunded` is idempotent-by-state (reversed → stays reversed).

---

## Crons (`server/src/services/affiliate-crons.ts`)

### `affiliate:commission-maturation` — daily 03:15 UTC

```ts
// Single UPDATE: pending_activation + hold_expires_at passed → approved.
// No refund event will flip the row post-approval unless admin reverses.
await db.update(commissions)
  .set({ status: "approved", updatedAt: sql`NOW()` })
  .where(and(
    eq(commissions.status, "pending_activation"),
    lt(commissions.holdExpiresAt, sql`NOW()`),
  ))
  .returning({ id: commissions.id });
```

### `affiliate:payout-batcher` — monthly, 1st of month at 04:00 UTC

Per affiliate:
1. Sum `approved` commissions.
2. Skip if below `minimumPayoutCents` (roll forward).
3. Insert `payouts` row (scheduled, batch_month = `YYYY-MM`).
4. Update matching commissions: `payoutBatchId = payout.id`, `status = 'scheduled_for_payout'`.

Runs inside a transaction per-affiliate to ensure atomicity.

---

## Backend routes (`server/src/routes/affiliates.ts`)

### Affiliate-facing

- `GET /me` → add buckets: `{ pendingCents, approvedCents, scheduledCents, paidCents, lifetimeCents }`. Replaces `estimatedEarned` (keep for one release cycle for UI backward-compat, remove in Phase 3).
- `GET /earnings` → `{ commissions: CommissionRow[], total, limit, offset }` filtered by authenticated affiliate, paginated.
- `GET /payouts` → `{ payouts: PayoutRow[], total }`.

### Admin-facing (`/api/affiliates/admin`)

- `GET /commissions` — list with filters (affiliate, status, date range).
- `PUT /commissions/:id/approve` — force-approve a pending row.
- `PUT /commissions/:id/reverse` — body `{ reason }`. Sets `status='reversed'`.
- `PUT /commissions/:id/hold` — sets `status='held'`.
- `GET /payouts` — list batches.
- `PUT /payouts/:id/mark-sent` — body `{ externalId }`. `status → sent`, `sentAt = now`.
- `PUT /payouts/:id/mark-paid` — `status → paid`, `paidAt = now`. Updates `commissions.status → paid` for all rows in batch.

All admin routes `assertBoard()` as existing convention.

---

## UI

### Affiliate dashboard (`ui/src/pages/AffiliateDashboard.tsx`)

Replace the single "Est. Earnings" stat with a 4-card row: Pending · Approved · Scheduled · Paid · (Lifetime).

New routes:
- `/earnings` — `AffiliateEarnings.tsx` with timeline: date, lead name, type (initial/recurring), amount, status pill, stripe invoice link on hover.
- `/payouts` — `AffiliatePayouts.tsx` with batch rows: month, amount, commission count, method, status, external id once sent.

### Admin dashboard (`ui/src/pages/`)

- `CommissionApproval.tsx` — table with filters, row actions (approve / reverse / hold). Bulk-approve for rows past hold window.
- `PayoutManagement.tsx` — scheduled batches at top, sent batches in middle, paid below. Mark-sent dialog accepts external id; mark-paid dialog confirms.

Both surfaced from `AffiliatesAdmin.tsx` sidebar tabs.

### API clients

- Extend `ui/src/api/affiliates.ts` with `listEarnings`, `listPayouts`.
- Extend `ui/src/api/affiliates-admin.ts` with the 7 admin endpoints above.

---

## Emails (`server/src/services/email-templates.ts`)

Add templates:
- `affiliate-commission-created` — "A new commission is pending: $X from [lead name]"
- `affiliate-commission-approved` — "$X is now approved and will be paid in the next batch"
- `affiliate-payout-sent` — "We sent $X (N commissions) via [method]"
- `affiliate-payout-held` — "Your payout is on hold — [reason]. Reach out to affiliates@..."

Triggers:
- commission-created → on webhook insert (async, catch + log).
- commission-approved → on maturation cron (batch per affiliate).
- payout-sent → on admin `mark-sent` endpoint.
- payout-held → manual admin action (optional).

---

## Tests

### Unit (`server/src/__tests__/`)

- `commission-webhook.test.ts` — 6 cases:
  1. `checkout.session.completed` with active attribution creates `pending_activation` row with correct amount.
  2. Same event replayed — no duplicate row (onConflictDoNothing).
  3. `invoice.payment_succeeded` with `billing_reason = subscription_create` — skipped.
  4. `invoice.payment_succeeded` for renewal — creates recurring row.
  5. `charge.refunded` with matching invoice — flips `pending_activation` → `reversed`.
  6. `charge.refunded` after `paid` — flips to `clawed_back`.
- `commission-maturation.test.ts` — 3 cases: mature past-hold row; leave pre-hold row; ignore already-approved.
- `payout-batcher.test.ts` — 3 cases: batches above threshold; rolls forward below threshold; handles zero approved rows.

### Integration

Run against the embedded-postgres harness (same pattern as `issues-service.test.ts`) for the webhook flow end-to-end — insert attribution, fire webhook, assert row + state + idempotency.

---

## Risks

1. **Commission rate snapshot.** We snapshot `affiliates.commission_rate` at creation time. If an admin adjusts the rate later, existing pending rows keep the old rate. Document this explicitly in the admin docs.
2. **Refund window.** Stripe emits `charge.refunded` whenever a refund happens — we don't check "within 30 days" because the hold window already takes care of it. Commissions refunded post-approval become `clawed_back` and require admin action (in-app alert to CD team).
3. **Invoice amount vs. what the affiliate actually earned on.** Using `amount_paid` (post-discount, post-tax) vs. `subtotal`. Decision: `amount_paid` — affiliates earn on actual cash in, not headline price.
4. **Threshold resets.** If an affiliate sits below threshold for months, small amounts accumulate. The batcher only skips the payout insert; commissions stay `approved` and roll into next month automatically.
5. **Payout idempotency on cron retry.** `(affiliate_id, batch_month)` is unique — retry is safe. If commissions got stamped `scheduled_for_payout` on the first attempt and the payout insert then failed, we'd be in inconsistent state. Wrap per-affiliate in a single transaction to prevent this.
6. **Policy changes reversal.** If we add clawback-on-violation in Phase 4, the commission state machine already supports it (`held` + `reversed` + `clawed_back` cover all cases).

---

## Build order (sub-agent fan-out)

Matches the Phase 1 pattern: schema first, then fan out.

1. **Me (sequential):** schema + migration + index export. Run `tsc` on db.
2. **Agent A (parallel):** Webhook changes in `directory-listings.ts` + the 2 new cron jobs + `sendTransactional` calls.
3. **Agent B (parallel):** Affiliate + admin routes in `affiliates.ts` (GET /earnings, /payouts; admin commission/payout CRUD).
4. **Agent C (parallel):** UI — dashboard buckets, earnings page, payouts page, admin commission + payout panels.
5. **Agent D (parallel):** 3 test files + 4 email templates.
6. **Me (review):** read all diffs, run server + ui tsc, run vitest full suite (not just new tests — commission code touches Stripe handler code paths).
7. **Commit + PR on `feat/affiliate-commission-ledger`** branched from `feat/affiliate-attribution` (so Phase 1 is included until Phase 1 merges).

---

## Gating

Cannot start this implementation until Phase 1 migration (`0082_affiliate_attribution.sql`) is applied to the target environment — the commission webhook reads from `referral_attribution`.
