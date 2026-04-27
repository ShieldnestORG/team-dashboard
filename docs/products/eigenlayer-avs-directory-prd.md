# PRD: EigenLayer / Restaking AVS Directory (Initiative E)

**Status:** Planning — unshipped. Highest priority among topic-takeover initiatives.
**Parent plan:** [docs/products/topic-takeover-roadmap.md](./topic-takeover-roadmap.md)
**Target repos:** team-dashboard (schema seed + crons), `directory.coherencedaddy.com` (rendered subpage).

---

## What It Is

A dedicated subdirectory at `directory.coherencedaddy.com/restaking` that
tracks every EigenLayer AVS (Actively Validated Service), restaking protocol,
LRT (Liquid Restaking Token), and operator with **live signals** — GitHub
commit cadence, Twitter follower velocity, RSS posts, on-chain TVL where
queryable.

Today the only public list is a GitHub README at
`eigenfoundation/eigenlayer-ecosystem-network`. It's a markdown table — no
enrichment, no sorting, no freshness. CD wins this SERP by being the first
enriched, queryable, browsable interface.

---

## Customer Promise

> "The live, sortable AVS + restaking directory — see which projects are
> actually shipping, not just listed."

---

## Why This Initiative

- **Zero enriched competitor.** GitHub README is the de facto canonical
  source. Bankless and Messari paywall their research.
- **CD's SERP ingest pipeline is already configured for this vertical** —
  see Initiative A's seed queries: `"restaking protocols on Ethereum"`,
  `"Bitcoin Layer 2 rollup projects"`. We can feed Initiative E from the
  same pipeline with no new infra.
- **Outbound goldmine.** Every AVS listed is a candidate for the AEO outbound
  campaign in Initiative B — and AVS teams are well-funded.
- **Token tailwind.** EIGEN, ETHFI, REZ, KING all launched in the past 18
  months. Search volume for `"restaking AVS list"` and `"liquid restaking
  tokens"` is climbing.

---

## Scope

**In scope:**
- New `directory_vertical = 'restaking'` partition inside `intel_companies`.
- Seed list of ~80 AVS + ~30 LRTs + ~20 operators (curated by hand from the
  GitHub README + DefiLlama + Bankless writeups).
- Live signals: GitHub stars/commits, Twitter, RSS, EigenLayer on-chain TVL
  via DefiLlama API.
- Renderer subpage at `/restaking` with sortable columns + per-AVS profile
  pages.

**Out of scope:**
- Custom on-chain indexing (use DefiLlama + EigenLayer's public APIs).
- Token-price tracking (link out to CoinGecko).
- Operator performance metrics (delegate, slashing) — version 2.

---

## Data Flow

```
Initiative A SERP ingest (existing) ──┐
                                       ├─→ directory_pending (vertical=restaking)
Hand-seeded ~130 row migration ────────┘                │
                                                         ↓
                                          Echo enrichment (existing)
                                                         ↓
                                          intel_companies (vertical=restaking)
                                                         ↓
                                          DefiLlama TVL cron (new)
                                                         ↓
                                          directory.coherencedaddy.com/restaking
```

---

## Schema Additions

Reuse `intel_companies`. Add one column:

```sql
ALTER TABLE intel_companies
  ADD COLUMN tvl_usd numeric(18,2),
  ADD COLUMN tvl_as_of timestamptz;
```

New table: `restaking_metadata` for AVS-specific fields:

| Column | Type | Notes |
|---|---|---|
| `company_id` | int FK → intel_companies.id (PK) | |
| `avs_type` | text | `restaking-protocol` / `avs` / `lrt` / `operator` |
| `eigen_secured` | boolean | Whether registered on EigenLayer mainnet |
| `mainnet_live` | boolean | Live vs testnet-only |
| `audit_count` | int | Number of public audits |
| `defi_llama_slug` | text | For TVL lookup |
| `updated_at` | timestamptz | |

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `restaking-tvl-sync` | Every 6 hours | Hit DefiLlama for each row with `defi_llama_slug`; update tvl_usd + tvl_as_of |
| `restaking-mainnet-status` | Daily | Re-check mainnet vs testnet via EigenLayer subgraph (single GraphQL query) |

Initiative A's existing `directory-serp-discovery` and
`directory-candidate-enrich` crons handle ongoing growth — no new ingest
crons needed.

---

## Renderer (storefront)

New routes in `coherencedaddy-landing`:
- `/restaking` — index page, sortable by TVL / GitHub stars / mainnet status / freshness.
- `/restaking/[slug]` — profile page using existing `intel_companies` profile component, plus a "restaking metadata" card.

No new endpoints in team-dashboard — existing `/api/intel/company` and
listing endpoints already filter by `vertical`.

---

## Rollout Milestones

**M1 — Seed + schema (3 days)**
- Migration: `tvl_usd` columns + `restaking_metadata` table.
- Hand-seed ~130 rows from EigenLayer README + DefiLlama.
- TVL cron live. Verify against 5 known protocols.

**M2 — Renderer (3 days)**
- `/restaking` index + profile pages.
- Sort + filter UI.

**M3 — SERP capture (ongoing)**
- Cornerstone post: "EigenLayer AVS Directory — Live TVL + Activity, April 2026."
- Submit to Tier 3 backlink targets (see BACKLINK-TARGETS.md rows 10–12).
- Push the GitHub README maintainers to cross-link.

**M4 — Operator metrics (later)**
- Delegate amounts, slashing events, performance — pull from EigenLayer subgraph.

---

## Success Metrics (60 days)

- Top 5 Google result for `"EigenLayer AVS list"`, `"liquid restaking tokens"`, `"restaking protocols ranked"`.
- ≥150 enriched rows live (vs 0 enriched competitors).
- ≥20 AVS teams contacted via Initiative B outbound; ≥5 conversion to listed status with self-claim.

---

## Risks + Open Decisions

- **Curation drift.** The space moves fast — protocols rebrand, AVS get
  delisted. Mitigate via the existing Echo enrichment cron flagging stale
  rows. Consider a "Last verified" badge on each profile.
- **DefiLlama rate limits.** Their API allows ~30 req/min on the free tier;
  130 rows / 6h is well under, but watch for 429s.
- **Topic dilution.** Don't try to also cover Symbiotic, Babylon, Karak in
  v1 — those are separate verticals. Add as `restaking-competitor` tag,
  ship them in v2 to widen the SERP footprint without diluting the core.

---

## Dependencies

- **Upstream:** Initiative A (SERP ingest) for ongoing growth, existing
  `intel_companies` schema, Echo agent.
- **Downstream:** Initiative B outbound — every listed AVS becomes an
  outreach target.
