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
| Content crons | `server/src/services/content-crons.ts` | 12 | Sage, Blaze, Cipher, Spark, Prism |
| Eval crons | `server/src/services/eval-crons.ts` | 1 | Nova |
| Alert crons | `server/src/services/alert-crons.ts` | 2 | Nova |
| Trend crons | `server/src/services/trend-crons.ts` | 1 | Echo |
| Pulse crons | `server/src/services/pulse-crons.ts` | 7 | Echo |

**Total: 33 cron jobs across 6 services + 2 plugin jobs (Discord).**

## Full Agent-to-Cron Mapping

### Echo (Data Engineer) — 16 jobs

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
| `trends:scan` | `0 */6 * * *` | trend-crons | CoinGecko + HackerNews trend signals every 6 hours |
| `pulse:search` | `*/5 * * * *` | pulse-crons | X API social pulse search polling every 5 minutes |
| `pulse:sentiment` | `*/15 * * * *` | pulse-crons | Keyword-based sentiment scoring every 15 minutes |
| `pulse:aggregate-hour` | `5 * * * *` | pulse-crons | Hourly aggregation rollups |
| `pulse:aggregate-day` | `10 0 * * *` | pulse-crons | Daily aggregation rollups |
| `pulse:xrpl-bridge` | `*/10 * * * *` | pulse-crons | XRPL bridge mention tagging every 10 minutes |
| `pulse:spike-detect` | `*/15 * * * *` | pulse-crons | Volume spike detection + alerting every 15 minutes |
| `pulse:backfill` | `0 */12 * * *` | pulse-crons | Historical data backfill every 12 hours |

### Sage (CMO) — 1 job (orchestrator)

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:seo-engine` | `3 7 * * *` | content-crons | Daily Claude-powered blog generation from trends |

Sage orchestrates the 4 content personality agents below.

### Blaze (Hot-Take Analyst) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:twitter` | `0 13,15,17,20 * * *` | content-crons | Hot-take tweets 4x daily |
| `content:video:trend` | `0 11,14,18 * * *` | content-crons | Trend video scripts 3x daily |
| `content:intel-alert:twitter` | `*/45 * * * *` | content-crons | Reactive tweets from hot intel signals |

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

### Prism (Trend Reporter) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `content:linkedin` | `0 14 * * 1-5` | content-crons | LinkedIn trend reports weekdays |
| `content:video:market` | `0 9 * * 1-5` | content-crons | Market recap video scripts weekdays |
| `content:video:weekly` | `0 10 * * 6` | content-crons | Weekly wrap-up video script Saturday |

### Nova (CTO) — 3 jobs

| Job | Schedule | Service | Description |
|-----|----------|---------|-------------|
| `eval:smoke` | `0 6 * * *` | eval-crons | Daily promptfoo eval suite |
| `alert:health-check` | `*/5 * * * *` | alert-crons | Readiness probe every 5 minutes |
| `alert:digest` | `0 7 * * *` | alert-crons | Daily server/eval digest email |

### Agents with No Cron Jobs

Atlas (CEO), River (PM), Pixel (Designer), Core (Backend Dev), Flux (Frontend Dev), Bridge (Full-Stack Dev), Mermaid (Structure Agent) — work arrives via task assignment and heartbeat wakeups.

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
