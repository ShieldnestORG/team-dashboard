---
title: Environment Variables
summary: Full environment variable reference
---

All environment variables that Team Dashboard uses for server configuration.

## Server Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | Server port |
| `HOST` | `127.0.0.1` | Server host binding |
| `DATABASE_URL` | (embedded) | PostgreSQL connection string |
| `PAPERCLIP_HOME` | `~/.paperclip` | Base directory for all Team Dashboard data |
| `PAPERCLIP_INSTANCE_ID` | `default` | Instance identifier (for multiple local instances) |
| `PAPERCLIP_DEPLOYMENT_MODE` | `local_trusted` | Runtime mode override |

## Secrets

| Variable | Default | Description |
|----------|---------|-------------|
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

## LLM Provider Keys (for adapters)

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Anthropic API key (for Claude Local adapter) |
| `OPENAI_API_KEY` | OpenAI API key (for Codex Local adapter) |
