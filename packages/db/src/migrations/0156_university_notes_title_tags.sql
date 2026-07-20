-- 0156_university_notes_title_tags.sql
-- Coherent Ones University — Smart Notes v1. Adds a title + tags to the member
-- NOTES store so notes can be free-form ("write anything down") and, later,
-- AI-enriched with a short title + a few tags.
--
-- `title` is nullable — lesson notes may have none; the fire-and-forget
-- enrichment backfills a title only when it is still NULL (a user-set title is
-- never overwritten). `tags` is NOT NULL with an empty-array default so every
-- row always has an array to read (no NULL-vs-[] branching in the app).
--
-- The GIN index on `tags` supports future tag filtering/search. NOTE: this wave
-- does NOT add a pgvector/embedding column — semantic search is deferred.
--
-- Additive only: 2 columns + 1 index, all IF NOT EXISTS. Safe to apply against
-- prod (existing rows get title=NULL and tags='{}').

ALTER TABLE university_notes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE university_notes ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS university_notes_tags_gin ON university_notes USING gin (tags);
