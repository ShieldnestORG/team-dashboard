# Topic-Takeover Roadmap

**Status:** Active. The connective tissue across Initiatives A, B, D, and the new E–I.
**Date:** 2026-04-26.
**Owner:** Coherence Daddy strategy.

---

## What this doc is

The five new initiatives (E–I) plus the two utility-network pivots are
**not stand-alone** — they consume Initiative A's SERP-ingest pipeline,
feed Initiative B's outbound, and graduate Initiative D's tool-niche
backlog. This roadmap is the single page that says how they connect, what
order to ship, and what each one needs from the others.

---

## The initiative map

```
                    ┌──────────────────────────────────────────────┐
                    │     Initiative A: Directory SERP Ingest      │
                    │  (Firecrawl → directory_pending → Echo →     │
                    │           intel_companies)                    │
                    └───────────┬──────────────────────────────────┘
                                │  feeds enriched rows
        ┌───────────────────────┼───────────────────────────────────┐
        ↓                       ↓                                    ↓
  ┌──────────┐            ┌──────────┐                         ┌──────────┐
  │  E:      │            │  F:      │                         │  H:      │
  │ Restaking│            │FaithTech │                         │ Cosmos   │
  │ Directory│            │ Directory│                         │   IBC    │
  └────┬─────┘            └────┬─────┘                         └────┬─────┘
       │                       │                                    │
       │   ┌─────────────────────────────────────────────┐          │
       └──>│       Initiative B: Outbound AEO            │<─────────┘
           │  (every listed company → cold-email target) │
           └───────────────────┬─────────────────────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │  G: AEO Content     │
                    │     Cluster         │  ←── cornerstone for cold emails
                    │  (48-rule playbook) │  ←── CreditScore funnel CTA
                    └──────────┬──────────┘
                               │
                               ↓
                    ┌─────────────────────┐
                    │  CreditScore conv.  │
                    └─────────────────────┘

Side channel:
  ┌──────────┐  feeds picks  ┌──────────────────┐
  │  D:      │──────────────>│  Utility-network │
  │ Niche    │               │  pivots:         │
  │ Harvest  │               │  - tokencount    │
  │ backlog  │               │  - dailycompound │
  └──────────┘               └─────────┬────────┘
                                        │ cross-links to E
                                        ↓
                              ┌──────────────────┐
                              │ Initiative I:    │
                              │ DevTools Live    │
                              │ Signals          │ ── DevTools Pulse newsletter
                              └──────────────────┘
```

---

## Initiative summary table

| ID | Initiative | Doc | Strategic role | Depends on | Feeds |
|---|---|---|---|---|---|
| A | Directory SERP Ingest | [directory-serp-ingest-prd.md](./directory-serp-ingest-prd.md) | Catalog growth engine | — | E, F, H, I, B |
| B | Outbound AEO Campaign | (existing PRD) | Conversion engine | A, G | CreditScore |
| D | Tool Niche Harvest | [tool-niche-harvest-prd.md](./tool-niche-harvest-prd.md) | Backlog hygiene | research-niches.ts | utility-network builds |
| **E** | **EigenLayer / Restaking Directory** | [eigenlayer-avs-directory-prd.md](./eigenlayer-avs-directory-prd.md) | **SERP land grab — zero enriched competitor** | A | B, dailycompound pivot |
| **F** | **Faith-Based Tech Directory** | [faith-tech-directory-prd.md](./faith-tech-directory-prd.md) | **508(c)(1)(A) moat** | A | B, Tier-2 backlinks |
| **G** | **AEO Content Cluster** | [aeo-content-cluster-prd.md](./aeo-content-cluster-prd.md) | **Funnel for CreditScore** | aeo-seo-playbook-prd.md | CreditScore, B |
| **H** | **Cosmos IBC Directory** | [cosmos-ibc-directory-prd.md](./cosmos-ibc-directory-prd.md) | **Adjacent SERP — sibling of E** | A | B, E (cross-links) |
| **I** | **DevTools Live Signals** | [devtools-live-signals-prd.md](./devtools-live-signals-prd.md) | **Repositioning, not new vertical** | A (existing devtools rows) | G (Pulse content) |
| — | tokencount pivot | [utility-network/tokencount-pivot-brief.md](./utility-network/tokencount-pivot-brief.md) | Up-stack utility | — | CreditScore-for-AI-cost (future) |
| — | dailycompound pivot | [utility-network/dailycompound-pivot-brief.md](./utility-network/dailycompound-pivot-brief.md) | Crypto-yield utility | E (live APRs) | E (cross-link) |

---

## Sequenced rollout

**Phase 1 (next 2 weeks) — foundations**
1. Initiative A finish M2 (it's already in flight). Without auto-promote
   live, E/F/H ingest will back up.
2. **G — Cornerstone + 3 spokes** of the AEO content cluster. This is the
   highest-leverage piece because every other initiative's outreach (B, E,
   F, H, I) anchors emails on G content.
