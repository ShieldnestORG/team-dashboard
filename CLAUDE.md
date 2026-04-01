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

- **Agent management** — 9 AI agents (Atlas/CEO, Nova/CTO, Sage/CMO, River/PM, Pixel/Designer, Echo/Marketing, Core/Backend, Bridge/Full-Stack, Flux/Frontend)
- **Data pipelines** — Firecrawl scraping, Qdrant vector indexing, Directory API sync
- **Authenticated dashboard** — company/workspace management, projects, issues, goals, routines
- **Plugin system** — adapter packages for AI providers
- **API layer** — backend at port 3100, proxied from UI dev server

## What Does NOT Live Here

The 27 public free tools were **migrated to the coherencedaddy repo** (April 2026). Do not add public marketing tools here. This repo is for authenticated admin functionality only.

## Tech Stack

- React 19, Vite, Tailwind CSS v4, shadcn/ui components
- Icons: lucide-react
- State: React useState/useEffect, @tanstack/react-query
- API: REST client at `ui/src/api/`
- Backend: Express.js at port 3100
- Adapters: `packages/` directory for AI provider integrations

## Project Structure

```
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
packages/
  brand-guide/        # Coherence Daddy brand guidelines (standalone HTML)
  plugins/
    plugin-firecrawl/ # Firecrawl scraping plugin (scrape, crawl, extract, etc.)
    ...               # Other plugins and adapters
docs/
  start/              # Getting started, architecture, core concepts
  deploy/             # Deployment guides (Docker, Tailscale, etc.)
  guides/             # Operator and developer guides
  adapters/           # Adapter documentation
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

## Deployment

- **Vercel project**: "team dashboard"
- **GitHub**: ShieldnestORG/team-dashboard
- **Access**: Authenticated users only

---

## Ladder: auto

This project is tracked by **ladder2.0** (MCP server at `~/.ladder/ladder.db`, project name: `team-dashboard`).

After every build, deploy, or code change, track the outcome via `mcp__ladder__track_event` with project `team-dashboard`.
When 10+ new events accumulate, run `mcp__ladder__generate_sources` with project `team-dashboard` and `persist=true`.
When new sources are created, run `mcp__ladder__generate_ideas` with project `team-dashboard` and `persist=true`.
At the end of each session, show `mcp__ladder__pipeline_status` for project `team-dashboard`.
