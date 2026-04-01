---
title: "Vercel + VPS Split Deployment"
description: "Deploy Team Dashboard with Vercel frontend, VPS backend, and Neon database"
---

# Vercel + VPS Split Deployment

Team Dashboard uses a split architecture: Vercel serves the static React UI, a VPS runs the Express.js backend in Docker, and Neon provides managed PostgreSQL.

## Architecture

```
Vercel (CDN)                 VPS (Docker)                 Neon (DB)
┌──────────────┐      ┌──────────────────┐      ┌─────────────────┐
│ React SPA    │─────▶│ Express.js :3200  │─────▶│ PostgreSQL      │
│ vercel.json  │      │ docker-compose    │      │ managed backups │
│ /api/* proxy │      │ SERVE_UI=false    │      │ auto-scaling    │
└──────────────┘      └──────────────────┘      └─────────────────┘
```

## Prerequisites

- VPS with Docker and Docker Compose installed
- Vercel project connected to the GitHub repo
- Neon PostgreSQL database (provisioned via Vercel integration)

## VPS Backend Setup

### 1. Create deployment directory

```bash
ssh root@YOUR_VPS_IP
mkdir -p /opt/team-dashboard
```

### 2. Clone the repo

```bash
cd /opt/team-dashboard
git clone https://github.com/ShieldnestORG/team-dashboard.git repo
```

### 3. Create docker-compose.yml

Copy `docker-compose.production.yml` from the repo, or create it manually:

```yaml
name: team-dashboard

services:
  server:
    build:
      context: ./repo
      dockerfile: Dockerfile
    image: team-dashboard:local
    ports:
      - "3200:3100"
    env_file:
      - .env.production
    environment:
      HOST: "0.0.0.0"
      PORT: "3100"
      SERVE_UI: "false"
      PAPERCLIP_DEPLOYMENT_MODE: "authenticated"
      PAPERCLIP_DEPLOYMENT_EXPOSURE: "public"
      PAPERCLIP_MIGRATION_AUTO_APPLY: "true"
      PAPERCLIP_DB_BACKUP_ENABLED: "false"
    volumes:
      - paperclip-data:/paperclip
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3100/api/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

volumes:
  paperclip-data:
```

### 4. Create `.env.production`

```bash
cat > /opt/team-dashboard/.env.production << 'EOF'
DATABASE_URL=postgresql://USER:PASSWORD@NEON_HOST/DBNAME?sslmode=require
BETTER_AUTH_SECRET=<run: openssl rand -base64 32>
PAPERCLIP_PUBLIC_URL=https://YOUR_VERCEL_DOMAIN.vercel.app
BETTER_AUTH_TRUSTED_ORIGINS=https://YOUR_VERCEL_DOMAIN.vercel.app
PAPERCLIP_ALLOWED_HOSTNAMES=YOUR_VPS_IP
ANTHROPIC_API_KEY=sk-ant-...
EOF
```

### 5. Build and start

```bash
cd /opt/team-dashboard
docker compose build
docker compose up -d
```

### 6. Verify

```bash
curl http://localhost:3200/api/health
# Should return: {"status":"ok","deploymentMode":"authenticated",...}
```

## Vercel Frontend Setup

The `vercel.json` at the repo root configures:
- Build command: `pnpm --filter @paperclipai/ui... build`
- Output: `ui/dist`
- API rewrites: `/api/*` proxied to VPS

Push to master triggers auto-deploy.

## First User Setup

After both frontend and backend are running:

1. Navigate to the Vercel URL
2. The app shows "Instance setup required"
3. SSH into the VPS and run: `docker compose exec server node -e "...bootstrap command..."`
4. Or generate a bootstrap invite: the server logs will show a claim URL on first startup

## Updating

### Backend

```bash
ssh root@YOUR_VPS_IP
cd /opt/team-dashboard/repo && git pull
cd /opt/team-dashboard && docker compose build && docker compose up -d
```

### Frontend

Push to master — Vercel auto-deploys.

## Environment Variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | VPS `.env.production` | Neon connection string |
| `BETTER_AUTH_SECRET` | VPS `.env.production` | Auth JWT signing key |
| `PAPERCLIP_PUBLIC_URL` | VPS `.env.production` | Must be the Vercel frontend URL |
| `BETTER_AUTH_TRUSTED_ORIGINS` | VPS `.env.production` | Vercel domain for CORS |
| `ANTHROPIC_API_KEY` | VPS `.env.production` | For Claude adapter |
| `SERVE_UI` | Docker Compose env | `false` (Vercel serves UI) |

## Known Limitations

- **WebSocket**: Vercel rewrites don't support WebSocket upgrade. Real-time push notifications are unavailable. React Query polling provides eventual consistency. Fix by adding a domain to the VPS with Caddy reverse proxy.
- **Neon pooling**: Uses PgBouncer pooled connection. If prepared statement errors occur, switch to the non-pooled Neon endpoint.

## Future Improvements

- Add a domain to the VPS for HTTPS + WebSocket support
- Set up Caddy as a reverse proxy with automatic TLS
- Create a GitHub Action for automated backend deploys (SSH + docker compose pull)
- Add uptime monitoring on `/api/health/readiness`
