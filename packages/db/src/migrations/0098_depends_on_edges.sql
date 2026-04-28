-- 0098_depends_on_edges.sql
-- SBOM deterministic parser: add `scope` column to company_relationships so
-- the new `depends_on` edge type can record runtime|devDependency|transitive.
--
-- The `relationship` column is plain TEXT (no Postgres enum), so no type
-- alter is needed for the new `depends_on` value.
--
-- Additive only. NULL for all existing rows (no backfill in this PR).

ALTER TABLE company_relationships
  ADD COLUMN IF NOT EXISTS scope TEXT;

COMMENT ON COLUMN company_relationships.scope IS
  'For depends_on edges: runtime | devDependency | transitive. NULL otherwise.';
