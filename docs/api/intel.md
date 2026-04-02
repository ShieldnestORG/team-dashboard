# Intel API

Blockchain company intelligence engine with vector-powered semantic search. Public read endpoints serve the free API consumed by coherencedaddy.com; write endpoints require an `INTEL_INGEST_KEY`.

## Public Endpoints (No Auth)

### Search Reports

```
GET /api/intel/search?q={query}&limit={n}&company={slug}
```

Semantic vector search across all intel reports using BGE-M3 embeddings.

| Param | Required | Default | Description |
|-------|----------|---------|-------------|
| `q` | Yes | — | Search query |
| `limit` | No | 10 | Max results (1-50) |
| `company` | No | — | Filter to company slug |

**Response:**
```json
{
  "results": [
    {
      "company_slug": "ethereum",
      "company_name": "Ethereum",
      "report_type": "news",
      "headline": "...",
      "body": "...",
      "source_url": "...",
      "captured_at": "2026-04-02T...",
      "similarity": 0.95
    }
  ],
  "query": "ethereum staking"
}
```

### Company Profile

```
GET /api/intel/company/{slug}
```

Returns company details + latest 5 reports per type + total report count.

### List Companies

```
GET /api/intel/companies
```

Returns all tracked companies ordered by name.

### Stats

```
GET /api/intel/stats
```

Returns total reports, breakdown by type, top companies, coverage stats.

## Protected Endpoints (Require `X-Intel-Key` header)

### Seed Companies

```
POST /api/intel/seed
```

Upserts all 115 tracked blockchain companies from static seed data.

### Ingest Endpoints

All ingest endpoints accept `?limit=N&offset=N` query params.

| Endpoint | Schedule | Source |
|----------|----------|--------|
| `POST /api/intel/ingest/prices` | Every 6h | CoinGecko `/coins/markets` |
| `POST /api/intel/ingest/news` | Every 4h | Company RSS/Atom feeds |
| `POST /api/intel/ingest/twitter` | Every 2h | Nitter instances + RSSHub |
| `POST /api/intel/ingest/github` | Every 8h | GitHub releases + commits |
| `POST /api/intel/ingest/reddit` | Every 6h | Reddit JSON API |

**Response (all ingest endpoints):**
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

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `EMBED_URL` | No | Embedding service URL (default: `http://31.220.61.12:8000`) |
| `EMBED_API_KEY` | No | Embedding service API key |
| `INTEL_INGEST_KEY` | Yes (for write) | Shared secret for ingest/seed endpoints |
| `GITHUB_TOKEN` | No | Increases GitHub API rate limit (60 -> 5000 req/hr) |

## Architecture

Ingestion runs on the VPS via standalone cron scheduler (tick-based, 30s interval). Coherencedaddy.com proxies `/api/intel/*` to the VPS via Vercel rewrites. The UI component (`BlockchainIntel.tsx`) remains in the coherencedaddy repo and calls the same API paths.

Vector search uses pgvector with `ivfflat` cosine index on 1024-dim BGE-M3 embeddings.
