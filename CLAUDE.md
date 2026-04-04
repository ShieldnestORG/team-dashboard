# CLAUDE.md — Team Dashboard

## What This Project Is

The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing tools and brand site live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

## Ecosystem

- **Team Dashboard** (this repo) — internal admin, agent management, data pipelines
- **Coherence Daddy** (coherencedaddy.com) — public brand landing page
- **Free Tools** (freetools.coherencedaddy.com) — 523+ public tools, subdomain routed (lives in coherencedaddy repo)
- **Blockchain Directory** (coherencedaddy.com/directory) — public directory of 114+ blockchain projects powered by Intel API (lives in coherencedaddy repo)
- **tokns.fi / app.tokns.fi** — crypto platform and dashboard (NFTs, swaps, staking, wallet tracking)
- **TX Blockchain** (tx.org) — Cosmos SDK chain, ShieldNest runs a validator; goal: #1 validator via tokns.fi
- **ShieldNest** (shieldnest.io) — privacy-first dev company
- **YourArchi** (yourarchi.com) — architecture platform

## Primary Company

**Coherence Daddy** — ID: `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`, prefix: `CD`

This is the main company in the dashboard. All agents, content, and data belong to this company. The env var `TEAM_DASHBOARD_COMPANY_ID` must point to this ID.

## What Lives Here

- **Agent management** — 9 AI agents under Coherence Daddy (Atlas/CEO, Nova/CTO, Sage/CMO, River/PM, Pixel/Designer, Echo/Data Engineer, Core/Backend, Bridge/Full-Stack, Flux/Frontend) + 4 content personality agents (Blaze/Cipher/Spark/Prism) + Mermaid (Company Structure Agent)
- **Data pipelines** — Firecrawl scraping, Qdrant vector indexing, Directory API sync, eval smoke tests (daily), SMTP email alerting, log aggregation
- **Content engine** — Ollama-powered text content generation with 4 personality agents, content queue, blog publishing API, multi-platform distribution
- **SEO engine** — trend scanner (CoinGecko + HackerNews every 6hr), Claude-powered blog post generation, auto-publish to coherencedaddy.com blog API, IndexNow ping. Routes at `/api/trends/*`, daily cron at 7:03 AM (`content:seo-engine`)
- **Visual content system** — AI image/video generation via Gemini (Imagen 3 + Veo 2), Grok/xAI (grok-2-image + grok-imagine-video), and Canva (Python bridge). FFmpeg video assembly with watermark + metadata embedding. Async job system, visual content queue with review workflow, Content Studio UI with Text/Visual mode toggle
- **Public Reels API** — unauthenticated `/api/reels` endpoint serving approved visual content for coherencedaddy.com. Stream, download (with Content-Disposition), and thumbnail endpoints
- **Platform publishing** — YouTube Shorts, TikTok, Instagram Reels, Twitter/X video publishers (env-var gated, auto-enabled when platform API keys are set)
- **Directory expansion** — AI/ML (152 entries), DeFi (114), DevTools (155) niche directories beyond the original 114 blockchain companies
- **Blockchain Intel Engine** — price/news/twitter/github/reddit ingestion with BGE-M3 vector embeddings, public API at `/api/intel/*`, cron-scheduled ingestion
- **Authenticated dashboard** — company/workspace management, projects, issues, goals, routines
- **Plugin system** — adapter packages for AI providers
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
      platform-publishers/          # Automated social media publishing
        types.ts                    # PlatformPublisher interface
        youtube.ts                  # YouTube Shorts (Data API v3)
        tiktok.ts                   # TikTok (Content Posting API)
        twitter-video.ts            # Twitter/X video (stub — needs OAuth 1.0a)
        instagram.ts                # Instagram Reels (stub — needs public URL)
        index.ts                    # Publisher registry
    content-templates/  # Personality prompt templates (blaze, cipher, spark, prism)
    routes/
      visual-content.ts             # Visual content API (/api/visual/*)
      public-reels.ts               # Public reels API (/api/reels/* — no auth)
      structure.ts                  # Structure diagram API (/api/companies/:id/structure)
    data/             # Static seed data (intel companies)
    middleware/       # Auth, validation, board mutation guard
    adapters/         # HTTP/process adapter runners
ui/
  src/
    api/              # REST API client (auth, companies, agents, etc.)
    components/
      ui/             # shadcn/ui primitives
    context/          # ThemeContext, CompanyContext, DialogContext, etc.
    hooks/            # Custom React hooks
    lib/              # Utilities, router, agent config
    pages/            # Authenticated dashboard pages
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
  shared/             # Shared types, constants, validators, API path constants
  adapter-utils/      # Shared adapter utilities
  adapters/           # Agent adapter implementations (Claude, Codex, Cursor, etc.)
  brand-guide/        # Coherence Daddy brand guidelines (standalone HTML)
  plugins/
    plugin-firecrawl/ # Firecrawl scraping plugin (scrape, crawl, extract, etc.)
    sdk/              # Plugin SDK for building plugins
cli/                  # CLI tool (paperclipai command)
docs/
  api/                # REST API endpoint documentation
  deploy/             # Deployment guides (Vercel+VPS, Docker, Tailscale, etc.)
  guides/             # Operator and agent developer guides
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
- **Cron Schedulers**: intel (5 jobs), eval (1 job), alert (2 jobs), content (10 jobs: 6 text + 3 video script + 1 SEO engine), trends (1 job: scan every 6hr)

### Key Files

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel build config + `/api/*` rewrite to VPS |
| `docker-compose.production.yml` | VPS backend Docker Compose (template) |
| `.env.production` | VPS secrets (never committed, on VPS at `/opt/team-dashboard/`) |
| `server/src/routes/content.ts` | Text content generation + queue API |
| `server/src/routes/visual-content.ts` | Visual content generation + queue + asset serving API |
| `server/src/content-templates/*.ts` | Personality prompt templates (text + video_script) |
| `server/src/services/trend-scanner.ts` | CoinGecko + HackerNews trend scanner |
| `server/src/services/seo-engine.ts` | Claude-powered blog generation + publish + IndexNow |
| `server/src/routes/trends.ts` | Trend signals + SEO engine API (`/api/trends/*`) |
| `server/src/services/visual-backends/` | Pluggable visual generation backends (Gemini, Grok, Canva) |
| `server/src/services/video-assembler.ts` | FFmpeg video pipeline (overlays, watermark, metadata) |
| `server/src/services/platform-publishers/` | Auto-publishing to YouTube/TikTok/Instagram/Twitter |
| `server/src/routes/public-reels.ts` | Public reels API (no auth) for coherencedaddy.com |
| `scripts/canva-generator.py` | Canva Connect API Python bridge |
| `server/src/services/structure.ts` | Company structure diagram service (Mermaid, versioned) |
| `server/src/routes/structure.ts` | Structure diagram API (`/api/companies/:id/structure`) |
| `ui/src/pages/Structure.tsx` | Architecture diagram page with zoom, fullscreen, revisions |

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
| **Intel Engine** | | | |
| `INTEL_INGEST_KEY` | Yes | VPS | Auth for intel data ingestion |
| `GITHUB_TOKEN` | Yes | VPS | GitHub API access for intel + deployment |
| `EMBED_URL` | Yes | VPS | Embedding service (`http://31.220.61.12:8000`) |
| `EMBED_API_KEY` | Yes | VPS | Embedding service auth |
| `FIRECRAWL_EMBEDDING_API_KEY` | Yes | VPS | Firecrawl scraping API auth |
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
