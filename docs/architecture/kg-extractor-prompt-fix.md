# Knowledge Graph Extractor — Subject/Object Reversal & Cross-Subject Bleed Fix

> **Cluster:** Architecture · **Tags:** knowledge-graph, extractor, prompt, dependabot, subject-bleed, nexus · **Related:** [SBOM Parser Design](sbom-parser-design.md), [KG Cleanup Handoff](kg-2026-04-28-handoff.md), [Knowledge Graph Positioning](../products/knowledge-graph-positioning.md), [Intel API](../api/intel.md), [Ownership Matrix](../OWNERSHIP.md)

**Owner:** Nexus agent
**File under review:** `server/src/services/relationship-extractor.ts`
**Doc-only proposal — no code changes here. Implementation is a follow-up PR.**

Reproducibility note: evidence picks below are deterministic by primary key, but
re-running selects against `intel_reports` with `SELECT setseed(0.42);` first
will give the operator a stable order on any fuzzy follow-up queries.

---

## 1. Failure mode (with evidence)

A 38-row audit of the `uses` relationship found ~16% of triples wrong in a
recurring pattern. The bug has **three compounding causes**, all visible in the
production data:

### Cause A — Chunk-level subject bleed

`extractFromReports()` glues 10 reports together with `---` separators
(`relationship-extractor.ts:213-217`) and ships them as one prompt:

```ts
const combinedText = chunk
  .map((r) => `[${r.company_slug}] ${r.headline}\n${r.body.slice(0, 500)}`)
  .join("\n---\n");
```

The LLM does **not reliably treat each `---` block as an isolated subject
scope**. It happily emits triples whose `source` came from one block and whose
`target` came from another. Worse, `evidence_report_ids` is set to *the entire
chunk* (`chunk.map((c) => c.id)`), so audit trails point at unrelated reports
(price snapshots for Sei, Hedera, Render, etc.) and obscure which block the
LLM actually fired on.

### Cause B — Slug overloading at the harvester layer

The intel harvester collapses multiple GitHub repos onto a single
`company_slug`. From the chunk for triple #197 (`argo-cd uses postcss`):

> id 100923 / company_slug `argo-cd` / headline "Argo CD GitHub activity: 3 recent commits"
> body: `chore(deps-dev): bump postcss from 8.5.6 to 8.5.10 in /ui (#27537)`
> Source: `https://github.com/argoproj/argo-cd/commit/...`

That one is at least the right repo — but `postcss` is a `devDependency` of
the **Argo CD UI subproject** (`/ui`), not of Argo CD's Go server. Same chunk
for triple #67 (`argo-cd uses pgx`):

> id 57792 / company_slug `argo-cd` / headline "Argo CD GitHub activity"
> body: `chore(deps): bump github.com/jackc/pgx/v5 from 5.7.5 to 5.9.0`
> Source: `https://github.com/argoproj/argo-workflows/commit/...`

This is **not Argo CD at all** — it's `argo-workflows`, a sibling project. The
harvester normalizes both repos to slug `argo-cd`. The extractor inherits the
mistake.

Bedrock cases are the most extreme. From the chunk for triples #38/#30
(`amazon-bedrock uses vite`, `amazon-bedrock uses aws-cdk-lib`):

> id 52534 / company_slug `aws-bedrock` / headline "Amazon Bedrock released v3.0.1"
> body: "...We also upgraded to Vite 8, cutting build time by 60%..."
> Source: `https://github.com/aws/graph-explorer/releases/tag/v3.0.1`

> id 52537 / company_slug `aws-bedrock` / headline "Amazon Bedrock released 1.0.10"
> Source: `https://github.com/aws/code-editor/releases/tag/1.0.10`

`graph-explorer` and `code-editor` are AWS open-source repos that have nothing
to do with Bedrock the LLM service — they're a frontend graph viz tool and a
VS Code fork. Both get tagged `aws-bedrock` upstream.

### Cause C — Dependabot bumps treated as `uses`

`chore(deps): bump X` and `chore(deps-dev): bump X` are the literal strings
producing the `uses` edges. These are mechanical version bumps in
package.json/go.mod, not declarations of architectural use. `devDependencies`
in particular (postcss, vite as build tooling for a UI subdir) should never
produce a top-level `<product> uses <tool>` edge.

### Bonus — `node24` is hallucinated tech

Triple #82 (`azure-openai-service uses node24`) traces to id 65337:

> body: "Updated to use node24 by @thomas-temby"

`node24` is shorthand for **Node.js 24** (a runtime version). The extractor
created a `knowledge_tags` row for it via `resolveEntity()` because there's no
sanity check on what counts as an "entity." Version strings, file paths, and
PR titles all become tags.

---

## 2. Proposed prompt patch (diff-style)

Below is the smallest change that addresses Causes A and C. Cause B is a
harvester-layer issue that a prompt fix cannot fully solve (see §4).

```diff
 const EXTRACTION_PROMPT = `You are a knowledge graph extraction agent. Given an
