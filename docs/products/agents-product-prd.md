# PRD: 100 Agents (v1 — 2026-05-07)

> Status: planned. Landing page live at `coherencedaddy.com/agents` since 2026-04-30. Backend not yet built. Founding cohort: 14/30 claimed at the time of writing.

## What It Is

A coordinated fleet of ~12 agent types that run on schedule per customer to handle: SERP tracking, brand-mention discovery, review monitoring, sentiment analysis, schema/FAQ updates, backlink outreach, competitor watching, and reporting. Customers get a dashboard with a real-time activity feed and an approval queue for any drafts that get posted publicly. The "100 agents" framing is honest brand presentation — 12 types instanced across each customer's keywords, sources, competitors, and brands.

## Customer Promise

> "100 agents. Working for you. While you sleep. We make sure people find you while you ship the product."

## Tiers & Pricing

| Tier | Price | Brands | Keywords | Mentions/wk | Cadence |
|---|---|---|---|---|---|
| **Starter** | $79/mo | 1 | 5 | ~20 | Weekly recap |
| **Growth** | $199/mo | 3 | 25 | ~100 | Daily recap + sentiment heatmap |
| **Pro** | $499/mo | 10 | unlimited (fair-use ~100/brand) | ~500 | Realtime alerts |
| **Command** | $1,499/mo | unlimited | unlimited | unlimited | Realtime + weekly call |

**Founding cohort cap: 30 customers.** Cap rises with infra. Pricing grandfathered for life.

**Approval mode by tier:** Starter / Growth = approval-only on every public post. Pro / Command = opt-in auto-publish per agent type, with override.

## Unit Economics (Validated 2026-05-07)

| Tier | Revenue | COGS | Gross | Margin |
|---|---|---|---|---|
| Starter | $79 | $5.59 | $73 | 92% |
| Growth | $199 | $11 | $188 | 94% |
| Pro | $499 | $45 | $454 | 91% |
| Command | $1,499 | $705 | $794 | 53% |

**Why the margins work:** scraping uses self-hosted Firecrawl ($0 marginal); LLM uses Ollama Cloud + Groq fallback ($0 effective). Real costs are compute amortization, Stripe fees, and (Command only) human strategy time.

**At realistic 30-customer mix (10/12/6/2): MRR $9,170, COGS $1,868, GP 80%.** Annualized GP ~$87.6k.

## Competitive Positioning

The DIY stack a customer would otherwise assemble:

| Tool | Role | Price |
|---|---|---|
| Awario | Brand mention monitoring | $149/mo |
| Ahrefs | SEO + SERP tracking | $129/mo |
| Pitchbox | Outreach / backlinks | $165/mo |
| **DIY total** | | **$443/mo** |

**Coherence Daddy Agents Growth = $199/mo.** Save $244/mo / $2,928/yr. Same surface area, one dashboard, one bill.

## Architecture

### Domain map
```
www.coherencedaddy.com    → coherencedaddy-landing (marketing /agents page)
app.coherencedaddy.com    → NEW customer dashboard (Next.js, shared auth)
api.coherencedaddy.com    → team-dashboard backend (existing VPS)
admin.coherencedaddy.com  → team-dashboard admin UI (existing, internal)
```

### Boundary with storefront
Per [docs/OWNERSHIP.md](../OWNERSHIP.md): plans, checkout, webhook, and entitlements live in team-dashboard. Storefront only renders pricing + CTA, calling `api.coherencedaddy.com` via vercel.json rewrite.

### Data model (new tables, all prefixed `agents_`)

| Table | Purpose |
|---|---|
| `agents_customers` | Stripe customer + tier + status |
| `agents_brands` | Domain, voice, sender domain, DKIM state |
| `agents_keywords` | Per-brand keyword watchlist |
| `agents_competitors` | Per-brand competitor domains |
| `agents_runs` | Every agent run: timestamp, status, summary, artifacts JSONB |
| `agents_mentions` | Discovered mentions w/ sentiment + reply state |
| `agents_drafts` | Replies / outreach / responses awaiting approval |
| `agents_reviews` | Monitored reviews across sources |
| `agents_serp_positions` | Time-series ranking data |
| `agents_backlinks` | Outreach pipeline state |
| `agents_alerts` | Customer-facing notifications |
| `agents_usage_meters` | Per-customer scrape/token/run counts |

