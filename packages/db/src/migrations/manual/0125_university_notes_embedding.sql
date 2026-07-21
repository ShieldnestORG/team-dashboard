-- Run this manually on production (Neon). Embedded postgres has no pgvector,
-- and the manual/ dir is NOT picked up by `npm run migrate` (the runner scans
-- files, not subdirs) — apply it by hand via psql.
--
-- WHY:
--   Adds a 1024-dim embedding to member notes so University can offer
--   "find related notes" (semantic search) and, later, a read-only notes coach.
--   The column stays vector(1024); reads cast to ::halfvec(1024) (2 bytes/dim,
--   cosine ops, dodges the 2000-dim HNSW ceiling) — same pattern intel_reports
--   uses. The column is deliberately kept OUT of the Drizzle schema; all vector
--   ops are raw SQL (customer-portal.ts setNoteEmbedding / getRelatedNotes),
--   matching intel_reports / agent_memory / moltbook.
--
-- ORDER MATTERS — do NOT build the ANN index here:
--   pgvector index scans on an empty/tiny/NULL column silently return ZERO rows
--   (the glossary_embeddings incident, 2026-07-12). So the staged rollout is:
--     1. (this file) CREATE EXTENSION + ADD COLUMN — additive, no index.
--     2. deploy server code (embed-on-save fills new notes going forward).
--     3. run the backfill script (server/scripts/backfill-university-note-embeddings.ts
--        --apply) to embed all EXISTING notes.
--     4. ONLY THEN build the halfvec HNSW index (see the commented block below,
--        ship as manual/0126) once the column is populated. On a small table a
--        seq scan is fine and correct; add the index only when it grows.
--
-- HOW TO RUN — use the UNPOOLED endpoint (host WITHOUT `-pooler`):
--   DIRECT_URL=$(printf '%s' "$DATABASE_URL" | sed 's/-pooler//')
--   psql "$DIRECT_URL" -f packages/db/src/migrations/manual/0125_university_notes_embedding.sql

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE university_notes
  ADD COLUMN IF NOT EXISTS embedding vector(1024);

-- DO NOT create the ANN index until AFTER the backfill (see "ORDER MATTERS").
-- When the table is large enough to warrant it, ship this as manual/0126 and run
-- it on the UNPOOLED endpoint with maintenance_work_mem so the build has memory:
--   DIRECT_URL=$(printf '%s' "$DATABASE_URL" | sed 's/-pooler//')
--   PGOPTIONS='-c maintenance_work_mem=256MB' \
--     psql "$DIRECT_URL" -c "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_university_notes_embedding_hnsw
--       ON university_notes USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops);"