-intel report about a blockchain/crypto/tech company, extract structured
-relationship triples.
+intel report about a blockchain/crypto/tech company, extract structured
+relationship triples.
+
+CRITICAL — SUBJECT SCOPING RULES (read before extracting):
+1. Each report block is delimited by "---". Treat blocks as INDEPENDENT.
+   Never emit a triple whose source comes from one block and whose target
+   comes from a different block.
+2. The bracketed slug at the start of each block (e.g. "[argo-cd]") is the
+   ONLY allowed value for "source" in that block. Do not infer a different
+   subject from text inside the block.
+3. If the block is a price snapshot, chain-metrics JSON, or otherwise has no
+   prose describing what the subject uses/integrates/etc., emit nothing for
+   that block.
+4. Dependabot / version-bump commits ("chore(deps): bump X", "chore(deps-dev):
+   bump X", "Updated to use nodeNN", "bump library/...") are NOT relationship
+   evidence. Skip them. They surface transitive deps and dev-tooling, not
+   product architecture.
+5. Frontend build tooling (Vite, PostCSS, Webpack, Rollup, Tailwind, esbuild)
+   inside a sibling /ui or /web subdirectory describes the UI subproject, not
+   the parent product. Do not emit "<backend product> uses <frontend tool>"
+   edges.
+6. Reject anything that isn't a real named product/company/library:
+   version numbers (node24, v3.0.1), file paths, PR titles, commit SHAs.

 Output ONLY a JSON array of objects with these fields:
 - "source": the name of the source entity (company or technology)
 - "relationship": one of: uses, built_on, competes_with, partners_with,
   fork_of, invested_in, maintains, integrates
 - "target": the name of the target entity (company or technology)
 - "confidence": a float 0.0-1.0 indicating how confident you are

 Rules:
 - Extract only factual relationships explicitly stated or strongly implied
 - Use canonical names (e.g., "Cosmos SDK" not "the Cosmos framework")
 - Do not extract speculative or uncertain relationships below 0.3 confidence
 - Return an empty array [] if no relationships are found
 - Output ONLY valid JSON, no markdown or explanation

-Example output:
-[{"source":"Osmosis","relationship":"built_on","target":"Cosmos SDK","confidence":0.95},{"source":"Osmosis","relationship":"integrates","target":"IBC Protocol","confidence":0.9}]
+Positive example:
+Block: "[osmosis] Osmosis upgrades to Cosmos SDK v0.50 — also enabled IBC v8."
+Output: [{"source":"Osmosis","relationship":"built_on","target":"Cosmos SDK","confidence":0.95},
+         {"source":"Osmosis","relationship":"integrates","target":"IBC Protocol","confidence":0.9}]
+
+NEGATIVE examples (DO NOT emit these):
+- Block "[argo-cd] chore(deps-dev): bump postcss from 8.5.6 to 8.5.10 in /ui"
+  → emit []. PostCSS is dev-tooling for the UI subdir; this is a Dependabot bump.
+- Block "[aws-bedrock] released v3.0.1 ... upgraded to Vite 8 ..."
+  Source: github.com/aws/graph-explorer
+  → emit []. The release belongs to aws/graph-explorer, not Bedrock; the slug
+  is wrong but you cannot re-attribute it. Skip rather than misattribute.
+- Block "[azure-openai] Updated to use node24"
+  → emit []. node24 = Node.js 24 runtime version, not an entity.

 Intel report:
 `;
```

---

## 3. Test plan

1. **Held-out batch.** Pick 10 reports the extractor has *not* yet processed.
   Bias the pick: 4 GitHub-activity reports under known-overloaded slugs
   (`aws-bedrock`, `azure-openai`, `argo-cd`, `aws`), 4 price snapshots, 2
   substantive prose reports (release notes with actual architecture text).
2. **Single-block runs.** Re-run extraction with the patched prompt but feed
   one report per call (chunk size = 1) as a control. Record triples.
3. **Multi-block runs.** Re-run with the existing chunk-of-10 path and the
   patched prompt. Diff against (2) — any triple unique to the multi-block
   run is suspect cross-block bleed.
4. **Audit.** Manually review every emitted triple. Pass criteria:
   - 0 triples whose subject is a different product than the slug-block.
   - 0 triples sourced from `chore(deps): bump …` lines.
   - 0 triples whose target is a version string or file path.
   - ≤1 ambiguous case per 10 reports (judgement-call frontend/backend split).
5. **Backfill audit.** Pull the existing 38-row audit set and re-extract with
   the patched prompt against the same evidence reports. Expect the 6 known-
   bad rows to drop out. Track the new precision number.

---

## 4. Structural issues a prompt fix cannot solve

- **Slug overloading at the harvester** (`argoproj/argo-workflows` →
  `argo-cd`; `aws/code-editor` and `aws/graph-explorer` → `aws-bedrock`).
  Fix at the harvester: either give each repo its own slug, or attach the
  source repo URL to each report and require the extractor to use the repo
  basename, not the slug, when forming the subject.
- **Evidence trail attribution.** `evidence_report_ids` should be the report
  the LLM actually fired on, not the whole chunk. Either (a) drop chunk size
  to 1 — the model is cheap (Ollama, local) — or (b) make the LLM echo the
  source slug for each triple and join post-hoc.
- **Dependency manifests as evidence.** package.json / go.mod content should
  be parsed deterministically into a separate `depends_on` edge type with
  scope (`runtime` vs `devDependency` vs `transitive`) instead of being
  flattened into `uses`. The LLM is the wrong tool for SBOM extraction.
- **Tag pollution from `resolveEntity()`.** It auto-creates a knowledge tag
  for any string the LLM emits. A whitelist or a "must match an existing
  tag/company OR be promoted by a curator" rule would have caught `node24`.

---

## 5. Recommendation for the existing 38 rows

- **Mark unverified, do not delete.** `company_relationships.verified`
  defaults to `false` and the audit found ~16% bad — the other ~84% are fine.
  Mass-delete is too lossy.
- Add a `metadata.flagged_reason` for the six audited bad rows
  (`"audit-2026-04-27-subject-bleed"`) so the dashboard can hide them and so
  the patched extractor's re-run can compare apples-to-apples.
- After the patched extractor re-runs and the precision check in §3 passes,
  delete only the rows that (a) are still flagged and (b) the patched
  extractor declined to re-emit.
