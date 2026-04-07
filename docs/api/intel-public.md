# Public Intel API

All endpoints below are unauthenticated and intended for use by the public directory at coherencedaddy.com/directory.

**Base URL (production):** `https://31.220.61.12:3200/api/intel` (proxied via Vercel rewrites)

**Base URL (local dev):** `http://localhost:3100/api/intel`

---

## GET /api/intel/companies

List all tracked companies with pagination.

**Query Parameters:**

| Param       | Default | Description                                         |
|-------------|---------|-----------------------------------------------------|
| `directory` | --      | Filter by directory (`crypto`, `ai-ml`, `defi`, `devtools`) |
| `limit`     | 100     | Max results per page (1-500)                        |
| `offset`    | 0       | Number of results to skip                           |

**Response:**

```json
{
  "companies": [ { "slug": "bitcoin", "name": "Bitcoin", ... } ],
  "total": 508,
  "limit": 100,
  "offset": 0,
  "directory": "all"
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/companies?directory=crypto&limit=20&offset=0"
```

---

## GET /api/intel/company/:slug

Get a single company profile with the latest 5 reports per type (news, price, twitter, github, reddit) and total report count.

**Path Parameters:**

| Param  | Description               |
|--------|---------------------------|
| `slug` | Company slug (e.g. `bitcoin`, `ethereum`) |

**Response:**

```json
{
  "company": {
    "slug": "bitcoin",
    "name": "Bitcoin",
    "category": "l1-blockchain",
    "directory": "crypto",
    "description": "...",
    "website": "https://bitcoin.org",
    "coingecko_id": "bitcoin",
    "github_org": "bitcoin",
    "subreddit": "Bitcoin",
    "twitter_handle": "bitcoin",
    "rss_feeds": ["https://bitcoin.org/en/rss/releases.rss"]
  },
  "latest_reports": [ ... ],
  "report_count": 847
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/company/bitcoin"
```

---

## GET /api/intel/company/:slug/price-history

Time-series price data for charts on directory subpages.

**Path Parameters:**

| Param  | Description        |
|--------|--------------------|
| `slug` | Company slug       |

**Query Parameters:**

| Param   | Default | Allowed Values         |
|---------|---------|------------------------|
| `range` | `30d`   | `7d`, `30d`, `90d`, `1y` |

**Response:**

```json
{
  "slug": "bitcoin",
  "range": "30d",
  "prices": [
    {
      "timestamp": "2026-03-07T06:00:00.000Z",
      "price_usd": 67200.50,
      "market_cap_usd": 1320000000000,
      "volume_24h_usd": 28500000000,
      "price_change_24h_pct": 1.45
    }
  ]
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/company/ethereum/price-history?range=7d"
```

---

## GET /api/intel/company/:slug/news

Recent news articles for a company, sourced from RSS/Atom feeds.

**Path Parameters:**

| Param  | Description  |
|--------|--------------|
| `slug` | Company slug |

**Query Parameters:**

| Param   | Default | Max |
|---------|---------|-----|
| `limit` | 10      | 50  |

**Response:**

```json
{
  "slug": "ethereum",
  "news": [
    {
      "id": 4521,
      "headline": "Ethereum Foundation Announces Pectra Upgrade",
      "body": "...",
      "source_url": "https://blog.ethereum.org/2026/03/28/pectra-timeline",
      "captured_at": "2026-03-28T14:30:00.000Z"
    }
  ]
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/company/solana/news?limit=5"
```

---

## GET /api/intel/company/:slug/social

Recent Twitter/X mentions for a company.

**Path Parameters:**

| Param  | Description  |
|--------|--------------|
| `slug` | Company slug |

**Query Parameters:**

| Param   | Default | Max |
|---------|---------|-----|
| `limit` | 10      | 50  |

**Response:**

```json
{
  "slug": "cosmos",
  "social": [
    {
      "id": 3210,
      "headline": "@cosmos tweeted about IBC v2",
      "body": "...",
      "source_url": "https://nitter.net/cosmos/status/123456",
      "captured_at": "2026-04-01T10:00:00.000Z"
    }
  ]
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/company/cosmos/social?limit=20"
```

---

## GET /api/intel/company/:slug/related

Companies in the same directory, prioritizing same category. Useful for "Similar Projects" sections on directory subpages.

**Path Parameters:**

| Param  | Description  |
|--------|--------------|
| `slug` | Company slug |

**Query Parameters:**

| Param   | Default | Max |
|---------|---------|-----|
| `limit` | 10      | 20  |

**Response:**

```json
{
  "slug": "ethereum",
  "related": [
    {
      "slug": "solana",
      "name": "Solana",
      "category": "l1-blockchain",
      "directory": "crypto",
      "description": "...",
      "website": "https://solana.com",
      "twitter_handle": "solana"
    }
  ]
}
```

**Example:**

```bash
curl "http://localhost:3100/api/intel/company/ethereum/related?limit=5"
```

---

## GET /api/intel/search

Semantic vector search across all intelligence reports.

**Query Parameters:**

| Param     | Required | Default | Description                               |
|-----------|----------|---------|-------------------------------------------|
| `q`       | Yes      | --      | Search query (natural language)           |
| `limit`   | No       | 10      | Max results (1-50)                        |
| `company` | No       | --      | Filter to a specific company slug         |

**Example:**

```bash
curl "http://localhost:3100/api/intel/search?q=ethereum+staking&limit=5"
```

---

## GET /api/intel/stats

Aggregate pipeline statistics: total reports, per-type breakdowns, top companies, data freshness, source coverage, and per-directory stats.

**Example:**

```bash
curl "http://localhost:3100/api/intel/stats"
```

---

## GET /api/intel/chain/:network

Cosmos chain metrics from Mintscan (staking APR, validator data).

**Path Parameters:**

| Param     | Description                           |
|-----------|---------------------------------------|
| `network` | Chain name (`cosmos`, `osmosis`, `txhuman`) |

**Example:**

```bash
curl "http://localhost:3100/api/intel/chain/cosmos"
```

---

## GET /api/intel/feed

Activity feed of recent intelligence reports. Useful for Discord bots or external polling.

**Query Parameters:**

| Param   | Required | Default | Description                               |
|---------|----------|---------|-------------------------------------------|
| `since` | Yes      | --      | ISO timestamp — only reports after this   |
| `type`  | No       | --      | Comma-separated report types to filter    |
| `limit` | No       | 20      | Max results (1-50)                        |

**Example:**

```bash
curl "http://localhost:3100/api/intel/feed?since=2026-04-05T00:00:00Z&type=news,price&limit=10"
```

---

## Error Responses

All endpoints return errors in this shape:

```json
{ "error": "Human-readable error message" }
```

| Status | Meaning                    |
|--------|----------------------------|
| 400    | Invalid parameters         |
| 404    | Company not found          |
| 500    | Internal server error      |
