# Trends & SEO Engine API

Trend scanning and automated blog generation for the Coherence Daddy content pipeline.

## How It Works

1. **Trend Scanner** (`trend-scanner.ts`) polls 4 sources every 6 hours:
   - **CoinGecko** — crypto price movers (>5% 24h change)
   - **HackerNews** — top tech stories (categorized: AI/ML, Crypto, Programming)
   - **Google Trends RSS** — trending search keywords (filtered for crypto/tech/AI relevance)
   - **Bing News API** — news headlines (env-var gated via `BING_NEWS_KEY`)

2. **SEO Engine** (`seo-engine.ts`) picks the best signal via priority chain:
   - Priority 1: Crypto mover with >15% change
   - Priority 2: Google Trends keyword with high traffic matching crypto/AI
   - Priority 3: AI/ML story with >200 HN score
   - Priority 4: Bing News headline matching crypto/AI
   - Priority 5: Any crypto mover
   - Priority 6: Any tech trend

3. **Blog Generation** — Claude generates a blog post with internal tool links
4. **Publishing** — auto-publishes to coherencedaddy.com blog API
5. **IndexNow** — pings search indexers for immediate crawling

## Endpoints

Base path: `/api/trends`

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/trends/signals` | GET | None | Returns latest cached trend signals |
| `/api/trends/scan` | POST | `CONTENT_API_KEY` | Force fresh scan of all 4 sources |
| `/api/trends/generate` | POST | `CONTENT_API_KEY` | Force SEO engine run (pick signal, generate, publish) |

### Authentication

Protected endpoints require either:
- Header: `Authorization: Bearer <CONTENT_API_KEY>`
- Header: `x-content-key: <CONTENT_API_KEY>`

### Response: GET /api/trends/signals

```json
{
  "signals": {
    "timestamp": "2026-04-07T00:00:00.000Z",
    "crypto_movers": [
      { "coin": "bitcoin", "change_24h": 5.2, "price": 68000, "volume": 28000000000 }
    ],
    "trending_tech": [
      { "title": "...", "score": 450, "category": "AI/ML", "url": "...", "comments": 200 }
    ],
    "google_trends": [
      { "keyword": "...", "traffic": "100K+", "related": ["..."], "region": "US" }
    ],
    "bing_news": [
      { "title": "...", "url": "...", "description": "...", "provider": "...", "category": "crypto", "datePublished": "..." }
    ]
  }
}
```

## Cron Jobs

| Job | Schedule | Owner | Description |
|-----|----------|-------|-------------|
| `trends:scan` | `0 */6 * * *` | Echo | Scan all 4 trend sources |
| `content:seo-engine` | `3 7 * * *` | Sage | Daily blog generation from latest signals |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTENT_API_KEY` | Yes | Auth for scan/generate endpoints |
| `CD_BLOG_API_KEY` | Yes | Bearer token for coherencedaddy blog publish |
| `CD_BLOG_API_URL` | Optional | Blog endpoint (default: `https://coherencedaddy.com/api/blog/posts`) |
| `INDEXNOW_KEY` | Optional | IndexNow verification key for search engine ping |
| `BING_NEWS_KEY` | Optional | Bing News Search API v7 key (trend scanner works without it) |
