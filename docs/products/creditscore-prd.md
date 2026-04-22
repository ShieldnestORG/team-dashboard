# PRD: CreditScore (v2 — reconciled 2026-04-21)

> Supersedes the earlier draft. Pricing and tier structure locked via the ecosystem-wide reconciliation captured in `/Users/exe/.claude/plans/prd-1-looks-good-fluffy-parnas.md`.

## What It Is

CreditScore is Coherence Daddy's top-of-funnel SEO + AEO audit tool. It scans any website and produces a 0–100 composite score measuring:

- **SEO signals** — technical health (Core Web Vitals, meta, structured data, crawlability)
- **AEO presence** — how often and how accurately the site is mentioned by AI engines (ChatGPT, Perplexity, Claude, Gemini)

The score anchors every upsell: low AEO sub-score surfaces Partner Network; mid AEO surfaces Directory Listings; Growth+ customers see bundle upgrade CTAs.

## Customer Promise

> "Know exactly where you stand in AI search — and get a clear roadmap to improve."

## Tiers & Pricing

| Tier | Price | Annual option | Deliverables |
|------|-------|---------------|--------------|
| **One-Time Report** | $19 | — | Full issue list (5 signals), prioritized fix checklist, top 5 competitors revealed, shareable HTML report. Generated within 15 min. |
| **Starter** | $49/mo | — | Monthly automated re-audit, score history chart, fix-priority email on the 1st, email alert on score drop ≥10 points. |
| **Growth** | $199/mo | $99/mo billed annually ($1,188/yr) | Starter + 2 AI-optimized pages/mo + 1 schema implementation/mo + monthly competitor breakdown (3 domains). |
| **Pro** | $499/mo | — | Growth + 4 AI pages/mo + 2 schema implementations/mo + weekly reporting + dedicated strategist (Sage) + competitor tracking up to 5 domains. |

**Pricing rationale:** $19 anchors at 2.6× the Starter monthly (not 12×). Growth at $199 covers AI page-writing labor honestly. Pro at $499 scopes the dedicated strategist promise properly. Annual only offered on Growth for now.

## Score Methodology

5 signals (live, unchanged — implemented in the external Firecrawl-backed audit microservice):
- AI access
- Structured data
- Content quality
- Freshness
- Technical

**Collected by:** Auditor agent (calls external audit microservice). No changes to the audit engine itself.

## Agent Assignments

| Agent | Responsibility | Trigger |
|-------|----------------|---------|
| **Auditor** | Call audit microservice, persist result to `creditscore_reports` | On report request + monthly/weekly cron |
| **Content Agent** | Draft 2 (Growth) or 4 (Pro) AI-optimized pages per subscriber per month | Monthly cron, pulls from active subs |
| **Schema Agent** | Generate JSON-LD per subscriber site | Monthly (Growth) / bi-monthly (Pro) |
| **Competitor Agent** | Monthly competitor scan (3 for Growth, 5 for Pro) | Monthly |
| **Report Agent** | Assemble and email weekly/monthly reports | Per tier cadence |
| **Sage** (Pro only) | Named strategist — weekly strategy doc | Weekly |

All agents live under `agents/`. They pull work from a shared task queue.

## Backend Requirements

### Database (`packages/db/src/schema/creditscore.ts`)

- `creditscore_plans` — tier catalog with Stripe price IDs and entitlements JSONB
- `creditscore_subscriptions` — per-customer state (nullable company_id for anonymous one-time reports)
- `creditscore_reports` — audit results + shareable slugs

### Service (`server/src/services/creditscore.ts`)

`listPlans`, `createCheckout`, `handleWebhook`, `generateReport`, `scheduleScans`, `getReport`, `resolveEntitlement`.

### Routes (`server/src/routes/creditscore.ts`)

`GET /plans`, `POST /checkout`, `POST /webhook`, `GET /entitlement`, `GET /report/:id`, `POST /audit/store`.

### Entitlement integration

`bundle-entitlements.ts` extended: `getEntitlementsForCompany` resolves CreditScore from both standalone subs and bundle entitlements, returning the higher tier.

## Cross-Repo Boundaries

- **team-dashboard owns** — plan definitions, subscription state, Stripe webhooks, rescan cron, agent work scheduling.
- **coherencedaddy-landing owns** — storefront UI (pricing page, CTAs), free audit SSE stream in browser, Resend email templates (invoked by team-dashboard via a callback endpoint or ported to a shared package).
- See `docs/OWNERSHIP.md` in both repos for the full ownership matrix.

## Stripe Products to Create (manual, not automated)

| Product | Price ID env var | Amount |
|---------|-----------------|--------|
| `creditscore_report_onetime` | `STRIPE_PRICE_CREDITSCORE_REPORT` | $19 one-time |
| `creditscore_starter_monthly` | `STRIPE_PRICE_CREDITSCORE_STARTER` | $49/mo |
| `creditscore_growth_monthly` | `STRIPE_PRICE_CREDITSCORE_GROWTH_MONTHLY` | $199/mo |
| `creditscore_growth_annual` | `STRIPE_PRICE_CREDITSCORE_GROWTH_ANNUAL` | $1,188/yr |
| `creditscore_pro_monthly` | `STRIPE_PRICE_CREDITSCORE_PRO` | $499/mo |

After creation, update `creditscore_plans.stripe_price_id` for each row.

## Cross-Sell Logic

- AEO score <40 → Partner Network Proof tier
- AEO score 40–65 → Directory Listing Featured tier
- Any Growth+ customer → bundle upgrade CTA ("save 33% with AEO Starter bundle at $199/mo standalone, $199/mo bundled — already there; nudge toward Growth bundle at $499/mo")

## Not In Scope v1

- Customer portal (cancel/pause/downgrade UI) — separate Subscription Management PRD
- PDF export of reports — v2
- White-label reports — All-Inclusive tier v2
- llms.txt generation per customer — v2
- Grandfathering policy for legacy $4 report buyers — product call