### Service layout (`team-dashboard/server/`)
```
routes/agents/
  plans.ts           GET /api/agents/plans
  checkout.ts        POST /api/agents/checkout       (Stripe session)
  webhook.ts         POST /api/agents/webhook        (Stripe events)
  brands.ts          CRUD /api/agents/brands
  dashboard.ts       GET /api/agents/dashboard/:brandId
  drafts.ts          GET + POST approve/reject

services/agents/
  scheduler.ts       (5-min tick → dispatches due runs)
  runner.ts          (base class: log, capture artifacts, write SLO)
  types/             (one file per agent type)
  slo.ts             (expected vs actual)

cron/
  agents-tick.ts     (every 5 min)
```

## The 12 Agent Types

| # | Agent | Cadence | Reads | Writes | Tier |
|---|---|---|---|---|---|
| 1 | **SERP Watcher** | hourly | Firecrawl (Google/Bing) | `agents_serp_positions` | All |
| 2 | **Mention Hunter** | every 30m | Firecrawl (Reddit, Quora) | `agents_mentions` | All |
| 3 | **Review Monitor** | hourly | Firecrawl (Google Business, Trustpilot, App/Play) | `agents_reviews` | Growth+ |
| 4 | **Sentiment Reader** | post-discovery | mentions + reviews | sentiment field | All |
| 5 | **Reply Author** | post-discovery | a `mention` | `agents_drafts` (pending) | All |
| 6 | **Review Responder** | post-discovery | a `review` | `agents_drafts` (pending) | Pro+ |
| 7 | **Outreach Author** | daily | competitor backlinks + niche sites | `agents_drafts` + `agents_backlinks` | Pro+ |
| 8 | **Backlink Sniper** | post-approval | sends approved drafts | `agents_backlinks` state | Pro+ |
| 9 | **Schema Patcher** | weekly | site sitemap + content | drafts schema patches | Growth+ |
| 10 | **FAQ Author** | weekly | top user questions from search + reviews | drafts FAQ updates | Growth+ |
| 11 | **Competitor Spy** | daily | competitor site diff + their socials | `agents_runs` | Growth+ |
| 12 | **Recap Composer** | weekly (Pro: daily) | last period's runs | sends email + dashboard digest | All |

X/Twitter is intentionally **not included**. API costs are unsustainable at our pricing, scraping violates ToS. Add later only as a paid add-on with cost passthrough.

## The Trust Layer (Most Important Section)

Customers churn if they can't see the agents working. Every run produces verifiable artifacts.

### Customer dashboard surfaces (`app.coherencedaddy.com/agents/:brandId`)

| Surface | Content |
|---|---|
| Overview | This-week KPIs vs last week; next 5 scheduled runs |
| Activity | Real-time agent run feed → click for artifacts |
| Approvals | Pending drafts queue; bulk approve for Pro+ |
| Mentions | Discovered mentions, sentiment, reply state |
| SERP | Keyword position chart, top movers |
| Reviews | Monitored reviews, response state |
| Outreach | Pipeline (proposed → contacted → earned/dead) |
| Health | Per-agent run history, last error, next run ETA |
| Settings | Brand config, keywords, competitors, DKIM setup |

### Verifiable artifacts (every agent run stores)

- **SERP:** position, URL, screenshot of result page
- **Mentions:** source URL, full snippet, timestamp
- **Drafts:** full text, target URL, who approved, sent timestamp, delivery receipt
- **Reviews:** review URL, draft response, posted response link

### Internal SLOs (ops-facing, in admin UI)

| Agent | Expected runs/customer/wk | Alert if below |
|---|---|---|
| SERP Watcher | 168 (hourly) | <140 in 24h |
| Mention Hunter | 336 (every 30m) | <250 in 24h |
| Review Monitor | 168 | <140 in 24h |
| Recap Composer | 7 (daily Pro) / 1 (weekly) | missed by >2h |

### Weekly recap email (the trust contract)

Three sections, named examples — not just numbers:
1. *"3 places you got mentioned"* — quotes + links
2. *"You moved on 4 keywords"* — before/after positions
3. *"5 drafts are waiting"* — deep-link to approval queue

### No silent failures

Every error → `agents_alerts` row → visible in customer Health tab as e.g. "SERP Watcher: rate-limited, retrying in 10m." Never just disappears.

## Build Phases

### Phase 0 — Backend scaffold (1 week)
- [ ] Migration: `agents_*` tables (schema above)
- [ ] Stripe products + prices created in dashboard (4 tiers)
- [ ] `routes/agents/plans.ts`, `checkout.ts`, `webhook.ts`
- [ ] Webhook handler: provision `agents_customer` row, send onboarding email
- [ ] Entitlement helper: `getAgentsEntitlement(customerId)` returning tier limits
- [ ] Onboarding endpoint: `POST /api/agents/brands` (domain, keywords, competitors, voice)
- [ ] Verify with `npx tsc --noEmit --project server/tsconfig.json`

