# Social Pulse API

Real-time X/Twitter intelligence for the TX Blockchain ecosystem.

## Authenticated Endpoints (require board auth)

Base path: `/api/pulse`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/pulse/summary` | GET | 24h dashboard summary (total tweets, sentiment, topics, XRPL mentions) |
| `/pulse/tweets` | GET | Paginated tweet feed. Query: `topic`, `page`, `limit` |
| `/pulse/tweets/trending` | GET | Top engagement tweets. Query: `topic`, `limit` |
| `/pulse/aggregations` | GET | Time-series chart data. Query: `topic`, `period` (hour/day), `hours` |
| `/pulse/xrpl-bridge` | GET | XRPL bridge-specific statistics |
| `/pulse/topics` | GET | Per-topic breakdown with sentiment |
| `/pulse/spikes` | GET | Recent volume spike alerts |
| `/pulse/force-poll` | POST | Manual trigger to poll X API immediately |
| `/pulse/backfill` | POST | Trigger historical data backfill for gap-filling |
| `/pulse/stream-status` | GET | Filtered stream connection status (connected, uptime, tweetsPerMinute, lastHeartbeat) |

## Public Endpoints (no auth, CORS-gated)

Base path: `/api/public/pulse`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/public/pulse/summary` | GET | Compact summary for embeds |
| `/api/public/pulse/trending` | GET | Top tweets by topic |
| `/api/public/pulse/xrpl-bridge` | GET | Bridge analytics |
| `/api/public/pulse/chart` | GET | Chart datapoints |
| `/api/public/pulse/widget` | GET | Minimal payload for embed widgets |
| `/api/public/pulse/tokens` | GET | Static TX ecosystem token list |

### CORS Whitelist
- tokns.fi, app.tokns.fi
- shieldnest.io
- coherencedaddy.com, freetools.coherencedaddy.com
- localhost:5173, localhost:3000, localhost:3008

### Caching
All public endpoints return `Cache-Control: public, max-age=300` (5 minutes).

## Filtered Stream (Real-time Ingestion)

When `BEARER_TOKEN` is set, the server starts an X API v2 filtered stream (`/2/tweets/search/stream`) on boot. This provides near-instant tweet ingestion instead of 5-minute polling intervals.

**Behavior:**
- Stream filter rules are auto-synced with the 4 pulse topics (tx, cosmos, xrpl-bridge, tokns)
- Heartbeat monitoring: X API sends heartbeats every 20s; disconnect detected if nothing received in 30s
- Auto-reconnect with exponential backoff (1s → 2s → 4s → ... → 5min cap)
- After 5 failed reconnect attempts, falls back to `pulse:search` polling cron
- Both stream and polling paths share the same `ingestTweet()` function — data flows into the same tables

**Key files:**
- `server/src/services/filtered-stream-client.ts` — stream connection, rule CRUD, event emitter
- `server/src/services/stream-rule-manager.ts` — syncs rules with PULSE_QUERIES
- `server/src/services/stream-connection-manager.ts` — lifecycle manager (start, stop, health, fallback)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `BEARER_TOKEN` | Optional | X API v2 bearer token. Social Pulse + filtered stream disabled if not set. |

## Cron Jobs (7 total, owner: Echo)

| Job | Schedule | Description |
|-----|----------|-------------|
| `pulse:search` | `*/5 * * * *` | Poll X API for new tweets |
| `pulse:sentiment` | `*/15 * * * *` | Score unscored tweets (computed per-topic sentiment, not hardcoded) |
| `pulse:aggregate-hour` | `5 * * * *` | Compute hourly rollups |
| `pulse:aggregate-day` | `10 0 * * *` | Compute daily rollups |
| `pulse:xrpl-bridge` | `*/10 * * * *` | Tag bridge mentions with direction/token/staking |
| `pulse:spike-detect` | `*/15 * * * *` | Detect >2x volume anomalies |
| `pulse:backfill` | `0 */12 * * *` | Historical data backfill for gaps |

## Topics Tracked

| Topic | Search Keywords |
|-------|----------------|
| `tx` | TX blockchain, TX chain, tx.org, tokns.fi, @txEcosystem, @txDevHub |
| `cosmos` | Cosmos SDK, $ATOM, IBC transfer, interchain, #CosmosSDK |
| `xrpl-bridge` | XRPL bridge, XRP on Cosmos, XRP IBC, XRPL to TX, XRP staking Cosmos |
| `tokns` | tokns.fi, tokns validator, tokns staking, tokns NFT |

## Database Tables

- `pulse_tweets` — Individual tweets with metrics and sentiment scores
- `pulse_aggregations` — Hourly/daily rollup statistics per topic
- `pulse_xrpl_bridge_mentions` — XRPL bridge-specific mention tagging
