# CLAUDE.md — Team Dashboard

## What This Project Is

The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Coherence Daddy is a faith-based organization on a mission to help humanity be more coherent through private, secure self-help products that teach real skills, broaden awareness, and help the next generation stay secure. This dashboard manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing brand site and tools live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

## Ecosystem

- **Team Dashboard** (this repo) — internal admin, agent management, data pipelines
- **Coherence Daddy** (coherencedaddy.com) — public mission hub: faith-driven technology for a more coherent world. Landing page features the mission, YourArchi spotlight, donation support (Stripe + crypto), venture overview, and FAQ
- **Free Tools** (freetools.coherencedaddy.com) — 523+ public tools, subdomain routed (lives in coherencedaddy repo)
- **Blockchain Directory** (coherencedaddy.com/directory) — public directory of 114+ blockchain projects powered by Intel API (lives in coherencedaddy repo)
- **YourArchi** (yourarchi.com) — flagship self-help product: smart note-taking and personal development app with full privacy (no data leaves the device)
- **tokns.fi / app.tokns.fi** — crypto platform and dashboard (NFTs, swaps, staking, wallet tracking)
- **TX Blockchain** (tx.org) — Cosmos SDK chain, ShieldNest runs a validator; goal: #1 validator via tokns.fi
- **ShieldNest** (shieldnest.io) — privacy-first dev company that builds all ecosystem infrastructure

## Primary Company

**Coherence Daddy** — ID: `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`, prefix: `CD`

This is the main company in the dashboard. All agents, content, and data belong to this company. The env var `TEAM_DASHBOARD_COMPANY_ID` must point to this ID.

## What Lives Here

