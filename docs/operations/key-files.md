# Key Files Reference — Team Dashboard

This document provides a mapping of critical files to their purpose within the system.

## API & Routes
- `server/src/routes/content.ts`: Text content generation and queue API.
- `server/src/routes/visual-content.ts`: Visual content generation, queue, and asset serving API.
- `server/src/routes/trends.ts`: Trend signals and SEO engine API (`/api/trends/*`).
- `server/src/routes/auto-reply.ts`: Auto-reply REST API (settings, config, logs, stats).
- `server/src/routes/public-reels.ts`: Public reels API (no auth) for coherencedaddy.com.
- `server/src/routes/partner.ts`: Partner CRUD and metrics API.
- `server/src/routes/partner-go.ts`: Public redirect endpoint (`/api/go/:slug` — no auth).
- `server/src/routes/knowledge-graph.ts`: Knowledge graph API.
- `server/src/routes/agent-memory.ts`: Agent memory API.
- `server/src/routes/structure.ts`: Structure diagram API (`/api/companies/:id/structure`).
- `server/src/routes/intel-billing.ts`: Intel paid tier API.

## Core Services
- `server/src/services/trend-scanner.ts`: CoinGecko, HackerNews, Google Trends, Bing News trend scanner.
- `server/src/services/seo-engine.ts`: Trend-based blog generation with intel vector context and publish.
- `server/src/services/content-embedder.ts`: Embeds published content back into intel reports with BGE-M3.
- `server/src/services/intel-quality.ts`: Quality scoring, dedup, and feedback penalties.
- `server/src/services/auto-reply.ts`: X auto-reply engine.
- `server/src/services/structure.ts`: Company structure diagram service.
- `server/src/services/relationship-extractor.ts`: Ollama triple extraction for the Knowledge Graph.
- `server/src/services/graph-query.ts`: Recursive CTE traversal and hybrid vector search.
- `server/src/services/agent-memory.ts`: Structured fact storage per agent.
- `server/src/services/intel-billing.ts`: Intel paid tier management and Stripe integration.

## Visual & Video Pipeline
- `server/src/services/visual-backends/`: Pluggable visual generation backends (Gemini, Grok, Canva).
- `server/src/services/video-assembler.ts`: FFmpeg video pipeline (overlays, watermark, metadata).
- `server/src/services/youtube/`: Full YouTube automation pipeline (strategy, scripts, TTS, rendering, publishing).
- `server/src/services/youtube/site-walker.ts`: Playwright browser agent for branded screenshots.
- `server/src/services/youtube/presentation-renderer.ts`: Playwright slide renderer.
- `server/src/services/youtube/tts.ts`: Grok TTS (xAI API, Rex voice).

## Database & Schema
- `packages/db/src/schema/content_quality_signals.ts`: Persistent feedback penalty table.
- `packages/db/src/schema/auto_reply.ts`: Auto-reply configuration and logs.
- `packages/db/src/schema/partners.ts`: Partner network tables.
- `packages/db/src/schema/knowledge_tags.ts`: Knowledge tags schema.
- `packages/db/src/schema/company_relationships.ts`: Company relationships schema.
- `packages/db/src/schema/agent_memory.ts`: Agent memory schema.
- `packages/db/src/schema/intel_billing.ts`: Intel billing and usage metering.

## Infrastructure & Config
- `vercel.json`: Vercel build config and `/api/*` rewrites.
- `docker-compose.production.yml`: VPS backend Docker Compose template.
- `.env.production`: VPS secrets (located at `/opt/team-dashboard/`).

## Plugins
- `packages/plugins/plugin-discord/src/worker.ts`: Discord bot worker.
- `packages/plugins/plugin-twitter/src/worker.ts`: Twitter/X plugin worker.
- `packages/plugins/plugin-moltbook/src/worker.ts`: Moltbook plugin worker.
