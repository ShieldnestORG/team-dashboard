# CLAUDE.md — Team Dashboard

## What This Project Is

The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Coherence Daddy is a faith-based organization on a mission to help humanity be more coherent through private, secure self-help products that teach real skills, broaden awareness, and help the next generation stay secure. This dashboard manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing brand site and tools live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

## Ecosystem

- **Team Dashboard** (this repo) — internal admin, agent management, data pipelines
- **Coherence Daddy** (coherencedaddy.com) — public mission hub: faith-driven technology for a more coherent world. Landing page features the mission, YourArchi spotlight, donation support (Stripe + crypto), venture overview, and FAQ
- **Free Tools** (freetools.coherencedaddy.com) — 523+ public tools, subdomain routed (lives in coherencedaddy repo)
- **Project Directory** (directory.coherencedaddy.com) — public directory of 532+ projects across Crypto, AI/ML, DeFi, DevTools with real-time intelligence, powered by Intel API (lives in coherencedaddy repo)
- **YourArchi** (yourarchi.com) — flagship self-help product: smart note-taking and personal development app with full privacy (no data leaves the device)
- **tokns.fi / app.tokns.fi** — crypto platform and dashboard (NFTs, swaps, staking, wallet tracking)
- **TX Blockchain** (tx.org) — Cosmos SDK chain, ShieldNest runs a validator; goal: #1 validator via tokns.fi
- **ShieldNest** (shieldnest.io) — privacy-first dev company that builds all ecosystem infrastructure

## Primary Company

**Coherence Daddy** — ID: `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`, prefix: `CD`

This is the main company in the dashboard. All agents, content, and data belong to this company. The env var `TEAM_DASHBOARD_COMPANY_ID` must point to this ID.

## What Lives Here