- **Agent management** — 9 AI agents under Coherence Daddy (Atlas/CEO, Nova/CTO, Sage/CMO, River/PM, Pixel/Designer, Echo/Data Engineer, Core/Backend, Bridge/Full-Stack, Flux/Frontend) + 4 content personality agents (Blaze/Cipher/Spark/Prism) + Mermaid (Company Structure Agent). Each agent's AGENTS.md documents its cron responsibilities. See `docs/guides/agent-cron-ownership.md` for the full mapping
- **Data pipelines** — Firecrawl scraping, Qdrant vector indexing, Directory API sync, eval smoke tests (daily), SMTP email alerting, log aggregation
- **Content engine** — Ollama-powered text content generation with 4 personality agents, PostgreSQL-backed content queue (`content_items` table), blog publishing API, multi-platform distribution. Admin feedback system (`content_feedback` table) with like/dislike ratings that feed back into generation prompts as training signal
- **SEO engine** — trend scanner (CoinGecko + HackerNews + Google Trends RSS + Bing News every 6hr), Claude-powered blog post generation, auto-publish to coherencedaddy.com blog API, IndexNow ping. Routes at `/api/trends/*`, daily cron at 7:03 AM (`content:seo-engine`)
- **Visual content system** — AI image/video generation via Gemini (Imagen 3 + Veo 2), Grok/xAI (grok-2-image + grok-imagine-video), and Canva (Python bridge). FFmpeg video assembly with watermark + metadata embedding. Async job system, PostgreSQL-backed visual content queue (`visual_content_items` + `visual_content_assets` tables) with review workflow, Content Studio UI with Text/Visual mode toggle
- **Public Reels API** — unauthenticated `/api/reels` endpoint serving approved visual content for coherencedaddy.com. Stream, download (with Content-Disposition), and thumbnail endpoints
- **Platform publishing** — YouTube Shorts, TikTok, Instagram Reels, Twitter/X video publishers (env-var gated, auto-enabled when platform API keys are set)
- **Directory expansion** — AI/ML (151 entries), DeFi (114), DevTools (155), Crypto (114) — 508 unique companies across 4 directories, all seeded and ingested
- **Blockchain Intel Engine** — price/news/twitter/github/reddit ingestion with BGE-M3 vector embeddings, public API at `/api/intel/*`, aggressive cron schedules (30min–4hr cycles), paginated full-directory processing
- **Intel Discovery Engine** — automated trending project discovery via CoinGecko trending + GitHub trending, auto-adds high-confidence finds, queues low-confidence for review
- **Intel Backfill** — cron + API endpoint for building historical data on sparse companies, auto-triggered after seeding
- **Mintscan Chain Metrics** — Cosmostation Mintscan API integration for Cosmos ecosystem (staking APR, validator data) tracking cosmos/osmosis/txhuman
- **Social Pulse Engine** — real-time X/Twitter monitoring for TX Blockchain, Cosmos, XRPL Bridge, and Tokns ecosystem. Dual ingestion: X API v2 filtered stream (real-time) with automatic fallback to polling. Computed per-topic sentiment analysis, hourly/daily aggregations, volume spike detection, XRPL bridge mention tracking, 12h backfill for historical gap-filling. 7 cron jobs (5min–12hr cycles), authenticated dashboard at `/social-pulse`, public API at `/api/public/pulse/*` for tokns.fi widget embeds
- **MCP Server** — `packages/mcp-server/` Model Context Protocol server exposing 35 tools across 9 entities (Issues, Projects, Milestones, Labels, Teams, WorkflowStates, Comments, IssueRelations, Initiatives). Wraps Team Dashboard REST API for use by Claude, Codex, and other MCP-compatible agents. Stdio transport, configurable via `PAPERCLIP_API_URL` and `PAPERCLIP_API_TOKEN`
- **Media Drop** — file upload and media management for content pipeline. Multer-based upload (up to 4 files), S3/local storage backends, per-company media libraries. Routes at `/api/media/*`, schema in `media_drops` table
- **Intel Dashboard** — admin UI page at `/intel` with tabbed tables (Overview/Crypto/AI-ML/DeFi/DevTools), searchable company lists, stats cards
- **Public Article Generator** — rate-limited public endpoint (`POST /api/content/public/generate`) for users to generate AI-powered articles with Coherence Daddy metadata attribution. Powered by Ollama + intel context, supports all platforms (tweet, blog, linkedin, reddit, etc.)
- **Authenticated dashboard** — company/workspace management, projects, issues, goals, routines
- **Discord Bot** — community moderation and ticketing bot (plugin-discord) for the Next.ai Discord server. Auto-mod (banned words, spam, invite links), escalating warning system (3=mute, 5=kick), support ticketing with private threads and auto-close, 17 mod commands, onboarding role assignment. Dashboard page at `/discord` with bot status, ticket queue, and mod action feed. 8 agent tools for AI-powered community management
- **Plugin system** — adapter packages for AI providers, plus Paperclip plugin SDK with Firecrawl, Twitter/X, and Discord plugins
- **API layer** — backend at port 3100, proxied from UI dev server
- **System Health dashboard** — eval results, alerting, log aggregation, ladder pipeline status
- **TX Ecosystem page** — tokns.fi validator promotion, ecosystem cross-links
- **Structure page** — Mermaid-powered architecture diagram of all backend services, routes, and crons with color-coded subgraphs, zoom/fullscreen controls, and revision history. Stored via documents table (no migration needed)

## What Does NOT Live Here

The 27 public free tools were **migrated to the coherencedaddy repo** (April 2026). Do not add public marketing tools here. This repo is for authenticated admin functionality only. The public blockchain directory page lives in the coherencedaddy repo at `/directory`, powered by this repo's Intel API.

## Tech Stack

- React 19, Vite, Tailwind CSS v4, shadcn/ui components
- Icons: lucide-react
- State: React useState/useEffect, @tanstack/react-query
- API: REST client at `ui/src/api/`
- Backend: Express.js at port 3100
- Adapters: `packages/` directory for AI provider integrations

## Project Structure

