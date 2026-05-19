# VPS Cheat Sheet

**One-page reference. Read before any SSH or deploy operation.**

## TL;DR — which VPS does what

| If you want to touch… | SSH to | Why |
|---|---|---|
| **The team-dashboard backend / any `*.coherencedaddy.com` API** | `root@31.220.61.14` (VPS4) | Public-facing Express container behind nginx |
| **The customer admin UI** | `root@31.220.61.14` (VPS4) | Same container, served at the same domains |
| **Firecrawl, BGE-M3 embeddings, or self-hosted Ollama** | `root@31.220.61.12` (VPS1) | Tailnet-only LLM/scrape stack |

**Rule:** if the task involves a `*.coherencedaddy.com` URL, it's `.14`. If it involves an LLM model, embedding, or web crawl, it's `.12`. There is no overlap.

## Pre-deploy sanity check (paste-ready)

Before any deploy, run this exactly:

```bash
dig +short api.coherencedaddy.com
# → must return 31.220.61.14
```

If it returns anything else, stop. The DNS has changed and this doc is stale — investigate before deploying.

## DNS → VPS map (audited 2026-05-09)

| Domain | A record | Served by |
|---|---|---|
| `coherencedaddy.com` (and 8 sibling subdomains) | Vercel | Vercel |
| `app.coherencedaddy.com` | Vercel | Vercel (customer portal repo) |
| `api.coherencedaddy.com` | **31.220.61.14** | VPS4 nginx → team-dashboard:3200 |
| `affiliates.coherencedaddy.com` | **31.220.61.14** | Same |
| `intel.coherencedaddy.com` | **31.220.61.14** | Same |
| `freetools.coherencedaddy.com` | Vercel (legacy 301) | Redirects to `coherencedaddy.com/tools/...` (only `/api/*` and `/.well-known/*` pass through) |
| `dao.nestd.xyz` | **31.220.61.14** | VPS4 nginx → trustee-frontend:3006 (separate stack on the same box) |

Re-run when in doubt: `dig +short <domain>`.

## SSH cheat-codes

```bash
# VPS4 (team-dashboard prod) — the one you almost always want
ssh root@31.220.61.14

# VPS1 (LLM/scrape, Tailnet-only services) — only for Firecrawl / BGE / self-hosted Ollama ops
ssh root@31.220.61.12
```

Both use the same key: `nestd@pm.me` ed25519. If SSH errors, the key isn't installed where you're calling from.

## Deploy team-dashboard (the standard recipe)

> **2026-05-17:** `scripts/predeploy.sh` now runs `pnpm db:migrate` after the DNS check. If you bypass it (raw `ssh ... docker compose up -d`), run `pnpm db:migrate` against the prod `DATABASE_URL` first — `docker compose up -d` reuses the running container and skips boot-time migration. See `docs/handoffs/2026-05-17-migration-0116-diagnosis.md`.

```bash
# 1. Verify you're going to the right box
dig +short api.coherencedaddy.com   # must be 31.220.61.14

# 2. Pull + rebuild + restart
ssh root@31.220.61.14 "cd /opt/team-dashboard/repo && git checkout master && git pull origin master && cd /opt/team-dashboard && docker compose up -d --build"

# 3. Wait for healthy
ssh root@31.220.61.14 "until docker inspect -f '{{.State.Health.Status}}' team-dashboard-server-1 2>/dev/null | grep -q healthy; do sleep 3; done; echo HEALTHY"

# 4. Smoke-test (no migration needed since the container auto-applies on boot)
curl -sS https://api.coherencedaddy.com/api/health | head -3
```

If step 1 returns anything other than `31.220.61.14`, **stop**. Migration of services onto/off this box happens once or twice a year and breaks every cached "deploy command" in old playbooks.

## .env.production live on VPS4

Path: `/opt/team-dashboard/.env.production`

```bash
# View redacted (safe to paste back)
ssh root@31.220.61.14 "cat /opt/team-dashboard/.env.production | sed -E 's/=(rk_live_|sk_live_|whsec_|.{8})[A-Za-z0-9_]+/=\\1***/g'"

# Edit
ssh root@31.220.61.14 "nano /opt/team-dashboard/.env.production"

# Backup + apply changes (template)
ssh root@31.220.61.14 "cp /opt/team-dashboard/.env.production /opt/team-dashboard/.env.production.bak.\$(date +%s) && nano /opt/team-dashboard/.env.production && cd /opt/team-dashboard && docker compose restart server"
```

Backups land alongside as `.env.production.bak.<unix-timestamp>` — purge old ones quarterly.

## Anti-patterns (the trap log)

| Anti-pattern | Why it's wrong | What to do instead |
|---|---|---|
| `ssh root@31.220.61.12 "cd /opt/team-dashboard && docker compose up -d"` | `.12` IS the LLM/scrape stack but ALSO has a stale team-dashboard checkout (legacy from before the swap). The container will build + run + bind 127.0.0.1:3200, but **no public domain proxies to it** — you'll see 404s from prod and think the deploy failed. | `dig +short api.coherencedaddy.com` first, then SSH to the answer |
| Trusting an agent's "VPS IP" without verifying | Agents read this file once and then memorize. Old reports from before the swap quote `.12` for team-dashboard | Always re-`dig` at the start of every fresh session |
| `docker compose up` in `/opt/team-dashboard/repo` | The compose file lives at `/opt/team-dashboard/docker-compose.yml`, not in the repo subdir | `cd /opt/team-dashboard && docker compose up -d` |

## Cost of getting it wrong

2026-05-09: deployed Watchtower wedge to `.12`, smoke test against api.coherencedaddy.com 404'd. Spent ~30 minutes investigating the route, the build, the routes file, the proxy chain, before running `dig` and finding api → `.14`. Re-deploy to `.14` succeeded first try. **Net waste: 30 min + one cold container rebuild on the wrong box.** The `dig` would have caught it in 1 second.

This entire doc exists to prevent the same trap from costing the next deploy more.
