-- 0128_member_economics_view.sql
-- Coherent Ones University — ad-economics reporting layer (M4).
--
-- A READ-ONLY view that rolls University membership + billing up to the
-- acquisition-campaign grain (utm_campaign + utm_source) so paid-acquisition
-- ROI can be reported per campaign. It is the aggregation half of the M4
-- "economics reporting" layer; the read-only admin endpoint
-- (server/src/routes/dashboard.ts) selects straight from it.
--
-- ── IMPORTANT: every number here is ESTIMATED / MODELED, not GAAP revenue ──
-- The view derives MRR / LTV from the marketing ledger we already keep
-- (university_attribution_events) plus subscription status. It is a directional
-- marketing signal for "which campaign pays back", NOT an accounting source of
-- truth. Specifically:
--   * gross_mrr is the latest captured *recurring* invoice amount per active
--     subscription (modeled monthly run-rate), summed per campaign — it is NOT
--     a Stripe-billing-period-accurate MRR.
--   * realized_ltv is total net cash collected to date per member (all paid
--     invoices minus all refunds), averaged across the campaign's members — a
--     trailing realized figure, NOT a predictive LTV model.
-- Treat both as modeled estimates. The endpoint echoes this in a `note` field.
--
-- ── Data sources / join model ──────────────────────────────────────────────
--   university_subscriptions      — the billing/member grain. Carries the
--                                   acquisition campaign (utm_campaign /
--                                   utm_source) stamped at checkout by the
--                                   ad-attribution webhook, plus status and
--                                   period dates. This is the row we group by.
--   university_attribution        — per-lead first-touch context, joined on
--                                   subscription_id to backfill the campaign /
--                                   source / first_touch_at when the
--                                   subscription row's own utm_* is NULL
--                                   (older / organic-then-attributed rows).
--   university_attribution_events — the append-only marketing ledger. We read
--                                   invoice.paid (amount_paid, cents) and
--                                   charge.refunded (amount_refunded, cents)
--                                   out of the JSONB `payload`, joined to the
--                                   subscription by stripe_customer_id. This is
--                                   where gross/net cash comes from.
--
-- Amounts in the ledger payload are MINOR units (cents). The view divides by
-- 100.0 to return MAJOR units (dollars) so the endpoint doesn't have to.
--
-- ── Grain / NULL handling ──────────────────────────────────────────────────
-- One row per (utm_campaign, utm_source). Subscriptions with no campaign on
-- either the subscription row or its attribution row collapse into the
-- '(unattributed)' bucket so totals reconcile to all subscriptions.
--
-- READ-ONLY. Additive: 1 view, no tables/columns touched. Re-runnable
-- (CREATE OR REPLACE). Safe to apply against prod.

CREATE OR REPLACE VIEW member_economics_by_campaign AS
WITH
-- Per-subscription cash rolled up from the marketing ledger. The ledger keys on
-- stripe_customer_id (the only id every invoice/charge event reliably carries),
-- so we sum per customer and join that onto the subscription by customer id.
ledger_by_customer AS (
  SELECT
    e.stripe_customer_id,
    -- Total recurring cash collected (paid invoices), cents.
    COALESCE(SUM(
      CASE WHEN e.event_type = 'invoice.paid'
        THEN COALESCE((e.payload ->> 'amount_paid')::bigint, 0)
        ELSE 0 END
    ), 0) AS paid_cents,
    -- Total refunded cash, cents.
    COALESCE(SUM(
      CASE WHEN e.event_type = 'charge.refunded'
        THEN COALESCE((e.payload ->> 'amount_refunded')::bigint, 0)
        ELSE 0 END
    ), 0) AS refunded_cents,
    -- Latest single paid-invoice amount (cents) — the modeled monthly run-rate
    -- for an active subscription. Uses the ledger row's created_at ordering.
    (ARRAY_AGG(
      CASE WHEN e.event_type = 'invoice.paid'
        THEN COALESCE((e.payload ->> 'amount_paid')::bigint, 0)
        ELSE NULL END
      ORDER BY e.created_at DESC
    ) FILTER (WHERE e.event_type = 'invoice.paid'))[1] AS latest_paid_cents
  FROM university_attribution_events e
  WHERE e.stripe_customer_id IS NOT NULL
  GROUP BY e.stripe_customer_id
),
-- One row per subscription with its resolved campaign/source and per-member
-- economics. Campaign/source falls back to the attribution row, then to the
-- '(unattributed)' bucket.
sub_econ AS (
  SELECT
    s.id AS subscription_id,
    COALESCE(NULLIF(s.utm_campaign, ''), NULLIF(a.utm_campaign, ''), '(unattributed)')
      AS utm_campaign,
    COALESCE(NULLIF(s.utm_source, ''), NULLIF(a.utm_source, ''), '(unattributed)')
      AS utm_source,
    s.status,
    -- Lifetime in months: first touch (or sub creation) → cancel (or now).
    -- Floored at ~0; one day = ~1/30 month. Directional only.
    GREATEST(
      EXTRACT(EPOCH FROM (
        COALESCE(s.canceled_at, now()) - COALESCE(a.first_touch_at, s.created_at)
      )) / (60 * 60 * 24 * 30.0),
      0
    ) AS lifetime_months,
    COALESCE(l.paid_cents, 0) AS paid_cents,
    COALESCE(l.refunded_cents, 0) AS refunded_cents,
    -- Modeled monthly run-rate: only active subs contribute to gross_mrr.
    CASE WHEN s.status = 'active'
      THEN COALESCE(l.latest_paid_cents, 0)
      ELSE 0 END AS active_mrr_cents
  FROM university_subscriptions s
  LEFT JOIN university_attribution a
    ON a.subscription_id = s.id
  LEFT JOIN ledger_by_customer l
    ON l.stripe_customer_id = s.stripe_customer_id
)
SELECT
  utm_campaign,
  utm_source,
  COUNT(*)::int AS new_members,
  COUNT(*) FILTER (WHERE status = 'active')::int AS active_members,
  COUNT(*) FILTER (WHERE status = 'cancelled')::int AS churned_members,
  -- Modeled monthly run-rate across active subs (dollars).
  ROUND(SUM(active_mrr_cents) / 100.0, 2) AS gross_mrr,
  -- Net of refunds (dollars). Refunds are lifetime, so net_mrr can dip below
  -- gross when a campaign's cohort has recent refunds; clamp at 0.
  ROUND(GREATEST(SUM(active_mrr_cents) - SUM(refunded_cents), 0) / 100.0, 2)
    AS net_mrr,
  -- Average modeled membership lifetime (months) across the campaign cohort.
  ROUND(AVG(lifetime_months)::numeric, 2) AS avg_lifetime_months,
  -- Realized LTV (dollars): net cash collected to date per member, averaged.
  ROUND(AVG((paid_cents - refunded_cents) / 100.0)::numeric, 2) AS realized_ltv
FROM sub_econ
GROUP BY utm_campaign, utm_source
ORDER BY active_members DESC, new_members DESC;
