# Knowledge Graph — 30-Day Infrastructure Burn Estimate

**Date:** 2026-04-27
**Scope:** The 9 KG cron jobs registered in `server/src/services/knowledge-graph-crons.ts` plus the storage they accumulate in Neon. Owned by Nexus (extraction), Weaver (curation), Recall (memory), Oracle (cache).
**Purpose:** Produce a hard-number monthly cash burn so monetization decisions for the KG asset can be grounded.
**Method:** Static read of the codebase. No DB queries, no API calls. Assumptions made explicit.

---

## 1. Cron inventory & per-run cost drivers

Source: `server/src/services/knowledge-graph-crons.ts:184-260`.

| Job | Schedule | Runs / 30d | Ollama calls / run | DB ops / run | Notes |
|---|---|---|---|---|---|
| `kg:extract-relationships` (Nexus) | `0 */3 * * *` | 240 | up to 5 (50 reports / chunk-of-10) | ~5 generate calls + N triple upserts (≤ ~20) + memory write + report fetch | Only processes reports `captured_at > NOW() - INTERVAL '7 days'` minus already-processed. Steady-state is bounded by intel ingest rate, NOT 50/run. |
| `kg:embed-tags` (Nexus) | `0 */6 * * *` | 120 | 0 Ollama; 1 BGE-M3 batch call (≤100 texts) | 1 `SELECT … WHERE embedding IS NULL LIMIT 100`; 0–100 row UPDATEs | After backfill, almost always no-ops (0 rows). |
| `kg:deduplicate-tags` (Weaver) | `0 2 * * *` | 30 | 0 | 1 vector self-join scan; 0–20 merges × 4 writes each | O(N²) self-join on `knowledge_tags`. Becomes expensive past ~50k tags. |
| `kg:prune-edges` (Weaver) | `0 3 * * *` | 30 | 0 | 3 UPDATE/DELETE scans of `company_relationships` | Cheap; indexed scans on `confidence`, `updated_at`. |
| `kg:stats` (Weaver) | `0 */12 * * *` | 60 | 0 | full-table aggregate over `company_relationships` + `knowledge_tags` | Cheap unless edge count > 1M. |
| `memory:expire` (Recall) | `0 4 * * *` | 30 | 0 | 1 DELETE `WHERE expires_at < NOW()` | Cheap. |
| `memory:compact` (Recall) | `0 5 * * *` | 30 | 0 | per-agent vector self-join on `agent_memory` (~10 agents × O(N²) within agent) | Same scaling concern as tag dedup. |
| `memory:embed` (Recall) | `0 */4 * * *` | 180 | 0 Ollama; 1 BGE-M3 batch (≤100) | 0–100 row UPDATEs | High-frequency but typically near-empty. |
| `kg:warm-cache` (Oracle) | `0 6 * * *` | 30 | 0 | 1 top-tag aggregate + 20 recursive CTE traversals (depth ≤ 2) + 20 `agent_memory` upserts | The recursive CTE is the most expensive single query on the platform. |

**Total per month:** 240 Ollama generate calls, ~300 BGE-M3 embed batch calls, ~770 cron invocations.

---

## 2. Ollama cost (LLM extraction)

Source: `server/src/services/ollama-client.ts:16-18`.

```
OLLAMA_URL   = process.env.OLLAMA_URL   || "https://ollama.com"   // default = Cloud
OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b"
```

Per the user's `reference_ollama_routing.md`: **content workloads route to Ollama Cloud (free tier).** The KG extractor calls `callOllamaGenerate` (the content path), not `callOllamaChat` (the agent/memory path that pins to VPS2). So:

- **Nexus extraction → Ollama Cloud free tier → $0 cash.**
- The free tier has a daily request cap. 240 calls/month = 8/day average; well under the cap. No overage risk at current volume.
- Embeddings hit `EMBED_URL = http://100.67.128.51:8080` (VPS1-hosted BGE-M3 via HuggingFace TEI, Tailnet-only). VPS1 is sunk cost (already paid for the LLM/scrape stack); KG embedding adds negligible marginal CPU.

