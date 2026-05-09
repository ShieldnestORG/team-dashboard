-- Migration 0110: add customer-approval columns to the 3 agent output tables.
-- Additive only — no existing columns or data are altered.
-- These columns record which customer_accounts row approved or rejected a draft/
-- schema impl/competitor scan. NULL means no customer action has been taken yet.

-- creditscore_content_drafts
ALTER TABLE creditscore_content_drafts
  ADD COLUMN IF NOT EXISTS approved_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS customer_rejection_reason text,
  ADD COLUMN IF NOT EXISTS customer_actioned_at timestamptz;

-- creditscore_schema_impls
ALTER TABLE creditscore_schema_impls
  ADD COLUMN IF NOT EXISTS approved_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS customer_rejection_reason text,
  ADD COLUMN IF NOT EXISTS customer_actioned_at timestamptz;

-- creditscore_competitor_scans
ALTER TABLE creditscore_competitor_scans
  ADD COLUMN IF NOT EXISTS approved_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS rejected_by_customer_account_id uuid,
  ADD COLUMN IF NOT EXISTS customer_rejection_reason text,
  ADD COLUMN IF NOT EXISTS customer_actioned_at timestamptz;
