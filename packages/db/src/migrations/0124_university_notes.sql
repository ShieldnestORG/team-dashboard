-- 0124_university_notes.sql
-- Coherent Ones University — member NOTES store. Persists the in-lesson
-- "write this down" prompts so a member's notes survive across sessions and
-- devices, keyed to the lesson + a stable note slot.
--
-- A note is one piece of saved text for a member, a lesson, and a note slot
-- (`note_key`). Notes are idempotent PER (member, lesson, note_key):
-- re-saving the same slot updates the existing row in place rather than
-- appending a duplicate, so the in-lesson field maps 1:1 to a row.
--
-- The member is identified the same way the rest of University is — by the
-- shared customer_accounts login (account_id once the linker has fired) joined
-- on the lowercased `email` as the durable fallback. Both are stored on the
-- note so the lookup works before AND after the account link resolves. The
-- uniqueness key uses the durable email identity so the constraint holds before
-- the account link fires.
--
-- FUTURE: these member notes are the input corpus for a planned "smart pattern
-- recognition" feature ported from the Optimize Me / architect app — it will
-- analyze members' notes to surface what to work on + best suggestions. Not
-- built yet.
--
-- Mirrors the 0123 table/index style. Additive only: 1 table + 3 indexes
-- (1 unique). Safe to apply against prod.

CREATE TABLE IF NOT EXISTS university_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES customer_accounts(id),  -- nullable; set once login identity resolves
  email TEXT NOT NULL,                               -- lowercased durable join key
  lesson_slug TEXT NOT NULL,
  note_key TEXT NOT NULL,                            -- the in-lesson note slot
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotency: one note per member+lesson+note_key. A re-save of the same slot
-- upserts this row (ON CONFLICT in the service). Keyed on the durable email
-- identity so the constraint holds before the account link fires.
CREATE UNIQUE INDEX IF NOT EXISTS university_notes_note_uq
  ON university_notes (email, lesson_slug, note_key);

CREATE INDEX IF NOT EXISTS university_notes_email_idx
  ON university_notes (email);

CREATE INDEX IF NOT EXISTS university_notes_account_idx
  ON university_notes (account_id);

CREATE INDEX IF NOT EXISTS university_notes_lesson_idx
  ON university_notes (lesson_slug);
