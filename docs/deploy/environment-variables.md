---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Team Dashboard uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port (VPS Docker maps 3100 → 3200 externally) |
| `HOST` | `127.0.0.1` | Server host binding |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string (Neon) |
| `PAPERCLIP_HOME` | `~/.paperclip` | Base directory for all Team Dashboard data |
| `PAPERCLIP_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |
| `PAPERCLIP_PUBLIC_URL` | (none) | Public URL for auth callbacks (e.g. `https://team-dashboard-cyan.vercel.app`) |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | (none) | Allowed hostnames for private deployment mode |
| `TEAM_DASHBOARD_COMPANY_ID` | (none) | Primary company UUID: `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4` (Coherence Daddy) |

## Authentication

| Variable | Default | Description |
|----------|---------|-------------|
| `PAPERCLIP_AGENT_JWT_SECRET` | (none) | Secret for signing agent JWTs |
| `BETTER_AUTH_SECRET` | (none) | Better Auth session signing secret |
| `BETTER_AUTH_TRUSTED_ORIGINS` | (none) | CORS trusted origins for auth (Vercel URL) |
| `PAPERCLIP_SECRETS_MASTER_KEY` | (from file) | 32-byte encryption key (base64/hex/raw) |
| `PAPERCLIP_SECRETS_MASTER_KEY_FILE` | `~/.paperclip/.../secrets/master.key` | Path to key file |
| `PAPERCLIP_SECRETS_STRICT_MODE` | `false` | Require secret refs for sensitive env vars |

## Agent Runtime (Injected into agent processes)

These are set automatically by the server when invoking agents:

| Variable | Description |
|----------|-------------|
| `PAPERCLIP_AGENT_ID` | Agent's unique ID |
| `PAPERCLIP_COMPANY_ID` | Company ID |
| `PAPERCLIP_API_URL` | Team Dashboard API base URL |
| `PAPERCLIP_API_KEY` | Short-lived JWT for API auth |
| `PAPERCLIP_RUN_ID` | Current heartbeat run ID |
| `PAPERCLIP_TASK_ID` | Issue that triggered this wake |
| `PAPERCLIP_WAKE_REASON` | Wake trigger reason |
| `PAPERCLIP_WAKE_COMMENT_ID` | Comment that triggered this wake |
| `PAPERCLIP_APPROVAL_ID` | Resolved approval ID |
| `PAPERCLIP_APPROVAL_STATUS` | Approval decision |
| `PAPERCLIP_LINKED_ISSUE_IDS` | Comma-separated linked issue IDs |

## LLM / AI Providers

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (none) | Anthropic API key (Claude for agent runtime) |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | Default Claude model |
| `OLLAMA_URL` | `http://168.231.127.180:11434` | Ollama LLM for text content generation |
| `OLLAMA_MODEL` | `qwen2.5:1.5b` | Ollama model for content generation |
| `OPENAI_API_KEY` | (none) | OpenAI API key (for Codex Local adapter) |

## Content Generation

| Variable | Default | Description |
|----------|---------|-------------|
| `CONTENT_API_KEY` | (none) | Auth key for `/api/content/*`, `/api/visual/*`, and `/api/trends/*` POST endpoints (via `X-Content-Key` header) |
| `CD_BLOG_API_URL` | `https://coherencedaddy.com/api/blog/posts` | Blog publish endpoint on coherencedaddy |
| `CD_BLOG_API_KEY` | (none) | Bearer token for blog publish API |
| `INDEXNOW_KEY` | (none) | IndexNow verification key for search engine ping after blog publish |

## Visual Content Backends

Both are optional — backends auto-enable when their API key is set.

| Variable | Default | Description |
|----------|---------|-------------|
| `GEMINI_API_KEY` | (none) | Google AI Studio key — enables Imagen 3 (images) + Veo 2 (video) |
| `GROK_API_KEY` | (none) | xAI key — enables grok-2-image (images) + grok-imagine-video (video, 1-15s, 720p) |
| `GROK_API_URL` | `https://api.x.ai/v1` | Override for Grok API base URL |

## Intel Engine

| Variable | Default | Description |
|----------|---------|-------------|
| `INTEL_INGEST_KEY` | (none) | Auth for intel data ingestion API |
| `GITHUB_TOKEN` | (none) | GitHub API access for intel GitHub source |
| `EMBED_URL` | `http://31.220.61.12:8000` | BGE-M3 vector embedding service |
| `EMBED_API_KEY` | (none) | Embedding service auth key |

## Site Metrics Integration

| Variable | Default | Description |
|----------|---------|-------------|
| `SITE_METRICS_KEY` | (none) | Shared secret for external sites to push metrics via `X-Site-Metrics-Key` header |

External properties (coherencedaddy.com, tokns.fi, etc.) call `POST /api/companies/:companyId/site-metrics/ingest` with this key to report analytics. Agents can query metrics via `GET /api/companies/:companyId/site-metrics`.

## Firecrawl Plugin

| Variable | Default | Description |
|----------|---------|-------------|
| `FIRECRAWL_EMBEDDING_API_KEY` | (none) | Coherence Daddy embedding API key |

Firecrawl plugin config (apiUrl, directoryApiUrl, embeddingApiUrl, ollamaUrl) is set via the plugin config API, not environment variables. See the Firecrawl plugin docs at `packages/plugins/plugin-firecrawl/docker/SELF_HOSTING.md`.

## Platform Publishing (Auto-Posting)

All optional — publishers auto-enable when their credentials are set.

| Variable | Default | Description |
|----------|---------|-------------|
| `YOUTUBE_CLIENT_ID` | (none) | YouTube Data API v3 OAuth client ID |
| `YOUTUBE_CLIENT_SECRET` | (none) | YouTube Data API v3 OAuth client secret |
| `YOUTUBE_REFRESH_TOKEN` | (none) | YouTube OAuth refresh token for Shorts upload |
| `TIKTOK_ACCESS_TOKEN` | (none) | TikTok Content Posting API access token |
| `TWITTER_API_KEY` | (none) | Twitter/X API key (consumer key) |
| `TWITTER_API_SECRET` | (none) | Twitter/X API secret (consumer secret) |
| `TWITTER_ACCESS_TOKEN` | (none) | Twitter/X user access token |
| `TWITTER_ACCESS_SECRET` | (none) | Twitter/X user access secret |
| `INSTAGRAM_ACCESS_TOKEN` | (none) | Instagram Graph API long-lived access token |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | (none) | Instagram business account ID |

## Alerting (SMTP)

| Variable | Default | Description |
|----------|---------|-------------|
| `SMTP_HOST` | (none) | SMTP server hostname (e.g. `smtp.protonmail.ch`) |
| `SMTP_PORT` | (none) | SMTP port (e.g. `587`) |
| `SMTP_USER` | (none) | SMTP username |
| `SMTP_PASS` | (none) | SMTP password |
| `ALERT_EMAIL_TO` | (none) | Alert recipient email |
| `ALERT_EMAIL_FROM` | (none) | Alert sender email |

## Deployment Checklist

**Vercel** (frontend only):
- `DATABASE_URL` — auto-injected via Neon integration
- No other env vars needed

**VPS** (`.env.production` at `/opt/team-dashboard/`):
- All variables above that are marked as required
- Visual backend keys are optional but recommended for content generation