```
server/
  src/
    routes/           # Express API routes (agents, issues, skills, plugins, site-metrics, intel, etc.)
    services/         # Business logic (agent instructions, company skills, intel ingestion, etc.)
      alerting.ts, alert-crons.ts   # SMTP email alerts with health check + daily digest
      eval-store.ts, eval-crons.ts  # Daily promptfoo eval runner + JSON result store
      ladder.ts                     # Read-only access to ladder2.0 pipeline data
      log-store.ts                  # In-memory + file-based log aggregation
      content.ts                    # Text content generation service (Ollama, personality prompts)
      content-crons.ts              # Scheduled content generation jobs (text + video scripts)
      visual-content.ts             # Visual content queue, generation orchestration, review
      visual-jobs.ts                # Async job tracker for visual generation (15s polling)
      visual-backends/              # Pluggable visual generation backends
        types.ts                    # VisualBackend interface
        gemini.ts                   # Gemini Imagen 3 (image) + Veo 2 (video)
        grok.ts                     # Grok/xAI image + video (grok-imagine-video)
        canva.ts                    # Canva Python bridge (template-based designs)
        index.ts                    # Backend registry (auto-enable by env var)
      video-assembler.ts            # FFmpeg pipeline (text overlays, watermark, metadata)
      watermark.ts                  # Brand watermark utility + metadata helper
      structure.ts                  # Company structure diagram service (Mermaid, versioned via documents table)
      content-feedback.ts           # Admin like/dislike feedback for content training
      trend-scanner.ts              # CoinGecko + HackerNews + Google Trends + Bing News trend signals
      seo-engine.ts                 # Claude-powered blog generation from trends + publish + IndexNow
      trend-crons.ts                # Trend scanning cron scheduler (6hr cycle)
      social-pulse.ts               # Social Pulse service (polling, sentiment, aggregation, spikes)
      social-pulse-client.ts        # X API v2 client for tweet search
      filtered-stream-client.ts     # X API v2 filtered stream client (real-time tweets)
      stream-rule-manager.ts        # Sync X API stream filter rules with pulse topics
      stream-connection-manager.ts  # Filtered stream lifecycle manager (connect, reconnect, fallback)
      pulse-crons.ts                # 7 pulse cron jobs (Echo-owned)
      platform-publishers/          # Automated social media publishing
        types.ts                    # PlatformPublisher interface
        youtube.ts                  # YouTube Shorts (Data API v3)
        tiktok.ts                   # TikTok (Content Posting API)
        twitter-video.ts            # Twitter/X video (stub — needs OAuth 1.0a)
        instagram.ts                # Instagram Reels (stub — needs public URL)
        index.ts                    # Publisher registry
    storage/              # Pluggable storage service (S3, local disk)
    content-templates/  # Personality prompt templates (blaze, cipher, spark, prism)
    routes/
      visual-content.ts             # Visual content API (/api/visual/*)
      public-reels.ts               # Public reels API (/api/reels/* — no auth)
      structure.ts                  # Structure diagram API (/api/companies/:id/structure)
      social-pulse.ts               # Authenticated pulse API (/api/pulse/* + stream-status)
      public-pulse.ts               # Public pulse API (/api/public/pulse/* — no auth)
      media-drop.ts                 # Media upload/management API (/api/media/*)
      trends.ts                     # Trend signals + SEO engine API (/api/trends/*)
    data/             # Static seed data (intel companies)
    middleware/       # Auth, validation, board mutation guard
    adapters/         # HTTP/process adapter runners
ui/
  src/
    api/              # REST API client (auth, companies, agents, etc.)
      pulse.ts        # Social Pulse API client
    components/
      ui/             # shadcn/ui primitives
      PulseTopicCard.tsx    # Pulse topic summary card component
      PulseTweetCard.tsx    # Pulse tweet display card component
      XrplBridgeShowcase.tsx # XRPL bridge analytics showcase component
      SocialPulseWidget.tsx     # Internal social pulse summary widget
      SocialPulseWidgetEmbed.tsx # Embeddable social pulse widget for tokns.fi
      HowToGuide.tsx            # Reusable collapsible help/tutorial component
    context/          # ThemeContext, CompanyContext, DialogContext, etc.
    hooks/            # Custom React hooks
    lib/              # Utilities, router, agent config
    pages/            # Authenticated dashboard pages (incl. SocialPulse.tsx)
  public/             # Favicons, service worker
agents/                 # Per-agent AGENTS.md instruction files
  atlas/              # CEO — strategy, delegation, board comms
  nova/               # CTO — technical direction, manages eng team
  sage/               # CMO — marketing, brand, AEO strategy
  river/              # PM — project coordination, sprint planning
  pixel/              # Designer — UI/UX, design system
  core/               # Backend Dev — Express, DB, APIs
  flux/               # Frontend Dev — React, UI, components
  bridge/             # Full-Stack Dev — integration, deployment, docs
  echo/               # Data Engineer — Firecrawl scraping, Qdrant, AEO
  blaze/              # Content Analyst — hot-take, data-driven content for Twitter/Reddit
  cipher/             # Content Technical — deep technical content for Blog/LinkedIn
  spark/              # Content Community — community engagement for Discord/Bluesky
  prism/              # Content Reporter — trend reports for Blog/LinkedIn/Newsletter
  mermaid/            # Company Structure Agent — architecture flowcharts, service topology
.agents/
  skills/             # Company skills (company-creator, doc-maintenance, release, etc.)
    content-writer/   # Content generation and publishing skill
    content-orchestrator/ # Sage's content dispatch and calendar management
packages/
  db/                 # Drizzle schema, migrations, DB clients
    src/schema/
      pulse_tweets.ts          # Pulse tweets table schema
      pulse_aggregations.ts    # Pulse hourly/daily aggregation schema
      pulse_xrpl_bridge.ts     # XRPL bridge mention tagging schema
  shared/             # Shared types, constants, validators, API path constants
  adapter-utils/      # Shared adapter utilities
  adapters/           # Agent adapter implementations (Claude, Codex, Cursor, etc.)
  mcp-server/         # MCP server — 35 tools wrapping Team Dashboard REST API
  brand-guide/        # Coherence Daddy brand guidelines (standalone HTML)
  plugins/
    plugin-firecrawl/ # Firecrawl scraping plugin (scrape, crawl, extract, etc.)
    plugin-twitter/   # Twitter/X automation plugin (queue, missions, engagement)
    plugin-discord/   # Discord bot plugin (moderation, ticketing, commands)
    sdk/              # Plugin SDK for building plugins
cli/                  # CLI tool (paperclipai command)
docs/
  api/                # REST API endpoint documentation
  deploy/             # Deployment guides (Vercel+VPS, Docker, Tailscale, etc.)
  guides/             # Operator and agent developer guides (incl. agent-cron-ownership.md)
  adapters/           # Adapter documentation
  companies/          # Agent Companies specification
doc/                  # Operational docs (SPEC, PRODUCT, GOAL, plans/)
```

