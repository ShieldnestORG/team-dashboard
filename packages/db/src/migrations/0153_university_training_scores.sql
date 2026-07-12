-- 0153_university_training_scores.sql
-- Coherent Ones University — per-member BEST scores for the brain-training
-- drills (the portal "Training" hub; member-facing copy says "drills", the
-- wire/DB slug field is `game_slug` per the frozen cross-repo contract).
--
-- One row per (member, drill). The portal POSTs every finished run to
-- /api/portal/university/training/score; the service upserts:
--   best_score = GREATEST(existing, incoming)
--   best_level = the level of the best-scoring run (replaced only when the
--                incoming score STRICTLY beats the stored best)
--   plays      = plays + 1 on EVERY valid submission
--
-- Read side: the community author pipeline (services/customer-portal.ts
-- buildAuthor) decorates authors with an optional trainingBadge — tier from
-- MAX(best_score) across the member's drills, percentile via percent_rank()
-- over NON-AGENT members (university_members.is_agent = false) having at least
-- one score. Members with no scores get NO badge (absent, never zeroed), and
-- agent-persona members are excluded from both the badge and the percentile
-- pool (honesty mandate — never fabricate agent activity).
--
-- Member identity is the university_members id (same key as
-- university_voice_meter / university_coherence_checks). Unlike those two,
-- the FK is declared here per the frozen contract — scores are meaningless
-- without their member row.
--
-- Hand-written in the repo's forward-only convention (no drizzle
-- journal/snapshot), next free slot after 0152. Additive only; `IF NOT EXISTS`
-- keeps it a safe no-op on any environment that already has the table.

CREATE TABLE IF NOT EXISTS university_training_scores (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  member_id   UUID        NOT NULL REFERENCES university_members(id),
  game_slug   TEXT        NOT NULL,
  best_score  INTEGER     NOT NULL,
  best_level  INTEGER     NOT NULL,
  plays       INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The six shipped drills. Adding a drill is a code change anyway, so the
  -- allowlist lives in the DB too (route also validates).
  CONSTRAINT university_training_scores_game_slug_ck CHECK (
    game_slug IN (
      'reaction-tap',
      'sequence-memory',
      'number-recall',
      'color-word',
      'pattern-grid',
      'circuit'
    )
  ),
  -- Defensive: contract ranges (route also validates).
  CONSTRAINT university_training_scores_score_ck CHECK (best_score BETWEEN 0 AND 1000),
  CONSTRAINT university_training_scores_level_ck CHECK (best_level BETWEEN 1 AND 5),
  CONSTRAINT university_training_scores_plays_ck CHECK (plays >= 0)
);

-- One row per member+drill — the upsert's ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS university_training_scores_member_game_uq
  ON university_training_scores (member_id, game_slug);

CREATE INDEX IF NOT EXISTS university_training_scores_game_idx
  ON university_training_scores (game_slug);