- **Agent management** — 9 AI agents under Coherence Daddy (Atlas/CEO, Nova/CTO, Sage/CMO, River/PM, Pixel/Designer, Echo/Data Engineer, Core/Backend, Bridge/Full-Stack, Flux/Frontend) + 6 content personality agents (Blaze/Cipher/Spark/Prism/Vanguard/Forge) + Mermaid (Company Structure Agent) + Moltbook (Social Presence Agent — AI agent social network). Each agent's AGENTS.md documents its cron responsibilities. See `docs/guides/agent-cron-ownership.md` for the full mapping
- **Data pipelines** — Firecrawl scraping, Qdrant vector indexing, Directory API sync, eval smoke tests (daily), SMTP email alerting, log aggregation
- **Content engine** — Ollama-powered text content generation with 6 personality agents (Blaze/hot-take analyst, Cipher/technical deep-diver, Spark/community builder, Prism/trend reporter, Vanguard/XRP-Ripple specialist, Forge/AEO-comparison architect), PostgreSQL-backed content queue (`content_items` table), blog publishing API, multi-platform distribution. **Slideshow blog generator** reuses the YouTube presentation renderer to produce interactive HTML slideshow posts with branded slides (Coherence Daddy coral/cyan or TX lime/purple), embedded navigation (prev/next, keyboard arrows, swipe, progress dots), published to both coherencedaddy.com and app.tokns.fi. Admin feedback system (`content_feedback` + `content_quality_signals` tables) with like/dislike ratings that persist to DB and downrank/uprank intel sources for future generation. Performance tracking (`click_count` + `engagement_score` on content_items) with public `POST /api/content/:id/track` endpoint
- **Content feedback loop** — published content is embedded back into `intel_reports` with BGE-M3 vectors (`content-embedder.ts`), so the knowledge base grows from its own output. SEO engine and content crons use vector similarity search to enrich prompts with relevant intel. Topic picker weights boosted by historical engagement data. Feedback penalties survive server restarts via `content_quality_signals` DB table
- **SEO engine** — trend scanner (CoinGecko + HackerNews + Google Trends RSS + Bing News every 6hr), Ollama blog post generation enriched with intel vector context, auto-publish to coherencedaddy.com + app.tokns.fi, IndexNow ping. Routes at `/api/trends/*`, daily cron at 7:03 AM (`content:seo-engine`)
- **Visual content system** — AI image/video generation via Gemini (Imagen 3 + Veo 2), Grok/xAI (grok-2-image + grok-imagine-video), and Canva (Python bridge). FFmpeg video assembly with watermark + metadata embedding. Async job system, PostgreSQL-backed visual content queue (`visual_content_items` + `visual_content_assets` tables) with review workflow, Content Studio UI with Text/Visual mode toggle
- **Public Reels API** — unauthenticated `/api/reels` endpoint serving approved visual content for coherencedaddy.com. Stream, download (with Content-Disposition), and thumbnail endpoints
- **YouTube Automation Pipeline** — full video production: Ollama content strategy, script writing, Playwright presentation rendering, Grok TTS (xAI Rex voice, chunked per-slide), FFmpeg assembly, SEO optimization, thumbnail generation, auto-publish queue. Includes **site-walker mode** — Playwright browser agent that visits URLs, scrolls through sites, captures branded screenshots, and feeds results to the walkthrough writer for narrated review videos. Services at `server/src/services/youtube/`, 5 cron jobs
- **Platform publishing** — YouTube Shorts, TikTok, Instagram Reels, Twitter/X video publishers (env-var gated, auto-enabled when platform API keys are set)
- **Directory expansion** — AI/ML (151 entries), DeFi (113), DevTools (154), Crypto (114) — 532 unique companies across 4 directories, all seeded and ingested
- **Blockchain Intel Engine** — price/news/twitter/github/reddit ingestion with BGE-M3 vector embeddings, public API at `/api/intel/*`, aggressive cron schedules (30min–4hr cycles), paginated full-directory processing, rate-limited at 60 req/min per IP
- **Intel Discovery Engine** — automated trending project discovery via CoinGecko trending + GitHub trending, auto-adds high-confidence finds, queues low-confidence for review
- **Intel Backfill** — cron + API endpoint for building historical data on sparse companies, auto-triggered after seeding
- **Mintscan Chain Metrics** — Cosmostation Mintscan API integration for Cosmos ecosystem (staking APR, validator data) tracking cosmos/osmosis/txhuman
- **Auto-Reply Engine** — X/Twitter auto-reply system using a single `search/recent` query to cover all enabled targets (accounts + keywords) in one API call. Configurable via admin UI: poll interval (default 30 min), daily dollar spend cap (default $5.00), global max replies/day (default 200), per-target delay range and reply caps. Reply modes: template rotation or AI-generated. Settings persisted in `auto_reply_settings` DB table. Budget tracked in-memory by `rate-limiter.ts` with dollar-based caps ($0.005/read, $0.01/write). Panic mode halves all caps for 1 hour on 429. Admin page at `/auto-reply`
- **X-Bot (planned)** — Chrome extension for DOM-based X/Twitter automation (likes, follows, replies, posts) will run locally (not on VPS) and send data back to the VPS API. Once operational, most X API write actions will migrate to x-bot to reduce API costs, keeping only search/read operations on the API crons
- **MCP Server** — `packages/mcp-server/` Model Context Protocol server exposing 35 tools across 9 entities (Issues, Projects, Milestones, Labels, Teams, WorkflowStates, Comments, IssueRelations, Initiatives). Wraps Team Dashboard REST API for use by Claude, Codex, and other MCP-compatible agents. Stdio transport, configurable via `PAPERCLIP_API_URL` and `PAPERCLIP_API_TOKEN`
- **Media Drop** — file upload and media management for content pipeline. Multer-based upload (up to 4 files), S3/local storage backends, per-company media libraries. Routes at `/api/media/*`, schema in `media_drops` table
- **AEO Partner Network** — B2B lead-gen system that drives traffic to local business partners through CD's content engine. Partners are local businesses (gyms, restaurants, salons, etc.) whose info gets woven into content naturally. Redirect link tracking (`/api/go/:slug`), click metrics, public partner dashboard (token-authenticated), content mention tracking. Admin page at `/partners`, public dashboard at `/partner-dashboard/:slug?token=xxx`. Revenue model: free proof tier → performance-based fees ($10-15/client/mo) → premium retainer
- **Intel Dashboard** — admin UI page at `/intel` with tabbed tables (Overview/Crypto/AI-ML/DeFi/DevTools), searchable company lists, stats cards
- **Public Article Generator** — rate-limited public endpoint (`POST /api/content/public/generate`) for users to generate AI-powered articles with Coherence Daddy metadata attribution. Powered by Ollama + intel context, supports all platforms (tweet, blog, linkedin, reddit, etc.)
- **Authenticated dashboard** — company/workspace management, projects, issues, goals, routines
- **Discord Bot** — community moderation and ticketing bot (plugin-discord) for the Next.ai Discord server. Auto-mod (banned words, spam, invite links), escalating warning system (3=mute, 5=kick), support ticketing with private threads and auto-close, 17 mod commands, onboarding role assignment. Dashboard page at `/discord` with bot status, ticket queue, and mod action feed. 8 agent tools for AI-powered community management
- **Moltbook Social Plugin** — AI agent social network integration (`plugin-moltbook`). Safe content posting with 7-layer protection: content filter (blocks credentials/IPs/secrets), rate limiter (0.5x safety multiplier + panic mode), daily budgets (4 posts/20 comments/50 votes), approval queue (manual review by default), domain lockdown (www.moltbook.com only), audit logging, verification challenge solver. 11 agent tools, 3 scheduled jobs. Agent profile at `agents/moltbook/AGENTS.md`
- **Plugin system** — adapter packages for AI providers, plus Paperclip plugin SDK with Firecrawl, Twitter/X, Discord, and Moltbook plugins
- **API layer** — backend at port 3100, proxied from UI dev server
- **System Health dashboard** — eval results, alerting, log aggregation, ladder pipeline status
- **TX Ecosystem page** — tokns.fi validator promotion, ecosystem cross-links
- **Structure page** — Mermaid-powered architecture diagram of all backend services, routes, and crons with color-coded subgraphs, zoom/fullscreen controls, and revision history. Stored via documents table (no migration needed)

