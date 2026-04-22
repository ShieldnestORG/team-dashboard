# PRD: Intel API

## What It Is

A real-time data API covering 500+ blockchain, AI, DeFi, and DevTools projects. Consumers get structured, up-to-date intelligence on projects: hourly price data, news summaries, GitHub activity, chain metrics, validator rankings, and RSS signals — all in one endpoint.

**Primary customers:** Developers, analysts, funds, and AI agent pipelines that need structured project intelligence without scraping it themselves.

---

## Customer Promise

> "Live intelligence on 500+ crypto and AI projects. One API. No scraping."

---

## Tiers & Pricing

| Tier | Price | Request Quota | Rate Limit | Overage | Backend Status |
|------|-------|--------------|------------|---------|---------------|
| **Free** | $0 | 1,000 req/mo | 60 req/min | N/A | ✅ Fully implemented |
| **Starter** | $19/mo | 100,000 req/mo | 300 req/min | $0.10/1k | ✅ Fully implemented |
| **Pro** | $49/mo | 500,000 req/mo | 1,000 req/min | $0.05/1k | ✅ Fully implemented |
| **Enterprise** | $199/mo | 5,000,000 req/mo | 5,000 req/min | $0.03/1k | ✅ Fully implemented |

**Stripe:** Subscription + metered overage billing. `intel_plans`, `intel_customers`, `intel_api_keys`, `intel_usage_meter` tables fully operational.

---

## Data Signals Covered

| Category | Update Frequency | Source |
|----------|-----------------|--------|
| Price + market cap | Hourly | Echo (CoinGecko/CoinMarketCap) |
| News + sentiment | Hourly | Echo (RSS + Firecrawl) |
| GitHub activity (stars, commits, PRs) | 6-hourly | Echo (GitHub API) |
| Chain metrics (TVL, txns, fees) | 6-hourly | Echo (DeFiLlama, L2Beat) |
| Validator/staking ranks | Daily | Echo (chain-specific RPC) |
| AI/DevTools project signals | Daily | Echo (Firecrawl, ProductHunt, HN) |

---

## Agent Assignments

| Agent | Task | Cron Schedule |
|-------|------|--------------|
| **Echo** | Data ingestion (price, news, GitHub, chain), project discovery | Multiple — see cron-inventory.md |
| **Nexus** | Extract entity relationships from ingested content | 4-hourly |
| **Weaver** | Knowledge graph curation, dedup, edge pruning | 6-hourly |
| **Recall** | Memory compaction, fact expiration, stale data cleanup | Daily |
| **Oracle** | Similarity search cache warming, multi-hop query optimization | Hourly |
| **Core** | API infrastructure, schema migrations, overage metering, key management | On demand (engineering) |

---

## Backend: Fully Implemented

All core infrastructure exists:

| Component | File |
|-----------|------|
| Plans schema | `packages/db/src/schema/intel_billing.ts` |
| Migration | `packages/db/src/migrations/0067_intel_billing.sql` |
| Billing service | `server/src/services/intel-billing.ts` |
| Billing routes | `server/src/routes/intel-billing.ts` |
| Frontend pricing | `ui/src/pages/IntelPricing.tsx` |
| Frontend billing | `ui/src/pages/IntelBilling.tsx` |

**No new backend work required for v1.**

---

## Bundle Integration Notes

Intel API is included in the **AEO Scale** bundle and **All-Inclusive** package. When bundled:
- Customer gets Pro tier access ($49/mo value) as part of bundle entitlement
- API key generated automatically on bundle checkout completion
- Quota comes from `intel_plans` plan lookup; entitlement system maps bundle → plan slug

---

## Upsell / Cross-Sell

- Free tier users hitting quota limit → upgrade prompt inline in API response headers (`X-Quota-Remaining`, `X-Upgrade-URL`)
- Starter users watching a competitor's project → "Get directory visibility for your own project" → DirectoryPricing link
- Pro/Enterprise users → "How does your project look to AI engines?" → CreditScore Audit link

---

## Not In Scope v1

- Streaming API (WebSocket real-time feed)
- Custom project addition (customer-submitted project tracking)
- GraphQL endpoint (REST only)
- White-label data feed reselling
