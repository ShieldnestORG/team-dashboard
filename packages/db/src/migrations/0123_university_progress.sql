-- 0123_university_progress.sql
-- Coherent Ones University — rep-log / progress. The "Practice" half of the
-- learning loop that powers streaks + this-week counts on the portal.
--
-- A "rep" is one completed practice on a lesson for a given day. Reps are
-- idempotent PER (member, lesson, day): re-submitting the same lesson on the
-- same day updates the existing row in place rather than logging a duplicate,
-- so streak math (counting distinct rep-days) stays honest no matter how many
-- times the client POSTs.
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable fallback. Both are stored on the rep
-- so the streak query works before AND after the account link resolves. The day
-- bucket is an explicit `rep_day` DATE (UTC) rather than derived from
-- created_at, making the day boundary deterministic and the unique constraint
-- trivial to express.
--
-- Mirrors the 0122 table/index style. Additive only: 1 table + 4 indexes
-- (1 unique). Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key
  lesson_slug TEXT NOT NULL,
  drill_done BOOLEAN NOT NULL DEFAULT true,
  reflection TEXT,
  quiz_score INTEGER,
  rep_day DATE NOT NULL,                             -- UTC day bucket — idempotency + streak key
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one rep per member+lesson+day. A re-submit of the same lesson
-- on the same day upserts this row (ON CONFLICT in the service). Keyed on the
-- durable email identity so the constraint holds before the account link fires.
CREATE UNIQUE INDEX IF NOT EXISTS university_progress_rep_uq
  ON university_progress (email, lesson_slug, rep_day);

CREATE INDEX IF NOT EXISTS university_progress_email_idx
  ON university_progress (email);

CREATE INDEX IF NOT EXISTS university_progress_account_idx
  ON university_progress (account_id);

CREATE INDEX IF NOT EXISTS university_progress_lesson_idx
  ON university_progress (lesson_slug);