## What Does NOT Live Here

The 523+ public free tools live in **the coherencedaddy repo** (migrated April 2026). Do not add public marketing tools here. This repo is for authenticated admin functionality only. The public blockchain directory page lives in the coherencedaddy repo at `/directory`, powered by this repo's Intel API.

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
      seo-engine.ts                 # Blog generation from trends with intel vector context + publish
      content-embedder.ts           # Embeds published content back into intel with BGE-M3
      intel-quality.ts              # Quality scoring, dedup, DB-persisted feedback penalties
      trend-crons.ts                # Trend scanning cron scheduler (6hr cycle)
      auto-reply.ts                 # X auto-reply engine (search-based polling, settings, configurable cron)
      partner-content.ts            # Partner content injection (industry matching, prompt context)
      x-api/
        client.ts                   # X API v2 client (searchRecent, getUserTweets, createTweet)
        rate-limiter.ts             # Dollar-based daily budget tracker ($0.005/read, $0.01/write) + panic mode
        oauth.ts                    # X OAuth 2.0 PKCE token management
        types.ts                    # X API type definitions (SearchResponse, TweetData, etc.)
      platform-publishers/          # Automated social media publishing
        types.ts                    # PlatformPublisher interface
        youtube.ts                  # YouTube Shorts (Data API v3)
        tiktok.ts                   # TikTok (Content Posting API)
        twitter-video.ts            # Twitter/X video (stub — needs OAuth 1.0a)
        instagram.ts                # Instagram Reels (stub — needs public URL)
        index.ts                    # Publisher registry
      youtube/                      # YouTube automation pipeline
        content-strategy.ts         # Ollama-powered content strategy generation
        script-writer.ts            # Ollama script generation for standard videos
        walkthrough-writer.ts       # Ollama walkthrough narration from site-walk results
        site-walker.ts              # Playwright browser agent — visits URLs, captures screenshots
        presentation-renderer.ts    # Playwright slide renderer (branded screenshots)
        tts.ts                      # Grok TTS (xAI API, Rex voice) — chunked per-slide
        yt-video-assembler.ts       # FFmpeg assembly with per-slide durations
        seo-optimizer.ts            # YouTube SEO (tags, chapters, descriptions)
        thumbnail.ts                # Thumbnail generation (Grok/Gemini)
        production.ts               # Production orchestration
        publish-queue.ts            # Auto-upload queue to YouTube
        analytics.ts                # YouTube API analytics + Ollama insights
        slide-templates.ts          # Branded slide layout templates
        yt-crons.ts                 # 5 scheduled jobs (daily-production, publish, analytics, strategy, optimization)
    storage/              # Pluggable storage service (S3, local disk)
    content-templates/  # Personality prompt templates (blaze, cipher, spark, prism, vanguard, forge)
    routes/
      visual-content.ts             # Visual content API (/api/visual/*)
      public-reels.ts               # Public reels API (/api/reels/* — no auth)
      structure.ts                  # Structure diagram API (/api/companies/:id/structure)
      media-drop.ts                 # Media upload/management API (/api/media/*)
      trends.ts                     # Trend signals + SEO engine API (/api/trends/*)
      auto-reply.ts                 # Auto-reply API (/api/auto-reply/*) — settings, config CRUD, log, stats
      partner.ts                    # Partner CRUD + metrics API (/api/partners/*)
      partner-go.ts                 # Public redirect endpoint (/api/go/:slug — no auth)
    data/             # Static seed data (intel companies)
    middleware/       # Auth, validation, board mutation guard, intel rate limiter
    adapters/         # HTTP/process adapter runners
