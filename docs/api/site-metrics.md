---
title: Site Metrics
summary: Receive and query analytics from external properties
---

# Site Metrics API

External properties (coherencedaddy.com, tokns.fi, yourarchi.com, etc.) push analytics to the dashboard. Agents query these metrics to inform decisions about content, SEO/AEO, and growth.

## Authentication

Two auth methods are supported:

1. **Standard bearer token** — for agents and board users (same as other endpoints)
2. **Shared secret** — `X-Site-Metrics-Key` header, validated against `SITE_METRICS_KEY` env var on the server. Use this for external sites that don't have full dashboard auth.

## Ingest Metrics

```
POST /api/companies/:companyId/site-metrics/ingest
```

### Request Body

```json
{
  "siteId": "coherencedaddy.com",
  "metrics": {
    "pageViews": 1500,
    "uniqueVisitors": 420,
    "toolViews": [
      { "slug": "qr-code-generator", "views": 280 },
      { "slug": "color-palette", "views": 150 }
    ],
    "subscribers": 12,
    "directoryClicks": 85,
    "topReferrers": [
      { "source": "google.com", "count": 300 },
      { "source": "twitter.com", "count": 50 }
    ],
    "period": "daily",
    "timestamp": "2026-04-01T06:00:00Z"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `siteId` | string | Yes | Site identifier (e.g., `coherencedaddy.com`) |
| `metrics.pageViews` | number | No | Total page views in period |
| `metrics.uniqueVisitors` | number | No | Unique visitors in period |
| `metrics.toolViews` | array | No | Per-tool view counts |
| `metrics.subscribers` | number | No | Active subscriber count |
| `metrics.directoryClicks` | number | No | Directory click count |
| `metrics.topReferrers` | array | No | Top traffic sources |
| `metrics.period` | string | Yes | `hourly`, `daily`, or `weekly` |
| `metrics.timestamp` | string | Yes | ISO 8601 timestamp |

### Response

```json
{ "ok": true, "receivedAt": "2026-04-01T06:00:01.234Z" }
```

## Query Metrics

```
GET /api/companies/:companyId/site-metrics
```

### Query Parameters

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `siteId` | string | (all) | Filter by site |
| `period` | string | (all) | Filter by period (`hourly`, `daily`, `weekly`) |
| `limit` | number | 200 | Max entries returned (max 5000) |

### Response

```json
{
  "metrics": [
    {
      "siteId": "coherencedaddy.com",
      "metrics": { "pageViews": 1500, "period": "daily", "timestamp": "..." },
      "receivedAt": "2026-04-01T06:00:01.234Z"
    }
  ],
  "total": 42
}
```

Results are returned newest-first.

## Storage

Metrics are stored in JSON files at `~/.paperclip/instances/<id>/data/site-metrics/<companyId>.json`, with an in-memory cache for fast reads. Capped at 10,000 entries per company (oldest dropped when exceeded).

## Integration Architecture

```
coherencedaddy.com    tokns.fi    yourarchi.com
       │                  │              │
       └──── POST /site-metrics/ingest ──┘
                          │
                  Team Dashboard VPS
                  (31.220.61.12:3200)
                          │
              ┌───────────┴───────────┐
              │  Agents query via     │
              │  GET /site-metrics    │
              │  to inform decisions  │
              └───────────────────────┘
```
