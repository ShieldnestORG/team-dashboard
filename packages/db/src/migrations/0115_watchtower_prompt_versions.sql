-- 0115_watchtower_prompt_versions.sql
--
-- Watchtower prompt-version history (audit V2 blocker #4).
--
-- What it does (plain language):
--   (a) A new table `watchtower_prompt_versions` stores an immutable
--       snapshot of each subscription's prompt list. Every time a customer
--       edits their prompts, the API inserts a new row here (and also
--       overwrites `watchtower_subscriptions.prompts`, which remains the
--       source of truth for "what runs next"). This table is append-only;
--       rows are NEVER updated or deleted except via FK cascade when the
--       owning subscription is deleted.
--   (b) `watchtower_runs.prompt_version_id` pins each run to the version
--       that was active when the run started. Existing (legacy) run rows
--       have NULL here — we cannot retroactively know which version they
--       used. The portal UI treats NULL as "pre-versioning" and falls
--       back to comparing on run_at boundaries.
--   (c) Cross-sell rule (see services/upsell-cards.ts): the audit says
--       result-derived upsell triggers MUST NOT fire across a version
--       boundary, because a prompt change invalidates result-trend
--       signals. Phase 1's cross-sell is tenure-only so this is
--       vacuously satisfied today — when result-derived triggers ship,
--       the upsell selector should check the latest run's
--       prompt_version_id against the window's earliest run's value and
--       suppress if they differ.
--
-- All statements use IF NOT EXISTS / additive shapes — safe to re-apply.

CREATE TABLE IF NOT EXISTS watchtower_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
    REFERENCES watchtower_subscriptions(id) ON DELETE CASCADE,
  prompts JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_actor_id UUID,
  created_by_actor_type TEXT,
  created_by_actor_label TEXT
);

CREATE INDEX IF NOT EXISTS watchtower_prompt_versions_sub_created_idx
  ON watchtower_prompt_versions (subscription_id, created_at DESC);

ALTER TABLE watchtower_runs
  ADD COLUMN IF NOT EXISTS prompt_version_id UUID
    REFERENCES watchtower_prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS watchtower_runs_prompt_version_idx
  ON watchtower_runs (prompt_version_id);

-- Backfill: every existing subscription gets an initial version row built
-- from its current prompts column. Guarded so re-running is a no-op even
-- if some subscriptions already have version rows from prior partial
-- applies.
INSERT INTO watchtower_prompt_versions (subscription_id, prompts)
SELECT s.id, s.prompts
FROM watchtower_subscriptions s
WHERE NOT EXISTS (
  SELECT 1
  FROM watchtower_prompt_versions v
  WHERE v.subscription_id = s.id
);
