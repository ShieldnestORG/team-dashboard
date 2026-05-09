---
title: Docker
summary: Docker Compose quickstart
---

Run Team Dashboard in Docker without installing Node or pnpm locally.

## Compose Quickstart (Recommended)

```sh
docker compose -f docker-compose.quickstart.yml up --build
```

Open [http://localhost:3100](http://localhost:3100).

Defaults:

- Host port: `3100`
- Data directory: `./data/docker-paperclip`

Override with environment variables:

```sh
PAPERCLIP_PORT=3200 PAPERCLIP_DATA_DIR=./data/pc \
  docker compose -f docker-compose.quickstart.yml up --build
```

## Manual Docker Build

```sh
docker build -t paperclip-local .
docker run --name paperclip \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -v "$(pwd)/data/docker-paperclip:/paperclip" \
  paperclip-local
```

## Data Persistence

All data is persisted under the bind mount (`./data/docker-paperclip`):

- Embedded PostgreSQL data
- Uploaded assets
- Local secrets key
- Agent workspace data

## Claude and Codex Adapters in Docker

The Docker image pre-installs:

- `claude` (Anthropic Claude Code CLI)
- `codex` (OpenAI Codex CLI)

Pass API keys to enable local adapter runs inside the container:

```sh
docker run --name paperclip \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -e OPENAI_API_KEY=sk-... \
  -e ANTHROPIC_API_KEY=sk-... \
  -v "$(pwd)/data/docker-paperclip:/paperclip" \
  paperclip-local
```

Without API keys, the app runs normally — adapter environment checks will surface missing prerequisites.

## Container Hardening Baseline

All production Docker services on VPS1 (LLM/scrape stack) and VPS4 (team-dashboard backend) are hardened to a defense-in-depth baseline (deployed 2026-05-09 in response to the 2026-05-08 XMRig compromise on VPS2/VPS3).

**Required for any new compose file shipped to production:**

```yaml
services:
  my-service:
    # ... image / ports / env ...
    cap_drop: [ALL]
    security_opt:
      - no-new-privileges:true
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777,noexec,nosuid,nodev
```

For services that need to write outside the rootfs (logs, caches, uploaded data), use named volumes or bind mounts — `read_only: true` only applies to the image rootfs, not to declared volumes.

### When to relax which flag

| Flag | Relax when | Replacement |
|---|---|---|
| `cap_drop: [ALL]` | Entrypoint chowns its data dir as root before dropping privileges | Use `cap_add` allowlist with the minimum caps (typically `[SETUID, SETGID, DAC_OVERRIDE, CHOWN]`, plus `FOWNER` for postgres) |
| `read_only: true` | Multi-service stack with too many write paths to enumerate | Drop `read_only` but keep `cap_drop` + `no-new-privileges` (defense in depth still holds) |
| `cap_drop: [ALL]` | Service runs Chromium / Playwright (sandbox uses CAP_SYS_ADMIN inside user namespaces) | Keep default caps but always set `no-new-privileges:true` |

### Production posture (as of 2026-05-09)

| Box | Service | `cap_drop` | `no-new-privileges` | `read_only` | Tmpfs | User |
|---|---|---|---|---|---|---|
| VPS1 | `ollama-ollama-1` | `[ALL]` | yes | yes | `/tmp` 64m noexec/nosuid/nodev | root (image default) |
| VPS1 | `bge-m3-tei-1` | `[ALL]` | yes | yes | `/tmp` 128m noexec/nosuid/nodev | root (image default) |
| VPS1 | `firecrawl-api-1` | (kept — Chromium sandbox) | yes | no | — | (default) |
| VPS1 | `firecrawl-playwright-service-1` | (kept — Chromium sandbox) | yes | no | — | (default) |
| VPS1 | `firecrawl-redis-1` | `[ALL]` | yes | no | — | (default) |
| VPS1 | `firecrawl-rabbitmq-1` | `[ALL]` + `cap_add [SETUID, SETGID, DAC_OVERRIDE, CHOWN]` | yes | no | — | (default) |
| VPS1 | `firecrawl-nuq-postgres-1` | `[ALL]` + `cap_add [SETUID, SETGID, DAC_OVERRIDE, CHOWN, FOWNER]` | yes | no | — | (default) |
| VPS4 | `team-dashboard-server-1` | `[ALL]` | yes | yes | `/tmp` 256m + `/var/tmp` 64m | `node` (non-root) |

Original compose files were backed up alongside as `*.bak` / `*.bak-pre-hardening` on each box.

**Rationale.** The April 2026 XMRig miner that killed VPS2/VPS3 was installed via Ollama RCE → write payload to disk → `chmod +x` → exec. With `read_only: true` + `cap_drop: [ALL]` + `no-new-privileges`, that chain breaks at every step even if a future Ollama (or other service) bug allows code exec inside the container. This is the reason the hardening baseline above is mandatory for new production services going forward.
