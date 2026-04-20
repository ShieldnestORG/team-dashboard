# Firecrawl Self-Hosting Guide -- Coherence Daddy

## What It Is

Firecrawl is an open-source web scraping engine. Running it yourself means:
- **No API key** -- zero cost per request
- **No rate limits** -- crawl as fast as your hardware allows
- **Full privacy** -- your scrape targets never leave your network
- **Cloud API available as upgrade** -- just add the key in plugin settings when you want higher throughput

---

## Production Deployment (Current)

Firecrawl is deployed on VPS `168.231.127.180` (srv1060975).

| Detail | Value |
|--------|-------|
| **Endpoint** | `https://firecrawl.coherencedaddy.com` |
| **API Version** | v1 (`/v1/scrape`, `/v1/crawl`, etc.) |
| **OS** | Ubuntu 24.04.3 LTS |
| **CPU** | 2 vCPU |
| **RAM** | 8 GB |
| **Disk** | 96 GB (89 GB free) |
| **Docker** | 29.0.2 |
| **Nginx** | Reverse proxy on port 80 |
| **Other services** | Ollama (LLM, port 11434) |
| **Compose file** | `/opt/firecrawl/docker-compose.yml` |
| **Images** | `trieve/firecrawl:v0.0.55`, `trieve/puppeteer-service-ts:v0.0.13`, `redis:7-alpine` |

### Architecture

```
Internet
   |
   v
Nginx (port 80) -- rate limited, 10 req/s per IP
   |
   v (proxy_pass to 127.0.0.1:3002)
Firecrawl API
   |
   +-- Redis (job queue + cache)
   +-- Worker (processes crawl/scrape jobs)
   +-- Puppeteer Service (headless Chromium for JS rendering)
```

### RAM Usage (Measured)

| Container | Idle | Limit |
|-----------|------|-------|
| Firecrawl API | 190 MB | 1 GB |
| Worker | 296 MB | 1 GB |
| Puppeteer Service | 353 MB | 2 GB |
| Redis | 4 MB | 640 MB |
| Ollama | 21 MB | unlimited |
| **Total** | **~864 MB** | **~5.3 GB** |
| **System available** | **6.4 GB** | -- |

---

## Container Management

### SSH Access
```bash
ssh root@168.231.127.180
# Password was changed on 2026-03-31 -- check secure notes
```

### Common Commands
```bash
# Check status
cd /opt/firecrawl && docker compose ps

# View logs
docker compose logs -f api --tail 50
docker compose logs -f worker --tail 50
docker compose logs -f puppeteer-service --tail 50

# Restart all services
docker compose restart

# Stop everything
docker compose down

# Start everything
docker compose up -d

# Update images
docker compose pull && docker compose up -d

# Resource usage
docker stats --no-stream
```

### Test Scrape
```bash
curl -X POST https://firecrawl.coherencedaddy.com/v1/scrape \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer self-hosted" \
  -d '{"url": "https://example.com"}'
```

---

## Hardware Requirements (for new deployments)

### Tier 1 -- Minimum (10-50 scrapes/day)
| Resource | Requirement |
|----------|-------------|
| RAM | **2 GB** |
| CPU | 1-2 cores |
| Storage | 5 GB |
| Example | Old laptop, $6/mo VPS |

### Tier 2 -- Recommended (daily competitive intelligence)
| Resource | Requirement |
|----------|-------------|
| RAM | **4 GB** |
| CPU | 2-4 cores |
| Storage | 20 GB |
| Example | Secondary laptop, $20/mo VPS |

### Tier 3 -- High Volume (continuous crawling)
| Resource | Requirement |
|----------|-------------|
| RAM | **8 GB+** |
| CPU | 4-8 cores |
| Storage | 50-100 GB |
| Example | Current VPS (168.231.127.180) |

---

## Paperclip Plugin Configuration

The Firecrawl plugin is configured via Paperclip Settings or API:

**Current config:**
- Plugin ID: `c0a67b48-f612-45ba-ad42-dfb773a95ee2`
- Self-Hosted URL: `https://firecrawl.coherencedaddy.com`
- API Key: `self-hosted` (placeholder -- no real key needed)

