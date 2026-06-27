# Trends Anti-Hallucination Method (the standard for ALL trend/topic/keyword generation)

> **Cluster:** Specs · **Tags:** trends, anti-hallucination, whats-hot, citation-check, provenance, saturation, grounded-prose, university · **Related:** [Trends & SEO API](../api/trends.md), [Watchtower](../products/watchtower.md), [AEO content cluster PRD](../products/aeo-content-cluster-prd.md), [Ownership Matrix](../OWNERSHIP.md)

**Owner directive (2026-06-25):** this hardened method is the **ONLY** method used for any trend / topic / keyword report the platform produces — no exceptions. It is implemented in the production pipeline (`server/src/services/trends-digest/*`) and any new trend/content surface must route through these primitives rather than letting a model assert facts.

The full feasibility/cost spec lives in the storefront repo: `coherencedaddy-landing/docs/plans/2026-06-25-university-whats-hot-and-50off.md` §1.8 (method) and §1.9 (cadence). This doc is the **engineering** record of how the method is enforced in code.

## Why

The one-off agent run that preceded this pipeline produced a fabricated "$910B" market cap, a "#1 trend" that was actually #3, and a saturated keyword marked "open." All three share one root cause: **an LLM was allowed to assert facts and numbers.** The production pipeline removes that freedom *architecturally* — it does not depend on a human/agent re-auditing every run (too expensive to do 2–3×/week). Facts are deterministic; the model only paraphrases sourced text.

## The 7 rules → where each is enforced

| # | Rule | Enforced by |
|---|------|-------------|
| 1 | **Numbers come from data, never the model.** Every figure is a fetched field inserted by code. | `assemble.ts` builds `DigestStat{value,display,source}` from fetched fields only; `number-guard.ts` rejects any number in generated prose absent from its source (the "$910B" net). |
| 2 | **The model only writes grounded prose.** One 1–2 sentence "why it's hot," restating fetched text, source attached. | `why-its-hot.ts` — strict system prompt, output re-checked by the number guard, deterministic templated fallback so a grounded line ALWAYS ships. |
| 3 | **Verdicts are computed, not opined.** RIDE / COATTAIL / DIFFERENTIATE / AVOID. | `saturation.ts` — pure deterministic formula (SERP domain concentration + keyword difficulty + AI-answer concentration + inverse velocity + coverage) → bucket × momentum → verdict matrix. No model. |
| 4 | **Automated citation-check gate before publish.** | `citation-gate.ts` — Haiku judge (modelled on `watchtower-accuracy-judge.ts`): unsupported claim → stripped to the grounded template; single-source → 🟡; unranked superlative → downgraded; judge outage → keep but ⚠ (never blanks the feed). |
| 5 | **Provenance ships to members** (✅ independently sourced / 🟡 single-source / ⚠ unverified); paid-ad copy uses only ✅. | `types.ts` `Provenance` + `PROVENANCE_BADGE`; `citation-gate.ts` `adFriendlyIds()`; the email payload carries the badge per item. |
| 6 | **Firecrawl provenance.** Stamp crawl time, prefer the page's dateline, present as "as stated on [source], [date]," re-crawl on a freshness window. | `firecrawl-stamp.ts` — `stampCrawl`, `extractDateline`, `asStatedOn`, `isStale`. |
| 7 | **Human spot-check before the blast.** A shared bad run hits every member at once. | A digest is born `pending`; `store.ts` only serves approved/sent; routes gate approve→send; crons NEVER auto-send. |

## Data flow

```
trend-scanner (fetched signals: HN/CoinGecko/Google-Trends/Bing — real numbers)
   └─ assemble.ts
        ├─ code-insert numbers as DigestStat (Rule 1)
        ├─ saturation.ts → verdict (Rule 3)   [+ optional serper.ts SERP enrichment]
        ├─ why-its-hot.ts → grounded prose (Rule 2), number-guard self-check (Rule 1)
        └─ citation-gate.ts → strip unsupported, tag provenance ✅/🟡/⚠ (Rules 4,5)
   └─ store.ts  → pending row (Rule 7)
   └─ routes (GET /api/trends/today serves approved only; approve/send admin gated)
   └─ whats-hot-email-callback.ts → signed envelope → storefront renders + sends (Brevo)
```

## Endpoints (see [Trends & SEO API](../api/trends.md) for full detail)

- `GET /api/trends/today` — latest **approved** digest (members; pending never exposed).
- `POST /api/trends/digest/build` — build a fresh **pending** digest (admin).
- `GET /api/trends/digest/pending` — review the pending digest (admin).
- `POST /api/trends/digest/:date/approve` — Rule-7 human gate (admin).
- `POST /api/trends/digest/:date/reject` — discard a bad run (admin).
- `POST /api/trends/digest/:date/send` — blast an **approved** digest to the founding list; refuses anything not approved.

## Cadence (§1.9)

- Base: 2× per week (`trends:digest:build`, Mon + Thu) — builds a **pending** digest only.
- Community-unlocked bonus: `trends:digest:bonus` (Wed) builds only if 7-day community engagement clears `WHATS_HOT_BONUS_VOTE_THRESHOLD`.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `CONTENT_API_KEY` | Yes | Auth for digest build/approve/send (admin). |
| `ANTHROPIC_API_KEY` (or `WATCHTOWER_ANTHROPIC_API_KEY`) | Optional | Claude-Haiku prose fallback + citation judge. Absent → Ollama prose + judge fail-soft (provenance capped at ⚠). |
| `SERPER_API_KEY` | Optional | SERP saturation enrichment (domain concentration + keyword difficulty). Absent → scorer degrades gracefully. |
| `WATCHTOWER_CALLBACK_KEY` | Optional | HMAC secret for the signed digest email envelope to the storefront. |
| `WHATS_HOT_EMAIL_CALLBACK_URL` | Optional | Storefront receiver (default: apex `/api/email/whats-hot`). |
| `WHATS_HOT_BONUS_VOTE_THRESHOLD` | Optional | Community engagement needed to unlock the Wed bonus run (default 10). |

## Tests

`server/src/__tests__/trends-digest-*.test.ts` — 56 tests across 9 suites, including a real-Postgres lifecycle test that boots the full migration chain (validates migration `0138_trends_digest.sql`) and proves the Rule-7 gate (pending never served, approve/send gating, no-clobber-on-rebuild).

## Storefront half

Per [Ownership Matrix](../OWNERSHIP.md), the email **renderer + Resend delivery** live in `coherencedaddy-landing` (`lib/whats-hot-email.ts` + `app/api/email/whats-hot/route.ts`). team-dashboard only posts the signed `whats_hot_digest` envelope.
