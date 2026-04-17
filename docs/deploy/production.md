# Production Deployment — Team Dashboard

## Deployment Architecture

Production is split across three primary environments to balance scalability and security:

```
Vercel (public sites)          VPS 31.220.61.12 (backend + admin)    Neon (database)
coherencedaddy.com             nginx (api.coherencedaddy.com)  ----> PostgreSQL
freetools.coherencedaddy.com   └─ Express :3100 (SERVE_UI=true)
directory.coherencedaddy.com      API + admin dashboard
token.coherencedaddy.com
```

- **Frontend (public)**: Vercel — auto-deploys coherencedaddy.com + all subdomains on push to main.
- **Admin Dashboard**: VPS Docker (`SERVE_UI=true`) — team-dashboard admin UI served from Express alongside API.
- **Backend**: VPS Docker behind Caddy at `api.coherencedaddy.com` — Express.js API, agent runtime, WebSocket.
- **Database**: Neon PostgreSQL — managed by Vercel integration.
- **Firecrawl**: Self-hosted at `168.231.127.180` — scraping, crawling, data extraction.
- **Embeddings**: `147.79.78.251:8000` — BGE-M3 vector embedding service (VPS_3).
- **Directory API**: `168.231.127.180:4000` — data sync from Firecrawl.
- **Ollama**: `https://ollama.com/api` (cloud) — Gemma 4 31B Cloud for content generation and summarization.

## Updating the Backend

To deploy changes to the VPS backend:

```bash
# 1. SSH into VPS
ssh root@31.220.61.12

# 2. Pull latest code
cd /opt/team-dashboard/repo && git pull

# 3. Rebuild and restart containers
cd /opt/team-dashboard && docker compose build && docker compose up -d
```

## VPS Docker Cleanup — MANDATORY

The VPS has limited disk space. Every `docker compose build` leaves behind old images, stopped containers, and build cache. **Failure to prune will eventually fill the disk and crash the backend.**

### Post-Deploy Cleanup
Run these commands after every `docker compose build / up`:

```bash
docker image prune -f
docker container prune -f
docker volume prune -f
docker builder prune -f
```

### Critical Disk Recovery
If disk usage exceeds 80%, escalate to a full system prune:

```bash
docker system prune -a -f
```
