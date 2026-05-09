# Key Files Reference — Team Dashboard

This document provides a mapping of critical files to their purpose within the system.

## API & Routes
- `server/src/routes/content.ts`: Text content generation + queue API. Includes `POST /queue/:id/republish/:target` admin endpoint for retrying a single blog publish leg (cd | sn | tokns-app).
- `server/src/routes/visual-content.ts`: Visual content generation, queue, and asset serving API.
- `server/src/routes/trends.ts`: Trend signals and SEO engine API (`/api/trends/*`).
- `server/src/routes/auto-reply.ts`: Auto-reply REST API (settings, config, logs, stats).
- `server/src/routes/public-reels.ts`: Public reels API (no auth) for coherencedaddy.com.
- `server/src/routes/partner.ts`: Partner CRUD, metrics, and admin checkout API. Public self-serve enrollment at `POST /public/enroll` (no auth) creates the partner row + Stripe Checkout session for the `coherencedaddy.com/partners-pricing` funnel.
- `server/src/routes/partner-go.ts`: Public redirect endpoint (`/api/go/:slug` — no auth).
- `server/src/routes/knowledge-graph.ts`: Knowledge graph API.
- `server/src/routes/agent-memory.ts`: Agent memory API.
- `server/src/routes/structure.ts`: Structure diagram API (`/api/companies/:id/structure`).
- `server/src/routes/intel-billing.ts`: Intel paid tier API.

## Core Services
- `server/src/services/trend-scanner.ts`: CoinGecko, HackerNews, Google Trends, Bing News trend scanner.
- `server/src/services/seo-engine.ts`: Trend-based blog generation with intel vector context and publish.
- `server/src/services/blog-publisher.ts`: Cross-repo blog fan-out (cd | sn | tokns-app | all). Exports `publishBlogFromContent`, `publishToTargets`, `republishTarget`, `liveUrlFor`. Persists per-target results to `content_items.publish_results`.
- `server/src/services/content-crons.ts`: Scheduled content generation jobs. Blog-type jobs (`content:blog`, `content:xrp:blog`, `content:tx-chain-daily`, etc.) call `publishBlogFromContent` and store slug + publish_results on the content item.
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
- `packages/db/src/schema/content_items.ts`: Content items table — `slug` + `publish_results` JSONB for per-target blog publish tracking.
- `packages/db/src/migrations/0092_content_items_publish_results.sql`: Migration adding `slug`, `publish_results`, and `content_items_slug_idx`.
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
- `.env.production`: VPS secrets (located at `/opt/team-dashboard/` on VPS4).

## Host-Level (NOT in this repo, but operationally critical)

These files live on the production VPSs (VPS1 = `shield-llm`, VPS4 = `shield-main-1`), NOT in the team-dashboard repo. Listed here so an operator looking for "what runs on our infra" can find them.

- `/etc/egress-watch.env` (mode 600 root:root, both boxes): Proton SMTP creds + thresholds for the egress watcher.
- `/usr/local/bin/egress-watch.sh` (mode 750 root:root, both boxes): every-5-min RX/TX + load15 sampler with Proton SMTP alert. Logs to `/var/log/egress-watch/YYYY-MM-DD.log`.
- `/usr/local/bin/egress-daily-summary.sh` (mode 750 root:root, both boxes): 23:55 daily roll-up email + 30-day log pruning.
- `/etc/cron.d/egress-watch` (mode 644 root:root, both boxes): `*/5 * * * *` watcher + `55 23 * * *` summary.
- `/var/lib/egress-watch/last-alert` (both boxes): cooldown timestamp file, prevents alert flooding.
- `/usr/local/bin/docker-cleanup.sh` (both boxes): Sundays 3am — prunes containers/images/build cache.
- `/opt/firecrawl/docker-compose.yml` (VPS1): Firecrawl stack, hardened 2026-05-09 (per-service cap_drop matrix in `docs/deploy/docker.md`).
- `/opt/bge-m3/docker-compose.yml` (VPS1): BGE-M3 TEI stack, hardened 2026-05-09.
- `/opt/ollama/docker-compose.yml` (VPS1): Ollama stack, hardened 2026-05-09.
- `/opt/team-dashboard/docker-compose.yml` (VPS4): team-dashboard backend, hardened 2026-05-09.

## Plugins
- `packages/plugins/plugin-discord/src/worker.ts`: Discord bot worker.
- `packages/plugins/plugin-twitter/src/worker.ts`: Twitter/X plugin worker.
- `packages/plugins/plugin-moltbook/src/worker.ts`: Moltbook plugin worker.
