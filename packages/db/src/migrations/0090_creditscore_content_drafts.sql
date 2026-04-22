-- CreditScore Content Agent (Cipher) — AI-drafted AEO page review queue.
-- See docs/products/creditscore-prd.md § Agent Assignments.

CREATE TABLE IF NOT EXISTS creditscore_content_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES creditscore_subscriptions(id) ON DELETE CASCADE,
  domain TEXT NOT NULL,
  cycle_tag TEXT NOT NULL,
  cycle_index INTEGER NOT NULL,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  target_signal TEXT,
  html_draft TEXT NOT NULL,
  markdown_draft TEXT,
  prompt_meta JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending_review',
  review_notes TEXT,
  reviewed_by_user_id UUID,
  reviewed_by_agent_id UUID,
  reviewed_at TIMESTAMPTZ,
  published_url TEXT,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS creditscore_content_drafts_subscription_idx
  ON creditscore_content_drafts (subscription_id);

CREATE INDEX IF NOT EXISTS creditscore_content_drafts_status_idx
  ON creditscore_content_drafts (status);

CREATE INDEX IF NOT EXISTS creditscore_content_drafts_cycle_idx
  ON creditscore_content_drafts (subscription_id, cycle_tag, cycle_index);
