-- 0084 — Affiliate Phase 3: CRM pipeline + attribution overrides
-- Additive + idempotent. Applied to prod Neon via psql.

-- partner_companies: CRM pipeline columns
ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS lead_status text NOT NULL DEFAULT 'submitted';
ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS assigned_rep_id text;
ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS pipeline_entered_at timestamptz;
ALTER TABLE partner_companies
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

-- Backfill lead_status for existing rows from billing flags.
-- Guarded on the default value so this is safely re-runnable.
UPDATE partner_companies
  SET lead_status = CASE
    WHEN is_paying THEN 'won'
    WHEN subscription_status = 'canceled' THEN 'lost'
    ELSE 'submitted'
  END
  WHERE lead_status = 'submitted';

CREATE INDEX IF NOT EXISTS partner_companies_lead_status_idx
  ON partner_companies (company_id, lead_status);

-- crm_activities: one row per lead event (timeline + affiliate-visible feed)
CREATE TABLE IF NOT EXISTS crm_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES partner_companies(id) ON DELETE CASCADE,
  actor_type text NOT NULL,
  actor_id text,
  activity_type text NOT NULL,
  from_status text,
  to_status text,
  note text,
  visible_to_affiliate boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_activities_lead_created_idx
  ON crm_activities (lead_id, created_at);
CREATE INDEX IF NOT EXISTS crm_activities_actor_idx
  ON crm_activities (actor_type, actor_id);

-- attribution_overrides: audit trail for admin overrides / transfers / dispute resolution
CREATE TABLE IF NOT EXISTS attribution_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES partner_companies(id),
  previous_attribution_id uuid REFERENCES referral_attribution(id),
  new_attribution_id uuid REFERENCES referral_attribution(id),
  previous_affiliate_id uuid REFERENCES affiliates(id),
  new_affiliate_id uuid REFERENCES affiliates(id),
  override_type text NOT NULL,
  reason text NOT NULL,
  overridden_by_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS attribution_overrides_lead_idx
  ON attribution_overrides (lead_id);
CREATE INDEX IF NOT EXISTS attribution_overrides_overridden_by_idx
  ON attribution_overrides (overridden_by_user_id);
