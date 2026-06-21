-- 0128_community_idea_votes.sql
-- Coherent Ones University — COMMUNITY idea voting with required reasoning
-- (Spec B). Idea-type posts (added in Spec A, migration 0127) get their own
-- engagement mechanic: members vote up or "Needs work" (down), and EVERY vote
-- carries a written reason. One new table, additive — no change to posts,
-- comments, or reactions. Tallies are computed on read (per-page resolver,
-- mirroring Spec A's accepted-answer), so there are no denormalized columns
-- here and nothing to backfill.
--
--   - post_id      — the idea post being voted on. FK to
--                    university_community_posts(id). Only post_type='idea'
--                    posts are ever voted on (enforced in the service).
--   - account_id   — nullable; set once the customer-account-linker resolves
--                    the shared login. `voter_email` is the durable key.
--   - voter_email  — lowercased durable voter identity (mirrors reactions'
--                    reactor_email), so the one-vote constraint holds before
--                    AND after the account link fires.
--   - direction    — 'up' | 'down' ('down' surfaced as "Needs work" in UI);
--                    CHECK-gated.
--   - reason       — required free text (service-capped + profanity-gated).
--   - created_at / updated_at — re-voting UPDATEs the existing row in place
--                    (switching direction moves the tally, never double-counts).
--
-- UNIQUE (voter_email, post_id) — one vote per member per idea; the service
-- upserts on re-vote. Index on (post_id) backs the tally + rationale queries.
--
-- Mirrors the 0126/0127 table/index style. Additive only; safe to apply
-- against prod (no existing rows, no column changes elsewhere).

CREATE TABLE IF NOT EXISTS university_community_idea_votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES university_community_posts(id),
  account_id UUID REFERENCES customer_accounts(id),
  voter_email TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('up','down')),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One vote per member per idea. Named to match the Drizzle uniqueIndex and the
-- 0126/0127 named-index convention; this column set is the upsert conflict target.
CREATE UNIQUE INDEX IF NOT EXISTS university_community_idea_votes_uq
  ON university_community_idea_votes (voter_email, post_id);

-- Tally + rationale-list queries: all votes for an idea post.
CREATE INDEX IF NOT EXISTS university_community_idea_votes_post_idx
  ON university_community_idea_votes (post_id);
