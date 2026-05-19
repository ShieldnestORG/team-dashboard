# Production Deployment — Team Dashboard

> **⚠️ Pre-deploy sanity check.** Always run `dig +short api.coherencedaddy.com` first and confirm `31.220.61.14`. Team-dashboard runs on **VPS4 (`.14`)**, NOT VPS1 (`.12`). VPS1 hosts the LLM/scrape stack only and never serves any `*.coherencedaddy.com` HTTP traffic. SSHing to `.12` and running `docker compose up` against the team-dashboard repo there will appear to succeed but won't affect production. (Cost ~30 min on 2026-05-09.)

## Deployment Architecture (post-2026-05-09 swap)

```
Vercel (9 subdomains, one Next.js app)     VPS4 31.220.61.14 (team-dashboard backend)
coherencedaddy.com                         nginx → 127.0.0.1:3200
freetools.coherencedaddy.com               └─ team-dashboard-server-1 Docker (Express :3100, SERVE_UI=true)
directory.coherencedaddy.com                  api.coherencedaddy.com
token.coherencedaddy.com                      affiliates.coherencedaddy.com
partners.coherencedaddy.com                   intel.coherencedaddy.com
creditscore.coherencedaddy.com                Trustee DAO + Game Panel still live here
shop.coherencedaddy.com                       (trustee-gateway-api :4001, trustee-frontend :3006,
law.coherencedaddy.com                         AMP Game Panel :8080, dao.nestd.xyz)
optimize-me.coherencedaddy.com
                                           VPS1 31.220.61.12 (LLM/scrape stack — Tailnet only)
affiliates.coherencedaddy.com              Firecrawl :3002 + BGE-M3 TEI :8080 + Ollama :11434
  └─ JWT auth, separate from admin session All bound to Tailnet 100.67.128.51 — no public bind
                                           VPS4 → VPS1 over Tailscale mesh (100.65.70.18 ↔ 100.67.128.51)

Neon (database)                            DECOMMISSIONED 2026-05-08
PostgreSQL (managed)                       VPS2 168.231.127.180 — handed off, do not reference
                                           VPS3 147.79.78.251 — payment lapses; rollwithsolo / runatthebullets
                                                                were on this box, migration follow-up
```

- **Frontend (public)**: Vercel — auto-deploys all 9 coherencedaddy.com subdomains on push to main via `middleware.ts` subdomain routing.
- **Admin Dashboard**: VPS4 Docker (`SERVE_UI=true`) — team-dashboard admin UI served from Express alongside API, fronted by nginx.
- **Backend API**: VPS4 Docker behind nginx at `api.coherencedaddy.com` — Express.js API, agent runtime, WebSocket. Container binds `127.0.0.1:3200 → 3100`.
- **Vercel rewrites to VPS4**: `/api/intel/*`, `/api/trends/*`, `/api/content/*`, `/api/partner-directory/*`, `/api/bundles/*`, `/api/creditscore/*` → `https://api.coherencedaddy.com/...`. See `docs/OWNERSHIP.md` for the full inter-repo contract.
- **Database**: Neon PostgreSQL — managed by Vercel integration. **Reachable from anywhere with the credentials over TLS** (us-east-1 AWS pooler endpoint). NOT on the Tailscale mesh. The `feedback_no_public_llm_db` Tailnet-only rule applies to self-hosted services (Ollama, custom binds) — Neon is a managed SaaS, public-by-design behind TLS + creds. To run a migration or query against prod Neon from your local machine: export the `DATABASE_URL` from `.env` and run `pnpm db:migrate` (or `psql "$DATABASE_URL"`). No SSH or VPN needed.
- **Firecrawl**: VPS1 Tailnet `http://100.67.128.51:3002` — scraping, crawling, Playwright, Redis. Self-hosted, `USE_DB_AUTHENTICATION=false`. Tailnet-only bind.
- **Embeddings**: VPS1 Tailnet `http://100.67.128.51:8080` — BGE-M3 via HuggingFace TEI 1.6 (CPU). Tailnet-only.
- **Ollama**: VPS1 Tailnet `http://100.67.128.51:11434` — local Gemma 2:2b for fallback / agent / KG workloads. Tailnet-only. Content generation primarily uses Ollama Cloud (`https://ollama.com/api`) — see [Ollama Endpoint Routing](../../README.md) and `OLLAMA_URL` env.
- **Tailscale mesh**: VPS4 (`shield-main-1`, `100.65.70.18`) ↔ VPS1 (`shield-llm`, `100.67.128.51`). All inter-VPS LLM/scrape calls go over Tailnet — no public 0.0.0.0 binds for internal services. See [Tailscale Private Access](./tailscale-private-access.md) for the key-expiry-disable policy.

## Updating the Backend

Always run `./scripts/predeploy.sh` first — it verifies the deploy target,
**runs pending DB migrations against `DATABASE_URL` (added 2026-05-17 after the
migration-0116 incident — see `docs/handoffs/2026-05-17-migration-0116-diagnosis.md`)**,
and prints the exact command below (prune tail included). If you bypass the
script (e.g. raw `ssh ... docker compose up -d`), you must run `pnpm db:migrate`
manually first — `docker compose up -d` reuses the running container, so
boot-time migration logic never re-runs.