ui/
  src/
    api/              # REST API client (auth, companies, agents, etc.)
    components/
      ui/             # shadcn/ui primitives
      HowToGuide.tsx            # Reusable collapsible help/tutorial component
    context/          # ThemeContext, CompanyContext, DialogContext, etc.
    hooks/            # Custom React hooks
    lib/              # Utilities, router, agent config
    pages/            # Authenticated dashboard pages (incl. Partners.tsx, PartnerDashboard.tsx)
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
  moltbook/           # Social Presence Agent — Moltbook AI social network engagement
.agents/
  skills/             # Company skills (company-creator, doc-maintenance, release, etc.)
    content-writer/   # Content generation and publishing skill
    content-orchestrator/ # Sage's content dispatch and calendar management
packages/
  db/                 # Drizzle schema, migrations, DB clients
    src/schema/
  shared/             # Shared types, constants, validators, API path constants
  adapter-utils/      # Shared adapter utilities
  adapters/           # Agent adapter implementations (Claude, Codex, Cursor, etc.)
  mcp-server/         # MCP server — 35 tools wrapping Team Dashboard REST API
  brand-guide/        # Coherence Daddy brand guidelines (standalone HTML)
  plugins/
    plugin-firecrawl/ # Firecrawl scraping plugin (scrape, crawl, extract, etc.)
    plugin-twitter/   # Twitter/X automation plugin (queue, missions, engagement)
    plugin-discord/   # Discord bot plugin (moderation, ticketing, commands)
    plugin-moltbook/  # Moltbook AI social network plugin (11 tools, 3 jobs, 7-layer safety)
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

