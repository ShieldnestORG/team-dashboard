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
    "productRevenue": [
      {
        "source": "printify",
        "product_id": "69ffc2b259e22ced910c76ad",
        "product_title": "Emotionally Expensive Crop Tee",
        "units": 3,
        "gross_cents": 8700,
        "net_cents": 8447,
        "period_start": "2026-04-30T06:00:00Z",
        "period_end": "2026-05-01T06:00:00Z"
      },
      {
        "source": "reservation",
        "product_id": "69ed2bc348930bafe4041fd7",
        "product_title": "Ringer Tee - Retro Heart",
        "units": 12,
        "gross_cents": 4800,
        "net_cents": 4302,
        "period_start": "2026-04-30T06:00:00Z",
        "period_end": "2026-05-01T06:00:00Z"
      }
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
| `metrics.productRevenue` | array | No | Per-product revenue rows. Each row: `{ source: "printify" \| "woo" \| "reservation", product_id, product_title, units, gross_cents, net_cents, period_start, period_end }`. Coherencedaddy aggregates from `product_sales` (Printify + Woo sales) + `shop_reservations` ($4 deposit holds). `net_cents` for reservations subtracts an estimated Stripe fee (`gross * 0.029 + 30¢ × units`); for printify/woo it equals `gross_cents` since fee data isn't tracked at sale-record time. UI surface (per-product chart) is future work — field is currently accepted, validated, and stored verbatim. |
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
                  (31.220.61.14:3200)
                          │
              ┌───────────┴───────────┐
              │  Agents query via     │
              │  GET /site-metrics    │
              │  to inform decisions  │
              └───────────────────────┘
```