## Concurrent Agent Sessions — CRITICAL

**Never run multiple agent sessions editing this repo simultaneously on the same branch.**

On 2026-04-03, two concurrent agent sessions both edited `server/src/app.ts` and `ui/src/pages/ContentReview.tsx`. The linter in Session B auto-removed imports that Session A had added (treating them as "unused"), which broke the VPS Docker build. Three emergency fix commits were needed to recover.

### Rules

1. **One writer per branch** — if two agents need to work in parallel, use separate feature branches or worktrees (`/worktree` command)
2. **Feature branches for new services** — any work that adds new backend services, routes, or DB migrations MUST happen on a feature branch, not directly on `master`
3. **Verify Docker build before merging** — the VPS TypeScript compiler is stricter than local. Always run `npx tsc --noEmit --project server/tsconfig.json` and confirm zero errors before pushing to master
4. **Express params** — always cast `req.params.*` as `string` (e.g., `req.params.id as string`) to satisfy strict TypeScript
5. **Don't `git add -A`** — stage specific files to avoid accidentally committing half-built artifacts from another session

### Safe Workflow for Large Features

```bash
# 1. Create a feature branch
git checkout -b feat/my-feature

# 2. Build and test on the branch
npx tsc --noEmit --project server/tsconfig.json  # zero errors
cd ui && npx tsc --noEmit                         # zero errors

# 3. Only merge to master when the full feature compiles
git checkout master && git merge feat/my-feature

# 4. Push — triggers Vercel deploy + manual VPS deploy
git push origin master
```

