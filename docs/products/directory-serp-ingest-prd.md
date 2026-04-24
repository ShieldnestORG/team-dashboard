# PRD: Directory SERP Ingest (Initiative A)

**Status:** Planning — unshipped.
**Parent plan:** `coherencedaddy-landing/docs/plans/2026-04-24-directory-expansion.md`
**Target repos:** team-dashboard (schema + crons + agents), storefront (read-only renderer).

---

## What It Is

A SERP-driven discovery pipeline that grows the `directory.coherencedaddy.com` catalog from ~511 hand-seeded companies into thousands of highly niche ones — crypto, AI/ML, DeFi, and DevTools projects we would never find by browsing ProductHunt or CoinGecko alone.

Candidates flow into a staging table, get enriched by the existing **Echo** agent, scored for quality, and either auto-promoted into `intel_companies` or surfaced in an admin review queue.

---

## Customer Promise

> "The most comprehensive niche directory in the industries we track — curated by content agents, not manual hand-seeding."

(Internal-only initiative — no paying customer directly, but the outbound AEO campaign in Initiative B depends on richer catalog coverage.)

---

## Why This Initiative

- Directory currently has **511 companies** verified 2026-04-24 (via `/api/intel/stats` → `coverage.total_companies`). Growth has been manual.
- Firecrawl infrastructure already exists (`server/src/services/firecrawl-sync.ts`, `firecrawl-crons.ts`). We use it today for `firecrawl-sync` intel reports, but not for net-new company discovery.
- `scripts/utility-network/research-niches.ts` already demonstrates Firecrawl + Ollama scoring to pick niche backlogs for the utility-network program. Same pattern, different target.
- Outbound outreach (Initiative B) is dramatically more effective at scale — each listed company becomes an email target. Catalog growth is the force multiplier.

---

## Data Flow

```
niche query config
      ↓
Firecrawl SERP scan (N×/day per query)
      ↓
raw SERP results → `directory_serp_raw` (optional cache)
      ↓
Extractor (LLM call): SERP result → candidate row
      ↓
Dedupe (domain + Levenshtein name match on intel_companies.slug / name)
      ↓
Echo enrichment pass (GitHub org, Twitter, RSS, CoinGecko)
      ↓
Quality score (signals ≥ N → auto-promote, else queue for review)
      ↓
`directory_pending` (staging) ──promote──> `intel_companies`
                               └──reject──> soft-delete, keep for learning
```

---

## Schema Additions

New tables in `packages/db/src/schema/` (team-dashboard):

### `directory_niche_queries`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `directory` | text | `crypto` / `ai-ml` / `defi` / `devtools` — matches `intel_companies.directory` |
| `query` | text | The SERP query (e.g. `"Cosmos IBC relayer operators"`) |
| `cadence_hours` | integer | How often to re-run (default 24, minimum 6) |
| `last_run_at` | timestamptz | |
| `active` | boolean | soft-disable |
| `created_at` / `updated_at` | timestamptz | |

### `directory_pending`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `candidate_slug` | text | derived from homepage domain |
| `candidate_name` | text | |
| `candidate_url` | text | homepage URL |
| `category_hint` | text | LLM-extracted |
| `tags_hint` | text[] | |
| `description_hint` | text | |
| `source_query_id` | int FK → `directory_niche_queries.id` | |
| `quality_score` | numeric(4,2) | 0-100; see Quality Score section |
| `enrichment_signals` | jsonb | `{github: bool, twitter: bool, rss: bool, coingecko: bool}` |
| `status` | text | `pending` / `promoted` / `rejected` |
| `promoted_company_id` | int FK → `intel_companies.id` | null until promoted |
| `promoted_at` / `rejected_at` / `created_at` | timestamptz | |

**No migration for `intel_companies` itself required** — promotion is a straight insert using existing columns.

---

## Quality Score

Simple, tunable weight sum (all in [0,1], then scaled to 0-100):

| Signal | Weight |
|---|---|
| Has GitHub org + ≥5 stars | 0.25 |
| Has Twitter/X handle with ≥100 followers | 0.15 |
| Has RSS feed | 0.10 |
| Appears in CoinGecko | 0.20 (crypto/defi only) |
| Domain age ≥ 6 months | 0.10 |
| Non-generic description (length > 40 chars, not just tagline boilerplate) | 0.10 |
| Unique-enough name (no fuzzy duplicate already in `intel_companies`) | 0.10 |

- Auto-promote: `quality_score ≥ 60`
- Admin review: `30 ≤ quality_score < 60`
- Auto-reject: `quality_score < 30` (still persisted for learning)

Weights are editable at runtime via an admin config row — ship with these defaults, iterate from observed conversion rates in Initiative B.

---

## Agent Assignments

| Agent | Task | Trigger |
|---|---|---|
| **Echo** | Profile enrichment (GitHub, Twitter, RSS, CoinGecko) on pending candidates | Hourly cron `directory-candidate-enrich` |
| **Extractor** (new, small LLM call — can reuse Ollama Cloud pattern) | SERP result → candidate row | Inline within the SERP cron |
| **Nexus** | Fuzzy-match dedup against `intel_companies` | Inline within the ingest pipeline |

No new named agent — Extractor is a single LLM call wrapped in a service module, not a persistent agent.

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `directory-serp-discovery` | Every hour; each query runs when `now() - last_run_at ≥ cadence_hours` | Hit Firecrawl for each active niche query; persist raw + extracted candidates |
| `directory-candidate-enrich` | Hourly | Run Echo over `directory_pending` rows with `status = 'pending'` and no enrichment yet |
| `directory-candidate-promote` | Every 15 min | Evaluate quality score; auto-promote eligible rows; surface review queue to admin UI |

