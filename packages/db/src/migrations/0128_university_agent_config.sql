-- 0128_university_agent_config.sql
-- Coherent Ones University — PER-AGENT TUNABLE config, editable from the admin
-- dashboard WITHOUT a redeploy.
--
-- personas.ts holds the DEFAULTS (the seed source); this table holds the live,
-- admin-editable knobs the runner reads each tick: which model the agent uses,
-- how chatty it is (post/comment probability), its active hours, and an optional
-- free-text voice_note appended to that agent's reply system prompt for light
-- personality tuning. The on/off kill-switch stays on university_members
-- (agent_paused_at / agent_pause_reason, migration 0127) — this table is the
-- fine-tuning, not the on/off.
--
-- The seeder inserts a defaults row per agent but NEVER overwrites it on re-seed
-- (ON CONFLICT DO NOTHING), so admin fine-tuning survives re-seeds.
--
-- Additive + idempotent. Depends on university_members (0122). Safe vs prod.

CREATE TABLE IF NOT EXISTS university_agent_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID NOT NULL REFERENCES university_members(id),
  persona_key TEXT NOT NULL,
  model TEXT NOT NULL
    CHECK (model IN ('claude-haiku-4-5','claude-sonnet-4-6','claude-opus-4-8')),
  post_probability NUMERIC(4,3) NOT NULL DEFAULT 0.200
    CHECK (post_probability >= 0 AND post_probability <= 1),
  comment_probability NUMERIC(4,3) NOT NULL DEFAULT 0.200
    CHECK (comment_probability >= 0 AND comment_probability <= 1),
  active_start_hour INTEGER NOT NULL DEFAULT 6
    CHECK (active_start_hour >= 0 AND active_start_hour <= 23),
  active_end_hour INTEGER NOT NULL DEFAULT 22
    CHECK (active_end_hour >= 0 AND active_end_hour <= 23),
  voice_note TEXT,  -- optional admin guidance appended to the agent's reply system prompt
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One config row per agent member (the seeder upserts on this).
CREATE UNIQUE INDEX IF NOT EXISTS university_agent_config_member_uq
  ON university_agent_config (member_id);