## Documentation Requirements

**Always update documentation when making changes.** After completing any build, modification, or refactor:

1. Update relevant docs in `docs/`
2. Never leave documentation referencing stale file lists or architecture
3. Verify documentation accuracy as part of the final review step

## Structure Diagram Updates

**After adding, removing, or restructuring backend services, routes, or cron jobs**, update the company structure diagram:

1. Read the current diagram: `GET /api/companies/:companyId/structure`
2. Update the Mermaid source to reflect changes (add/remove nodes, update subgraphs, fix arrows)
3. Save: `PUT /api/companies/:companyId/structure` with `{ body: "<mermaid source>", changeSummary: "what changed" }`

Use `TEAM_DASHBOARD_COMPANY_ID` (`8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`) as the companyId. The diagram lives on the Structure page (`/structure`) in the UI. If no diagram exists in the DB yet, the page renders a built-in default — update via the API to persist changes.

**What triggers an update**: new files in `server/src/services/`, `server/src/routes/`, new cron jobs, new visual backends, new plugin services, or any change to `server/src/app.ts` route mounting.

## Commands

```bash
# UI dev server (port 5173, proxies /api to :3100)
cd ui && npm run dev

# Backend
npm run dev

# Build
cd ui && npm run build
```

## Deployment (Split Architecture)

```
Vercel (frontend)              VPS 31.220.61.12 (backend)        Neon (database)
React SPA (ui/dist)  -------> Docker: Express.js :3200  ------> PostgreSQL
vercel.json rewrites           docker-compose.production.yml     Vercel integration
/api/* -> VPS:3200             SERVE_UI=false
```

