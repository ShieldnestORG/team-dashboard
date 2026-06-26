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
| `/api/trends/today` | GET | None | Latest **approved** "what's hot" digest (pending never exposed) |
| `/api/trends/digest/build` | POST | `CONTENT_API_KEY` | Build a fresh **pending** digest |
| `/api/trends/digest/pending` | GET | `CONTENT_API_KEY` | Review the pending digest |
| `/api/trends/digest/:date/approve` | POST | `CONTENT_API_KEY` | Rule-7 human approval gate |
| `/api/trends/digest/:date/reject` | POST | `CONTENT_API_KEY` | Discard a bad pending run |
| `/api/trends/digest/:date/send` | POST | `CONTENT_API_KEY` | Blast an **approved** digest to the founding list |

> The "what's hot" digest endpoints implement the hardened
> [anti-hallucination method](../specs/trends-anti-hallucination-method.md):
> numbers are code-inserted from fetched fields, prose is grounded + citation-checked,
> verdicts are computed, and a digest is `pending` until a human approves it.

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
| `trends:digest:build` | `0 7 * * 1,4` | Echo | Build a **pending** what's-hot digest (Mon + Thu) — never auto-sends |
| `trends:digest:bonus` | `0 7 * * 3` | Echo | Community-unlocked bonus digest (Wed), only if engagement clears the threshold |

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTENT_API_KEY` | Yes | Auth for scan/generate endpoints |
| `CD_BLOG_API_KEY` | Yes | Bearer token for coherencedaddy blog publish |
| `CD_BLOG_API_URL` | Optional | Blog endpoint (default: `https://coherencedaddy.com/api/blog/posts`) |
| `INDEXNOW_KEY` | Optional | IndexNow verification key for search engine ping |
| `BING_NEWS_KEY` | Optional | Bing News Search API v7 key (trend scanner works without it) |
| `ANTHROPIC_API_KEY` | Optional | Haiku prose fallback + citation judge for the digest (absent → Ollama prose, judge fail-soft) |
| `SERPER_API_KEY` | Optional | SERP saturation enrichment for the digest (absent → scorer degrades gracefully) |
| `WATCHTOWER_CALLBACK_KEY` | Optional | HMAC secret for the signed digest email envelope to the storefront |
| `WHATS_HOT_EMAIL_CALLBACK_URL` | Optional | Storefront digest-email receiver (default: apex `/api/email/whats-hot`) |
| `WHATS_HOT_BONUS_VOTE_THRESHOLD` | Optional | Community engagement needed to unlock the Wed bonus run (default 10) |
