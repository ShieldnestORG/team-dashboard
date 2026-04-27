# PRD: Cosmos IBC Ecosystem Directory (Initiative H)

**Status:** Planning — unshipped. Sibling to Initiative E (restaking).
**Parent plan:** [docs/products/topic-takeover-roadmap.md](./topic-takeover-roadmap.md)
**Target repos:** team-dashboard (vertical seed + relayer health cron), `directory.coherencedaddy.com` (renderer).

---

## What It Is

A live-signal directory at `directory.coherencedaddy.com/cosmos` covering
every IBC-connected chain, relayer operator, and major Cosmos-native app —
with **relayer health** and **chain liveness** signals that the official
`cosmos.network/ecosystem/apps` page does not provide.

---

## Customer Promise

> "The Cosmos IBC ecosystem with live relayer health, chain block heights,
> and app activity — not a static logo wall."

---

## Why This Initiative

- **Sparse incumbent.** `cosmos.network/ecosystem/apps` is logo-grid only;
  no liveness, no enrichment, no sort.
- **Pipeline pre-configured.** Initiative A's seed query
  `"Cosmos IBC relayer operators"` is already in the schema.
- **Adjacent to Initiative E (restaking).** Babylon, EigenLayer-on-Cosmos,
  and ICS chains overlap. Same operator, similar enrichment.
- **Long-tail SEO.** `"IBC relayer status"`, `"cosmos chain registry list"`,
  `"top cosmos apps 2026"` — all under-served.

---

## Scope

**In scope:**
- New `directory_vertical = 'cosmos'` partition.
- Seed: ~80 chains + ~25 relayer operators + ~60 native apps (DEXes,
  staking platforms, Cosmos-SDK projects).
- Live signals: GitHub, Twitter, RSS, plus chain-specific block-height
  liveness via public RPCs.
- Relayer health endpoint integration (Cosmos hub mintscan / map of zones).

**Out of scope:**
- Validator-set tracking (Cosmostation already nails this).
- Token price (link to CoinGecko).

---

## Data Flow

```
Initiative A SERP ingest (Cosmos queries) ──┐
                                             ├─→ directory_pending
Chain Registry import (one-shot) ────────────┘          │
                                                         ↓
                                            Echo enrichment + manual triage
                                                         ↓
                                            intel_companies (vertical=cosmos)
                                                         ↓
                                            cosmos-liveness cron (new)
                                                         ↓
                                            directory.coherencedaddy.com/cosmos
```

---

## Schema

New table `cosmos_metadata`:

| Column | Type | Notes |
|---|---|---|
| `company_id` | int FK PK | |
| `cosmos_type` | text | `chain` / `relayer` / `app` |
| `chain_id` | text | If chain |
| `bech32_prefix` | text | If chain |
| `rpc_endpoints` | text[] | Public RPCs for liveness |
| `latest_block_height` | bigint | Updated by cron |
| `block_height_as_of` | timestamptz | |
| `liveness_status` | text | `healthy` / `stale` / `down` (block-height based) |

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `cosmos-liveness` | Every 10 min | For each chain row, ping first available RPC for `/status`; update height + status |
| `cosmos-relayer-health` | Hourly | Pull map-of-zones aggregate; update per-relayer activity |

---

## Renderer

- `/cosmos` — sortable index, default order: liveness desc, then activity.
- `/cosmos/[slug]` — chain or app profile with live block height.
- `/cosmos/relayers` — relayer leaderboard.

---

## Rollout Milestones

**M1 — Chain Registry import (3 days)**
- Pull `github.com/cosmos/chain-registry` for canonical chain list.
- Seed `cosmos_metadata` rows.
- Liveness cron live.

**M2 — Apps + relayers (3 days)**
- Hand-seed 60 native apps + 25 relayers.
- Echo enrichment passes.

**M3 — Renderer + outreach (1 week)**
- `/cosmos` page shipped.
- PR to chain-registry README adding CD as resource.
- Reddit r/cosmosnetwork post (Tier 3d).

---

## Success Metrics (60 days)

- ≥160 enriched rows.
- Top 5 for `"cosmos IBC ecosystem"`, `"cosmos chain list"`, `"IBC relayer status"`.
- Liveness signal accuracy ≥99% (cross-check vs mintscan).

---

## Risks + Open Decisions

- **Public RPCs are unreliable.** Rotate through `rpc_endpoints[]`; mark
  chain `down` only after 3 consecutive failures across multiple RPCs.
- **Chain Registry churn.** Re-import quarterly; auto-flag deltas.
- **Scope creep into Solana, Sui, Polkadot.** Hold the line — IBC-specific
  is the moat. Other ecosystems = other initiatives.

---

## Dependencies

- **Upstream:** Initiative A, `cosmos/chain-registry` GitHub repo, public
  Cosmos RPCs.
- **Downstream:** Initiative E (cross-link restaking + IBC ICS chains).
