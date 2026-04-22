# Production Deployment — Team Dashboard

## Deployment Architecture

```
Vercel (9 subdomains, one Next.js app)     VPS 31.220.61.12 (backend + admin)     Neon (database)
coherencedaddy.com                         Caddy (api.coherencedaddy.com)  ──────► PostgreSQL
freetools.coherencedaddy.com               └─ Express :3100 (SERVE_UI=true)
directory.coherencedaddy.com                  API + admin dashboard + agent runtime
token.coherencedaddy.com
partners.coherencedaddy.com
creditscore.coherencedaddy.com             VPS 168.231.127.180 (Firecrawl + AI)
shop.coherencedaddy.com                    Firecrawl API :3002 + Worker + Redis
law.coherencedaddy.com                     Ollama :11434 (Gemma 4 31B)
optimize-me.coherencedaddy.com             Qdrant :6333 + Directory API :4000

affiliates.coherencedaddy.com              VPS 147.79.78.251 (ShieldNest + Embeddings)
  └─ JWT auth, separate from admin session BGE-M3 :8000 + Ollama :11434
                                           ShieldNest PM2 apps + Coreum tools
                                           rollwithsolo.com · runatthebullets.com

                                           VPS 31.220.61.14 (Trustee DAO + Game Panel)
                                           trustee-gateway-api Docker :4001
                                           trustee-frontend Next.js :3006
                                           AMP Game Panel :8080 · dao.nestd.xyz
```

- **Frontend (public)**: Vercel — auto-deploys all 9 coherencedaddy.com subdomains on push to main via `middleware.ts` subdomain routing.
- **Admin Dashboard**: VPS1 Docker (`SERVE_UI=true`) — team-dashboard admin UI served from Express alongside API.
- **Backend API**: VPS1 Docker behind Caddy at `api.coherencedaddy.com` — Express.js API, agent runtime, WebSocket.
- **Vercel rewrites to VPS1**: `/api/intel/*`, `/api/trends/*`, `/api/content/*`, `/api/partner-directory/*`, `/api/bundles/*`, `/api/creditscore/*` → `http://31.220.61.12:3100/...` (or `api.coherencedaddy.com/...`). See `docs/OWNERSHIP.md` for the full inter-repo contract.
- **Database**: Neon PostgreSQL — managed by Vercel integration.
- **Firecrawl**: VPS2 (`168.231.127.180`) — scraping, crawling, Puppeteer, Redis.
- **Embeddings**: VPS3 (`147.79.78.251:8000`) — BGE-M3 vector embedding service (uvicorn).
- **Ollama**: VPS2 (`168.231.127.180:11434`) — Gemma 4 31B-cloud for content generation. VPS3 also runs Ollama :11434.
- **Qdrant Vector Store**: VPS2 (`168.231.127.180:6333`).
- **Directory API**: VPS2 (`168.231.127.180:4000`) — data sync from Firecrawl.

## Updating the Backend

```bash
ssh root@31.220.61.12 'cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose build && docker compose up -d && docker image prune -f && docker container prune -f && docker builder prune -f'
```

## VPS Disk Usage (April 2026 baseline)

| VPS | IP | Total | Used | Free | % |
|---|---|---|---|---|---|
| Team Dashboard | 31.220.61.12 | 394 GB | 35 GB | 343 GB | 10% |
| Firecrawl | 168.231.127.180 | 96 GB | 28 GB | 69 GB | 29% |
| ShieldNest/Embeddings | 147.79.78.251 | 193 GB | 81 GB | 113 GB | 42% |
| Trustee DAO | 31.220.61.14 | 197 GB | 31 GB | 158 GB | 17% |

## Automated Cleanup (all VPS)

All four VPS servers run `/usr/local/bin/docker-cleanup.sh` via cron every **Sunday at 3am**. The script:
- Prunes stopped containers (`docker container prune -f`)
- Prunes dangling images only (`docker image prune -f`) — does NOT remove all unused images
- Prunes build cache, keeping 2 GB reserved (`docker builder prune -f --keep-storage=2gb`)
- Logs before/after disk usage to `/var/log/docker-cleanup.log`

VPS4 also has a pre-existing `/opt/trustbrain/docker-prune.sh` running the same schedule.

### Manual Post-Deploy Cleanup
Still run these after every `docker compose build / up` on VPS1:

```bash
docker image prune -f
docker container prune -f
docker builder prune -f
```

### Critical Disk Recovery (>80% usage)
```bash
docker system prune -a -f
```
