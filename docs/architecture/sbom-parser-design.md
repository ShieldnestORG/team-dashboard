# SBOM Deterministic Parser — Design

**Owner:** Nexus agent
**Status:** v1 (this PR)
**Source recommendation:** [`kg-extractor-prompt-fix.md`](./kg-extractor-prompt-fix.md) §4

## Problem

The relationship-extractor LLM is misclassifying Dependabot bumps and
manifest contents (`chore(deps): bump postcss`, `chore(deps): bump pgx`,
"upgraded to Vite 8") as architectural `uses` edges. The 2026-04-27 KG audit
deleted six such edges from prod (`argo-cd uses postcss`, `amazon-bedrock
uses vite`, etc.). The class will recur every cron tick until SBOM extraction
moves out of the LLM.

## Design

### 1. Trigger

**Choice (a): inline in the GitHub harvester, after `intel_reports` insert.**

Rationale:
- The harvester already knows the source repo (`release.html_url`,
  `commit.html_url`) and rate-limits GitHub for us. A separate cron would
  duplicate that auth/throttle plumbing and burn extra API budget.
- On-demand from the Intel API (option c) gives unpredictable latency and
  doesn't fit how the KG is built — edges should land as evidence lands.
- The call is best-effort and wrapped in `try/catch`. Manifest fetch returning
  404 is the common case (most repos don't have a `package.json` at root for
  our key-file set) and is silently skipped, never logged loud.

### 2. Inputs

**v1 formats:** `package.json` (npm) and `go.mod` (Go).

These two cover 100% of the audit's bug patterns (postcss/vite from npm,
pgx from Go). `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `Gemfile`,
`pom.xml` are deferred to a follow-up — adding them is mechanical once the
edge schema and integration pattern are proven.

Manifests are fetched from `https://raw.githubusercontent.com/{owner}/{repo}/HEAD/{path}`
to avoid the GitHub API rate-limit budget for the common 404 case.

### 3. Output schema

New relationship: **`depends_on`** (additive, does not replace `uses`).

New column on `company_relationships`:

```sql
ALTER TABLE company_relationships
  ADD COLUMN IF NOT EXISTS scope TEXT;
-- Allowed values for depends_on edges: 'runtime' | 'devDependency' | 'transitive'
-- NULL for all legacy rows and for non-depends_on edges.
```

No CHECK constraint — legacy edges keep `scope = NULL` and we want freedom to
add scope values later (`peerDependency`, `optionalDependency`) without a new
migration.

The relationship enum on `company_relationships.relationship` is stored as
TEXT, not a Postgres ENUM type (verified via `\d company_relationships`), so
no enum-alter is required. The TS const `VALID_RELATIONSHIPS` in
`relationship-extractor.ts` is the only enforcement and is intentionally NOT
extended in this PR — `depends_on` is written by the deterministic parser
which has its own validation, and we explicitly do not want the LLM to start
emitting `depends_on`.

### 4. Subject scoping

The slug-overloading bug is the single root cause we must not reproduce.
Rules:

1. The parser accepts a `sourceRepo` argument of shape `"owner/repo"` (e.g.
   `"argoproj/argo-cd"`). It is the ONLY allowed value for the source side
   of the edge — the parser never reads `company_slug`.
2. The harvester wires this from `release.html_url` /
   `recentCommit.html_url` by extracting `owner/repo` from the GitHub URL.
3. If `sourceRepo` cannot be derived (URL unparseable, manifest fetch fails,
   manifest is empty/malformed), the parser returns `[]` and writes nothing.
4. PR #15 will add a `source_repo` column to `intel_reports` so the harvester
   no longer collapses sibling repos onto one slug. **This PR does not
   depend on the column existing** — it derives the repo from the URL it
   already has in hand. PR #15 strengthens the post-hoc audit story; it is
   not a runtime dependency.

The `source_id` written to `company_relationships` is the `sourceRepo`
string (e.g. `"argoproj/argo-cd"`). The `source_type` is `"repo"` — a new
value, not `"company"`. Downstream graph rendering can join `repo →
company_slug` later via a lookup table; we deliberately do NOT do that join
in this PR (avoids re-introducing the slug-overloading bug at write time).

### 5. De-duplication

Edges are written via the same UPSERT pattern the LLM extractor uses
(`ON CONFLICT (source_type, source_id, relationship, target_type, target_id)
DO UPDATE`). A typical `package.json` emits 50–200 edges; they are batched
in a single transaction per manifest. `confidence` is fixed at `1.0` for
deterministic parses. `evidence_report_ids` carries the single intel_report
id that triggered the parse. `extracted_by` is `'sbom-parser'`.

### 6. Migration plan

File: `packages/db/src/migrations/0099_depends_on_edges.sql`

```sql
ALTER TABLE company_relationships
  ADD COLUMN IF NOT EXISTS scope TEXT;

COMMENT ON COLUMN company_relationships.scope IS
  'For depends_on edges: runtime | devDependency | transitive. NULL otherwise.';
```

**No backfill.** Existing rows are unaffected. The new edge type starts
populating from the next harvester tick after merge.

### 7. Out of scope (future work)

- Transitive dependency resolution (no `npm ls`, no `go mod graph`). v1
  records only the deps a manifest *declares*.
- License analysis (SPDX extraction, compatibility matrix).
- Vulnerability matching (CVE / GHSA cross-reference).
- Additional manifests: `requirements.txt`, `pyproject.toml`, `Cargo.toml`,
  `Gemfile`, `pom.xml`, `composer.json`.
- Lockfile parsing (`package-lock.json`, `go.sum`, `poetry.lock`) — would
  give us pinned versions and transitive depth at the cost of much larger
  API payloads.
- A `repo → company_slug` lookup table to project SBOM edges back onto the
  company graph. Not needed until the UI wants to render them.
- Removing the `uses` edges that the LLM continues to emit from manifest
  text. PR #14 (prompt patch) addresses that side; deletion of the existing
  bad rows is a separate audit job (already partially done 2026-04-27).
