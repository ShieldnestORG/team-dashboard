-- =============================================================================
-- Knowledge Graph Accuracy Audit — Sampling Query
-- =============================================================================
--
-- Purpose:
--   The KG (company_relationships) is populated by Ollama via
--   server/src/services/relationship-extractor.ts. Before we monetize anything
--   on top of Weaver/Nexus, we must establish a human-eyeballed accuracy floor
--   on the strongest relationship type (likely `uses` or `competes_with`).
--
-- How to run:
--   1. Get the prod DATABASE_URL. It is set in /Users/exe/Downloads/Claude/team-dashboard/.env
--      on the VPS, and in `server/src/config.ts` it is read from
--      `process.env.DATABASE_URL` (Neon connection string). On the VPS host
--      (31.220.61.12) you can: `ssh root@31.220.61.12 'cat ~/team-dashboard/.env | grep DATABASE_URL'`
--      Or pull it from Neon directly.
--
--   2. From your laptop:
--        psql "$DATABASE_URL" -f scripts/audit/kg-accuracy-sample.sql > kg-audit-$(date +%Y%m%d).txt
--
--      Or for tab-separated CSV that opens cleanly in a spreadsheet:
--        psql "$DATABASE_URL" -A -F $'\t' -f scripts/audit/kg-accuracy-sample.sql \
--          > kg-audit-$(date +%Y%m%d).tsv
--
-- What to do with the output:
--   - SECTION 1 prints edge counts by relationship type. Pick the largest one
--     (expected: `uses` or `competes_with`).
--   - SECTION 2 prints a 200-row random sample of that type, with resolved
--     source/target NAMES (joined to intel_companies / knowledge_tags), the
--     model's confidence, evidence_report_ids, and verified flag.
--   - For each row, the human auditor judges: is this relationship factually
--     correct given the evidence reports? Mark Y/N in a sheet.
--   - Compute correct / 200.
--
-- Threshold gate:
--   - >= 70% correct  => Weaver is good enough. Proceed to internal enrichment
--                        (auto-tag intel reports, expose graph features to
--                        paying tiers, etc.).
--   - <  70% correct  => DO NOT monetize. Fix Weaver first: tighten the
--                        EXTRACTION_PROMPT, raise the 0.3 confidence floor,
--                        switch the Ollama model, or add a verification pass.
--
-- Notes on the schema (packages/db/src/schema/company_relationships.ts):
--   - source_type / target_type are 'company' or 'tag'
--   - source_id / target_id are SLUGS, not UUIDs (resolveEntity in the
--     extractor lowercase-slugifies the name and looks it up in
--     intel_companies, then knowledge_tags, else creates a new tag)
--   - relationship is one of: uses, built_on, competes_with, partners_with,
--     fork_of, invested_in, maintains, integrates
--   - confidence is REAL 0.0-1.0 (extractor drops anything < 0.3)
--   - evidence_report_ids is jsonb array of intel_reports.id
--   - verified is a boolean a human flips after auditing
--
-- Caveat: if the table is small (< 200 rows of the chosen type) the sample
-- will simply return all of them. Adjust the LIMIT in SECTION 2 if needed.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- SECTION 1: Edge counts by relationship type
-- -----------------------------------------------------------------------------
\echo '=== Edge counts by relationship type ==='
SELECT
  relationship,
  COUNT(*)                                       AS edge_count,
  ROUND(AVG(confidence)::numeric, 3)             AS avg_confidence,
  COUNT(*) FILTER (WHERE verified)               AS verified_count,
  COUNT(*) FILTER (WHERE jsonb_array_length(evidence_report_ids) > 0) AS with_evidence
FROM company_relationships
GROUP BY relationship
ORDER BY edge_count DESC;

-- -----------------------------------------------------------------------------
-- SECTION 2: Random 200-row sample of the strongest relationship type
--
-- Default target = 'uses'. Change the value of :target_rel below before running
-- if SECTION 1 shows a different leader.
--
-- Override at invocation:
--   psql "$DATABASE_URL" -v target_rel="'competes_with'" \
--     -f scripts/audit/kg-accuracy-sample.sql
-- -----------------------------------------------------------------------------
\set target_rel '\'uses\''
\echo '=== Random 200-row sample for relationship = ' :target_rel ' ==='

WITH resolved AS (
  SELECT
    cr.id,
    cr.relationship,
    cr.source_type,
    cr.source_id,
    COALESCE(ic_src.name, kt_src.name, cr.source_id) AS source_name,
    cr.target_type,
    cr.target_id,
    COALESCE(ic_tgt.name, kt_tgt.name, cr.target_id) AS target_name,
    cr.confidence,
    cr.verified,
    cr.evidence_report_ids,
    cr.extracted_by,
    cr.created_at
  FROM company_relationships cr
  LEFT JOIN intel_companies  ic_src ON cr.source_type = 'company' AND ic_src.slug = cr.source_id
  LEFT JOIN knowledge_tags   kt_src ON cr.source_type = 'tag'     AND kt_src.slug = cr.source_id
  LEFT JOIN intel_companies  ic_tgt ON cr.target_type = 'company' AND ic_tgt.slug = cr.target_id
  LEFT JOIN knowledge_tags   kt_tgt ON cr.target_type = 'tag'     AND kt_tgt.slug = cr.target_id
  WHERE cr.relationship = :target_rel
)
SELECT
  id,
  source_type || ':' || source_name        AS source,
  relationship,
  target_type || ':' || target_name        AS target,
  ROUND(confidence::numeric, 2)            AS confidence,
  verified,
  evidence_report_ids,
  extracted_by,
  created_at
FROM resolved
ORDER BY random()
LIMIT 200;

-- -----------------------------------------------------------------------------
-- SECTION 3: Optional — pull the actual evidence text for any single edge
--   so the auditor can quickly verify a flagged row. Replace 12345 with the
--   id from SECTION 2.
-- -----------------------------------------------------------------------------
-- SELECT ir.id, ir.company_slug, ir.report_type, ir.headline,
--        LEFT(ir.body, 600) AS body_excerpt
-- FROM intel_reports ir
-- WHERE ir.id = ANY (
--   SELECT (jsonb_array_elements_text(evidence_report_ids))::int
--   FROM company_relationships WHERE id = 12345
-- );
