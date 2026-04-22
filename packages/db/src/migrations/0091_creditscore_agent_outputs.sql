-- CreditScore fulfillment-agent outputs — Schema Agent (Core),
-- Competitor Agent (Forge), Sage Strategist (Sage).

CREATE TABLE IF NOT EXISTS creditscore_schema_impls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES creditscore_subscriptions(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  cycle_tag TEXT NOT NULL,
  cycle_index INTEGER NOT NULL,
  schema_type TEXT NOT NULL,
  json_ld JSONB NOT NULL DEFAULT '{}',
  html_snippet TEXT NOT NULL,
  prompt_meta JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_notes TEXT,
  reviewed_by_user_id UUID,
  reviewed_by_agent_id UUID,
  reviewed_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_schema_impls_subscription_idx
  ON creditscore_schema_impls (subscription_id);
CREATE INDEX IF NOT EXISTS creditscore_schema_impls_status_idx
  ON creditscore_schema_impls (status);
CREATE INDEX IF NOT EXISTS creditscore_schema_impls_cycle_idx
  ON creditscore_schema_impls (subscription_id, cycle_tag, cycle_index);

CREATE TABLE IF NOT EXISTS creditscore_competitor_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES creditscore_subscriptions(id) ON DELETE CASCADE,
  parent_report_id UUID REFERENCES creditscore_reports(id) ON DELETE SET NULL,
  cycle_tag TEXT NOT NULL,
  customer_domain TEXT NOT NULL,
  competitor_domain TEXT NOT NULL,
  competitor_score INTEGER,
  customer_score INTEGER,
  audit_json JSONB NOT NULL DEFAULT '{}',
  gap_summary TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_competitor_scans_subscription_idx
  ON creditscore_competitor_scans (subscription_id);
CREATE INDEX IF NOT EXISTS creditscore_competitor_scans_cycle_idx
  ON creditscore_competitor_scans (subscription_id, cycle_tag);
CREATE INDEX IF NOT EXISTS creditscore_competitor_scans_parent_idx
  ON creditscore_competitor_scans (parent_report_id);

CREATE TABLE IF NOT EXISTS creditscore_strategy_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES creditscore_subscriptions(id) ON DELETE CASCADE,
  cycle_tag TEXT NOT NULL,
  week_of TIMESTAMPTZ NOT NULL,
  doc_html TEXT NOT NULL,
  doc_markdown TEXT,
  prompt_meta JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft',
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_strategy_docs_subscription_idx
  ON creditscore_strategy_docs (subscription_id);
CREATE INDEX IF NOT EXISTS creditscore_strategy_docs_cycle_idx
  ON creditscore_strategy_docs (subscription_id, cycle_tag);
CREATE INDEX IF NOT EXISTS creditscore_strategy_docs_status_idx
  ON creditscore_strategy_docs (status);