---

## Backend Endpoints

New routes in `server/src/routes/directory-ingest.ts`:

- `GET /api/directory-ingest/queries` — list active queries (admin, authed)
- `POST /api/directory-ingest/queries` — create new query (admin)
- `PATCH /api/directory-ingest/queries/:id` — update cadence/active (admin)
- `GET /api/directory-ingest/pending?status=pending&limit=50` — review queue (admin)
- `POST /api/directory-ingest/pending/:id/promote` — manual promote (admin)
- `POST /api/directory-ingest/pending/:id/reject` — manual reject with reason (admin)

Storefront consumes nothing new — promoted rows appear on `directory.coherencedaddy.com/directory` via the existing `/api/intel/company` and listing endpoints.

---

## Admin UI (team-dashboard `ui/src/pages/`)

New page: `DirectoryIngestQueue.tsx`. Three tabs:
1. **Queries** — editable table of active niche queries with last-run + cadence.
2. **Review Queue** — candidates with `30 ≤ score < 60`, with one-click promote/reject + inline dedup candidate suggestions.
3. **Recent Promotions** — audit log with quality scores and source queries, so we can tune weights.

Reuses existing admin auth + layout patterns (see `ui/src/pages/IntelPricing.tsx`, `DirectoryPricing.tsx`).

---

## Seed Queries (v1)

Ship with ~40 queries across the 4 directories. Examples per vertical:

**Crypto:** "Cosmos IBC relayer operators", "Bitcoin Layer 2 rollup projects 2026", "modular blockchain data availability", "restaking protocols on Ethereum", "Solana MEV searcher tools".

**AI/ML:** "indie AI agent frameworks", "open-source LLM observability", "RAG pipeline startups Series A", "AI eval tools for LLM ops", "embedding model fine-tuning platforms".

**DeFi:** "perp DEX aggregators", "intent-based trading protocols", "RWA tokenization platforms", "yield vault aggregators Cosmos", "DeFi insurance protocols 2026".

**DevTools:** "developer-first AI code review", "DX metrics platforms for engineering teams", "AI-powered bug triage SaaS", "CI/CD platforms for Rust", "open-source internal developer platforms".

Seeds live in a migration or a one-shot script (`scripts/seed-directory-niche-queries.ts`), editable post-launch via admin UI.

---

## Rollout Milestones

**M1 — Schema + write path (1 week)**
- Migration for the two new tables.
- `directory-serp-discovery` cron scaffold that writes `directory_pending` rows but doesn't enrich yet.
- Seed queries loaded.
- Smoke: run the cron manually against 1 query; verify rows land in `directory_pending`.

**M2 — Enrichment + quality score (1 week)**
- `directory-candidate-enrich` cron wired.
- Quality-score calculation + thresholds.
- `directory-candidate-promote` cron (manual promote only — auto-promote gated off until M3).

**M3 — Admin UI + auto-promote (1 week)**
- `DirectoryIngestQueue.tsx` page shipped.
- Auto-promote gated behind `directory_ingest_auto_promote` feature flag (env var); flip on after 1 week of review-queue observation.

**M4 — Tuning + scale (ongoing)**
- Observe 30-day conversion from promotion → paid tier (requires Initiative B shipped).
- Tune quality weights.
- Expand seed queries from ~40 to 200+.

---

## Success Metrics (30 days post-M3)

- **+500 new companies** in `intel_companies`, with enrichment coverage ≥70% across GitHub/Twitter/RSS.
- **Review queue size < 200 at any point** (means auto-promote threshold is correctly tuned — not too aggressive, not too cautious).
- **False-positive rate < 5%** (measured by % of auto-promoted rows that admin later manually rejects / hides).

---

## Risks + Open Decisions

- **SERP cost at scale.** Firecrawl pricing may be too high at 40 queries × 4×/day × 30 days = 4,800 queries/month per environment. Budget check before M1. Alternatives: SerpAPI, ScrapingBee, Bright Data, Google Programmable Search Engine.
- **Dedup false negatives** (same company, different name spelling — e.g. "0x Protocol" vs "0x"). Start with Levenshtein + domain-match; graduate to embedding-based match if false-duplicate rate is above 2%.
- **Extractor hallucination.** LLM-based SERP parsing can invent facts. Gate the promotion pipeline on Echo enrichment succeeding with at least one real external signal (GitHub/Twitter/CoinGecko) — never promote based on extractor output alone.
- **Query pollution from marketing content** — queries like "best AI agents 2026" will return listicles, not companies. Prefer specific technical queries that surface real projects.

---

## Dependencies

- **Upstream:** existing `firecrawl-sync` service, `intel_companies` schema, Echo agent, Ollama Cloud (for Extractor).
- **Downstream:** Initiative B (Outbound AEO Campaign) — depends on catalog growth from A to have meaningful outreach volume.

---

## Post-Ship Documentation Updates

When M3 ships, update:
- `team-dashboard/docs/architecture/system-overview.md` — add SERP-ingest arrow into intel pipeline.
- `team-dashboard/docs/operations/cron-inventory.md` — list the 3 new crons.
- `team-dashboard/docs/api/intel.md` — document the new `/api/directory-ingest/*` admin routes.
- Mermaid diagram in `coherencedaddy-landing/docs/ARCHITECTURE.md` — add SERP ingest node feeding the directory.
- Close the Initiative A checkboxes in `TODO.md`.