```bash
ssh root@31.220.61.14 'cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose build && docker compose up -d && docker image prune -f && docker container prune -f && docker builder prune -f'
```

The trailing `docker … prune -f` calls are not optional — omitting them
leaves dangling images + build cache on the box until the Sunday 3am cron
sweeps them (see "Automated Cleanup" below). `predeploy.sh` now emits the
full command with the prune tail so a copy-paste deploy stays clean.

LLM/scrape stack updates (VPS1):

```bash
# Firecrawl rebuild after upstream pull:
ssh root@31.220.61.12 'cd /opt/firecrawl && git pull && docker compose build && docker compose up -d'
# BGE-M3 image bump:
ssh root@31.220.61.12 'cd /opt/bge-m3 && docker compose pull && docker compose up -d'
```

## VPS Disk Usage (post-swap baseline)

| VPS | Public IP | Tailnet | Plan | Role |
|---|---|---|---|---|
| VPS1 (`shield-llm`) | 31.220.61.12 | 100.67.128.51 | Hostinger Game Panel 8 (32 GB / 8 vCPU / 400 GB) | Firecrawl + BGE-M3 + Ollama, Tailnet-only |
| VPS4 (`shield-main-1`) | 31.220.61.14 | 100.65.70.18 | Hostinger Game Panel 4 (16 GB / 4 vCPU / 200 GB) | team-dashboard backend, nginx, public 80/443 |

VPS2 (`168.231.127.180`) was nuked 2026-05-08 (XMRig compromise via Ollama RCE) and handed off. VPS3 (`147.79.78.251`) is decommissioning — payment lapse imminent. Do not provision new services there.

## Container hardening (deployed 2026-05-09)

Every Docker service on both kept boxes has `cap_drop: [ALL]` + `security_opt: [no-new-privileges:true]` applied. Rootfs is `read_only: true` with tmpfs `/tmp` for the LLM/embed services and team-dashboard. Firecrawl's multi-service stack is partially hardened — see [docs/deploy/docker.md](./docker.md#container-hardening-baseline) for the per-service matrix and rationale.

Original compose files were backed up alongside as `*.bak` / `*.bak-pre-hardening` on each box.

**Why:** the April 2026 XMRig miner that killed VPS2/VPS3 was installed via Ollama RCE → write payload → `chmod +x` → exec. With `read_only` + `cap_drop` + `no-new-privileges`, that chain breaks at every step even if a future Ollama bug allows code exec inside the container — defense in depth on top of the Tailnet-only bind.

## Egress + load monitoring (deployed 2026-05-09)

Host-level cron on **both** VPS1 and VPS4 (NOT in the team-dashboard cron registry — these are OS-level cron jobs):

- `/etc/egress-watch.env` (mode 600 root:root) — Proton SMTP creds + thresholds.
- `/usr/local/bin/egress-watch.sh` (mode 750) — every 5 min: samples eth0 RX/TX bytes from `/proc/net/dev` over 10s, reads `/proc/loadavg`, logs to `/var/log/egress-watch/YYYY-MM-DD.log`. Alerts via Proton SMTP `curl --ssl-reqd smtp://smtp.protonmail.ch:587` when **either** TX > 500 KB/s **or** load15 > nproc × 0.9. 1-hour cooldown via `/var/lib/egress-watch/last-alert`.
- `/usr/local/bin/egress-daily-summary.sh` (mode 750) — runs at 23:55, sends roll-up email, prunes logs > 30 days.
- `/etc/cron.d/egress-watch` (mode 644) — `*/5 * * * * root` watcher + `55 23 * * * root` summary.

Alert destination: `nestd@pm.me`. From: `info@coherencedaddy.com`. End-to-end test confirmed delivering 2026-05-09 20:57.

**Tuning tip:** XMRig pool traffic is small (KB/s) and slips under bandwidth alerts — load15 is the more reliable miner-detect signal because miners peg cores. Raise to `1.0` (full saturation) before dropping the bandwidth threshold if false positives appear.

**Known follow-up (2026-05-09):** team-dashboard's own alert system on VPS4 still has the OLD Proton SMTP token in its `.env.production`. The egress-watch scripts use the new (rotated 2026-05-09) token. To finish the rotation, manually update `/opt/team-dashboard/.env.production` `SMTP_PASS` on VPS4 and `docker compose up -d`.

## Automated Cleanup (all VPS)

Both VPS1 and VPS4 run `/usr/local/bin/docker-cleanup.sh` via cron every **Sunday at 3am**. The script:
- Prunes stopped containers (`docker container prune -f`)
- Prunes dangling images only (`docker image prune -f`) — does NOT remove all unused images
- Prunes build cache, keeping 2 GB reserved (`docker builder prune -f --keep-storage=2gb`)
- Logs before/after disk usage to `/var/log/docker-cleanup.log`

VPS4 also has a pre-existing `/opt/trustbrain/docker-prune.sh` running the same schedule.

### Manual Post-Deploy Cleanup
Still run these after every `docker compose build / up` on VPS4:

```bash
docker image prune -f
docker container prune -f
docker builder prune -f
```

### Critical Disk Recovery (>80% usage)
```bash
docker system prune -a -f
```
