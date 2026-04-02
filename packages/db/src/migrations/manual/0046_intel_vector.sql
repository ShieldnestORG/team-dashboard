-- Run this manually on production (Neon) after migration 0046_intel_tables.
-- Embedded postgres does not support pgvector.
--
-- psql $DATABASE_URL -f packages/db/src/migrations/0046_intel_vector.sql

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "intel_reports" ADD COLUMN IF NOT EXISTS "embedding" vector(1024);

CREATE INDEX IF NOT EXISTS "idx_intel_reports_embedding"
  ON "intel_reports" USING ivfflat ("embedding" vector_cosine_ops) WITH (lists = 20);
