# Knowledge Graph — Positioning & Roadmap

> **Cluster:** Products · **Tags:** knowledge-graph, positioning, intel-api, enrichment, dependencies, devtools · **Related:** [Intel API PRD](intel-api-prd.md), [Intel API Reference](../api/intel.md), [Docs Index](../README.md)

**Date:** 2026-04-27
**Status:** Internal-only enrichment layer. Not a SKU. Not pricing-tiered.
**Owners:** Nexus (extraction), Weaver (curation), Recall (memory), Oracle (query/cache).
**Companion docs:** `docs/operations/kg-burn-estimate.md` (cost), `council-transcript-20260427-234502.md` (strategy session).

---

## 1. One-sentence positioning (the bakery-owner test, for indie devs)

> **"For an AI engineer or platform builder evaluating a tool, the KG answers: what does this thing actually depend on, and what else in its ecosystem leans on the same plumbing?"**

The audience is the **Intel API customer** (indie devs, AI engineers, infra builders), **not** the CreditScore SMB. The KG knows about Bedrock, Argo CD, Anyscale, XRPL, Astar, Buildkite, Kubernetes — it does not know about a bakery's competitors, and it never will, because that's not the corpus we're ingesting.

---

## 2. What the data actually is (audit, 2026-04-27)

| Relationship | Edge count | Quality |
|---|---:|---|
| `maintains` | 72 | strong (org → repo/project) |
| `uses` | 38 | ~58% strictly correct, ~84% if "trivially true" counts |
| `integrates` | 23 | usable |
| `built_on` | 2 | too sparse to query |
| `partners_with` | 2 | too sparse to query |
| `invested_in` | 1 | noise |
| `competes_with` | **0** | **does not exist in our data** |
| `fork_of` | 0 | (none captured) |
| **Total** | **138** | |

**Cash burn:** ~$0/mo (Ollama Cloud free tier + sunk VPS2 + Neon storage absorbed). Real cost is operator attention. See `docs/operations/kg-burn-estimate.md`.

**Honest read:** this is a small graph. Treat it like a curated dependency index of dev-tooling/AI-infra projects, not a market intelligence database.

---

## 3. The 2–3 queries this data can actually answer well

Given the edge shape (`maintains` 72, `uses` 38, `integrates` 23), three real queries:

1. **"What does X depend on?"** — for an entity in the corpus, return outgoing `uses` + `integrates` + `built_on` edges. Useful for "I'm evaluating Anyscale, what is it standing on?" Works on ~40-60 entities today.
2. **"Who maintains X?"** — return `maintains` edges, often the highest-confidence relationship type (org → project mapping is structurally easier to extract than competitive claims). Useful for supply-chain attribution.
3. **"What else in the corpus leans on the same dependency?"** — for a dependency entity (e.g. Kubernetes, Bedrock), return inbound `uses` + `integrates` edges. This is the "OSS dependency map" surface the Outsider hinted at — small but directionally valuable for an AI engineer scanning ecosystem risk.

Anything that requires `competes_with`, `partners_with`, or `invested_in` is **out of scope** until that data exists.

---

## 4. Explicitly retired plays (do not resurrect without new data)

These were on the table before the audit. The audit kills them. Logged here so future-me doesn't re-pitch them in six months.

- **❌ "Competitive Intelligence Layer" upsell across CreditScore / Directory / Partner Network.** The Expansionist's Crayon/Klue analog. **Reason killed:** zero `competes_with` edges, zero `partners_with` signal, wrong audience (SMBs don't appear in the corpus at all).
- **❌ "Competitive landscape" page inside CreditScore audits.** The Outsider's enrichment idea. **Reason killed:** the KG doesn't know any SMB customer's competitors. The corpus is OSS/cloud-vendor intel, not SMB market data. Wiring this in would surface irrelevant or wrong relationships in a paid product (active liability, per the Contrarian).
- **❌ Programmatic "vs / alternatives to" SEO pages on the Utility-Site Network.** The Expansionist + Executor's AdSense play. **Reason killed:** (a) zero `competes_with` data to seed pages from; (b) Google helpful-content risk on auto-generated relationship pages even if data existed; (c) defamation-adjacent legal exposure on noisy competitive claims.
- **❌ Standalone KG SaaS / public graph explorer / "KG-as-a-service" tier.** Council was unanimous: KG is ingredient, not SKU. No new pricing tier. No new product page.
- **❌ "License the embeddings" play.** 138 edges is not a licensable corpus. Revisit at 10-100× growth.

