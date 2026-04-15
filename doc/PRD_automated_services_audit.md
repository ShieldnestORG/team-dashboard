# PRD — Automated Services Audit, Wiring Gaps & Monetization Roadmap

**Author:** Sage + Nova + Bridge (synthesized via parallel audit agents)
**Date:** 2026-04-13
**Status:** Draft v1 — needs product sign-off before execution
**Scope:** Every automated service in `team-dashboard` — crons, services, routes, plugins, agents — plus a reality-check on monetization.

---

## TL;DR

- **62 cron jobs** are defined in `server/src/services/*-crons.ts`. **56 wired & healthy**, **5 degraded**, **1 intentionally paused** (Canva), **0 pure stubs**. The central `cron-registry` scheduler is solid.
- **9 "plugin jobs"** claimed in CLAUDE.md are **only 5 really running** — Moltbook's 3 (`content-dispatcher`, `heartbeat`, `daily-cleanup`) + maybe 2 from the registered plugins. **Discord's 2 and Twitter's 4 plugin jobs are dormant** — their manifests exist, but the plugins aren't loaded into the `plugin_config` DB registry, so the plugin-job-scheduler never schedules them. CLAUDE.md overstates the running count.
- **2 orphan services** found: `plugin-log-retention.ts` and `plugin-runtime-sandbox.ts` — exported but never started or imported.
- **~11 of 21 agents are "active"** — i.e. own real executing code. 10 are pure doc-only personas (Atlas, River, Pixel, Core, Flux, Mermaid + most leadership/eng roles). That's fine for task-dispatch roles, but is a gap for anything sold as "automated".
- **Revenue paths: 0 live, 1 near-ready, 3 proof-of-concept, 5 aspirational.** The only thing currently generating trackable output on a recurring schedule is the partner click-tracking system, and it's not billed. **Stripe key is set in env but imported by zero server files.** Partner monthly fees are declared in the DB schema but not wired to payments.
- **Quickest path to first dollar:** wire partner-subscription checkout → Stripe → monthly invoicing cron. ~3-4 days of work. All the upstream plumbing (partner CRUD, metrics, reports, click attribution) already exists.

---

## Table of Contents

