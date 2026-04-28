# KG Cleanup Sprint — Handoff (2026-04-28)

**Status:** All 5 PRs merged, both migrations applied to prod Neon, VPS1 deployed and healthy on `c6fd3b89`. Open work below.

This file is the single source of truth for the next agent or operator picking up this workstream. Read it cold; everything you need is linked from here.

---

## What Just Shipped (already in prod)

| Concern | PR | What it does |
|---|---|---|
| Subject bleed + Dependabot edges | [#14](https://github.com/ShieldnestORG/team-dashboard/pull/14) | Tightened `EXTRACTION_PROMPT` with 6 SUBJECT SCOPING RULES + 3 negative examples; preserves canonical display names |
| Slug overloading at harvester (Cause B) | [#15](https://github.com/ShieldnestORG/team-dashboard/pull/15) | New `OVERLOADED_REPO_MAP` + per-repo skip/rewrite; `intel_reports.source_repo` column populated on every new GitHub harvest |
| PRD doc drift | [#16](https://github.com/ShieldnestORG/team-dashboard/pull/16) | Nexus cron 4h → 3h (cosmetic) |
| Junk tags (`node24`, version strings) | [#17](https://github.com/ShieldnestORG/team-dashboard/pull/17) | `resolveEntity()` denylist; drops triples whose endpoint can't resolve |
| Dependabot/SBOM as `uses` edges | [#18](https://github.com/ShieldnestORG/team-dashboard/pull/18) | Deterministic `package.json` + `go.mod` parser; emits `depends_on` edges with `scope` (runtime/devDependency); never blocks harvester |

**Migrations applied via psql** (Drizzle migrator is broken — see Open Issues):
- `0098_intel_reports_source_repo.sql` — adds nullable `source_repo` column + partial index
- `0099_depends_on_edges.sql` — adds nullable `scope` column on `company_relationships`

**DB cleanup performed:**
- 48 H2-mismatched rows flagged with `verified=false` + `metadata.flagged_reason="kg-cleanup-dry-run-20260428 heuristic match"`
- 3 confirmed-garbage rows DELETED (38, 40, 82) with backup at [`kg-block-b-deleted-rows-backup-20260428.jsonl`](../../kg-block-b-deleted-rows-backup-20260428.jsonl)
- 1 orphan `knowledge_tags` row DELETED (`node24`, id 48) with backup at [`kg-orphan-tag-node24-backup-20260428.jsonl`](../../kg-orphan-tag-node24-backup-20260428.jsonl)
- 1 row added to `intel_companies`: `argo-workflows` (devtool-cicd, argoproj) — needed for PR #15's slug rewrite to find a join target

**Production state right now:**
- VPS1 (`31.220.61.12`) container `team-dashboard-server-1` healthy on `c6fd3b89`
- 95 crons registered including all 9 KG jobs
- `company_relationships`: **135 edges** (138 − 3 deleted), of which **87 are trusted**, 48 unverified pending re-extraction
- Cash burn: ~$0/mo (Ollama Cloud free tier + sunk VPS2 + Neon storage absorbed)

---

## Strategy (not a product, an ingredient)

The KG is **not a SKU**. The 2026-04-27 council session ([transcript](../../council-transcript-20260427-234502.md), [report](../../council-report-20260427-234502.html)) concluded:

- Audience is **Intel API customer** (indie devs, AI engineers, infra builders) — NOT CreditScore SMBs
- Phase 1 (now): silent `dependencies` block enrichment in Intel API entity responses
- Phase 2 (only if Phase 1 earns it): single `GET /v1/entity/:slug/dependencies` endpoint on existing Pro tier
- **60-day kill metric (deadline 2026-06-26):** ≥200 enriched paid responses in any rolling 7-day window AND ≥75% spot-check accuracy. Miss either → freeze Nexus, KG goes dormant

Killed plays (do not resurrect): Crayon/Klue competitive intel upsell, CreditScore competitive landscape, programmatic "vs / alternatives" SEO, standalone KG SaaS, embedding licensing.

Full positioning: [`docs/products/knowledge-graph-positioning.md`](../products/knowledge-graph-positioning.md)

---

## Open Work — In Priority Order

### P0 — Validate the deploy (run in next 3–24h)

Nexus runs every 3 hours. After 1–2 ticks under the new code:

1. **Re-run cleanup heuristics on the 48 flagged rows** to see how much self-heals after re-ingestion under the patched harvester:
   ```bash
   npx tsx scripts/audit/kg-cleanup-dry-run.ts
   # Compare flagged-row count vs the 48 baseline; expect drop
   ```
2. **Spot-check fresh triples for new false positives.** Pull the 50 newest `company_relationships` rows where `created_at > '2026-04-28 11:45:00'` and eyeball them. Watch especially for new `depends_on` edges from the SBOM parser — those are the highest-volume new edges, and a regression there will balloon row counts fast.
3. **Watch for SBOM volume.** A single `package.json` can emit 100+ `depends_on` edges. The parser is best-effort and silent on 404s, but if it succeeds on a popular repo (kubernetes, anyscale) the edge count will jump from 135 to thousands. That's by design but operator should know.

### P1 — Re-deploy YT branch when ready

VPS1 was on `fix/yt-caption-sync` with 10+ in-flight YT commits ([`b2391d15`](https://github.com/ShieldnestORG/team-dashboard/commits/b2391d15)). Branch is safely on origin (SHA matches), nothing lost. To put YT work back into production:

```bash
ssh root@31.220.61.12 'cd /opt/team-dashboard/repo && git checkout fix/yt-caption-sync && git pull && cd /opt/team-dashboard && docker compose build && docker compose up -d'
```

Note: this will revert the KG fixes too if `fix/yt-caption-sync` hasn't been rebased on master. Either rebase YT onto master first, or merge YT into master, before re-deploying.

### P1 — Drizzle migrator is broken

`pnpm db:migrate` thinks 40 migrations are pending and errors on `type "vector" does not exist`. Pre-existing bug discovered during this sprint when applying 0098/0099. **Workaround used:** apply SQL directly with psql. The migrations 0098/0099 are well-formed and idempotent (use `IF NOT EXISTS`).

Likely root cause (unverified): `_journal.json` only has entries up to migration 0050; everything from 0051+ is treated as pending. Plus the runner doesn't bootstrap the pgvector extension before applying old migrations that reference `vector` type.

Need to investigate `packages/db/src/client.ts:applyPendingMigrations` and `inspectMigrations` to understand how it tracks state. Workaround for new migrations meanwhile: apply with `psql "$DATABASE_URL" -f packages/db/src/migrations/<name>.sql`.

### P2 — Address 4 Dependabot moderate vulns on master

GitHub flagged on every push during this sprint. Visit [security/dependabot](https://github.com/ShieldnestORG/team-dashboard/security/dependabot) and patch or suppress. Already in `TODO.md`.

### P2 — Wire Phase 1 silent enrichment into Intel API

Per [positioning doc §5](../products/knowledge-graph-positioning.md), Phase 1 is the silent `dependencies` block injected into existing Intel API entity responses. Not a new endpoint, not a new tier. This is the work that actually makes the KG earn its keep against the 60-day kill metric.

Files to touch (best guess):
- `server/src/routes/intel.ts` (or wherever Intel API entity responses are built)
- A new helper that joins `company_relationships` for `uses` + `integrates` + `built_on` + `maintains` edges where `verified=true` and source matches the entity slug

### P3 — Dogfood the KG for an operator decision

Use the KG yourself for one real choice (next product, next partner, who to write a tutorial about). If it doesn't change your behavior, the customer-facing version won't change theirs either. Council put this BEFORE Phase 1 wiring; we shipped Phase 1 prereqs first because they were unblocked.

### P3 — Re-run A/B test on substantive prose

The original A/B sample skewed toward GitHub-activity reports (validator JSON, Dependabot bumps). After 3+ days of fresh ingestion under new code, re-run [`scripts/audit/kg-extractor-ab-test.ts`](../../scripts/audit/kg-extractor-ab-test.ts) on substantive release notes (≥500-char body) to confirm the patched prompt isn't over-correcting on real architecture text.

### P4 — 60-day tripwire (2026-06-26)

Concrete kill metric — measure both:
- ≥200 enriched paid Intel API responses in any rolling 7-day window where `dependencies` block was non-empty
- ≥75% accuracy on a 50-edge spot-check of dependency blocks served to paid customers

Miss either → pause Nexus, freeze Weaver, keep schema dormant. Set a calendar reminder or schedule a remote agent.

---

## Reference — Where Everything Lives

### Code
- Extractor (prompt + denylist): `server/src/services/relationship-extractor.ts`
- Harvester (slug attribution): `server/src/services/intel.ts` (search `OVERLOADED_REPO_MAP`)
- SBOM parser: `server/src/services/sbom-parser.ts`
- KG crons: `server/src/services/knowledge-graph-crons.ts`
- Schemas: `packages/db/src/schema/{company_relationships,knowledge_tags,intel_reports,intel_companies,agent_memory}.ts`
- Migrations applied this sprint: `packages/db/src/migrations/{0098_intel_reports_source_repo,0099_depends_on_edges}.sql`

### Tests
- `server/src/__tests__/relationship-extractor.test.ts` (13 tests, denylist)
- `server/src/__tests__/sbom-parser.test.ts` (13 tests, SBOM)

### Docs
- Strategy: [`docs/products/knowledge-graph-positioning.md`](../products/knowledge-graph-positioning.md)
- Original audit + extractor diagnosis: [`docs/architecture/kg-extractor-prompt-fix.md`](kg-extractor-prompt-fix.md)
- SBOM parser design: [`docs/architecture/sbom-parser-design.md`](sbom-parser-design.md)
- Burn estimate: [`docs/operations/kg-burn-estimate.md`](../operations/kg-burn-estimate.md)
- Council session (the strategy decision): [`council-transcript-20260427-234502.md`](../../council-transcript-20260427-234502.md), [`council-report-20260427-234502.html`](../../council-report-20260427-234502.html)

### Sprint artifacts (untracked, repo root)
- `kg-audit-20260428.txt` — original 38-row audit output
- `kg-extractor-ab-results-20260428.md` — held-out A/B (OLD 19 → NEW 2)
- `kg-reextract-flagged-results-20260428.md` — patched extractor on the 6 flagged rows (0 STILL EMITTED)
- `kg-cleanup-dry-run-20260428.md` — heuristic scan that produced the 48 + 3 cleanup
- `kg-block-b-deleted-rows-backup-20260428.jsonl` — backup of deleted rows 38/40/82
- `kg-orphan-tag-node24-backup-20260428.jsonl` — backup of deleted knowledge_tag

### Audit / cleanup scripts (untracked, `scripts/audit/`)
- `kg-accuracy-sample.sql` — pull a 200-row sample for human accuracy grading
- `kg-extractor-ab-test.ts` — OLD-vs-NEW prompt A/B harness
- `kg-reextract-flagged.ts` — re-run patched extractor against specific flagged rows' evidence
- `kg-cleanup-dry-run.ts` — H1–H5 heuristic cleanup with bucketed action recommendations

### Infrastructure
- VPS1 (team-dashboard backend): `31.220.61.12`. Deploy: `ssh root@31.220.61.12 'cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose build && docker compose up -d'`
- Neon Postgres (prod): `DATABASE_URL` in `.env`, host `ep-shiny-pine-amwqhmr1-pooler.c-5.us-east-1.aws.neon.tech`
- Ollama: Cloud free tier (`ollama.com`) for KG agents — see [`reference_ollama_routing.md`](../../../.claude/projects/-Users-exe-Downloads-Claude-team-dashboard/memory/reference_ollama_routing.md)

---

## How To Read This Without Burning Cache

If you only have 5 minutes: read this file's "What Just Shipped" + "Open Work P0/P1" sections.

If you only have 30 minutes: also read [`council-report-20260427-234502.html`](../../council-report-20260427-234502.html) (5-min visual brief) and [`docs/products/knowledge-graph-positioning.md`](../products/knowledge-graph-positioning.md) (10-min full positioning).

If you're picking up cold and need the full context: read this, then the two docs above, then the original audit + extractor diagnosis ([`kg-extractor-prompt-fix.md`](kg-extractor-prompt-fix.md)). Skip the council transcript unless someone proposes resurrecting a killed play — then re-read it to see why it died.