---

## 5. The surface — internal first, one endpoint later

### Phase 1 (now) — internal enrichment only

Wire KG dependency lookups into existing **Intel API** entity responses as a silent quality lift. When the API returns project metadata for, say, Anyscale, also include a `dependencies` block populated from KG `uses` + `integrates` + `built_on` edges, with a confidence score. No new endpoint. No new pricing. No external surface to support.

This is reversible: if it doesn't move retention or upgrade signal, remove the block.

### Phase 2 (only if Phase 1 earns it) — one public endpoint on Intel API

A single GET endpoint on the existing Intel API surface. Not a new product, not a new tier — slots into the Pro tier ($49/mo) quota at the same per-request cost as any other Intel call.

```
GET /v1/entity/:slug/dependencies
```

**Example request:**
```
GET /v1/entity/anyscale/dependencies?min_confidence=0.7
Authorization: Bearer <intel_api_key>
```

**Example response:**
```json
{
  "entity": {
    "slug": "anyscale",
    "name": "Anyscale"
  },
  "dependencies": {
    "uses": [
      { "target": "ray", "confidence": 0.91, "source_report_ids": ["..."] },
      { "target": "kubernetes", "confidence": 0.78, "source_report_ids": ["..."] }
    ],
    "integrates": [
      { "target": "aws-bedrock", "confidence": 0.74, "source_report_ids": ["..."] }
    ],
    "built_on": [],
    "maintained_by": [
      { "target": "anyscale-inc", "confidence": 0.95 }
    ]
  },
  "graph_meta": {
    "total_edges_in_graph": 138,
    "entity_edge_count": 4,
    "extracted_at": "2026-04-26T11:32:00Z",
    "disclaimer": "Relationships extracted from public intel reports; confidence scores reflect extraction certainty, not endorsement."
  }
}
```

The disclaimer is load-bearing — it dodges the legal exposure the Outsider flagged on competitive claims.

**Explicitly out of scope for the endpoint:** competitive relationships (we don't have them), partnership lookups (sparse), reverse traversal (likely Phase 3 if ever). Keep the surface as narrow as the data justifies.

---

## 6. 60-day measurement plan

The kill criterion. If neither metric clears its threshold by **2026-06-26**, the KG goes dormant: pause Nexus, freeze Weaver, keep schema and data, revisit only on inbound demand.

| Phase | Metric | Threshold | If miss |
|---|---|---|---|
| Phase 1 (internal enrichment) | Number of Intel API responses where the `dependencies` block was non-empty AND the response was returned to a paying tier (Starter+) customer | **≥ 200 enriched paid responses in any rolling 7-day window by day 60** | Enrichment isn't reaching real usage. Remove the block, mark the play dead. |
| Phase 1 quality gate | Spot-check accuracy on 50 random `dependencies` blocks served to paid customers | **≥ 75% of dependency edges in served responses are correct** | Data quality below customer-facing threshold. Pause Nexus, fix Weaver, do not promote to Phase 2. |

**Phase 2 trigger:** both Phase 1 metrics pass AND at least 1 inbound customer email or support ticket asks "do you expose this dependency data?" Without that pull signal, do not ship the public endpoint. Building a public surface from operator imagination is exactly what the Council told us not to do.

**Hard kill:** if at day 60 the KG has neither (a) measurably enriched paid Intel API traffic nor (b) changed an operator decision (next product, next partner) you can point to in a commit message or memory note, freeze the crons. Contrarian wins by default — and that's a fine outcome at $0 cash burn.

---

## 7. What stays the same

- Nexus runs on the existing 3-hour cron. No frequency change.
- No new tables. The `company_relationships` schema is sufficient for everything above.
- No new pricing tier. No marketing page. No new support queue.
- The KG admin UI at `/knowledge-graph` stays admin-only.
- Burn-estimate doc (`docs/operations/kg-burn-estimate.md`) is the source of truth on cost. If burn ever exceeds $25/mo cash, re-open this doc.
