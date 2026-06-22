-- 0136_university_agent_identity.sql
-- Coherent Ones University — INVISIBLE AGENT MEMBERS.
--
-- We run ~15 AI persona "members" inside the real community to keep the room
-- alive: they help real members and small-talk with each other, indistinguishable
-- to members and visible/controllable ONLY on the admin side. This migration is
-- the admin-only identity + observability layer for that.
--
-- THREE additions, all additive + idempotent (safe against prod):
--
--   1) Agent identity columns on university_members. These are ADMIN-ONLY and
--      MUST NEVER be serialized into the member-facing community feed. The feed's
--      author object (buildAuthor / CommunityAuthor in customer-portal.ts) stays
--      exactly { displayName, handle, isYou, isMark } — agent-ness is resolved by
--      joining email->member admin-side, never sent to the /api/portal/* surface.
--
--   2) university_agent_reports — deterministic problem reports the runner files
--      to admin (non-2xx, broken audio, failed action, a member asking "are you a
--      bot?", a safety-gated reply, a blown spend budget). Code-emitted only,
--      never model-authored. Idempotent per (kind, dedupe_key) so a flapping
--      failure is one row/day/kind/target — and dedupe works even when member_id
--      is NULL (the auth_failure case, where the member is missing/inactive).
--
--   3) university_agent_usage — per-agent LLM cost ledger. Every Claude call the
--      runner makes writes one row (model + tokens + computed USD cost). This is
--      what powers the per-agent cost on the admin profile, the admin cost
--      dashboard, and the daily spend-ceiling sum.
--
-- Style mirrors 0122/0126: plain lowercase identifiers, IF NOT EXISTS on every
-- statement, CHECK for enums-by-convention, gen_random_uuid(), timestamptz now().
-- Depends only on university_members (0122) — independent of the community
-- tables (0126), which are merged into this branch separately.

-- 1) Agent identity on the member entity (ADMIN-ONLY).
ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS is_agent BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS agent_persona_key TEXT;        -- 'maya' | 'dario' | ... ; NULL for humans
ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS agent_paused_at TIMESTAMPTZ;   -- NULL = running; set = kill-switch engaged
ALTER TABLE university_members
  ADD COLUMN IF NOT EXISTS agent_pause_reason TEXT;       -- why an admin paused this agent

-- "Which members are agents / which are running" admin lookups.
CREATE INDEX IF NOT EXISTS university_members_is_agent_idx
  ON university_members (is_agent);

-- 2) Deterministic problem reports filed by the agent runner -> admin.
CREATE TABLE IF NOT EXISTS university_agent_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES university_members(id),  -- NULLABLE: auth_failure fires when the member is missing/inactive
  agent_persona_key TEXT,
  report_kind TEXT NOT NULL
    CHECK (report_kind IN (
      'auth_failure','rate_limit','error','profanity_block',
      'incomplete_task','model_timeout','bot_challenge','safety_block','budget_exceeded'
    )),
  severity TEXT NOT NULL DEFAULT 'warning'
    CHECK (severity IN ('info','warning','error','critical')),
  message TEXT NOT NULL,                              -- deterministic, code-emitted; never raw model text
  context JSONB NOT NULL DEFAULT '{}'::jsonb,         -- {personaKey, postId?, model?, httpStatus?, capName?, elapsedMs?}
  dedupe_key TEXT NOT NULL DEFAULT '',               -- '<persona|email>:<UTC-date>:<target>'
  is_resolved BOOLEAN NOT NULL DEFAULT false,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Idempotency keyed on (kind, dedupe_key) — NOT member_id — so it still dedupes
-- when member_id is NULL (auth_failure). One row/day/kind/target.
CREATE UNIQUE INDEX IF NOT EXISTS university_agent_reports_dedupe_uq
  ON university_agent_reports (report_kind, dedupe_key);

-- Admin queue: unresolved first, newest first.
CREATE INDEX IF NOT EXISTS university_agent_reports_unresolved_idx
  ON university_agent_reports (is_resolved, reported_at DESC);

-- Per-agent report history (the agent profile).
CREATE INDEX IF NOT EXISTS university_agent_reports_member_idx
  ON university_agent_reports (member_id, reported_at DESC);

-- 3) Per-agent LLM usage + cost ledger.
CREATE TABLE IF NOT EXISTS university_agent_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id UUID REFERENCES university_members(id),  -- the agent member (nullable to survive a member delete)
  agent_persona_key TEXT NOT NULL,
  model TEXT NOT NULL,                               -- claude-haiku-4-5 | claude-sonnet-4-6 | claude-opus-4-8
  purpose TEXT NOT NULL
    CHECK (purpose IN ('ambient','responsive_help','variation')),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,         -- computed from model price x tokens (see agent-runner/pricing)
  source TEXT NOT NULL DEFAULT 'llm'
    CHECK (source IN ('llm','fallback')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-agent cost rollups (agent profile) + daily spend-ceiling sum.
CREATE INDEX IF NOT EXISTS university_agent_usage_member_idx
  ON university_agent_usage (member_id, created_at DESC);

-- "Total cost today/week/month" admin dashboard + budget gate.
CREATE INDEX IF NOT EXISTS university_agent_usage_created_idx
  ON university_agent_usage (created_at DESC);

-- Cost-by-model breakdown.
CREATE INDEX IF NOT EXISTS university_agent_usage_model_idx
  ON university_agent_usage (model);