**To change via API:**
```bash
curl -X POST http://localhost:3100/api/plugins/c0a67b48-f612-45ba-ad42-dfb773a95ee2/config \
  -H "Content-Type: application/json" \
  -d '{"configJson": {"apiUrl": "https://firecrawl.coherencedaddy.com", "apiKey": "self-hosted"}}'
```

**To switch to cloud API:**
```bash
curl -X POST http://localhost:3100/api/plugins/77a47f04-bd01-481a-87da-4c22bc6ea2b1/config \
  -H "Content-Type: application/json" \
  -d '{"configJson": {"apiUrl": "", "apiKey": "fc-your-key-here"}}'
```

---

## Available Firecrawl Tools (6 total)

| Tool | Description | Agent Access |
|------|-------------|-------------|
| `firecrawl:scrape` | Scrape a single URL to markdown | All 7 agents |
| `firecrawl:crawl` | Crawl an entire site (multi-page) | Nova, Core, Bridge, River, Sage |
| `firecrawl:map` | Discover all URLs on a site (sitemap) | Nova, Core, Bridge, River, Sage, Echo |
| `firecrawl:extract` | Extract structured data via prompt | Nova, Core, Bridge |
| `firecrawl:search` | Web search returning full page content | All 7 agents |
| `firecrawl:metrics` | Usage stats, success rate, data volume | All 7 agents |

---

## Monitoring & Metrics

Every tool call logs to: `~/.paperclip/instances/default/firecrawl-metrics.jsonl`

Each entry records:
- Timestamp, tool name, mode (cloud/self-hosted)
- Target URL or query
- Duration in milliseconds
- Characters returned
- Success/failure + error message

**To view metrics**, any agent can call `firecrawl:metrics` with `{"days": 7}`.

---

## Dataset Targets

Full list of URLs to scrape is stored as a Company Skill in Paperclip: **"Firecrawl Dataset Targets"**

Active intelligence-gathering issues:

| Issue | Agent | Target |
|-------|-------|--------|
| COH-15 | Nova (CTO) | ShieldNest competitor analysis -- Proton, Bitwarden, Mullvad |
| COH-16 | Core (Backend) | Tokns.fi DeFi landscape -- Jupiter, Raydium, Pump.fun |
| COH-17 | Bridge (Full-Stack) | Smart Notes competitors -- Notion, Obsidian, Reflect |
| COH-18 | River (PM) | Token migration research -- burn-to-mint mechanics |
| COH-19 | Sage (CMO) | SEO keyword research -- all 4 ventures |
| COH-20 | Echo (Marketing) | Weekly brand monitoring setup |

---

## Nginx Configuration

Location: `/etc/nginx/sites-available/firecrawl`

Features:
- Rate limiting: 10 req/s per IP, burst 20
- Proxy timeout: 300s (for crawl operations)
- Only `/v1/*` and `/v0/*` paths exposed
- Health check at `/health` (no auth)
- All other paths return 404

---

## Cloud API Upgrade Path

When you want higher throughput or to offload from your VPS:

1. Sign up at **firecrawl.dev**
2. Copy your API key (`fc-xxxxxxxx`)
3. In Paperclip UI: Settings > Plugins > Firecrawl
   - Clear "Self-Hosted URL"
   - Paste API key in "Cloud API Key"

The plugin automatically uses whichever is configured. Self-hosted URL takes precedence if both are set.

---

## Backup & Recovery

**What to back up:**
- `/opt/firecrawl/docker-compose.yml` -- the compose config
- `/etc/nginx/sites-available/firecrawl` -- nginx proxy config
- Redis data is ephemeral (cache only) -- no backup needed

**To redeploy from scratch:**
```bash
apt update && apt install -y docker.io docker-compose-plugin nginx
mkdir -p /opt/firecrawl
# Copy docker-compose.yml to /opt/firecrawl/
# Copy nginx config to /etc/nginx/sites-available/firecrawl
ln -s /etc/nginx/sites-available/firecrawl /etc/nginx/sites-enabled/
cd /opt/firecrawl && docker compose pull && docker compose up -d
nginx -t && systemctl reload nginx
```
