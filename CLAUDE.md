# CLAUDE.md — Team Dashboard

## What This Project Is

The internal admin control plane for the Coherence Daddy / 508(c)(1)(A) ecosystem. Manages AI agents, data scraping pipelines, directory API, and operational dashboards. **Not public-facing** — requires authentication.

The public-facing tools and brand site live in a separate repo: [ShieldnestORG/coherencedaddy](https://github.com/ShieldnestORG/coherencedaddy).

## Ecosystem

- **Team Dashboard** (this repo) — internal admin, agent management, data pipelines
- **Coherence Daddy** (coherencedaddy.com) — public brand landing page
- **Free Tools** (freetools.coherencedaddy.com) — 27 public tools (lives in coherencedaddy repo)
- **tokns.fi / app.tokns.fi** — crypto platform and dashboard
- **TX Blockchain** (tx.org) — Cosmos SDK chain, ShieldNest runs a validator
- **ShieldNest** (shieldnest.io) — privacy-first dev company
- **YourArchi** (yourarchi.com) — architecture platform

## What Lives Here

- **Agent management** — 9 AI agents (Atlas/CEO, Nova/CTO, Sage/CMO, River/PM, Pixel/Designer, Echo/Data Engineer, Core/Backend, Bridge/Full-Stack, Flux/Frontend)
- **Data pipelines** — Firecrawl scraping, Qdrant vector indexing, Directory API sync, eval smoke tests (daily), SMTP email alerting, log aggregation
- **Blockchain Intel Engine** — price/news/twitter/github/reddit ingestion with BGE-M3 vector embeddings, public API at `/api/intel/*`, cron-scheduled ingestion
- **Authenticated dashboard** — company/workspace management, projects, issues, goals, routines
- **Plugin system** — adapter packages for AI providers
- **API layer** — backend at port 3100, proxied from UI dev server
- **System Health dashboard** — eval results, alerting, log aggregation, ladder pipeline status
- **TX Ecosystem page** — tokns.fi validator promotion, ecosystem cross-links

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
.agents/
  skills/             # Company skills (company-creator, doc-maintenance, release, etc.)
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
- **Ollama**: `168.231.127.180:11434` — local summarization (qwen2.5:1.5b)
- **GitHub**: ShieldnestORG/team-dashboard (make private after deploy; use PAT for VPS access)
- **Site Metrics**: coherencedaddy.com pushes daily analytics via `/api/companies/:id/site-metrics/ingest`
- **DB Backups**: enabled (`PAPERCLIP_DB_BACKUP_ENABLED=true`)
- **SMTP Alerting**: env vars `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ALERT_EMAIL_TO`, `ALERT_EMAIL_FROM`
- **Cron Schedulers**: intel (5 jobs), eval (1 job), alert (2 jobs)

### Key Files

| File | Purpose |
|------|---------|
| `vercel.json` | Vercel build config + `/api/*` rewrite to VPS |
| `docker-compose.production.yml` | VPS backend Docker Compose (template) |
| `.env.production` | VPS secrets (never committed, on VPS at `/opt/team-dashboard/`) |

### Updating

```bash
# Backend: SSH into VPS, pull latest code, rebuild
ssh root@31.220.61.12
cd /opt/team-dashboard/repo && git pull
cd /opt/team-dashboard && docker compose build && docker compose up -d

# Frontend: auto-deploys on push to master
git push origin master
```

### WebSocket Limitation

Vercel rewrites don't support WebSocket upgrade. Live push notifications (agent status, issue updates) are degraded. React Query polling still works. Fix later by adding a domain to the VPS with Caddy for HTTPS + WS support.

---

## Ladder: auto

This project is tracked by **ladder2.0** (MCP server at `~/.ladder/ladder.db`, project name: `team-dashboard`).

After every build, deploy, or code change, track the outcome via `mcp__ladder__track_event` with project `team-dashboard`.
When 10+ new events accumulate, run `mcp__ladder__generate_sources` with project `team-dashboard` and `persist=true`.
When new sources are created, run `mcp__ladder__generate_ideas` with project `team-dashboard` and `persist=true`.
At the end of each session, show `mcp__ladder__pipeline_status` for project `team-dashboard`.
