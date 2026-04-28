-- 0098_intel_reports_source_repo.sql
-- KG harvester slug-attribution fix: add a per-row repo provenance column on
-- intel_reports so GitHub-sourced rows can record which repo the activity came
-- from, independent of the umbrella company_slug.
--
-- Background: the GitHub harvester resolves a row's company_slug by org name
-- only (intel_companies.github_org), so an org with multiple public repos
-- (aws/, Azure/, argoproj/, ...) collapses every repo onto the single slug
-- that happens to share that org. Examples in prod intel_reports as of
-- 2026-04-27:
--   - report 52537: company_slug='aws-bedrock', source_url=aws/code-editor
--   - report 65337: company_slug='azure-openai', source_url=Azure/cli
-- Downstream extractor then emits triples like "Amazon Bedrock uses Vite"
-- from a graph-explorer release note.
--
-- This column lets the harvester record the actual org/repo so future audits
-- and re-attribution passes have ground truth without re-fetching GitHub.
-- See: docs/architecture/kg-extractor-prompt-fix.md §4
--
-- Additive only: one nullable column + one index. Safe to apply against prod.

ALTER TABLE intel_reports
  ADD COLUMN IF NOT EXISTS source_repo TEXT;

CREATE INDEX IF NOT EXISTS idx_intel_reports_source_repo
  ON intel_reports(source_repo)
  WHERE source_repo IS NOT NULL;
