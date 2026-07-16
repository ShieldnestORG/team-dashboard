-- 0154: widen the per-agent model allowlist to include claude-sonnet-5.
--
-- Owner decision 2026-07-15: community-agent chat standardizes on Sonnet 5
-- after a live head-to-head (better member-facing voice + strict instruction
-- following than sonnet-4-6/gemma; currently cheaper than sonnet-4-6 at the
-- $2/$10 per-Mtok intro rate through 2026-08-31, then $3/$15).
--
-- The three prior values stay valid so existing rows and a rollback both keep
-- working. Forward-only, hand-written (never drizzle-kit generate); the
-- DROP IF EXISTS + ADD pair is idempotent as a unit.

ALTER TABLE university_agent_config
  DROP CONSTRAINT IF EXISTS university_agent_config_model_check;

ALTER TABLE university_agent_config
  ADD CONSTRAINT university_agent_config_model_check
  CHECK (model IN ('claude-haiku-4-5','claude-sonnet-4-6','claude-opus-4-8','claude-sonnet-5'));