- **Frontend**: Vercel — auto-deploys on push to master, serves static UI
- **Backend**: VPS Docker at `31.220.61.12:3200` — Express.js API, agent runtime
- **Database**: Neon PostgreSQL — managed by Vercel integration
- **Firecrawl**: Self-hosted at `168.231.127.180` — scraping, crawling, data extraction
- **Embeddings**: `31.220.61.12:8000` — vector embedding service
- **Directory API**: `168.231.127.180:4000` — data sync from Firecrawl
- **Ollama**: `168.231.127.180:11434` — local LLM for content generation and summarization (qwen2.5:1.5b)
- **Content API Key**: `CONTENT_API_KEY` env var for content generation auth (text + visual)
- **Visual Backends**: `GEMINI_API_KEY` (Imagen 3 + Veo 2), `GROK_API_KEY` (xAI images via grok-2-image + video via grok-imagine-video) — optional, auto-enabled when set
- **Company ID**: `TEAM_DASHBOARD_COMPANY_ID=8365d8c2-ea73-4c04-af78-a7db3ee7ecd4` (Coherence Daddy)
- **GitHub**: ShieldnestORG/team-dashboard (make private after deploy; use PAT for VPS access)
- **Site Metrics**: coherencedaddy.com pushes daily analytics via `/api/companies/:id/site-metrics/ingest`
- **DB Backups**: enabled (`PAPERCLIP_DB_BACKUP_ENABLED=true`)
- **SMTP Alerting**: env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`
- **Cron Schedulers**: intel (8 jobs: 5 ingest + 1 backfill + 1 discover + 1 chain-metrics), eval (1 job), alert (2 jobs), content (12 jobs: 6 text + 3 video script + 1 SEO engine + 2 intel-alert), trends (1 job: scan every 6hr), pulse (7 jobs: search + sentiment + aggregate-hour + aggregate-day + xrpl-bridge + spike-detect + backfill), discord (2 plugin jobs: ticket-cleanup + daily-stats), twitter (4 plugin jobs: post-dispatcher 2m + engagement-cycle 5m + queue-cleanup 6h + analytics-rollup daily). All 37 jobs have `ownerAgent` metadata — see `docs/guides/agent-cron-ownership.md`. Note: `pulse:search` auto-skips when the X API filtered stream is connected and healthy
- **Filtered Stream**: X API v2 filtered stream (`/2/tweets/search/stream`) runs as a background service on startup when `BEARER_TOKEN` is set. Auto-reconnects with exponential backoff (1s–5min). Falls back to `pulse:search` polling if stream fails after 5 retries. Status at `GET /api/pulse/stream-status`
- **Heartbeat Scheduler**: enabled by default (`HEARTBEAT_SCHEDULER_ENABLED`), 30s tick in `index.ts`, wakes agents with configured `runtimeConfig.heartbeat.intervalSec`

### Key Files

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel build config + `/api/*` rewrite to VPS |
| `docker-compose.production.yml` | VPS backend Docker Compose (template) |
| `.env.production` | VPS secrets (never committed, on VPS at `/opt/team-dashboard/`) |
| `server/src/routes/content.ts` | Text content generation + queue API |
| `server/src/routes/visual-content.ts` | Visual content generation + queue + asset serving API |
| `server/src/content-templates/*.ts` | Personality prompt templates (text + video_script) |
| `server/src/services/trend-scanner.ts` | CoinGecko + HackerNews + Google Trends + Bing News trend scanner |
| `server/src/services/seo-engine.ts` | Claude-powered blog generation + publish + IndexNow |
| `server/src/routes/trends.ts` | Trend signals + SEO engine API (`/api/trends/*`) |
| `server/src/services/filtered-stream-client.ts` | X API v2 filtered stream client (real-time, event emitter) |
| `server/src/services/stream-connection-manager.ts` | Filtered stream lifecycle (connect, reconnect, fallback to polling) |
| `server/src/services/stream-rule-manager.ts` | X API stream filter rule sync with pulse topics |
| `server/src/services/visual-backends/` | Pluggable visual generation backends (Gemini, Grok, Canva) |
| `server/src/services/video-assembler.ts` | FFmpeg video pipeline (overlays, watermark, metadata) |
| `server/src/services/platform-publishers/` | Auto-publishing to YouTube/TikTok/Instagram/Twitter |
| `server/src/routes/public-reels.ts` | Public reels API (no auth) for coherencedaddy.com |
| `scripts/canva-generator.py` | Canva Connect API Python bridge |
| `server/src/services/intel-discovery.ts` | Auto-discovery of trending projects (CoinGecko + GitHub) |
| `server/src/services/mintscan.ts` | Cosmostation Mintscan API integration (chain APR, validator metrics) |
| `ui/src/pages/Intel.tsx` | Intel Dashboard — tabbed admin page for browsing 508 companies |
| `server/src/services/structure.ts` | Company structure diagram service (Mermaid, versioned) |
| `server/src/routes/structure.ts` | Structure diagram API (`/api/companies/:id/structure`) |
| `ui/src/pages/Structure.tsx` | Architecture diagram page with zoom, fullscreen, revisions |
| `packages/plugins/plugin-discord/src/worker.ts` | Discord bot plugin worker (Discord.js client, tools, jobs) |
| `packages/plugins/plugin-discord/src/manifest.ts` | Discord plugin manifest (config, 8 tools, 2 jobs) |
| `packages/plugins/plugin-discord/src/moderation.ts` | Auto-mod, warnings, spam detection |
| `packages/plugins/plugin-discord/src/ticketing.ts` | Ticket lifecycle, auto-close, log embeds |
| `packages/plugins/plugin-discord/src/commands.ts` | 17 `!` commands (warn, mute, kick, ban, etc.) |
| `ui/src/pages/Discord.tsx` | Discord dashboard — bot status, tickets, mod feed |
| `server/src/services/social-pulse.ts` | Social Pulse service (polling, sentiment, aggregation, spike detection) |
| `server/src/services/social-pulse-client.ts` | X API v2 client for tweet search |
| `server/src/services/pulse-crons.ts` | 7 pulse cron jobs (Echo-owned) |
| `server/src/routes/social-pulse.ts` | Authenticated pulse API (`/api/pulse/*`) |
| `server/src/routes/public-pulse.ts` | Public pulse API (`/api/public/pulse/*` — no auth) |
| `ui/src/pages/SocialPulse.tsx` | Social Pulse dashboard — 5-tab view with topic cards, tweet feed, XRPL bridge |
| `server/src/routes/media-drop.ts` | Media upload/management API (`/api/media/*`) |
| `packages/plugins/plugin-twitter/src/manifest.ts` | Twitter/X plugin manifest (13 tools, 4 jobs) |
| `packages/plugins/plugin-twitter/src/worker.ts` | Twitter/X plugin worker (queue, engagement, analytics) |
| `packages/mcp-server/src/index.ts` | MCP server entry point — registers 35 tools, stdio transport |
| `packages/mcp-server/src/client.ts` | HTTP client wrapping Team Dashboard REST API for MCP |
| `docker/chrome-bot/entrypoint.sh` | Chrome-bot entrypoint — fixes /data volume permissions before supervisor |

### Updating

```bash
# Backend: SSH into VPS, pull latest code, rebuild
ssh root@31.220.61.12
cd /opt/team-dashboard/repo && git pull
cd /opt/team-dashboard && docker compose build && docker compose up -d

# Frontend: auto-deploys on push to master
git push origin master
```

### Environment Variables Reference

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| **Database** | | | |
| `DATABASE_URL` | Yes | VPS + Vercel + Local | Neon PostgreSQL connection string |
| **Auth** | | | |
| `PAPERCLIP_AGENT_JWT_SECRET` | Yes | VPS | Agent JWT signing secret |
| `BETTER_AUTH_SECRET` | Yes | VPS | Better Auth session signing |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes | VPS | CORS origins for auth (Vercel URL) |
| `PAPERCLIP_PUBLIC_URL` | Yes | VPS | Public URL for auth callbacks |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | Yes | VPS | Allowed hostnames for private mode |
| **API** | | | |
| `PAPERCLIP_API_URL` | Yes | VPS | Backend API base URL |
| `TEAM_DASHBOARD_COMPANY_ID` | Yes | VPS + Local | `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4` (Coherence Daddy) |
| **AI / LLM** | | | |
| `ANTHROPIC_API_KEY` | Yes | VPS | Claude API for agent runtime |
| `ANTHROPIC_MODEL` | Optional | VPS | Default model (default: claude-haiku-4-5-20251001) |
| `OLLAMA_URL` | Yes | VPS | Ollama LLM for content generation (`http://168.231.127.180:11434`) |
| `OLLAMA_MODEL` | Optional | VPS | Ollama model (default: qwen2.5:1.5b) |
| **Visual Content** | | | |
| `CONTENT_API_KEY` | Yes | VPS | Auth for content, visual content, and trend endpoints |
| `CD_BLOG_API_URL` | Optional | VPS | Blog publish endpoint (default: `https://coherencedaddy.com/api/blog/posts`) |
| `CD_BLOG_API_KEY` | Yes | VPS | Bearer token for coherencedaddy blog API |
| `INDEXNOW_KEY` | Optional | VPS | IndexNow verification key for search engine ping |
| `GEMINI_API_KEY` | Optional | VPS | Enables Gemini visual backend (Imagen 3 + Veo 2) |
| `GROK_API_KEY` | Optional | VPS | Enables Grok/xAI backend (grok-2-image + grok-imagine-video) |
| `CANVA_API_KEY` | Optional | VPS | Enables Canva template backend (Python bridge) |
| **Platform Publishing** | | | |
| `YOUTUBE_CLIENT_ID/SECRET` | Optional | VPS | YouTube Shorts auto-publishing |
| `YOUTUBE_REFRESH_TOKEN` | Optional | VPS | YouTube OAuth refresh token |
| `TIKTOK_ACCESS_TOKEN` | Optional | VPS | TikTok Content Posting API |
| `TWITTER_API_KEY/SECRET` | Optional | VPS | Twitter/X video posting |
| `TWITTER_ACCESS_TOKEN/SECRET` | Optional | VPS | Twitter/X OAuth tokens |
| `INSTAGRAM_ACCESS_TOKEN` | Optional | VPS | Instagram Graph API |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Optional | VPS | Instagram business account |
| **Discord Bot** | | | |
| `DISCORD_TOKEN` | Yes | VPS | Discord bot token from Developer Portal |
| `DISCORD_GUILD_ID` | Yes | VPS | Discord server ID (Next.ai: `1481053410152288422`) |
| `DISCORD_TICKET_CHANNEL_ID` | Yes | VPS | #submit-a-ticket channel for ticket threads |
| `DISCORD_TICKET_LOG_CHANNEL_ID` | Yes | VPS | #ticket-logs channel for status embeds |
| `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` | Optional | VPS | #moderators-updates for mod action logs |
| `DISCORD_WELCOME_CHANNEL_ID` | Optional | VPS | #welcome channel |
| `DISCORD_ROLE_MEMBER` | Optional | VPS | Auto-assigned role on join |
| `DISCORD_ROLE_MODERATOR` | Optional | VPS | Role for mod commands |
| `DISCORD_ROLE_ADMIN` | Optional | VPS | Role for admin commands |
| **Intel Engine** | | | |
| `INTEL_INGEST_KEY` | Yes | VPS | Auth for intel data ingestion |
| `MINTSCAN_API_KEY` | Optional | VPS | Cosmostation Mintscan API for Cosmos chain metrics (APR, validators) |
| `GITHUB_TOKEN` | Yes | VPS | GitHub API access for intel + deployment |
| `EMBED_URL` | Yes | VPS | Embedding service (`http://31.220.61.12:8000`) |
| `EMBED_API_KEY` | Yes | VPS | Embedding service auth |
| `FIRECRAWL_EMBEDDING_API_KEY` | Yes | VPS | Firecrawl scraping API auth |
| `BING_NEWS_KEY` | Optional | VPS | Bing News Search API v7 key for trend scanning |
| **Social Pulse** | | | |
| `BEARER_TOKEN` | Optional | VPS | X API v2 bearer token for Social Pulse (disables feature if missing) |
| `CONSUMER_KEY` | Optional | VPS | X API consumer key for OAuth 1.0a |
| `SECRET_KEY` | Optional | VPS | X API consumer secret for OAuth 1.0a |
| `X_ACCESS_TOKEN` | Optional | VPS | X API OAuth access token |
| `X_ACCESS_TOKEN_SECRET` | Optional | VPS | X API OAuth access token secret |
| **Payments** | | | |
| `STRIPE_SECRET_KEY` | Optional | VPS | Stripe API secret key for donations |
| `STRIPE_WEBHOOK_SECRET` | Optional | VPS | Stripe webhook signature verification |
| **Monitoring** | | | |
| `SITE_METRICS_KEY` | Yes | VPS + coherencedaddy | Site analytics ingestion auth |
| `SMTP_HOST/PORT/USER/PASS` | Optional | VPS | Email alerting (Proton Mail) |
| `ALERT_EMAIL_TO/FROM` | Optional | VPS | Alert email recipients |

**Vercel** gets `DATABASE_URL` automatically via Neon integration. No other env vars needed there — it only serves the static UI.

**VPS** needs all the above in `.env.production` at `/opt/team-dashboard/`.

### WebSocket Limitation

Vercel rewrites don't support WebSocket upgrade. Live push notifications (agent status, issue updates) are degraded. React Query polling still works. Fix later by adding a domain to the VPS with Caddy for HTTPS + WS support.

---

## Ladder: auto

This project is tracked by **ladder2.0** (MCP server at `~/.ladder/ladder.db`, project name: `team-dashboard`).

After every build, deploy, or code change, track the outcome via `mcp__ladder__track_event` with project `team-dashboard`.
When 10+ new events accumulate, run `mcp__ladder__generate_sources` with project `team-dashboard` and `persist=true`.
When new sources are created, run `mcp__ladder__generate_ideas` with project `team-dashboard` and `persist=true`.
At the end of each session, show `mcp__ladder__pipeline_status` for project `team-dashboard`.
