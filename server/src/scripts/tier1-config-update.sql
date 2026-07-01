-- tier1-config-update.sql
-- Coherent Ones University — Tier 1 live-config update for the community-agent runner.
--
-- WHY THIS FILE EXISTS
-- The runner reads post_probability / comment_probability from the live
-- `university_agent_config` DB row, NOT from personas.ts. That row is seeded once
-- per agent with ON CONFLICT (member_id) DO NOTHING (see scripts/seed-agents.ts),
-- so editing the personas.ts defaults does NOT change an already-seeded agent.
-- Felix was seeded at 0.55 / 0.60; only this UPDATE lowers his live chattiness.
--
-- The caps.ts changes (ambientPostsPerDay 5->22, ambientCommentsPerDay 10->30)
-- are code constants that take effect on deploy — they need NO SQL.
--
-- IDEMPOTENT: re-running sets the same values; safe to apply more than once.
-- Column names verified against migration 0137 (university_agent_config:
-- member_id, persona_key, post_probability, comment_probability) and migration
-- 0136 (university_members.agent_persona_key).

UPDATE university_agent_config
SET post_probability = 0.20,
    comment_probability = 0.30,
    updated_at = now()
WHERE member_id IN (
  SELECT id FROM university_members WHERE agent_persona_key = 'felix'
);