**This diagram must be continuously maintained.** Every PR or commit that adds, removes, or restructures services/routes/crons MUST include a corresponding diagram update in the same commit. Use the `changeSummary` field as a changelog entry — include the date and what changed (e.g., `"2026-04-10: removed Social Pulse Engine, added Partner Network subgraph, fixed cron counts"`). The fallback `DEFAULT_DIAGRAM` in `ui/src/pages/Structure.tsx` should also be kept in sync so new installs render an accurate diagram.

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
Vercel (public sites)          VPS 31.220.61.12 (backend + admin)    Neon (database)
coherencedaddy.com             nginx (api.coherencedaddy.com)  ----> PostgreSQL
freetools.coherencedaddy.com   └─ Express :3100 (SERVE_UI=true)
directory.coherencedaddy.com      API + admin dashboard
token.coherencedaddy.com
```

- **Frontend (public)**: Vercel — auto-deploys coherencedaddy.com + all subdomains on push to main
- **Admin Dashboard**: VPS Docker (SERVE_UI=true) — team-dashboard admin UI served from Express alongside API
- **Backend**: VPS Docker behind Caddy at `api.coherencedaddy.com` — Express.js API, agent runtime, WebSocket
- **Database**: Neon PostgreSQL — managed by Vercel integration
- **Firecrawl**: Self-hosted at `168.231.127.180` — scraping, crawling, data extraction
- **Embeddings**: `147.79.78.251:8000` — BGE-M3 vector embedding service (VPS_3)
- **Directory API**: `168.231.127.180:4000` — data sync from Firecrawl
- **Ollama**: `https://ollama.com/api` (cloud) — Gemma 4 31B Cloud for content generation and summarization
- **Content API Key**: `CONTENT_API_KEY` env var for content generation auth (text + visual)
- **Visual Backends**: `GEMINI_API_KEY` (Imagen 3 + Veo 2), `GROK_API_KEY` (xAI images via grok-2-image + video via grok-imagine-video + TTS via Rex voice) — optional, auto-enabled when set
- **Company ID**: `TEAM_DASHBOARD_COMPANY_ID=8365d8c2-ea73-4c04-af78-a7db3ee7ecd4` (Coherence Daddy)
- **GitHub**: ShieldnestORG/team-dashboard (make private after deploy; use PAT for VPS access)
- **Site Metrics**: coherencedaddy.com pushes daily analytics via `/api/companies/:id/site-metrics/ingest`
- **DB Backups**: enabled (`PAPERCLIP_DB_BACKUP_ENABLED=true`)
- **SMTP Alerting**: env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`
- **Cron Schedulers**: intel (8 jobs: 5 ingest + 1 backfill + 1 discover + 1 chain-metrics), eval (1 job), alert (4 jobs: health-check + digest + partner-metrics + partner-site-monitor), content (24 jobs: 1 SEO engine + 1 retweet-cycle + 1 partner-sites + 7 text + 3 video script + 2 intel-alert + 1 tx-chain-daily + 4 XRP/vanguard + 3 AEO-comparison/forge + 2 slideshow-blog), trends (1 job: scan every 6hr), maintenance (2 jobs: stale-content + health-check), ssl-monitor (1 job: cert expiry check every 6hr + email alert if &lt;14 days), auto-reply (1 job: single `search/recent` query covering all targets, configurable interval via settings API, default 30 min), moltbook-backend (5 jobs: ingest + post + engage + heartbeat + performance), youtube (5 jobs: daily-production + publish-queue + daily-analytics + weekly-strategy + optimization, Grok TTS + Playwright + FFmpeg), discord (2 plugin jobs: ticket-cleanup + daily-stats), twitter (4 plugin jobs: post-dispatcher 2m + engagement-cycle 30m + queue-cleanup 6h + analytics-rollup daily), moltbook-plugin (3 plugin jobs: content-dispatcher 5m + heartbeat 30m + daily-cleanup midnight). All 51 cron + 9 plugin jobs have `ownerAgent` metadata — see `docs/guides/agent-cron-ownership.md`
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
| `server/src/services/seo-engine.ts` | Trend-based blog generation with intel vector context + publish + IndexNow |
| `server/src/services/content-embedder.ts` | Embeds published content back into intel_reports with BGE-M3 |
| `server/src/services/intel-quality.ts` | Quality scoring, dedup, feedback penalties (DB-persisted), context filtering |
| `packages/db/src/schema/content_quality_signals.ts` | Persistent feedback penalty table (survives restarts) |
| `packages/db/src/migrations/0062_content_feedback_loop.sql` | Migration: content_quality_signals table + performance tracking columns |
| `server/src/routes/trends.ts` | Trend signals + SEO engine API (`/api/trends/*`) |
| `server/src/services/visual-backends/` | Pluggable visual generation backends (Gemini, Grok, Canva) |
| `server/src/services/video-assembler.ts` | FFmpeg video pipeline (overlays, watermark, metadata) |
| `server/src/services/platform-publishers/` | Auto-publishing to YouTube/TikTok/Instagram/Twitter |
| `server/src/services/youtube/` | YouTube automation pipeline (strategy, scripts, TTS, rendering, publishing) |
| `server/src/services/youtube/site-walker.ts` | Playwright browser agent — visits URLs, scrolls, captures branded screenshots |
| `server/src/services/youtube/walkthrough-writer.ts` | Ollama walkthrough narration from site-walk results with TTS sanitization |
| `server/src/services/youtube/tts.ts` | Grok TTS (xAI API, Rex voice) — chunked per-slide with silence gaps |
| `server/src/services/youtube/presentation-renderer.ts` | Playwright slide renderer with branded screenshot overlays |
| `server/src/services/youtube/slide-templates.ts` | Brand color templates (coherencedaddy coral/cyan, tx lime/purple) |
| `server/src/services/youtube/yt-crons.ts` | 5 YouTube cron jobs (production, publish, analytics, strategy, optimization) |
| `server/src/services/blog-slideshow-generator.ts` | Slideshow blog generator — reuses presentation renderer for interactive HTML blog posts |
| `server/src/routes/public-reels.ts` | Public reels API (no auth) for coherencedaddy.com |
| `scripts/canva-generator.py` | Canva visual backend Python bridge (legacy) |
| `server/src/services/canva-connect.ts` | Canva Connect API client (OAuth + design export) |
| `server/src/routes/canva-oauth.ts` | Canva OAuth + design listing routes (`/api/canva/oauth/*`) |
| `server/src/services/canva-media-cron.ts` | Canva design-to-tweet service (not yet activated) |
| `server/src/services/x-api/retweet-service.ts` | Smart retweet service — single-query polling + intel save |
| `server/src/services/intel-discovery.ts` | Auto-discovery of trending projects (CoinGecko + GitHub) |
| `server/src/services/mintscan.ts` | Cosmostation Mintscan API integration (chain APR, validator metrics) |
| `server/src/services/auto-reply.ts` | Auto-reply engine — search-based polling, settings management, configurable cron interval |
| `server/src/services/x-api/client.ts` | X API v2 client — `searchRecent()`, `getUserTweets()`, `createTweet()` |
| `server/src/services/x-api/rate-limiter.ts` | X API rate limiter — dollar-based daily budget ($0.005/read, $0.01/write), panic mode on 429 |
| `server/src/routes/auto-reply.ts` | Auto-reply REST API — settings GET/PUT, config CRUD, toggle, log, stats |
| `packages/db/src/schema/auto_reply.ts` | `autoReplyConfig`, `autoReplyLog`, `autoReplySettings` table schemas |
| `packages/db/src/migrations/0054_auto_reply_settings.sql` | Migration: `auto_reply_settings` table (per-company global settings jsonb) |
| `ui/src/pages/AutoReply.tsx` | Auto-reply admin UI — settings panel, config cards with inline edit, stats |
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
| `server/src/routes/media-drop.ts` | Media upload/management API (`/api/media/*`) |
| `packages/plugins/plugin-twitter/src/manifest.ts` | Twitter/X plugin manifest (13 tools, 4 jobs) |
| `packages/plugins/plugin-moltbook/src/manifest.ts` | Moltbook plugin manifest (11 tools, 3 jobs) |
| `packages/plugins/plugin-moltbook/src/worker.ts` | Moltbook plugin worker (safety filter, approval queue, dispatcher) |
| `packages/plugins/plugin-moltbook/src/moltbook-client.ts` | Moltbook HTTP client (domain lockdown, audit, rate limit headers) |
| `packages/plugins/plugin-moltbook/src/rate-limiter.ts` | Moltbook rate limiter (safety multiplier, daily budgets, panic mode) |
| `agents/moltbook/AGENTS.md` | Moltbook Social Presence Agent profile (reports to Sage/CMO) |
| `packages/plugins/plugin-twitter/src/worker.ts` | Twitter/X plugin worker (queue, engagement, analytics) |
| `packages/mcp-server/src/index.ts` | MCP server entry point — registers 35 tools, stdio transport |
| `packages/mcp-server/src/client.ts` | HTTP client wrapping Team Dashboard REST API for MCP |
| `server/src/services/x-api/rate-limiter.ts` | X API rate limiter — $5/day budget, panic mode on 429 |
| `packages/db/src/schema/partners.ts` | `partnerCompanies` + `partnerClicks` table schemas |
| `packages/db/src/migrations/0057_partner_network.sql` | Migration: partner network tables |
| `server/src/services/partner-content.ts` | Partner context injection for content generation prompts |
| `server/src/routes/partner.ts` | Partner CRUD + metrics API (`/api/partners/*`) |
| `server/src/routes/partner-go.ts` | Public redirect endpoint (`/api/go/:slug` — no auth) |
| `ui/src/pages/Partners.tsx` | Partner admin page — CRUD, metrics, dashboard links |
| `ui/src/pages/PartnerDashboard.tsx` | Public partner metrics dashboard (token-auth, light theme) |

### Updating

```bash
# Backend: SSH into VPS, pull latest code, rebuild
ssh root@31.220.61.12
cd /opt/team-dashboard/repo && git pull
cd /opt/team-dashboard && docker compose build && docker compose up -d

# REQUIRED: Clean up stale Docker artifacts after every deploy
docker image prune -f && docker container prune -f && docker volume prune -f && docker builder prune -f
```

**Docker cleanup is mandatory.** The VPS has limited disk (31GB RAM but finite storage). Every `docker compose build` leaves behind old images, stopped containers, and build cache. Agents that SSH to the VPS for deploys MUST run the prune commands above after every rebuild. Failing to clean up will eventually fill the disk and crash the backend. If disk usage is above 80%, also run `docker system prune -a -f` to remove all unused images (not just dangling ones).

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
| `OLLAMA_URL` | Yes | VPS | Ollama API endpoint (default: `https://ollama.com/api`) |
| `OLLAMA_MODEL` | Optional | VPS | Ollama model (default: gemma4:31b-cloud) |
| `OLLAMA_API_KEY` | Yes | VPS | Ollama Cloud API bearer token |
| **Visual Content** | | | |
| `CONTENT_API_KEY` | Yes | VPS | Auth for content, visual content, and trend endpoints |
| `CD_BLOG_API_URL` | Optional | VPS | Blog publish endpoint (default: `https://coherencedaddy.com/api/blog/posts`) |
| `CD_BLOG_API_KEY` | Yes | VPS | Bearer token for coherencedaddy blog API |
| `INDEXNOW_KEY` | Optional | VPS | IndexNow verification key for search engine ping |
| `GEMINI_API_KEY` | Optional | VPS | Enables Gemini visual backend (Imagen 3 + Veo 2) |
| `GROK_API_KEY` | Optional | VPS | Enables Grok/xAI backend (grok-2-image + grok-imagine-video + TTS) |
| `GROK_TTS_VOICE` | Optional | VPS | Voice for Grok TTS (default: `rex`) |
| `CANVA_API_KEY` | Optional | VPS | Enables Canva template backend (Python bridge) |
| `CANVA_CLIENT_ID` | Optional | VPS | Canva Connect API client ID (OAuth 2.0) |
| `CANVA_CLIENT_SECRET` | Optional | VPS | Canva Connect API client secret |
| `CANVA_CALLBACK_URL` | Optional | VPS | Canva OAuth callback URL |
| `CANVA_MEDIA_FOLDER_ID` | Optional | VPS | Canva folder to pull designs from for media tweets |
| **Platform Publishing** | | | |
| `YOUTUBE_CLIENT_ID/SECRET` | Optional | VPS | YouTube Shorts auto-publishing |
| `YOUTUBE_REFRESH_TOKEN` | Optional | VPS | YouTube OAuth refresh token |
| `TIKTOK_ACCESS_TOKEN` | Optional | VPS | TikTok Content Posting API |
| `TWITTER_API_KEY/SECRET` | Optional | VPS | Twitter/X video posting |
| `TWITTER_ACCESS_TOKEN/SECRET` | Optional | VPS | Twitter/X OAuth tokens |
| `INSTAGRAM_ACCESS_TOKEN` | Optional | VPS | Instagram Graph API |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Optional | VPS | Instagram business account |
| **Moltbook** | | | |
| `MOLTBOOK_API_KEY` | Optional | VPS | Moltbook API key (registered via plugin tool, stored as secret ref) |
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
| `COIN_GECKO_API_KEY` | Optional | VPS | CoinGecko Demo API key (30 req/min, 10k/month) |
| `MINTSCAN_API_KEY` | Optional | VPS | Cosmostation Mintscan API for Cosmos chain metrics (APR, validators) |
| `GITHUB_TOKEN` | Yes | VPS | GitHub API access for intel + deployment |
| `EMBED_URL` | Yes | VPS | Embedding service (`http://147.79.78.251:8000`) |
| `EMBED_API_KEY` | Yes | VPS | Embedding service auth |
| `FIRECRAWL_EMBEDDING_API_KEY` | Yes | VPS | Firecrawl scraping API auth |
| `BING_NEWS_KEY` | Optional | VPS | Bing News Search API v7 key for trend scanning |
| **Payments** | | | |
| `STRIPE_SECRET_KEY` | Optional | VPS | Stripe API secret key for donations |
| `STRIPE_WEBHOOK_SECRET` | Optional | VPS | Stripe webhook signature verification |
| **Monitoring** | | | |
| `SITE_METRICS_KEY` | Yes | VPS + coherencedaddy | Site analytics ingestion auth |
| `SMTP_HOST/PORT/USER/PASS` | Optional | VPS | Email alerting (Proton Mail) |
| `ALERT_EMAIL_TO/FROM` | Optional | VPS | Alert email recipients |

**Vercel** gets `DATABASE_URL` automatically via Neon integration. No other env vars needed there — it only serves the static UI.

**VPS** needs all the above in `.env.production` at `/opt/team-dashboard/`.

### WebSocket & API Domain

The VPS backend is fronted by **Caddy** at `api.coherencedaddy.com` (auto-HTTPS via Let's Encrypt). The production frontend connects directly to `https://api.coherencedaddy.com/api` for HTTP and `wss://api.coherencedaddy.com` for WebSocket — bypassing Vercel rewrites entirely. This enables real-time push notifications (agent status, issue updates, live events) via WebSocket.

- **Caddy config:** `Caddyfile` in repo root, mounted into Docker
- **CORS:** `server/src/app.ts` allows `*.vercel.app`, `coherencedaddy.com`, and `localhost` origins with credentials
- **Fallback:** `vercel.json` still has `/api/*` rewrites to the VPS IP as a fallback

---

## Ladder: auto

This project is tracked by **ladder2.0** (MCP server at `~/.ladder/ladder.db`, project name: `team-dashboard`).

After every build, deploy, or code change, track the outcome via `mcp__ladder__track_event` with project `team-dashboard`.
When 10+ new events accumulate, run `mcp__ladder__generate_sources` with project `team-dashboard` and `persist=true`.
When new sources are created, run `mcp__ladder__generate_ideas` with project `team-dashboard` and `persist=true`.
At the end of each session, show `mcp__ladder__pipeline_status` for project `team-dashboard`.

---

## Structure Diagram Maintenance — CRITICAL

The company structure Mermaid diagram (`/structure` page) is a **living document** that must stay in sync with the codebase at all times. It is the single source of truth for how all backend services, routes, crons, plugins, and infrastructure connect.

### Rules

1. **Every structural change = diagram update.** Any commit that adds, removes, or restructures services, routes, cron jobs, plugins, visual backends, or infrastructure MUST include a corresponding update to the structure diagram in the same commit.
2. **Use the changelog.** When updating via the API (`PUT /api/companies/:companyId/structure`), always include a dated `changeSummary` (e.g., `"2026-04-10: added Partner Network, removed Pulse Engine, updated cron counts"`).
3. **Keep the fallback in sync.** The `DEFAULT_DIAGRAM` constant in `ui/src/pages/Structure.tsx` must match reality so new installs render an accurate diagram.
4. **Audit periodically.** If you notice the diagram is stale or missing features during any session, fix it immediately — don't defer.

### VPS Docker Cleanup — MANDATORY

When agents SSH to the VPS (`31.220.61.12`) for deploys or maintenance, they **MUST** clean up stale Docker artifacts:

```bash
# Run after every docker compose build / up
docker image prune -f
docker container prune -f
docker volume prune -f
docker builder prune -f

# If disk usage > 80%, escalate:
docker system prune -a -f
```

Old images, stopped containers, and build cache accumulate with every deploy. The VPS has finite disk — failing to prune will eventually fill it and crash the backend. This is not optional.
