# Agent-Cron Ownership Architecture

How agents map to cron jobs and how the 24/7 execution model works on the VPS.

## Two Execution Models

The system runs two parallel execution models:

| Model | How it works | Cost | Use case |
|-------|-------------|------|----------|
| **Cron jobs** | Direct service function calls on a schedule | Zero LLM cost | Deterministic, repeatable work (data ingestion, content generation, health checks) |
| **Heartbeat wakeups** | Spawn Claude CLI via adapter, agent reads AGENTS.md instructions | API token cost | Open-ended reasoning tasks, issue resolution, creative work |

Both run 24/7 on the VPS Docker container. They are complementary, not competing.

## Heartbeat System

The heartbeat ticker is already running on the VPS. It lives in `server/src/index.ts` (not `app.ts`).

**Config flags:**
- `HEARTBEAT_SCHEDULER_ENABLED` (default: `true`) — set to `"false"` to disable
- `HEARTBEAT_SCHEDULER_INTERVAL_MS` (default: `30000`) — tick interval in milliseconds

**How it works:**
1. Every 30 seconds, `tickTimers()` iterates all agents in the DB
2. For each agent with `runtimeConfig.heartbeat.enabled = true` and `intervalSec > 0`:
   - Calculates elapsed time since `lastHeartbeatAt`
   - If elapsed >= `intervalSec`, calls `enqueueWakeup()` with `source: "timer"`
3. The wakeup spawns the agent's adapter (e.g., `claude-local`) as a child process
4. Agent reads its AGENTS.md instructions and works on assigned tasks

**Agent heartbeat config** (stored in `agents.runtimeConfig` JSONB):
```json
{
  "heartbeat": {
    "enabled": true,
    "intervalSec": 300,
    "wakeOnDemand": true,
    "maxConcurrentRuns": 1
  }
}
```

## Cron Services

All cron services use a 30-second tick interval with per-job mutual exclusion (`running` flag prevents concurrent runs). Each job now has an `ownerAgent` field for traceability.

| Service | File | Job Count | Owner Agent(s) |
|---------|------|-----------|----------------|
| Intel crons | `server/src/services/intel-crons.ts` | 8 | Echo |
| Content crons | `server/src/services/content-crons.ts` | 23 | Sage, Blaze, Cipher, Spark, Prism, Vanguard, Forge |
| Eval crons | `server/src/services/eval-crons.ts` | 1 | Nova |
| Alert crons | `server/src/services/alert-crons.ts` | 4 | Nova |
| Trend crons | `server/src/services/trend-crons.ts` | 1 | Echo |
| Maintenance crons | `server/src/services/maintenance-crons.ts` | 2 | Bridge |
| Auto-reply | `server/src/services/auto-reply.ts` | 1 | Core |
| Moltbook backend | `server/src/services/moltbook-crons.ts` | 5 | Moltbook |
| YouTube pipeline | `server/src/services/youtube/yt-crons.ts` | 5 | Core — Ollama scripts, Chatterbox TTS, Playwright slides, FFmpeg, YouTube API |

**Total: 49 system cron jobs across 9 services + 9 plugin jobs (Discord 2 + Twitter 4 + Moltbook 3) = 58 total**

> **Planned (not activated):** `content:canva-media:morning` and `content:canva-media:evening` owned by Sage — posts Canva designs as image tweets 2x/day once Canva OAuth is connected.

## Full Agent-to-Cron Mapping

### Echo (Data Engineer) — 9 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `intel:prices` | `0 * * * *` | intel-crons | Hourly price data ingestion |
| `intel:news` | `0 * * * *` | intel-crons | Hourly news article ingestion |
| `intel:twitter` | `*/30 * * * *` | intel-crons | Twitter/X data every 30 minutes |
| `intel:github` | `0 */4 * * *` | intel-crons | GitHub activity every 4 hours |
| `intel:reddit` | `0 */2 * * *` | intel-crons | Reddit discussions every 2 hours |
| `intel:chain-metrics` | `0 */4 * * *` | intel-crons | Mintscan Cosmos APR data every 4 hours |
| `intel:backfill` | `0 */12 * * *` | intel-crons | Sparse data catch-up twice daily |
| `intel:discover` | `0 */6 * * *` | intel-crons | Discover trending projects every 6 hours |
| `trends:scan` | `0 */6 * * *` | trend-crons | CoinGecko + HackerNews + Google Trends + Bing News trend signals every 6 hours |

### Sage (CMO) — 1 job (orchestrator)

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:seo-engine` | `3 7 * * *` | content-crons | Daily Claude-powered blog generation from trends |

Sage orchestrates the 4 content personality agents below.

### Blaze (Hot-Take Analyst) — 5 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:twitter` | `0 13,15,17,20 * * *` | content-crons | Hot-take tweets 4x daily |
| `content:twitter:auto-post` | `0 9,12,15,18,21 * * *` | content-crons | Auto-post tweets every 3hr during active hours |
| `content:video:trend` | `0 11,14,18 * * *` | content-crons | Trend video scripts 3x daily |
| `content:intel-alert:twitter` | `*/45 * * * *` | content-crons | Reactive tweets from hot intel signals |
| `content:retweet-cycle` | `0 */4 * * *` | content-crons | Retweet ecosystem accounts every 4 hours |

### Cipher (Technical Deep-Diver) — 2 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:blog` | `0 10 * * 2,4` | content-crons | Technical blog posts Tue/Thu |
| `content:reddit` | `0 15 * * *` | content-crons | Technical Reddit content daily |

