-- Run this manually on production (Neon). Embedded postgres has no pgvector.
-- Supersedes the ivfflat index created in manual/0046_intel_vector.sql.
--
-- WHY:
--   idx_intel_reports_embedding was ivfflat(embedding vector(1024), lists=20) ≈ 831 MB
--   — ~44% of the whole database. Two problems:
--     1. Size: full float4 vectors in the index. halfvec (2 bytes/dim vs 4) ~halves it.
--     2. Recall: lists=20 is badly under-tuned for ~106k rows, and ivfflat recall
--        depends on a per-query `ivfflat.probes` GUC the app never sets (and cannot
--        safely set on the Neon transaction pooler). HNSW gives robust recall with
--        no per-query tuning.
--   Net: a halfvec HNSW index — smaller AND more accurate. The read queries in
--   server/src were updated to order by `embedding::halfvec(1024)` so the planner
--   uses this expression index. Writes are unchanged (column stays vector(1024)).
--
-- ZERO-DOWNTIME STAGED ROLLOUT:
--   1. (this file, pre-deploy) build the new index CONCURRENTLY — additive; the old
--      ivfflat index keeps serving the currently-deployed code.
--   2. deploy server code that queries via ::halfvec(1024).
--   3. (manual/0123, post-deploy) drop the old ivfflat index to reclaim space.
--
-- HOW TO RUN — use the UNPOOLED endpoint (host WITHOUT `-pooler`) so maintenance_work_mem
-- applies; the pooler rejects it as a startup parameter:
--   DIRECT_URL=$(printf '%s' "$DATABASE_URL" | sed 's/-pooler//')
--   PGOPTIONS='-c maintenance_work_mem=320MB' \
--     psql "$DIRECT_URL" -f packages/db/src/migrations/manual/0122_intel_embedding_halfvec.sql

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_intel_reports_embedding_hnsw
  ON intel_reports USING hnsw ((embedding::halfvec(1024)) halfvec_cosine_ops);