**Ollama cash line: $0 / month.**
**Implied opportunity cost:** if VPS2 were retired and embeddings moved to a paid API (e.g., Voyage/OpenAI at ~$0.02/M tokens), 300 batches × ~100 texts × ~30 tokens ≈ 900k tokens/month → ~$0.02. Trivial.

---

## 3. Neon (Postgres) cost

Neon Launch tier pricing (as of 2026-04): $19/mo base includes 10 CU-hours autoscaling compute + 10 GB storage; $1.75/extra CU-hour, $0.35/extra GB-month. The dashboard already runs a Neon project for the whole app — the KG's marginal cost is what it adds on top.

### 3a. Storage (the biggest line item)

Vector columns are `vector(1024)` → 4 KB raw per row, ~5-6 KB with HNSW/IVFFlat index overhead.

**Assumed row counts (rough order-of-magnitude — see §6):**

| Table | Assumed rows | Per-row size (incl. embedding) | Subtotal |
|---|---|---|---|
| `intel_reports` (with `embedding`) | 50,000 | ~6 KB | 300 MB |
| `knowledge_tags` (with `embedding`) | 5,000 | ~5 KB | 25 MB |
| `company_relationships` (no embedding) | 20,000 | ~0.5 KB | 10 MB |
| `agent_memory` (with `embedding`) | 30,000 | ~5 KB | 150 MB |
| Indexes (IVFFlat on each vector column, btree on FKs) | — | ~30% overhead | ~145 MB |
| **KG-attributable total** | | | **~630 MB** |

At $0.35/GB-month over the 10 GB included → **~$0 today, ~$0.22/mo if it pushes the project past the free tier**, ~$3.50/mo at 10x growth (6 GB). Storage is **not the binding constraint at current scale**.

### 3b. Compute (CU-hours)

Neon autoscales based on active query time. KG load:

- 770 cron invocations/month, most finish in < 5 s each = ~1 CU-hour / month total cron compute.
- **Recall: `recall()` semantic search and Oracle's `traverseRelationships()` recursive CTE are the heaviest queries**, hit via UI/API. If admin uses KG ~50× /day at avg 200ms each = 50 × 30 × 0.2s = 5 minutes / mo of compute. Trivial.
- **Weaver dedup self-joins are O(N²)** on the embedding column — at 5k tags, 12.5M comparisons per nightly run. With pgvector cosine ops on 1024-dim, expect ~30s / run on Neon's smallest CU. 30 runs × 30s = 15 min / mo. Still small but **scales quadratically with tag count** — by 50k tags this is 50 min / day = 25 CU-hours/mo by itself.

**Compute estimate today: 2-4 CU-hours/mo attributable to KG.** Within free tier. Cash add: **~$0** today, **$25-50/mo** if tag count grows 10×.

### 3c. IO / data transfer

Neon doesn't currently bill egress separately on Launch tier. Skipping.

### 3d. Neon bottom line

- **Today:** ~$0 marginal (absorbed by base tier).
- **At 10× scale (50k tags, 200k edges, 500k reports):** $20–60/mo additional.

---

## 4. VPS1 (embeddings + agent Ollama) — sunk

VPS1 (`100.67.128.51`) hosts the BGE-M3 embedding service (`:8080`), Firecrawl, and Ollama, and is rented for those LLM/scrape workloads regardless of KG. Marginal CPU added by KG embedding crons is < 5% of one core for a few minutes/day.

- **Cash line: $0** (already in the VPS rental).
- **Opportunity cost:** if KG were eliminated, VPS2 could potentially downsize one tier (~$10/mo savings). Counted as soft cost, not cash burn.

---

## 5. Operator attention (qualitative)

Empirical signal from the codebase: 9 cron jobs, 3 of them with O(N²) self-joins, 1 Ollama-dependent path that fails non-fatally (`logger.warn`, `result.errors++`). Failure modes:

