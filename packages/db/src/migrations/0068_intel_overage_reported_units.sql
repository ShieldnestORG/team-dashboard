-- Intel API overage reporter: track cumulative units (1k-request buckets)
-- already reported to Stripe Meter Events, so the daily cron can emit only
-- the delta since its last run instead of double-billing.

ALTER TABLE intel_usage_meter
  ADD COLUMN IF NOT EXISTS overage_units_reported BIGINT NOT NULL DEFAULT 0;
