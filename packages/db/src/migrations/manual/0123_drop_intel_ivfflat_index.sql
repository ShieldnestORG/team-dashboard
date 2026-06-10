-- Run this manually on production (Neon), POST-DEPLOY only.
-- Phase 3 of the halfvec migration started in manual/0122_intel_embedding_halfvec.sql.
--
-- PRECONDITION: the server code that queries `embedding::halfvec(1024)` is LIVE in
-- production. Until then the old ivfflat index below is still serving the deployed
-- code — dropping it early forces those semantic-search queries to sequential-scan
-- ~106k rows (functional but slow). Verify the deploy first, then run this.
--
-- Reclaims ≈ 831 MB (the old ivfflat index). The halfvec HNSW replacement from 0122
-- is already serving reads at this point.
--
-- HOW TO RUN (pooler is fine; no maintenance_work_mem needed for a drop):
--   psql "$DATABASE_URL" -f packages/db/src/migrations/manual/0123_drop_intel_ivfflat_index.sql

DROP INDEX CONCURRENTLY IF EXISTS idx_intel_reports_embedding;