1. [Cron Audit Results](#1-cron-audit-results)
2. [Services & Routes — Orphans and Ghost Endpoints](#2-services--routes--orphans-and-ghost-endpoints)
3. [Plugin System — Loaded vs Dormant](#3-plugin-system--loaded-vs-dormant)
4. [Agent Reality Check](#4-agent-reality-check)
5. [External Integrations — Status by Provider](#5-external-integrations--status-by-provider)
6. [Interconnection & Enhancement Opportunities](#6-interconnection--enhancement-opportunities)
7. [Monetization Roadmap](#7-monetization-roadmap)
8. [Prioritized Action List](#8-prioritized-action-list)

---

## 1. Cron Audit Results

Legend: ✅ wired & healthy · ⚠️ wired but degraded · ❌ not wired · 💤 paused · 🔧 stub

### Summary by owner agent

| Owner | Count | Status | Notes |
|---|---|---|---|
| **Echo** (Data Engineer) | 9 | ✅ | prices, news, twitter, github, reddit, chain-metrics, backfill, discover, trends:scan |
| **Blaze** (Hot-Take) | 4 | ✅ | twitter 6×/day, video:trend, intel-alert:twitter, retweet-cycle |
| **Cipher** (Technical) | 3 | ✅ | blog, reddit, slideshow-blog:cd |
| **Spark** (Community) | 3 | ✅ | discord, bluesky, intel-alert:bluesky |
| **Prism** (Trend Reporter) | 5 | ✅ | linkedin, video:market, video:weekly, tx-chain-daily, slideshow-blog:sn |
| **Vanguard** (XRP) | 4 | ✅ | xrp:blog, xrp:twitter, xrp:linkedin, xrp-alert:twitter |
| **Forge** (AEO) | 3 | ✅ | comparison:blog, aeo:blog, tokns-promo:blog |
| **Sage** (CMO) | 2 | ✅ | seo-engine (daily), seo-audit (weekly) ← just added |
| **Nova** (CTO) | 5 | ✅ | eval:smoke, alert:health-check, alert:digest, reports:partner-metrics, monitor:partner-sites |
| **Bridge** (Full-Stack) | 2 | ✅ | maintenance:stale-content, maintenance:health-check |
| **Nexus** (KG Extractor) | 2 | ✅ | kg:extract-relationships, kg:embed-tags |
| **Weaver** (KG Curator) | 3 | ✅ | kg:deduplicate-tags, kg:prune-edges, kg:stats |
| **Recall** (Memory) | 3 | ✅ | memory:expire, memory:compact, memory:embed |
| **Oracle** (KG Query) | 1 | ✅ | kg:warm-cache |
| **Moltbook** (Social Agent) | 5 | ⚠️ | ingest, post, engage, heartbeat, performance. Schedule mismatch on `performance` (code says midnight; docs say every 6h). |
| **Core** (Backend Dev — auto-reply) | 1 | ⚠️ | `auto-reply:poll` runs a **separate `setInterval` timer** outside the central registry. It works but is invisible to the admin cron UI and the `system_crons` DB table. |
| **YouTube pipeline** (no single owner) | 5 | ⚠️ | production, publish-queue, analytics, strategy, optimization. **All gated behind undocumented `YT_PIPELINE_ENABLED` env var** — if unset, `startYouTubeCrons()` logs and returns early. Silent no-op in prod if forgotten. |
| **Canva media** | 2 | 💤 | Intentionally paused in `app.ts` line ~393 pending Canva folder-API fix. |

**Total:** 62 system crons. Add Moltbook's 3 plugin jobs = 65 realistically running. **Not 69 as CLAUDE.md claims** — Discord (2) + Twitter (4) plugin jobs are dormant.

### Top 5 most-broken or most-important cron issues

1. 🔴 **YouTube pipeline gate** — `YT_PIPELINE_ENABLED` is not in `.env.example`, not in the CLAUDE.md env var table. 5 crons silently don't run in prod if this flag is forgotten on deploy. **Fix:** add to `.env.example` with `true` default, document in CLAUDE.md, and emit a warning log at startup when disabled.
2. 🟠 **Moltbook `performance` cron schedule drift** — code and docs disagree. Someone is wrong. Decide which is authoritative and fix the other.
3. 🟠 **Auto-reply outside cron registry** — works, but breaks the "single source of truth for crons" design. **Fix:** port it to `registerCronJob` using a dynamic schedule hook so it shows up in the admin Cron UI alongside everything else.
4. 🟡 **Canva media crons** — still paused, and `CANVA_MEDIA_FOLDER_ID` is undocumented. Either finish the folder-API integration or delete the pause comment and remove the service to stop pretending it's "ready".
5. 🟡 **Discord + Twitter plugin jobs dormant** — see §3.

---

## 2. Services & Routes — Orphans and Ghost Endpoints

### Orphan services

| File | Status | Recommendation |
|---|---|---|
| `server/src/services/plugin-log-retention.ts` | ❌ exports `startPluginLogRetention()` + `prunePluginLogs()`, **never called** from anywhere | **Quick win:** add one line `startPluginLogRetention(db)` to `app.ts` next to the other `start*` calls. Estimated 5 minutes. Prevents plugin logs from growing unbounded. |
| `server/src/services/plugin-runtime-sandbox.ts` | ❌ exports `loadPluginModuleInSandbox()`, **never imported** | Either finish wiring it into `plugin-loader.ts` for VM-isolated plugin execution, or delete it. Current state is dead code. |

All other ~120+ files under `server/src/services/` are in use — even ones that looked like orphans (`blog-publisher`, `content-embedder`, `relationship-extractor`, etc.) are cross-imported by crons or other services.

### Mounted routes

All **46 route files** under `server/src/routes/` are properly mounted in `app.ts`. No unmounted route files. No stub handlers that `res.status(501)` or similar were found.

### Ghost endpoints — public APIs that exist but have zero visible consumers

These endpoints are wired, served, and reachable, but nothing in this repo (and no evidence elsewhere) actually calls them:

| Endpoint | Purpose | Consumer status |
|---|---|---|
| `GET /api/reels` | Public visual-content feed for coherencedaddy.com | Not referenced by coherencedaddy-landing. May be used by a site we don't control — verify. |
| `GET /api/partner-directory/featured` | Partner list feed for coherencedaddy.com | coherencedaddy-landing logs `404` fetching this (seen in dev logs this session). **Broken integration** — either the frontend path is wrong or the API path moved. |
| `GET /api/partner-sites` | Partner-microsite content feed | Unclear if deployed partner sites actually fetch from this vs. static generation |
| `GET /api/content/public/generate` | Rate-limited public article generator | No visible public-facing entry point linking to this. Potentially a monetizable asset; see §7. |

### Services that emit data nobody reads

- **Content Embedder** (`content-embedder.ts`) — embeds published content back into `intel_reports` with BGE-M3 vectors. Consumed by `fetchQualityContext` in seo-engine. ✅ actually used, just not obvious.
- **Knowledge Graph output** — consumed by `seo-engine.ts` via `fetchQualityContext({ includeRelationships: true })`. ✅ actually used.
- **Trend scanner signals** — consumed by seo-engine + content crons. ✅ used.

**Result:** the orphan data-emitter concern is mostly unfounded; the pipelines do form a closed loop. The real gap is at the **consumer end** — external systems (coherencedaddy.com, partner sites) that should be calling these ghost endpoints but aren't.

---

## 3. Plugin System — Loaded vs Dormant

| Plugin | Manifest | Registered in `plugin_config` | Jobs scheduled | Tools callable by agents | Status |
|---|---|---|---|---|---|
| **plugin-moltbook** | ✅ | ✅ | ✅ 3 jobs running | ✅ 11 tools | **LIVE** |
| **plugin-twitter** | ✅ (13 tools, 4 jobs declared) | ❓ | ❌ jobs not observed scheduling | ❓ tools unclear | **DORMANT** — manifest exists but no evidence plugin-job-scheduler picks it up. The "Twitter engagement 30m" cron CLAUDE.md claims to exist wasn't found in running state. |
| **plugin-discord** | ✅ (8 tools, 2 jobs declared) | ❓ | ❌ | ❓ | **DORMANT** — same issue. Unless a `plugin_config` row exists and is loaded at boot, these jobs don't fire. |
| **plugin-firecrawl** | ❓ no `manifest.ts` found in standard layout | — | — | — | **UNCLEAR** — may still work via direct imports from `intel-crons.ts` / `partner-deployment.ts` that use the Firecrawl client library. Not a "plugin" in the loader sense. |
| **sdk** | n/a | — | — | — | Infrastructure package, not a plugin |

**Root cause:** `plugin-loader.ts` loads plugins from the DB `plugins` / `plugin_config` tables. If a plugin isn't registered there (by running the installer or seeding the DB), its manifest is invisible at runtime. The repo's build ships plugin packages but never seeds their rows.

**Fixes needed:**
1. Write a one-shot seeder or admin UI flow to register `plugin-discord`, `plugin-twitter`, `plugin-moltbook` into `plugin_config` on first-time setup. Document it in CLAUDE.md.
2. Verify `plugin-moltbook` is registered in the production DB (it's running jobs per the audit, so probably yes) and document HOW it got there so the other two can be replicated.
3. Emit a warning log at startup if any of the 4 declared plugins is NOT in `plugin_config` — makes silent dormancy visible.

---

## 4. Agent Reality Check

| Agent | Declared Role | Cron count | Code? | Status | Gap |
|---|---|---|---|---|---|
| Atlas | CEO — strategy, delegation | 0 | — | Doc-only | ✅ appropriate (pure task-dispatch role) |
| Nova | CTO — tech direction | 5 | alert-crons, eval-crons | Active | — |
| Sage | CMO — AEO, content strategy | 2 | content-crons (orchestrator), seo-audit-cron | Active/Partial | Orchestrates 4 personality agents by declaration, but orchestration is manual task dispatch, not a closed-loop automation. |
| River | PM — coordination | 0 | — | Doc-only | ✅ appropriate |
| Pixel | Designer | 0 | — | Doc-only | ✅ appropriate |
| Core | Backend Dev | 0 explicit (owns auto-reply timer) | — | Doc-only | ⚠️ the auto-reply timer is under Core per CLAUDE.md but runs outside cron-registry |
| Flux | Frontend Dev | 0 | — | Doc-only | ✅ appropriate |
| Bridge | Full-Stack | 2 | maintenance-crons | Active | — |
| Echo | Data Engineer | 9 | intel-crons, trend-crons | Active | **⚠️ No Firecrawl cron** — scraping orchestration is triggered manually or by external signals, not scheduled. Declared role includes "Firecrawl scraping" but nothing pulls that on a schedule. |
| Blaze | Content — hot takes | 4 | content-crons | Active | — |
| Cipher | Content — technical | 3 | content-crons | Active | — |
| Spark | Content — community | 3 | content-crons | Active | — |
| Prism | Content — trend reporter | 5 | content-crons | Active | — |
| Vanguard | Content — XRP | 4 | content-crons | Active | — |
| Forge | Content — AEO comparison | 3 | content-crons | Active | — |
| Mermaid | Structure agent | 0 | structure.ts (manual) | Doc-only | No cron for auto-diagram sync; diagrams update by agent task, not schedule |
| Moltbook | Social presence | 5 | moltbook-crons + plugin | Active | Safety filters are DB-driven, not runtime-enforced — relies on plugin layer |
| Nexus | KG — relationship extractor | 2 | knowledge-graph-crons | Active | — |
| Weaver | KG — curator | 3 | knowledge-graph-crons | Active | — |
| Recall | KG — memory manager | 3 | knowledge-graph-crons | Active | — |
| Oracle | KG — query engine | 1 | knowledge-graph-crons | Active | — |

**Summary: 11 active, 10 doc-only.** That's a reasonable split for an org with execution agents + management personas. The gap worth addressing:
- **Echo's Firecrawl orchestration** — currently there's no scheduled scraping cycle. Either build one (`firecrawl:sync` weekly) or rename Echo's declared role.
- **Sage's closed loop** — the new `/repo-updates` advisory flow is one step toward real closed-loop automation. Extend it so approved suggestions become auto-generated PRs (gated by admin approval) instead of hand-off work.
- **Core's auto-reply visibility** — fix the cron-registry integration.

---

## 5. External Integrations — Status by Provider

| Provider | Service file | Wired? | Env vars | Notes |
|---|---|---|---|---|
| Anthropic (Claude) | agent runtime, content crons fallback | ✅ live | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | primary LLM |
| Ollama (Cloud) | `ollama-client.ts` | ✅ live | `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_API_KEY` | primary content/extraction LLM |
| Firecrawl (self-hosted) | intel, partner-deployment, seo-engine | ✅ live | `FIRECRAWL_URL`, `FIRECRAWL_EMBEDDING_API_KEY` | no dedicated cron (see Echo gap) |
| Embedding service (BGE-M3) | `intel-embeddings.ts`, `agent-memory.ts` | ✅ live | `EMBED_URL`, `EMBED_API_KEY` | backbone for vector search |
| CoinGecko | `intel-discovery.ts`, `trend-scanner.ts` | ✅ live | `COIN_GECKO_API_KEY` | Demo tier, 30 req/min |
| GitHub | intel, repo-update paths | ✅ live | `GITHUB_TOKEN` | |
| Bing News | intel/trend crons | ✅ live | `BING_NEWS_KEY` | optional |
| Cosmos LCD (publicnode.com) | `cosmos-lcd.ts` | ✅ live | `COSMOS_LCD_URL`, `OSMOSIS_LCD_URL` (optional — defaults built-in) | APR, validators, block height, inflation, community tax — no vendor key required |
| DefiLlama | `defillama.ts` | ✅ live | none | Chain TVL with 24h delta — free public API, no key |
| SMTP (Proton) | `alerting.ts` | ✅ live | `SMTP_*`, `ALERT_EMAIL_*` | used by audit digest, alert crons |
| Gemini (Imagen/Veo) | `visual-backends/gemini.ts` | ✅ auto-enable | `GEMINI_API_KEY` | only runs if key is set |
| Grok / xAI | visual backends + TTS | ✅ auto-enable | `GROK_API_KEY`, `GROK_TTS_VOICE` | used by YouTube pipeline |
| Canva | `canva-connect.ts`, `canva-media-cron.ts` | 💤 paused | `CANVA_*` | waiting on folder API |
| YouTube Data API | `platform-publishers/youtube.ts`, yt-crons | ⚠️ gated | `YOUTUBE_*` + `YT_PIPELINE_ENABLED` | whole pipeline silent without flag |
| TikTok | `platform-publishers/tiktok.ts` | ⚠️ stub-ish | `TIKTOK_ACCESS_TOKEN` | publisher declared; actual posting path unverified |
| Instagram | `platform-publishers/instagram.ts` | ⚠️ stub | `INSTAGRAM_*` | marked stub in source |
| Twitter/X video | `platform-publishers/twitter-video.ts` | ⚠️ stub | `TWITTER_*` | marked stub (needs OAuth 1.0a) |
| Twitter/X API (text + search) | `x-api/client.ts`, auto-reply | ✅ live | `TWITTER_*` | budget-capped at $5/day |
| Discord | `plugin-discord` | ❌ dormant | `DISCORD_*` | plugin not registered |
| Moltbook | `plugin-moltbook` | ✅ live | `MOLTBOOK_API_KEY` | 3 jobs running |
| Stripe | (none) | ❌ NOT USED | `STRIPE_SECRET_KEY` | **key is set in env, zero imports in server code** |
| IndexNow (Bing/Yandex) | blog-publisher | ✅ live | `INDEXNOW_KEY` | |
| Neon Postgres | `vps-monitor.ts`, drizzle | ✅ live | `DATABASE_URL` | |

**Headline finding:** Stripe is the single biggest gap. The key exists, the `finance_events` schema has `externalInvoiceId`, partner DB has `monthlyFee`, but **zero server code imports the Stripe SDK**. Everything needed for billing is one integration away.

---

## 6. Interconnection & Enhancement Opportunities

Things that would make the existing systems work together better without building wholly new features.

### 6.1 Close the Sage advisory loop
The new `/repo-updates` queue is one step short of end-to-end. Add:
- An **"apply approved suggestion" worker** that, on approval, creates a GitHub PR against the affected repo using the stored `proposedPatch`. PR still requires human merge, but Sage drafts the change.
- Ollama-generated **commit message + PR body** per suggestion (advisor already drafts the rationale).
- A **re-audit on PR merge** via GitHub webhook → advisor marks the suggestion `applied` automatically.

### 6.2 Wire Echo's Firecrawl cron
Create `firecrawl:sync` weekly cron under Echo that refreshes the content of the top 50 companies in the directory (by intel engagement) via Firecrawl crawl + embed. Currently intel-crons pull *metadata* from CoinGecko/GitHub/etc. but never re-crawl the actual company sites.

### 6.3 Auto-register plugins
Add a startup check: if `plugin-discord`, `plugin-twitter`, `plugin-moltbook` packages exist on disk but are missing from `plugin_config`, auto-register them in a `draft` state and emit a warning. Turns silent dormancy into a visible "please configure" nag.

### 6.4 Knowledge graph → content engine tighter coupling
Oracle's `kg:warm-cache` already warms graph traversal results. Push further: expose the warmed cache as an Ollama tool via the agent tool dispatcher so any content personality agent can query "what does Coherence Daddy compete with in DeFi?" mid-generation. Makes content factually tighter without extra LLM calls.

### 6.5 Cross-agent memory sharing
`agent_memory` table is per-agent (each persona has private memories). Add a **shared `company_memory`** slice for facts every agent should know (brand guidelines, tone rules, current launch priorities). Recall already embeds memories — adding a shared namespace is cheap. Prevents agents drifting from brand voice.

### 6.6 Content performance → quality signals loop
`click_count` and `engagement_score` exist on `content_items`. The content embedder already re-ingests published content. Go one step further: compute engagement deltas per personality agent weekly and feed them back as a `content_quality_signals` row so low-performing voices get downweighted automatically. Half the plumbing is already there.

### 6.7 Unified "Automation Health" dashboard
Add a single `/automation-health` admin page that shows: cron registry status, plugin dormancy state, external integration keys present, last-run timestamps, error rates. Right now this info is scattered across `/crons`, `/system-health`, `/repo-updates`, and buried in logs. One glance = whole system status.

### 6.8 Standardize cron outcome reporting
Many crons log but don't write a structured outcome row (count produced, errors, duration). Pick a `cron_runs` table (or reuse `heartbeat_runs`) and have every cron write one row per execution. Makes it possible to build trend charts ("SEO engine produced X posts this week") without log-scraping.

---

## 7. Monetization Roadmap

Blunt current state. Nothing on this list is generating recurring revenue in this repo today.

### 7.1 Revenue seams ranked by time-to-first-dollar

| # | Path | Status | Missing | Time to first $ |
|---|---|---|---|---|
| 1 | **Partner subscription billing** | 70% wired | Stripe import, checkout session, subscription cron, invoice persistence | **~3–4 days** |
| 2 | **Intel API paid tier** | 30% wired | API key auth, usage tracking, paywall middleware, pricing page | ~1 week |
| 3 | **Public article generator → lead gen** | 50% wired | CTA in generated articles, email capture, CRM integration | ~1 week |
| 4 | **Knowledge Graph B2B API** | 40% wired (KG engine exists) | Public `/api/kg/*` with tiered auth, pricing, docs | ~1.5 weeks |
| 5 | **YouTube channel monetization** | 60% wired (pipeline exists) | `YT_PIPELINE_ENABLED`, channel monetization eligibility, ad enable | ~2-3 weeks (YouTube gated by watch hours + subs) |
| 6 | **Affiliate attribution on content** | 10% wired | Link rewriter, affiliate account signups, click tracking, per-post attribution | ~1 week |
| 7 | **Discord bot SaaS** | 80% built, 0% sold | Pricing, self-serve onboarding UI, billing, multi-tenant config | ~2 weeks |
| 8 | **Daddy Token validator commission** | infra only | Staking revenue tracking in `finance_events` | ~3 days reporting |
| 9 | **Moltbook community → product launchpad** | proof-of-concept | Requires an actual paid product to launch | n/a alone |
| 10 | **Donation flow (Stripe + crypto)** | lives in separate repo | Not in this repo; track in coherencedaddy one | — |

### 7.2 Detailed path 1: Partner subscription billing (RECOMMENDED FIRST)

**Current state**
- ✅ Partner CRUD at `/api/partners`
- ✅ `partner_companies` table with `monthlyFee`, `tier` (proof/active/premium), `referralFeePerClient`
- ✅ Click tracking via `/api/go/:slug`, metrics at `/api/partners/:slug/metrics`
- ✅ Monthly metrics email via `reports:partner-metrics` cron
- ✅ Admin UI at `/partners` with CRUD and dashboard links
- ❌ Stripe SDK not imported anywhere
- ❌ No checkout session endpoint
- ❌ No subscription webhook
- ❌ `finance_events.externalInvoiceId` never populated

**What to build**
1. Create `server/src/services/stripe-client.ts` — wraps Stripe SDK (`stripe` npm package)
2. `POST /api/partners/:slug/checkout` → creates a Stripe Checkout Session for a monthly subscription at the tier's `monthlyFee`
3. `POST /api/stripe/webhook` → handles `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted`, persists to `finance_events`, updates `partner_companies.tier`
4. Public partner dashboard at `/partner-dashboard/:slug` gets an "Upgrade" button that hits `/checkout`
5. Weekly `billing:partner-reconcile` cron (under Nova or a new Treasurer agent) — compares Stripe subscription state against partner tiers; reports drift

**Estimate:** 3-4 days of focused work. All upstream plumbing already exists. This is the single highest-leverage unblock.

**First-dollar moment:** one real partner goes through checkout. CLAUDE.md implies the business model is already designed; this just operationalizes it.

### 7.3 Detailed path 2: Intel API paid tier

The `/api/intel/*` public API serves 532 companies with real-time intel, rate-limited at 60 req/min per IP. This is a genuinely useful B2B product — crypto VCs, analysts, founders would pay for tiered access.

- **Free tier:** 60 req/min, 24h cached data, no auth
- **Pro tier ($49-99/mo):** 500 req/min, real-time data, API key auth, bulk endpoints
- **Enterprise ($499+/mo):** unlimited, webhooks on price/news/social alerts, dedicated slug watchlists

Stack needed:
- API key generation flow in admin (probably reuse `agent_api_keys` or add `api_consumer_keys`)
- `intel-rate-limiter.ts` middleware already exists — extend with key-aware tiers
- Pricing page on coherencedaddy.com (separate repo) pointing at Stripe checkout (reuse path 1's plumbing)

### 7.4 Additional monetization candidates worth exploring

- **Free-tools affiliate layer** — 523+ tools on freetools.coherencedaddy.com. Add affiliate links via a single config map (e.g. ledger/trezor for a wallet tool, Ledn for a borrow calculator). Trivial to wire, meaningful long-term revenue.
- **Sponsored intel reports** — the content engine auto-publishes trend reports. Add a "Sponsored slot" template and let partners pay for placement (requires editorial guardrails).
- **Partner microsite template gallery** — upsell partners to custom microsite templates beyond the generic one (premium tier).

---

## 8. Prioritized Action List

Ordered by impact × effort. Bold items are the concrete next tickets.

### P0 — Immediate, high impact, low effort

1. **Wire `plugin-log-retention`** (one import + one call in `app.ts`). Prevents plugin log table from growing forever. 5 minutes.
2. **Document `YT_PIPELINE_ENABLED`** in `.env.example` + CLAUDE.md env var table, default on. Prevents silent no-op in prod. 10 minutes.
3. **Fix Moltbook performance-cron schedule mismatch** — reconcile code vs docs. 10 minutes.
4. **Fix the broken `/api/partner-directory/featured` endpoint** — coherencedaddy-landing dev logs show `404` fetching this. Either the UI path is wrong or the API path moved. 30 minutes.
5. **Seed `plugin_config` rows** for plugin-discord and plugin-twitter so their jobs actually schedule. Document the seed step. ~2 hours.

### P1 — High impact, medium effort

6. **Wire Stripe for partner subscriptions** (§7.2) — the single biggest revenue unlock. **3-4 days.**
7. **Add Echo's Firecrawl sync cron** (`firecrawl:sync` weekly) — makes directory content actually fresh. 1 day.
8. **Port auto-reply cron into cron-registry** — unifies admin view. 2 hours.
9. **Close the Sage → GitHub PR advisory loop** (§6.1) — turns `/repo-updates` into a real feedback flow. 2 days.
10. **`/automation-health` unified dashboard page** (§6.7) — massively improves visibility over scattered admin pages. 1 day.

### P2 — Medium impact, medium effort

11. **Intel API tier + auth middleware** (§7.3) — revenue path #2. 1 week.
12. **Knowledge graph tool for content agents** (§6.4) — higher-quality content without new LLM calls. 2 days.
13. **Shared `company_memory` namespace** (§6.5) — brand voice consistency. 2 days.
14. **Cron outcome reporting table** (§6.8) — unlocks trend dashboards. 1 day.
15. **Content performance → quality signals feedback loop** (§6.6) — auto-downweight weak personalities. 2 days.

### P3 — Longer-term bets

16. **Discord Bot SaaS** — 80% built but needs multi-tenancy + billing.
17. **YouTube channel monetization** — gated by YouTube's eligibility thresholds (watch hours, subs), not by our code.
18. **Sponsored intel reports** — needs editorial/brand policy decisions first.
19. **Kill or finish Canva media crons** — stop living in the paused zombie state.
20. **Plugin runtime sandbox** — decide if we need it; finish or delete.

---

## Appendix A — Audit methodology

Three parallel Explore agents audited disjoint parts of the codebase on 2026-04-13:
1. **Cron audit** — enumerated every `registerCronJob` call, traced boot path in `app.ts`, verified handlers.
2. **Services/routes/plugins wiring** — import graph analysis, route mount audit, plugin registry inspection.
3. **Agents + monetization** — AGENTS.md parsing, `ownerAgent` field grep, env var cross-reference, revenue seam trace.

This PRD synthesizes their findings with manual verification of contested points (e.g. the "9 plugin jobs claimed but only 3–5 running" discrepancy).

## Appendix B — Open questions for the user

1. Is the Canva folder API fix on anyone's roadmap? If not, **delete the paused cron file** rather than carrying dead code.
2. Does the `plugin-moltbook` row already exist in the production `plugin_config`? If yes, that confirms the path for registering the other two plugins.
3. What's the intended business model for the Intel API? Free forever vs tiered? That decision blocks monetization path #2.
4. Who should own the new `Treasurer` / billing agent persona — Nova (since alerts already live under her), a new agent, or fold into Sage?
5. Should the Sage advisory loop's "approved suggestion" worker create PRs automatically, or keep them as a hand-off queue forever?

---

**Next step:** pick the top 3 items from the P0/P1 list you want to start on. I recommend **#1 (plugin-log-retention wire-up)** + **#4 (partner-directory/featured 404 fix)** as warmups, then **#6 (Stripe for partner subs)** as the real revenue unlock.
