# Intel API -- Blockchain Directory

## Overview

Public API for querying blockchain project intelligence. Powers [directory.coherencedaddy.com](https://directory.coherencedaddy.com). The Intel Engine tracks 114 blockchain companies across 12 categories, ingesting data from five sources (CoinGecko, RSS/Atom feeds, Nitter/RSSHub, GitHub, Reddit) on automated cron schedules.

Read endpoints are fully public with no authentication. Write endpoints (seed and ingest) require the `X-Intel-Key` header.

**Base URL (production):** `https://directory.coherencedaddy.com/api/intel`

**Base URL (local dev):** `http://localhost:3100/api/intel`

---

## Public Endpoints

### GET /api/intel/companies

List all tracked blockchain companies, ordered alphabetically by name.

**Authentication:** None

**Query Parameters:** None

**Response:**

```typescript
interface CompaniesResponse {
  companies: IntelCompany[];
}

interface IntelCompany {
  slug: string;
  name: string;
  category: string;
  description: string;
  website: string;
  coingecko_id: string | null;
  github_org: string | null;
  subreddit: string | null;
  twitter_handle: string | null;
  rss_feeds: string[];
  created_at: string;
  updated_at: string;
}
```

**Example Response:**

```json
{
  "companies": [
    {
      "slug": "bitcoin",
      "name": "Bitcoin",
      "category": "l1-blockchain",
      "description": "The original decentralized cryptocurrency...",
      "website": "https://bitcoin.org",
      "coingecko_id": "bitcoin",
      "github_org": "bitcoin",
      "subreddit": "Bitcoin",
      "twitter_handle": "bitcoin",
      "rss_feeds": [
        "https://bitcoin.org/en/rss/releases.rss",
        "https://feeds.feedburner.com/BitcoinMagazine"
      ],
      "created_at": "2026-03-15T00:00:00.000Z",
      "updated_at": "2026-03-15T00:00:00.000Z"
    }
  ]
}
```

**Error Response:**

```json
{ "error": "Failed to list companies" }
```

---

### GET /api/intel/company/:slug

Get a company profile including the latest 5 reports per type (news, price, twitter, github, reddit) and total report count.

**Authentication:** None

**Path Parameters:**

| Param  | Type   | Description               |
|--------|--------|---------------------------|
| `slug` | string | Company slug (e.g. `ethereum`, `solana`) |

**Response:**

```typescript
interface CompanyResponse {
  company: IntelCompany;
  latest_reports: IntelReport[];
  report_count: number;
}

interface IntelReport {
  id: number;
  company_slug: string;
  report_type: "news" | "price" | "twitter" | "github" | "reddit";
  headline: string;
  body: string;
  source_url: string | null;
  captured_at: string;
}
```

**Example Response:**

```json
{
  "company": {
    "slug": "ethereum",
    "name": "Ethereum",
    "category": "l1-blockchain",
    "description": "The leading smart contract platform...",
    "website": "https://ethereum.org",
    "coingecko_id": "ethereum",
    "github_org": "ethereum",
    "subreddit": "ethereum",
    "twitter_handle": "ethereum",
    "rss_feeds": ["https://blog.ethereum.org/feed.xml"]
  },
  "latest_reports": [
    {
      "id": 4521,
      "company_slug": "ethereum",
      "report_type": "news",
      "headline": "Ethereum Foundation Announces Pectra Upgrade Timeline",
      "body": "The Ethereum Foundation published details on the upcoming Pectra upgrade...",
      "source_url": "https://blog.ethereum.org/2026/03/28/pectra-timeline",
      "captured_at": "2026-03-28T14:30:00.000Z"
    },
    {
      "id": 4519,
      "company_slug": "ethereum",
      "report_type": "price",
      "headline": "Ethereum price snapshot",
      "body": "$3,245.67 | Market cap: $390.2B | 24h change: +2.4% | Volume: $12.8B",
      "source_url": null,
      "captured_at": "2026-03-28T12:00:00.000Z"
    }
  ],
  "report_count": 847
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 404    | `{ "error": "Company not found" }` |
| 500    | `{ "error": "Failed to fetch company data" }` |

---

### GET /api/intel/search

Semantic vector search across all intelligence reports using BGE-M3 embeddings and cosine similarity.

**Authentication:** None

**Query Parameters:**

| Param     | Required | Default | Description                            |
|-----------|----------|---------|----------------------------------------|
| `q`       | Yes      | --      | Search query (natural language)        |
| `limit`   | No       | 10      | Max results, clamped to 1-50           |
| `company` | No       | --      | Filter results to a specific company slug |

**Response:**

```typescript
interface SearchResponse {
  results: SearchResult[];
  query: string;
}

interface SearchResult {
  company_slug: string;
  company_name: string;
  report_type: "news" | "price" | "twitter" | "github" | "reddit";
  headline: string;
  body: string;
  source_url: string | null;
  captured_at: string;
  similarity: number; // 0.00 to 1.00, rounded to 2 decimal places
}
```

**Example Request:**

```
GET /api/intel/search?q=ethereum%20staking%20rewards&limit=5&company=ethereum
```

**Example Response:**

```json
{
  "results": [
    {
      "company_slug": "ethereum",
      "company_name": "Ethereum",
      "report_type": "news",
      "headline": "Ethereum Staking Yields Rise After Pectra Upgrade",
      "body": "Post-Pectra staking yields have increased to 4.2% APR...",
      "source_url": "https://blog.ethereum.org/2026/03/25/staking-update",
      "captured_at": "2026-03-25T08:00:00.000Z",
      "similarity": 0.94
    },
    {
      "company_slug": "ethereum",
      "company_name": "Ethereum",
      "report_type": "reddit",
      "headline": "Discussion: Best staking strategies post-merge",
      "body": "What are you all doing with your ETH staking...",
      "source_url": "https://reddit.com/r/ethereum/comments/abc123",
      "captured_at": "2026-03-24T16:00:00.000Z",
      "similarity": 0.87
    }
  ],
  "query": "ethereum staking rewards"
}
```

**Notes:**
- An empty `q` parameter returns `{ "results": [] }` immediately without hitting the embedding service.
- Results are ordered by cosine similarity (highest first).
- Only reports with computed embeddings are included in search results.

**Error Response:**

```json
{ "results": [], "error": "Search unavailable" }
```

---

### GET /api/intel/stats

Pipeline statistics including total report counts, per-type breakdowns, top companies by volume, data freshness timestamps, and source coverage metrics.

**Authentication:** None

**Query Parameters:** None

**Response:**

```typescript
interface StatsResponse {
  total_reports: number;
  reports_last_24h: number;
  by_type: Record<string, number>;
  last_ingested: Record<string, string>; // report_type -> ISO timestamp
  top_companies: {
    slug: string;
    name: string;
    count: number;
  }[];
  coverage: {
    total_companies: number;
    companies_with_data: number;
    sources: {
      twitter: number;
      github: number;
      reddit: number;
      rss: number;
      coingecko: number;
    };
  };
}
```

**Example Response:**

```json
{
  "total_reports": 12483,
  "reports_last_24h": 347,
  "by_type": {
    "price": 5120,
    "news": 3200,
    "twitter": 2100,
    "github": 1200,
    "reddit": 863
  },
  "last_ingested": {
    "price": "2026-04-03T06:00:00.000Z",
    "news": "2026-04-03T04:00:00.000Z",
    "twitter": "2026-04-03T02:00:00.000Z",
    "github": "2026-04-02T16:00:00.000Z",
    "reddit": "2026-04-02T18:00:00.000Z"
  },
  "top_companies": [
    { "slug": "ethereum", "name": "Ethereum", "count": 1247 },
    { "slug": "bitcoin", "name": "Bitcoin", "count": 1183 },
    { "slug": "solana", "name": "Solana", "count": 892 }
  ],
  "coverage": {
    "total_companies": 114,
    "companies_with_data": 108,
    "sources": {
      "twitter": 98,
      "github": 87,
      "reddit": 72,
      "rss": 95,
      "coingecko": 110
    }
  }
}
```

**Error Response:**

```json
{ "error": "Stats unavailable" }
```

---

## Protected Endpoints

All protected endpoints require the `X-Intel-Key` header (or `Authorization: Bearer <key>`) matching the server's `INTEL_INGEST_KEY` environment variable.

**Authentication Errors:**

| Status | Body | Cause |
|--------|------|-------|
| 401    | `{ "error": "Invalid or missing intel ingest key" }` | Key missing or incorrect |
| 503    | `{ "error": "Intel ingest key not configured" }` | Server has no `INTEL_INGEST_KEY` set |

---

### POST /api/intel/seed

Upsert all 114 tracked blockchain companies from the static seed data. Uses `ON CONFLICT (slug) DO UPDATE` so it is safe to run repeatedly.

**Authentication:** `X-Intel-Key` required

**Request Body:** None

**Response:**

```typescript
interface SeedResponse {
  success: boolean;
  message: string;
  count: number;
}
```

**Example Response:**

```json
{
  "success": true,
  "message": "Seeded 114 companies",
  "count": 114
}
```

---

### POST /api/intel/ingest/prices

Ingest price snapshots from the CoinGecko `/coins/markets` API. Creates a report per company with current price, market cap, 24h change, and volume.

**Authentication:** `X-Intel-Key` required

**Query Parameters:**

| Param    | Default | Description                  |
|----------|---------|------------------------------|
| `limit`  | 90      | Number of companies to process |
| `offset` | 0       | Starting offset for pagination |

**Source:** CoinGecko API (`https://api.coingecko.com/api/v3/coins/markets`)

**Cron Schedule:** Every 6 hours (`0 */6 * * *`)

---

### POST /api/intel/ingest/news

Ingest news articles from company RSS and Atom feeds. Parses feed XML, deduplicates by source URL, and stores articles from the last 7 days.

**Authentication:** `X-Intel-Key` required

**Query Parameters:**

| Param    | Default | Description                  |
|----------|---------|------------------------------|
| `limit`  | 30      | Number of companies to process |
| `offset` | 0       | Starting offset for pagination |

**Source:** RSS/Atom feeds configured per company (see `rss_feeds` field)

**Cron Schedule:** Every 4 hours (`0 */4 * * *`)

---

### POST /api/intel/ingest/twitter

Ingest tweets from company Twitter accounts via Nitter instances and RSSHub fallback. Rotates through multiple Nitter mirrors for resilience.

**Authentication:** `X-Intel-Key` required

**Query Parameters:**

| Param    | Default | Description                  |
|----------|---------|------------------------------|
| `limit`  | 20      | Number of companies to process |
| `offset` | 0       | Starting offset for pagination |

**Source:** Nitter RSS mirrors (privacydev.net, poast.org, 1d4.us, tiekoetter.com, nl) with RSSHub fallback

**Cron Schedule:** Every 2 hours (`0 */2 * * *`)

---

### POST /api/intel/ingest/github

Ingest GitHub releases and recent commits for companies with a configured `github_org`. Filters out drafts and prereleases. Commits are limited to the last 30 days.

**Authentication:** `X-Intel-Key` required

**Query Parameters:**

| Param    | Default | Description                  |
|----------|---------|------------------------------|
| `limit`  | 15      | Number of companies to process |
| `offset` | 0       | Starting offset for pagination |

**Source:** GitHub REST API (`api.github.com`) -- releases and commits endpoints

**Cron Schedule:** Every 8 hours (`0 */8 * * *`)

---

### POST /api/intel/ingest/reddit

Ingest top posts from company subreddits via the Reddit JSON API. Captures posts from the last 7 days with their scores and comment counts.

**Authentication:** `X-Intel-Key` required

**Query Parameters:**

| Param    | Default | Description                  |
|----------|---------|------------------------------|
| `limit`  | 20      | Number of companies to process |
| `offset` | 0       | Starting offset for pagination |

**Source:** Reddit JSON API (`https://www.reddit.com/r/{subreddit}/hot.json`)

**Cron Schedule:** Every 6 hours (`0 */6 * * *`)

---

### Ingest Response Shape (All Ingest Endpoints)

All five ingest endpoints return the same response structure:

```typescript
interface IngestResponse {
  success: boolean;
  processed: number;  // Reports successfully stored
  skipped: number;    // Duplicates or filtered items
  errors: string[];   // Per-company error messages
  offset: number;     // Requested offset
  limit: number;      // Requested limit
  total: number;      // Total companies processed in this batch
  next_offset: number; // Offset for the next batch (offset + limit)
}
```

**Example Response:**

```json
{
  "success": true,
  "processed": 42,
  "skipped": 8,
  "errors": [],
  "offset": 0,
  "limit": 90,
  "total": 88,
  "next_offset": 90
}
```

**Pagination:** For large batches, call the endpoint repeatedly with `offset` and `limit` until `total < limit`, indicating all companies have been processed.

---

## Categories

The 114 tracked companies are organized into 12 categories:

| Category            | Slug                | Examples                          |
|---------------------|---------------------|-----------------------------------|
| Layer 1 Blockchain  | `l1-blockchain`     | Bitcoin, Ethereum, Solana, Cardano |
| Layer 2 Blockchain  | `l2-blockchain`     | Arbitrum, Optimism, Polygon, Base |
| Cosmos Ecosystem    | `cosmos-ecosystem`  | Cosmos Hub, Osmosis, Injective    |
| DeFi                | `defi`              | Uniswap, Aave, MakerDAO, Lido    |
| Infrastructure      | `infrastructure`    | Chainlink, The Graph, Alchemy     |
| Exchange            | `exchange`          | Coinbase, Binance, Kraken         |
| Wallet              | `wallet`            | MetaMask, Phantom, Ledger         |
| NFT                 | `nft`               | OpenSea, Blur, Yuga Labs          |
| Payments            | `payments`          | XRPL/Ripple, Stellar, Lightning   |
| Enterprise          | `enterprise`        | Hyperledger, R3, Hedera           |
| Data                | `data`              | Chainalysis, Dune, Messari        |
| DAO                 | `dao`               | Nouns, Aragon                     |

---

## Data Sources and Refresh Rates

| Source    | Report Type | Schedule     | Cron Expression  | Data Window |
|-----------|-------------|--------------|------------------|-------------|
| CoinGecko | `price`    | Every 6 hours | `0 */6 * * *`  | Current snapshot |
| RSS/Atom  | `news`     | Every 4 hours | `0 */4 * * *`  | Last 7 days  |
| Nitter    | `twitter`  | Every 2 hours | `0 */2 * * *`  | Recent tweets |
| GitHub    | `github`   | Every 8 hours | `0 */8 * * *`  | Last 30 days |
| Reddit    | `reddit`   | Every 6 hours | `0 */6 * * *`  | Last 7 days  |

The cron scheduler runs on the VPS with a 30-second tick interval. Jobs do not overlap -- if a previous run is still executing, the next tick is skipped for that job.

---

## Vector Search Architecture

The search endpoint uses semantic vector search powered by BGE-M3 embeddings and pgvector.

**Embedding Model:** BGE-M3 (BAAI/bge-m3), producing 1024-dimensional dense vectors.

**Embedding Service:** Self-hosted at `31.220.61.12:8000`. Accepts `POST /embed` with a JSON body `{ "texts": ["..."] }` and returns `{ "dense": [[...]] }`.

**Storage:** Embeddings are stored in the `intel_reports.embedding` column as pgvector `vector(1024)` type, indexed with an IVFFlat index using cosine distance.

**Search Flow:**

1. The query string is sent to the embedding service to produce a 1024-dim vector.
2. pgvector computes cosine distance (`<=>` operator) between the query vector and all report embeddings.
3. Results are ranked by similarity (1 - cosine distance), with higher values indicating stronger matches.
4. The similarity score is rounded to 2 decimal places in the response.
5. Only reports with non-null embeddings are included in results.

**Optional company filter:** When the `company` query parameter is provided, results are restricted to that company's reports before ranking.

---

## Environment Variables

| Variable          | Required         | Default                        | Description                                    |
|-------------------|------------------|--------------------------------|------------------------------------------------|
| `INTEL_INGEST_KEY`| Yes (for writes) | --                             | Shared secret for seed and ingest endpoints    |
| `EMBED_URL`       | No               | `http://31.220.61.12:8000`     | BGE-M3 embedding service URL                   |
| `EMBED_API_KEY`   | No               | --                             | API key for the embedding service (X-API-Key header) |
| `GITHUB_TOKEN`    | No               | --                             | GitHub PAT; increases rate limit from 60 to 5000 req/hr |

---

## Architecture

```
coherencedaddy.com         Vercel rewrites          VPS (31.220.61.12)
/api/intel/*          -->  vercel.json proxy   -->  Express.js :3200
                                                      |
                                                      +--> PostgreSQL (Neon)
                                                      |      intel_companies table
                                                      |      intel_reports table (pgvector)
                                                      |
                                                      +--> Embedding Service :8000
                                                             BGE-M3 (1024-dim)
```

- **Ingestion** runs on the VPS via a standalone tick-based cron scheduler (30-second interval).
- **Coherencedaddy.com** proxies all `/api/intel/*` requests to the VPS backend through Vercel rewrites.
- **Vector index** uses pgvector IVFFlat with cosine distance on the 1024-dimensional embedding column.
- **Deduplication** is handled via source URL uniqueness constraints on report inserts. Price snapshots use null source URLs to avoid constraint conflicts.

---

## Rate Limits

Public read endpoints have no rate limiting at the application level. Abuse protection is handled upstream by Vercel's edge network and VPS-level firewall rules.

Protected ingest endpoints are gated by the `X-Intel-Key` and are not exposed publicly.