### Phase 1 — First three agents end-to-end (2 weeks)
- [ ] `services/agents/runner.ts` base class (artifact capture, SLO write, error → `agents_alerts`)
- [ ] `services/agents/scheduler.ts` (5-min tick, picks due runs by cadence)
- [ ] `cron/agents-tick.ts` registered
- [ ] Agent type 1: **SERP Watcher** (uses Firecrawl, writes `agents_serp_positions`)
- [ ] Agent type 2: **Mention Hunter** (Firecrawl on Reddit + Quora search URLs)
- [ ] Agent type 12: **Recap Composer** (assembles + sends weekly email via Resend)
- [ ] Manual onboarding form in admin UI (we use this for the first 5 customers ourselves)

### Phase 2 — Customer dashboard + approvals (1 week)
- [ ] New repo / app: `app.coherencedaddy.com` (Next.js, NextAuth or Clerk)
- [ ] Auth handshake with team-dashboard (JWT signed by team-dashboard, verified by app)
- [ ] Pages: Overview, Activity, Approvals, Mentions, SERP, Health, Settings
- [ ] Activity feed component (polls `/api/agents/dashboard/:brandId/runs?since=...`)
- [ ] Approval queue (POST `/api/agents/drafts/:id/approve|reject`)

### Phase 3 — Soft launch (2 weeks)
- [ ] Pick 5 customers from existing community / waitlist
- [ ] White-glove onboarding call each (30 min: brand voice, keywords, DKIM)
- [ ] Free first month, founding pricing locked
- [ ] Daily debrief for week 1, weekly for week 2
- [ ] Required written feedback at week 2 + week 4
- [ ] Kill criteria: if 2 of 5 churn or rate <7/10, hold self-serve open until fixed

### Phase 4 — Remaining agents (3–4 weeks)
Priority order by visible customer value:
- [ ] Review Monitor (customer-visible reviews are high-trust)
- [ ] Reply Author + Review Responder (the approval-queue fillers)
- [ ] Sentiment Reader (powers heatmaps in Growth+)
- [ ] Competitor Spy (Growth+ promise)
- [ ] Schema Patcher + FAQ Author (Growth+ promise)
- [ ] Outreach Author + Backlink Sniper (Pro+ promise)

### Phase 5 — Observability (1 week)
- [ ] SLO dashboard in admin UI (per-customer agent run rate vs expected)
- [ ] On-call alerting if any tier-Pro+ customer breaks SLO
- [ ] Usage meter rollup (Firecrawl req/customer/day, LLM tokens, agent run count)
- [ ] Customer-tier health rollup ("12 of 14 founders all green")

### Phase 6 — Self-serve open (1 week)
- [ ] Stripe checkout button live on landing page
- [ ] Automated onboarding flow (no white-glove)
- [ ] Open up to remaining 16 founding cohort slots

**Total: ~10 weeks. Soft launch milestone at week 6.**

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Firecrawl capacity** at >15 customers | Static analysis estimate (2026-05-07): light pages ~40–50 RPS sustained, heavy pages (Reddit/Wikipedia) ~10–15 RPS, mixed load ~20–25 RPS practical. Current concurrency cap is 3 with 30s timeout. **Empirical validation deferred** — gentle controlled test (≤5 RPS) before Phase 1 launch, not a full ramp against prod. Plan: horizontal-scale at ~15 customers (add second Firecrawl worker + load balancer), or Firecrawl Cloud overflow. Add queue-based scheduling (BullMQ) to spread agent runs across 24h. |
| **Reddit/Quora ToS** on auto-posted replies | **Approval-only** for Starter/Growth; Pro/Command auto-post is opt-in per agent + clear ToS warning |
| **Cold-email deliverability** killing customer's domain reputation | All outreach sends via **customer's own DKIM-verified Resend domain**, not ours. Hard requirement at onboarding. |
| **Founding pricing grandfathered** trap if a tier loses money later | Margins validated at 80%+ across mix; remaining cost driver (Firecrawl scale) is fixed-cost expansion not per-customer variable |
| **Reddit blocks our VPS IPs at scale** | Add residential proxy layer (IPRoyal $1.75/GB) only when measured; not pre-built |

## Reference Docs

- [System Overview](../architecture/system-overview.md)
- [Ownership Matrix](../OWNERSHIP.md) — what lives here vs storefront
- [Branch Safety](../guides/branch-safety.md)
- [CreditScore PRD](creditscore-prd.md) — Stripe pattern reference

## Changelog

- **2026-05-07** — v1 PRD written. Unit economics validated. Plan locked. Ready for Phase 0.