### Spark (Community Builder) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:discord` | `0 10,16,21 * * *` | content-crons | Community Discord content 3x daily |
| `content:bluesky` | `0 14,17,20 * * *` | content-crons | Bluesky posts 3x daily |
| `content:intel-alert:bluesky` | `0 */2 * * *` | content-crons | Reactive Bluesky posts from hot intel |

### Prism (Trend Reporter) — 4 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:linkedin` | `0 14 * * 1-5` | content-crons | LinkedIn trend reports weekdays |
| `content:video:market` | `0 9 * * 1-5` | content-crons | Market recap video scripts weekdays |
| `content:video:weekly` | `0 10 * * 6` | content-crons | Weekly wrap-up video script Saturday |
| `content:tx-chain-daily` | `0 8 * * *` | content-crons | Daily TX chain metrics article → ShieldNest |

### Vanguard (XRP/Ripple Analyst) — 4 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:xrp:blog` | `0 9 * * 1,3,5` | content-crons | XRP analysis blog Mon/Wed/Fri → CD + tokns |
| `content:xrp:twitter` | `0 11,16,19 * * *` | content-crons | XRP insight tweets 3x daily |
| `content:xrp:linkedin` | `0 13 * * 2,4` | content-crons | XRP LinkedIn posts Tue/Thu |
| `content:xrp-alert:twitter` | `0 */3 * * *` | content-crons | Reactive XRP tweets from hot intel signals |

### Forge (AEO/Comparison Architect) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:comparison:blog` | `0 10 * * 3,6` | content-crons | TX vs L1 comparison blogs Wed/Sat → CD + tokns |
| `content:aeo:blog` | `0 11 * * 1,4` | content-crons | AEO-optimized blogs Mon/Thu → CD + tokns |
| `content:tokns-promo:blog` | `0 14 * * 2,5` | content-crons | tokns.fi feature spotlight blogs Tue/Fri → CD + tokns |

### Nova (CTO) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `eval:smoke` | `0 6 * * *` | eval-crons | Daily promptfoo eval suite |
| `alert:health-check` | `*/5 * * * *` | alert-crons | Readiness probe every 5 minutes |
| `alert:digest` | `0 7 * * *` | alert-crons | Daily server/eval digest email |

### Core (Backend Dev) — 1 job

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `auto-reply:poll` | configurable (default every 30 min) | auto-reply.ts | Single `search/recent` query covering all enabled account + keyword targets. Interval driven by `AutoReplyGlobalSettings.pollIntervalMinutes`, updated live via settings API. Dollar-budget tracked: $0.005/read, $0.01/write. |

### Bridge (Full-Stack Dev) — 2 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `maintenance:stale-content` | `0 3 * * *` | maintenance-crons | Reset stuck content items daily |
| `maintenance:health-check` | `0 */4 * * *` | maintenance-crons | System health probe every 4 hours |

### Moltbook (Social Presence Agent) — 5 backend jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `moltbook:ingest` | `0 */2 * * *` | moltbook-crons | Ingest Moltbook feed every 2 hours |
| `moltbook:post` | `0 */4 * * *` | moltbook-crons | Generate and post content every 4 hours |
| `moltbook:engage` | `0 */3 * * *` | moltbook-crons | Engage with feed content every 3 hours |
| `moltbook:heartbeat` | `*/30 * * * *` | moltbook-crons | Heartbeat check every 30 minutes |
| `moltbook:performance` | `0 0 * * *` | moltbook-crons | Daily performance stats aggregation |

### Bridge (YouTube Pipeline) — 5 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `yt:daily-production` | `0 6 * * *` | yt-crons | Full pipeline: strategy → script → SEO → thumbnail → TTS → slides → video → queue |
| `yt:publish-queue` | `*/15 * * * *` | yt-crons | Auto-upload due videos to YouTube via OAuth2 |
| `yt:daily-analytics` | `0 9 * * *` | yt-crons | Collect YouTube analytics (views, likes, CTR) |
| `yt:weekly-strategy` | `0 8 * * 0` | yt-crons | Analyze performance, adjust content pillars |
| `yt:optimization` | `0 22 * * *` | yt-crons | Ollama-powered optimization insights |

### Agents with No Cron Jobs

Atlas (CEO), River (PM), Pixel (Designer), Flux (Frontend Dev), Mermaid (Structure Agent) — work arrives via task assignment and heartbeat wakeups.

## Adding a New Cron Job

1. Pick the right service file based on domain (intel, content, eval, alert, trend)
2. Add the job definition with `ownerAgent` set to the responsible agent's name
3. Update the owner agent's `agents/{name}/AGENTS.md` with the new cron in the `## Cron Responsibilities` section
4. Update this document with the new job in the mapping table
5. If the job introduces a new service file, also update `server/src/app.ts` and `CLAUDE.md`

## Monitoring

All cron job log messages include `ownerAgent` in the structured payload, enabling filtering by responsible agent:

```
logger.info({ job: "intel:prices", ownerAgent: "echo" }, "Intel cron job starting")
```

Filter logs by agent: `grep ownerAgent.*echo` to see all Echo-owned job activity.

The `alert:health-check` job pings readiness every 5 minutes and sends SMTP alerts if the server is down. The `alert:digest` sends a daily email with eval results and server metrics when failures are detected.
