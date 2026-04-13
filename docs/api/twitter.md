# Twitter/X API

Internal API endpoints for X/Twitter automation, OAuth, analytics, and the Chrome extension bot.

## Authentication

All endpoints require board-level authentication (session cookie) unless noted otherwise.

---

## OAuth Endpoints (`/api/x/oauth`)

### `GET /authorize`
Initiates X OAuth 2.0 + PKCE flow. Redirects user to X consent screen.

### `GET /callback`
Handles OAuth callback from X. Exchanges authorization code for access/refresh tokens and stores them in `x_oauth_tokens`.

### `GET /status`
Returns current OAuth connection status and token validity.

**Response:**
```json
{ "connected": true, "username": "handle", "userId": "123" }
```

### `POST /revoke`
Disconnects X account by revoking tokens.

### `GET /rate-limits`
Returns current X API v2 rate limit status across all tracked endpoints.

### `POST /rate-limits/multiplier`
Adjusts the rate limit safety multiplier (0.1-1.0). Lower values use a smaller fraction of official API limits.

**Body:** `{ "multiplier": 0.5 }`

---

## Analytics Endpoints (`/api/x/analytics`)

### `GET /rate-limits`
Returns rate limit status from the server-side rate limiter (daily budgets, per-endpoint limits, panic mode).

**Response:**
```json
{
  "endpoints": { ... },
  "dailyBudget": {
    "posts": { "used": 5, "limit": 50 },
    "likes": { "used": 12, "limit": 40 },
    "follows": { "used": 3, "limit": 15 },
    "replies": { "used": 1, "limit": 20 }
  },
  "multiplier": 0.5,
  "panicMode": false
}
```

### `GET /engagement?days=7`
Returns engagement analytics (likes, follows, replies, reposts) grouped by day and action type.

**Query params:** `days` (1-90, default 7)

**Response:**
```json
{
  "daily": [{ "date": "2026-04-07", "action": "like", "count": 12 }],
  "totals": [{ "action": "like", "count": 45, "success_count": 43 }],
  "topTargets": [{ "username": "handle", "engagement_count": 8, "actions": ["like", "follow"] }],
  "days": 7
}
```

### `GET /posting?days=7`
Returns posting analytics with daily counts, recent posts (with impression/engagement metrics), and aggregate stats.

**Query params:** `days` (1-90, default 7)

**Response:**
```json
{
  "daily": [{ "date": "2026-04-07", "count": 3 }],
  "recentPosts": [{
    "tweet_id": "...",
    "tweet_text": "...",
    "posted_at": "...",
    "like_count": 5,
    "retweet_count": 2,
    "reply_count": 1,
    "impression_count": 450,
    "quote_count": 0
  }],
  "stats": {
    "total": 15,
    "with_impressions": 12,
    "total_likes": 45,
    "total_retweets": 8,
    "total_replies": 3,
    "total_impressions": 2500
  },
  "days": 7
}
```

### `GET /connection`
Returns OAuth connection status from `x_oauth_tokens` table.

**Response:**
```json
{
  "connected": true,
  "username": "handle",
  "userId": "123",
  "expiresAt": "2026-05-07T...",
  "connectedAt": "2026-04-01T..."
}
```

### `GET /recent-posts?since=<ISO>&limit=10`
Returns recent posts since a given timestamp. Used by the Discord bot for cross-posting.

**Query params:**
- `since` (required, ISO timestamp)
- `limit` (1-30, default 10)

---

## Twitter Plugin (`coherencedaddy.twitter`)

The Twitter plugin provides 13 agent-callable tools and 4 scheduled jobs for tweet queuing, engagement automation, and analytics. See the plugin dashboard at `/twitter` in the UI.

### Plugin Tools (via `/api/plugins/tools/execute`)

| Tool | Description |
|------|-------------|
| `queue-post` | Queue a tweet (max 280 chars, up to 4 media URLs) |
| `queue-reply` | Queue a reply to a specific tweet URL |
| `queue-repost` | Queue a repost/retweet |
| `queue-thread` | Queue a multi-tweet thread (max 25 tweets) |
| `create-mission` | Define multi-step engagement mission |
| `add-target` | Add account to engagement target list |
| `remove-target` | Remove engagement target |
| `list-targets` | Query targets by status/venture |
| `query-extracts` | Search extracted tweet/profile data |
| `get-queue-status` | Check queue depth + X API connection status |
| `get-analytics` | Retrieve posting/engagement stats over time window |
| `get-bot-config` | Returns anti-bot settings + rate limit status |
| `get-media-drops` | Fetch available media from content API |

### Plugin Jobs

| Job | Schedule | Description |
|-----|----------|-------------|
| `post-dispatcher` | Every 2 min | Process tweet queue via X API v2 |
| `engagement-cycle` | Every 5 min | Execute engagement actions on targets |
| `queue-cleanup` | Every 6 hr | Archive old queue items (>7 days) |
| `analytics-rollup` | Daily midnight | Aggregate daily stats |

