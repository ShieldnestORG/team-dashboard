# System Overview — Team Dashboard

## What This Project Is
The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Coherence Daddy is a faith-based organization on a mission to help humanity be more coherent through private, secure self-help products that teach real skills, broaden awareness, and help the next generation stay secure. This dashboard manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing brand site and tools live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

## Ecosystem

### coherencedaddy.com (ShieldnestORG/coherencedaddy repo)
One Next.js 15 App Router app serving **all 9 subdomains** via `middleware.ts` subdomain routing, deployed on Vercel. Proxies `/api/intel/*`, `/api/trends/*`, and `/api/content/*` to the team-dashboard backend via Vercel rewrites.

| Subdomain | Purpose |
|---|---|
| `coherencedaddy.com` | Mission hub — faith-driven tech, YourArchi spotlight, donations (Stripe + crypto), FAQ |
| `freetools.coherencedaddy.com` | 501+ public tools with SSR content; hosts all LLM/agent discovery files |
| `directory.coherencedaddy.com` | 532+ projects across Crypto, AI/ML, DeFi, DevTools — powered by Intel API |
| `token.coherencedaddy.com` | Crypto / NFT / staking dashboard |
| `partners.coherencedaddy.com` | AEO partner network — local business partner directory |
| `creditscore.coherencedaddy.com` | Credit score tools subdomain |
| `shop.coherencedaddy.com` | Shop / merchandise subdomain |
| `law.coherencedaddy.com` | Legal / law tools subdomain |
| `optimize-me.coherencedaddy.com` | Self-optimization tools subdomain |

### SEO & LLM Discovery (as of April 2026)
- **Sitemap**: `app/sitemap.ts` — single master sitemap covering all 9 subdomains (pages, tools, directory companies, partner slugs)
- **robots.ts**: All 9 subdomain sitemaps listed; LLM crawlers explicitly allowed: GPTBot, ChatGPT-User, ClaudeBot, PerplexityBot, Applebot-Extended, GoogleOther
- **llms.txt** / **llms-full.txt** — served from `freetools.*`, lists all 9 subdomains + 501 tools by category
- **ai-plugin.json** / **mcp.json** / **openapi.json** — agent/MCP discovery at `freetools.*/.well-known/`
- **AdSense**: `ca-pub-1882924299982046` — auto ads in `app/layout.tsx`, manual units in tool pages, sidebar, and blog posts; `ads.txt` in public/; CookieYes CMP + Consent Mode v2

### Other Ecosystem Properties
- **YourArchi** (yourarchi.com) — flagship self-help product: smart note-taking and personal development app with full privacy (no data leaves the device)
- **tokns.fi / app.tokns.fi** — crypto platform and dashboard (NFTs, swaps, staking, wallet tracking)
- **TX Blockchain** (tx.org) — Cosmos SDK chain, ShieldNest runs a validator; goal: #1 validator via tokns.fi
- **ShieldNest** (shieldnest.io) — privacy-first dev company that builds all ecosystem infrastructure
- **Trustee DAO** (dao.nestd.xyz) — DAO governance platform on VPS4 (31.220.61.14)
- **rollwithsolo.com / runatthebullets.com** — ShieldNest properties on VPS3 (147.79.78.251)

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