- Ollama Cloud rate limit / outage → Nexus stalls silently, backlog grows.
- Bad LLM JSON output → `parseTriples` returns []; data quality degrades invisibly.
- Embedding service down (VPS2) → `embed-tags` and `memory:embed` crash; embeddings stall.
- Recursive CTE on growing edge set → `warm-cache` slows then times out.

Realistic ongoing maintenance: **1–3 hours/month**. At a $150/hr blended rate that's $150–450/mo of attention. **This is the largest real cost** and it does not appear on any invoice.

---

## 6. Bottom-line table

| Line item | $ / month (cash) | Confidence |
|---|---:|---|
| Ollama Cloud (Nexus extraction) | $0 | high — free tier, well under cap |
| BGE-M3 embeddings (VPS2, sunk) | $0 | high |
| Neon storage (KG-attributable, ~630 MB) | $0–1 | medium |
| Neon compute (KG crons + admin queries) | $0–5 | medium |
| VPS2 marginal CPU (sunk) | $0 | high |
| **Total cash burn** | **$0–6 / month** | |
| Operator attention (1–3 hr × $150/hr) | $150–450 | low — depends on how often it breaks |
| **Total cash + soft cost** | **$150–460 / month** | |

### Sensitivity / what changes the answer

- **10× data growth** (50k tags, 200k edges, 500k reports): cash burn moves to **$25–80/mo** (Neon storage + Weaver dedup CU-hours).
- **Ollama Cloud free tier removed or KG migrated to a paid API** (Claude Haiku for extraction at ~$0.25/M input, ~$1.25/M output): 240 calls × ~3000 input tokens × ~500 output tokens per call → ~720k input + 120k output / month → ~**$0.30/mo**. Still a rounding error — the prompt is small.
- **If Nexus ran every hour instead of every 3h:** Ollama calls 3×, but still under any plausible free-tier cap. Negligible.

---

## 7. Assumptions table (for review)

| # | Assumption | Confidence | If wrong, impact |
|---|---|---|---|
| A1 | Ollama Cloud is the production endpoint for Nexus (i.e., `OLLAMA_URL` not overridden in prod env) | medium — needs prod env confirmation | If actually VPS2: $0 → $0 cash either way, but VPS2 CPU load is 50× higher than current estimate |
| A2 | `intel_reports` ≈ 50k rows, `knowledge_tags` ≈ 5k, `agent_memory` ≈ 30k | **low** — guessed from "captured_at > NOW() - 7 days" cron limit & cron age | Storage cost scales linearly; could be 2-5× off |
| A3 | Neon Launch tier ($19/mo base), KG fits inside the existing project's allocation | medium | If KG forces a tier upgrade (Scale at $69/mo), attribute the delta = $50/mo |
| A4 | BGE-M3 embedding service runs on VPS1 (100.67.128.51:8080) and that VPS is paid regardless | high — endpoint is hard-coded; user memory confirms VPS1 routing | — |
| A5 | Operator spends 1-3 hr/month on KG maintenance | low — pure guess | Could be 0 hr (silent) or 10 hr (frequent breakage) |
| A6 | Steady-state Nexus actually processes far fewer than 50 reports/run because of the 7-day window + processed-IDs filter | medium | If wrong (high intel ingest), Ollama calls scale up but free tier still holds at < 1000/day |

---

## 8. Verdict for monetization decision

- **Cash burn is effectively zero today.** The KG is a free asset on the books.
- **The real cost is operator attention**, which is a soft cost but the dominant one — $150–450/mo of engineering time vs. $0–6/mo of compute.
- **If Nexus were paused:** cash burn drops by literally $0 (it's already free). Operator attention drops ~30-50% (one fewer flaky path). Backlog of unprocessed reports accumulates but no data is lost. **Pausing Nexus is a near-zero-cost reversibility experiment.**
- **The cliff is at 10× data growth**, where Neon compute on Weaver's O(N²) dedup becomes the binding cost ($25–80/mo). Bound that with a `LIMIT` in the dedup CTE before it bites.