3. **Backlinks doc seeded** — execute Tier 1 immediately.

**Phase 2 (weeks 3–6) — directory expansion**
4. **E — Restaking directory** (M1 + M2). First topic-takeover land grab
   to ship; clearest moat.
5. **H — Cosmos directory** (M1 + M2). Reuses E's enrichment patterns;
   ships fast.
6. **F — Faith-tech directory** (M1 + M2). Ships in parallel; different
   team owner if available.
7. **dailycompound pivot** runs in parallel — directly cross-links into E.

**Phase 3 (weeks 7–10) — content + signals**
8. **G — Mid-cluster spokes** (6 more posts).
9. **I — DevTools live signals** (M1 + M2). Pulse newsletter starts.
10. **tokencount pivot** ships.
11. Initiative B — outbound campaign turns on against E + F + H listings.

**Phase 4 (weeks 11+) — compounding**
12. **G — Full cluster + GitHub mirror.**
13. **D — Tool niche harvest** runs to feed phase-2 utility-site picks.
14. Backlink Tier 3 push across all topic-takeover targets.

---

## Cross-cutting decisions

- **Naming convention.** All five takeovers use `directory_vertical = '<slug>'`
  in `intel_companies`. No new top-level tables for verticals — each gets
  one metadata table at most.
- **Renderer ownership.** Subpages live in `coherencedaddy-landing` (the
  storefront repo), team-dashboard owns data + crons + admin UIs only.
  Per CLAUDE.md ownership matrix.
- **Backlink discipline.** No tier sprawl. Hold the active list ≤50 targets.
  Submissions tracked in `directory_listings`; weekly digest cron emails
  the operator.
- **CreditScore is the universal CTA.** Every directory profile page,
  every blog post, every utility microsite — one CreditScore CTA, rotated
  across three messages.
- **508(c)(1)(A) framing.** Used explicitly only on F (faith-tech
  directory). Mentioned in author bio everywhere else as authority signal,
  not as marketing.

---

## Open questions / decisions needed

1. **Editorial capacity for G.** 12–15 spokes in 4 weeks is real work. If
   solo, stretch to 8 weeks or recruit a guest writer per spoke.
2. **Initiative B status.** This roadmap assumes B is shipped or shipping
   alongside. If not, E + F + H still produce SEO value but the
   conversion loop is slower.
3. **DefiLlama dependency** for E and dailycompound pivot. Single point of
   failure — at minimum, cache + plan a fallback to direct EigenLayer
   subgraph queries.
4. **Resource conflict between E and F.** Same operator, different verticals.
   If solo, ship E first (clearer moat), F second. If two operators, ship
   in parallel.

---

## Running TODO checklist

- [x] Create BACKLINK-TARGETS.md (this session)
- [x] PRD: Initiative E — Restaking
- [x] PRD: Initiative F — FaithTech
- [x] PRD: Initiative G — AEO content cluster
- [x] PRD: Initiative H — Cosmos
- [x] PRD: Initiative I — DevTools live signals
- [x] Pivot brief: tokencount
- [x] Pivot brief: dailycompound
- [x] Roadmap doc (this file)
- [ ] Migration: `tvl_usd` + `tvl_as_of` on `intel_companies`
- [ ] Migration: `restaking_metadata`, `cosmos_metadata`, `faith_tech_metadata`
- [ ] Migration: `signal_velocity_30d`, `momentum_score`, `breakout_flag`
- [ ] Add 12 faith-tech queries + 8 cosmos queries to `directory_niche_queries`
- [ ] Cron: `restaking-tvl-sync`
- [ ] Cron: `cosmos-liveness`
- [ ] Cron: `cosmos-relayer-health`
- [ ] Cron: `devtools-momentum`
- [ ] Cron: `devtools-pulse-digest`
- [ ] Cron: `llm-pricing-sync` (tokencount pivot)
- [ ] Storefront: `/restaking`, `/cosmos`, `/faith-tech`, `/blog/aeo/*`
- [ ] Public repo: `Coherence-Daddy/aeo-playbook`
- [ ] Tier 1 backlinks: 5 submissions executed
- [ ] Tier 2 backlinks: 4 submissions executed
- [ ] Tier 3 backlinks: 13 submissions tracked
- [ ] **Schedule recurring agent** to work through the migration + cron checklist (one item/week, opens PRs, posts status). Decision: cadence (weekly Monday?), scope (all infra checkboxes vs only crons?), repo target (team-dashboard only or also coherencedaddy-landing for renderer subpages).

---

## Documentation updates required when shipping

- `docs/architecture/system-overview.md` — add E/F/H/I verticals to intel diagram.
- `docs/operations/cron-inventory.md` — add the new crons listed above.
- `docs/architecture/structure-diagram-policy.md` — update Mermaid for new directory subpages.
- `TODO.md` (both repos) — reflect this roadmap's checklist.
