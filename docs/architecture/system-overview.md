# System Overview — Team Dashboard

## What This Project Is
The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Coherence Daddy is a faith-based organization on a mission to help humanity be more coherent through private, secure self-help products that teach real skills, broaden awareness, and help the next generation stay secure. This dashboard manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing brand site and tools live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

### GitHub identities (as of 2026-04-25)

The ecosystem operates across three GitHub identities. Pick the right one when creating a new repo:

| Identity | Type | Used for | Examples |
|---|---|---|---|
| `ShieldNEST` | Personal (HEAD_DEV) | Active dev account; admin in both orgs below | — |
| [`ShieldnestORG`](https://github.com/ShieldnestORG) | Org (mix) | Infrastructure: storefront, control plane, landing pages, validator | `coherencedaddy`, `team-dashboard`, `shieldnest_landing_page`, `tokns.fi_landing_page`, `tokns` |
| [`Coherence-Daddy`](https://github.com/Coherence-Daddy) | Org (public) | Share-ready public content meant to be starred, forked, and submitted to awesome-lists | [`use-ollama-to-enhance-claude`](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) |

**Rule:** infrastructure → `ShieldnestORG`. Public hero asset (tutorial, demo, viral-content repo) → `Coherence-Daddy`.

## Ecosystem

### coherencedaddy.com (ShieldnestORG/coherencedaddy repo)
One Next.js 15 App Router app serving **all 9 subdomains** via `middleware.ts` subdomain routing, deployed on Vercel. Proxies `/api/intel/*`, `/api/trends/*`, and `/api/content/*` to the team-dashboard backend via Vercel rewrites.

| Subdomain | Purpose |
|---|---|
| `coherencedaddy.com` | Mission hub — faith-driven tech, YourArchi spotlight, donations (Stripe + crypto), FAQ |
| `freetools.coherencedaddy.com` | 501+ public tools with SSR content; hosts all LLM/agent discovery files |
| `directory.coherencedaddy.com` | 532+ projects across Crypto, AI/ML, DeFi, DevTools — powered by Intel API |
| `token.coherencedaddy.com` | Crypto / NFT / staking dashboard |
| `partners.coherencedaddy.com` | AEO partner network — featured-partner directory + how-it-works landing (served from **coherencedaddy-landing** via middleware rewrite to `/partners-home`). Self-serve signup funnel lives at `coherencedaddy.com/partners-pricing` and POSTs to team-dashboard `/api/partners/public/enroll`. |
| `creditscore.coherencedaddy.com` | Redirect → `freetools.coherencedaddy.com/creditscore-home` (actual tool). Plan catalog, checkout session creation, Stripe webhooks, rescan cron, and report persistence all live in this repo at `/api/creditscore/*`. |
| `shop.coherencedaddy.com` | Merch **preview** (Next.js). Authoritative cart/checkout is a Hostinger WordPress + WooCommerce store aggregating **Printful**, **Printify**, and first-party products — see [Org Structure › Shop Storefront Detail](./org-structure.md#shop-storefront-detail). |
| `law.coherencedaddy.com` | Legal / law tools subdomain |
| `optimize-me.coherencedaddy.com` | Self-optimization tools subdomain |

### Tutorial library (added 2026-04-25)

Path-based (NOT subdomain) — lives at `coherencedaddy.com/tutorials`. Self-contained static HTML presentations served via Next.js rewrite. Each tutorial pairs a visual deck with a copy-paste prompt that lets Claude do ~98% of the setup. Designed for sharing on Show HN / Reddit / X with the GitHub mirror as the canonical home.

| URL | Status | Public mirror |
|---|---|---|
| `coherencedaddy.com/tutorials` | LIVE | — |
| `coherencedaddy.com/tutorials/use-ollama-to-enhance-claude` | LIVE | [Coherence-Daddy/use-ollama-to-enhance-claude](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) |

Per-tutorial: full OG meta + Twitter cards, `HowTo` JSON-LD, AdSense banner that auto-skips cover/picker/closing slides, `<link rel="canonical">` so the GitHub mirror doesn't outrank the hosted version. Index page emits `CollectionPage` + `ItemList` JSON-LD. Sitemap + llms.txt updated.

### SEO & LLM Discovery (as of April 2026)
- **Sitemap**: `app/sitemap.ts` — single master sitemap covering all 9 subdomains + the `/tutorials` library (pages, tools, directory companies, partner slugs, tutorial slugs)
- **robots.ts**: All 9 subdomain sitemaps listed; LLM crawlers explicitly allowed: GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Applebot-Extended, GoogleOther
- **llms.txt** / **llms-full.txt** — served from `freetools.*` (and `coherencedaddy.com/llms.txt` lists tutorials with the GitHub mirror); covers all 9 subdomains + 501 tools by category + tutorial library
- **ai-plugin.json** / **mcp.json** / **openapi.json** — agent/MCP discovery at `freetools.*/.well-known/`
- **AdSense**: `ca-pub-1882924299982046` — auto ads in `app/layout.tsx`, manual units in tool pages, sidebar, blog posts, AND the tutorial index + per-tutorial banner (lazy-fill on first ad-eligible slide); `ads.txt` in public/; CookieYes CMP + Consent Mode v2

### Other Ecosystem Properties
All properties below are owned by the **ShieldnestORG** Vercel organization unless noted. Each Vercel project name is listed so the control plane can trace which repo deploys which domain.

- **YourArchi** (yourarchi.com) — flagship self-help product: smart note-taking and personal development app with full privacy (no data leaves the device)
- **ShieldNest** (shieldnest.org) — privacy-first dev company; root site. Vercel project: `shieldnestorg/shieldnest_landing_page`. A blog section is **planned** (no `/blog` route live yet).
- **tokns.fi** — TX ecosystem marketing site. Vercel project: `shieldnestorg/tokns.fi_landing_page`. Blog section is called **"the Lab"** (`tokns.fi/lab`) — **planned**, not yet live.
- **app.tokns.fi** — crypto dashboard (NFTs, swaps, staking, wallet tracking). Vercel project: `shieldnestorg/tokns`. Blog content surfaces as a **"News & Insights"** section at the bottom of `/dashboard` — **planned**, not yet live.
- **TX Blockchain** (tx.org) — Cosmos SDK chain; ShieldNest runs a validator. Goal: #1 validator via tokns.fi delegation.
- **Trustee DAO** (dao.nestd.xyz) — DAO governance platform on VPS4 (31.220.61.14)
- **rollwithsolo.com / runatthebullets.com** — ShieldNest properties on VPS3 (147.79.78.251)

### Blog Distribution

Generate → publish wiring owned by this repo (see [docs/products/blog-distribution.md](../products/blog-distribution.md) for the canonical matrix and `server/src/services/blog-publisher.ts` for the code):

| Target slug | Destination | Status | Env vars |
|---|---|---|---|
| `cd`        | `https://www.coherencedaddy.com/blog/<slug>` | **LIVE** — ~2–3 posts/day | `CD_BLOG_API_URL`, `CD_BLOG_API_KEY` |
| `sn`        | `https://shieldnest.org/blog/<slug>` | **LIVE** | `SN_BLOG_API_URL`, `SN_BLOG_API_KEY` |
| `tokns-app` | `https://app.tokns.fi/articles/<slug>` + dashboard "News & Insights" feed | **LIVE** | `TOKNS_APP_BLOG_API_URL`, `TOKNS_APP_BLOG_API_KEY` |
| _(read-only)_ | `https://tokns.fi/lab` ("the Lab") — fetches from `app.tokns.fi/api/articles` client-side (CORS-allowlisted) | **LIVE** | _(no publisher env; reads tokns-app)_ |

Per-target publish results (`content_items.publish_results` JSONB, migration 0092) are surfaced in the admin UI at `/content-review` via `PublishTargetChips` — green chips with open-link, red chips with retry, gray chips with publish-now. The retry endpoint is `POST /api/content/queue/:id/republish/:target`.

## Core Systems In This Repo

### Agent Management
Manages a diverse fleet of AI agents including:
- **Executive/Core Team**: Atlas (CEO), Nova (CTO), Sage (CMO), River (PM), Pixel (Designer), Echo (Data Engineer), Core (Backend), Bridge (Full-Stack), Flux (Frontend).
- **Content Personalities**: Blaze, Cipher, Spark, Prism, Vanguard, Forge.
- **Specialized Agents**: Mermaid (Structure), Moltbook (Social), and Knowledge Graph agents (Nexus, Weaver, Recall, Oracle).

### Data & Intel Pipelines
- **Blockchain Intel Engine**: Price/news/social ingestion with BGE-M3 vector embeddings.
- **Intel Discovery**: Automated trending project discovery via CoinGecko and GitHub.
- **Chain Metrics**: Direct Cosmos SDK LCD ingestion for staking APR, validator ranks, and TVL tracking.
- **Knowledge Graph Engine**: Structured relationship intelligence layer with typed directed edges and semantic agent memory.

### Content & Visual Generation
- **Text Engine**: Ollama-powered generation with personality-driven templates and a feedback loop.
- **SEO Engine**: Trend-based blog generation with intel vector context and IndexNow integration.
- **Visual Content System**: AI image/video generation via Gemini, Grok/xAI, and Canva.
- **YouTube Automation**: Full production pipeline from strategy and script writing to TTS (Grok Rex) and FFmpeg assembly.
- **Public Reels API**: Unauthenticated endpoint for approved visual content.

### Business & Monetization
- **Intel API Paid Tier**: Stripe-backed subscription layers (Free, Starter, Pro, Enterprise) with usage metering.
- **Directory Listings**: Monetized featured/verified placements for indexed companies.
- **AEO Partner Network**: B2B lead-gen system weaving local business partners into content.
- **CreditScore (SEO + AEO audit)**: 4-tier product ($19 one-time / $49 Starter / $199 Growth / $499 Pro, plus $1,188/yr Growth annual). Plans, subs, reports, Stripe pipeline, and rescan cron (`creditscore:scan`, every 6h; Starter/Growth monthly, Pro weekly cadence) all owned here. Email delivery is an HMAC-signed callback to `coherencedaddy-landing` (templates stay in the storefront). See `docs/products/creditscore-prd.md` and `docs/OWNERSHIP.md`.
- **Bundles**: Multi-product packages (AEO Starter $199, AEO Growth $499, AEO Scale $1,299, All-Inclusive $2,499). `getEntitlementsForCompany` resolves the higher of bundle-granted or standalone-subscribed tier per product.
- **Affiliate Program**: Public-facing recruiter network at `affiliates.coherencedaddy.com`. Affiliates register, submit local business prospects via URL, earn commission on conversions. Full pipeline: registration → admin approval → prospect submission → AI onboarding (Firecrawl + Ollama) → admin tracking in dashboard. JWT-auth, separate from admin session system.

### Communication & Integration
- **Auto-Reply Engine**: X/Twitter polling and response system with budget-based rate limiting.
- **Discord Bot**: Community moderation, ticketing, and AI-powered management.
- **Moltbook Plugin**: Integration with the Moltbook AI social network.
- **MCP Server**: Exposes dashboard tools to MCP-compatible agents.

### Infrastructure & Admin
- **Authenticated Dashboard**: Company/workspace, project, and issue management.
- **System Health**: Eval results, log aggregation, and alerting.
- **Structure Diagram**: Living Mermaid-based visualization of the backend topology.
