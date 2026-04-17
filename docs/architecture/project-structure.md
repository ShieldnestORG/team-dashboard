# Project Structure — Team Dashboard

## Directory Map

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
      relationship-extractor.ts     # Ollama-powered triple extraction from intel reports (Nexus agent)
      graph-query.ts                # Recursive CTE traversal + hybrid vector search (Oracle agent)
      agent-memory.ts               # Structured fact storage per agent with semantic recall (Recall agent)
      knowledge-graph-crons.ts      # 9 cron jobs across 4 knowledge graph agents
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
      knowledge-graph.ts            # Knowledge graph API (/api/knowledge-graph/*) — search, traverse, CRUD, visualization
      agent-memory.ts               # Agent memory API (/api/agent-memory/*) — CRUD, semantic search, stats
      affiliates.ts                 # Affiliate system API (/api/affiliates/* + /api/affiliates/admin/*) — register, login, JWT auth, prospects, password reset, admin approval
    data/             # Static seed data (intel companies)
    middleware/       # Auth, validation, board mutation guard, intel rate limiter
      affiliate-auth.ts             # JWT middleware for affiliate-scoped requests (separate from admin auth)
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
                      # Affiliate-facing pages served at affiliates.coherencedaddy.com (hostname-detected):
                      #   AffiliateLanding.tsx, AffiliateDashboard.tsx, AffiliateProspectDetail.tsx,
                      #   AffiliateResetPassword.tsx, AffiliatesAdmin.tsx (admin only)
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
  nexus/              # Relationship Extractor — Ollama triple extraction from intel reports
  weaver/             # Graph Curator — tag dedup, edge pruning, graph health
  recall/             # Memory Manager — expire, compact, embed agent memories
  oracle/             # Graph Query Agent — multi-hop traversal, hybrid search, cache
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

## Key Files

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
| `server/src/services/cosmos-lcd.ts` | Direct Cosmos LCD chain metrics (APR, validators, blocks) — replaces deprecated Mintscan |
| `server/src/services/defillama.ts` | DefiLlama chain TVL ingestion (free public API, no key) |
| `server/src/services/cosmos-lcd.ts` (validator rank) | `ingestValidatorRanks()` — LCD-fetched top-50 validators → `validator_rank_history` + intel_reports summary |
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
| `packages/db/src/schema/knowledge_tags.ts` | `knowledgeTags` table schema (technologies, protocols, ecosystems) |
| `packages/db/src/schema/company_relationships.ts` | `companyRelationships` table schema (typed directed edges) |
| `packages/db/src/schema/agent_memory.ts` | `agentMemory` table schema (subject-predicate-object triples) |
| `packages/db/src/migrations/0064_knowledge_graph.sql` | Migration: knowledge graph + agent memory tables |
| `server/src/services/relationship-extractor.ts` | Ollama triple extraction from intel reports (Nexus agent) |
| `server/src/services/graph-query.ts` | Recursive CTE traversal + hybrid vector search (Oracle agent) |
| `server/src/services/agent-memory.ts` | Structured fact storage per agent with semantic recall |
| `server/src/services/knowledge-graph-crons.ts` | 9 cron jobs across 4 knowledge graph agents |
| `server/src/routes/knowledge-graph.ts` | Knowledge graph API (`/api/knowledge-graph/*`) |
| `server/src/routes/agent-memory.ts` | Agent memory API (`/api/agent-memory/*`) |
| `ui/src/pages/KnowledgeGraph.tsx` | Knowledge graph admin page — stats, search, relationships, entity detail |
| `server/src/services/intel-billing.ts` | Intel paid tier — Stripe REST client, checkout, webhook handler, overage reporter, welcome email |
| `server/src/routes/intel-billing.ts` | `/api/intel-billing/*` routes (plans, checkout, webhook, customers, me) |
| `server/src/middleware/intel-rate-limit.ts` | Per-API-key + per-plan rate limiter with monthly quota meter |
| `packages/db/src/schema/intel_billing.ts` | `intelPlans`, `intelCustomers`, `intelApiKeys`, `intelUsageMeter` tables |
| `packages/db/src/migrations/0066_intel_billing.sql` | Migration: intel billing tables + seed of 4 tiers |
| `ui/src/pages/IntelPricing.tsx` | Public pricing page at `/intel/pricing` — 4 tier cards, email → Stripe Checkout |
| `ui/src/pages/IntelBilling.tsx` | Admin subscribers list at `/intel-billing` — MRR, customer table |
| `ui/src/pages/IntelBillingSuccess.tsx` | Post-checkout page at `/billing/success` — verify key, show usage |
