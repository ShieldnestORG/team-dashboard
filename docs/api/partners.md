# AEO Partner Network API

## Overview

Internal API for managing the AEO Partner Network -- referral partners, service providers, and affiliates within the Coherence Daddy ecosystem. Partners are tracked with click metrics, content mentions, and individual dashboard access via token-authenticated endpoints.

Authenticated endpoints require board-level session authentication. The public redirect endpoint (`/api/go`) requires no authentication and is designed for embedding in content and marketing materials.

**Base URL (production):** `https://31.220.61.12:3200/api/partners`

**Base URL (local dev):** `http://localhost:3100/api/partners`

---

## Partner Object

```typescript
interface Partner {
  id: string;                          // UUID
  companyId: string;                   // UUID — owning company
  slug: string;                        // URL-safe identifier
  name: string;
  industry: string;
  location: string | null;
  website: string | null;
  description: string | null;
  services: string[];                  // e.g. ["consulting", "development"]
  socialHandles: Record<string, string>; // e.g. { twitter: "handle" }
  contactName: string | null;
  contactEmail: string | null;
  tier: "proof" | "partner" | "premium";
  status: "trial" | "active" | "paused" | "churned";
  monthlyFee: number | null;          // cents
  referralFeePerClient: number | null; // cents
  contentMentions: number;             // count of content items mentioning this partner
  totalClicks: number;                 // lifetime redirect clicks
  dashboardToken: string | null;       // token for partner self-service dashboard
  partnerSince: string;                // ISO 8601 timestamp
  createdAt: string;                   // ISO 8601 timestamp
  updatedAt: string;                   // ISO 8601 timestamp

  // Phase 2: Business profile
  address: string | null;
  phone: string | null;
  hours: Record<string, string> | null;
  logoUrl: string | null;
  brandColors: { primary: string; secondary: string; accent: string } | null;
  targetKeywords: string[] | null;
  targetAudience: string | null;

  // Phase 2: Microsite management
  siteUrl: string | null;
  siteRepoUrl: string | null;
  siteDeployStatus: string;            // none | building | deployed | failed | suspended
  siteLastDeployedAt: string | null;
  siteConfig: object | null;

  // Phase 2: Analytics baseline
  baselineAnalytics: object | null;    // { capturedAt, monthlyVisitors, topKeywords, competitorSites }
  baselineCapturedAt: string | null;
  contentPostCount: number;
  lastContentGeneratedAt: string | null;

  // Onboarding pipeline
  onboardingStatus: string;            // none | scraping | analyzing | complete | failed
  onboardingError: string | null;
  onboardingCompletedAt: string | null;

  // Trusted Companies directory
  featured: boolean;                   // show in homepage banner
  featuredOrder: number | null;        // sort order for banner
  tagline: string | null;              // short one-liner for directory cards
}
```

---

## Authenticated Endpoints

All endpoints below require session authentication (cookie-based).

---

### GET /api/partners

List all partners for the current company.

**Authentication:** Session (cookie)

**Query Parameters:**

| Parameter | Type   | Default | Description                                      |
|-----------|--------|---------|--------------------------------------------------|
| `status`  | string | —       | Filter by status: `trial`, `active`, `paused`, `churned` |
| `industry`| string | —       | Filter by industry (exact match)                 |
| `limit`   | number | 50      | Max results to return (1-200)                    |
| `offset`  | number | 0       | Pagination offset                                |

**Response:**

```json
{
  "partners": [
    {
      "id": "a1b2c3d4-...",
      "companyId": "8365d8c2-...",
      "slug": "acme-consulting",
      "name": "Acme Consulting",
      "industry": "consulting",
      "location": "Austin, TX",
      "website": "https://acme.example.com",
      "description": "Blockchain advisory firm",
      "services": ["consulting", "audit"],
      "socialHandles": { "twitter": "acmeconsult" },
      "contactName": "Jane Doe",
      "contactEmail": "jane@acme.example.com",
      "tier": "partner",
      "status": "active",
      "monthlyFee": 9900,
      "referralFeePerClient": 5000,
      "contentMentions": 12,
      "totalClicks": 347,
      "dashboardToken": "tok_abc123...",
      "partnerSince": "2026-03-01T00:00:00.000Z",
      "createdAt": "2026-03-01T00:00:00.000Z",
      "updatedAt": "2026-04-08T14:30:00.000Z"
    }
  ],
  "total": 1
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 500 | `{ "error": "Failed to list partners" }` |

---

### GET /api/partners/:slug

Get a single partner by slug.

**Authentication:** Session (cookie)

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Response:**

```json
{
  "partner": { ... }
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Partner not found" }` |

---

### POST /api/partners

Create a new partner.

**Authentication:** Session (cookie)

**Request Body:**

| Field                 | Type     | Required | Description                                        |
|-----------------------|----------|----------|----------------------------------------------------|
| `name`                | string   | Yes      | Partner display name                               |
| `industry`            | string   | Yes      | Industry category                                  |
| `slug`                | string   | No       | URL slug (auto-generated from name if omitted)     |
| `location`            | string   | No       | Geographic location                                |
| `website`             | string   | No       | Partner website URL                                |
| `description`         | string   | No       | Short description                                  |
| `services`            | string[] | No       | List of services offered                           |
| `socialHandles`       | object   | No       | Social media handles (e.g. `{ twitter: "handle" }`) |
| `contactName`         | string   | No       | Primary contact name                               |
| `contactEmail`        | string   | No       | Primary contact email                              |
| `tier`                | string   | No       | `proof`, `partner`, or `premium` (default: `proof`) |
| `referralFeePerClient`| number   | No       | Per-referral fee in cents                          |
| `monthlyFee`          | number   | No       | Monthly fee in cents                               |

**Example Request:**

```json
{
  "name": "Acme Consulting",
  "industry": "consulting",
  "website": "https://acme.example.com",
  "services": ["consulting", "audit"],
  "tier": "partner",
  "referralFeePerClient": 5000
}
```

**Response (201):**

```json
{
  "partner": { ... }
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 400 | `{ "error": "name and industry are required" }` |
| 401 | `{ "error": "Unauthorized" }` |
| 409 | `{ "error": "Partner with this slug already exists" }` |

---

### PUT /api/partners/:slug

Update an existing partner. Accepts partial updates -- only provided fields are changed.

**Authentication:** Session (cookie)

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Request Body:** Any subset of the fields from `POST /api/partners`.

**Example Request:**

```json
{
  "tier": "premium",
  "monthlyFee": 19900,
  "status": "active"
}
```

**Response:**

```json
{
  "partner": { ... }
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Partner not found" }` |

---

### DELETE /api/partners/:slug

Delete a partner and all associated click data.

**Authentication:** Session (cookie)

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Response:**

```json
{ "ok": true }
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Partner not found" }` |

---

### GET /api/partners/:slug/metrics

Retrieve click metrics and content mention count for a partner.

**Authentication:** Session (cookie)

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Response:**

```json
{
  "totalClicks": 347,
  "clicksByDay": [
    { "date": "2026-04-08", "count": 23 },
    { "date": "2026-04-07", "count": 18 }
  ],
  "clicksBySource": [
    { "source": "blog", "count": 210 },
    { "source": "tweet", "count": 89 },
    { "source": "newsletter", "count": 48 }
  ],
  "contentMentions": 12
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Unauthorized" }` |
| 404 | `{ "error": "Partner not found" }` |

---

### GET /api/partners/:slug/dashboard?token=xxx

Public-facing dashboard data for partner self-service access. Authenticated via query-string token rather than session cookie.

**Authentication:** Dashboard token (query parameter)

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Query Parameters:**

| Parameter | Type   | Required | Description                  |
|-----------|--------|----------|------------------------------|
| `token`   | string | Yes      | Partner dashboard token      |

**Response:**

```json
{
  "name": "Acme Consulting",
  "industry": "consulting",
  "website": "https://acme.example.com",
  "totalClicks": 347,
  "clicksByDay": [
    { "date": "2026-04-08", "count": 23 },
    { "date": "2026-04-07", "count": 18 }
  ],
  "clicksBySource": [
    { "source": "blog", "count": 210 },
    { "source": "tweet", "count": 89 }
  ],
  "contentMentions": 12
}
```

**Error Responses:**

| Status | Body |
|--------|------|
| 401 | `{ "error": "Invalid or missing dashboard token" }` |
| 404 | `{ "error": "Partner not found" }` |

---

## Public Endpoints

---

### GET /api/go/:slug

Redirect to a partner's website. Logs the click in the `partner_clicks` table with source and content metadata. Designed for use in blog posts, tweets, newsletters, and other content.

**Authentication:** None

**Path Parameters:**

| Parameter | Type   | Description          |
|-----------|--------|----------------------|
| `slug`    | string | Partner URL slug     |

**Query Parameters:**

| Parameter | Type   | Required | Description                                    |
|-----------|--------|----------|------------------------------------------------|
| `src`     | string | No       | Source type (e.g. `blog`, `tweet`, `newsletter`) |
| `cid`     | string | No       | Content ID for attribution tracking            |

**Example URL:**

```
https://31.220.61.12:3200/api/go/acme-consulting?src=blog&cid=post-123
```

**Response:** `302 Found` redirect to the partner's `website` URL.

**Error Responses:**

| Status | Body |
|--------|------|
| 404 | `{ "error": "Partner not found" }` |
| 400 | `{ "error": "Partner has no website configured" }` |

---

### POST /api/partners/:slug/onboard

Manually trigger the onboarding pipeline for a partner. Scrapes their website via Firecrawl, extracts business intel via Ollama, finds competitors, and populates Phase 2 fields. Runs fire-and-forget (returns immediately).

**Authentication:** Session (cookie)

**Response:**

```json
{ "ok": true, "status": "started" }
```

**Error Responses:**

| Status | Body |
|--------|------|
| 400 | `{ "error": "Partner has no website to scrape" }` |
| 404 | `{ "error": "Partner not found" }` |

**Pipeline stages:** `none` -> `scraping` -> `analyzing` -> `complete` (or `failed`). Poll `GET /api/partners/:slug` to check `onboardingStatus`.

---

### GET /api/partner-directory/

Public directory of active/trial partners. No authentication required.

**Query Parameters:**

| Parameter  | Type    | Default | Description                              |
|------------|---------|---------|------------------------------------------|
| `featured` | boolean | —       | If `true`, only return featured partners |
| `limit`    | number  | 100     | Max results (1-200)                      |

**Response:**

```json
{
  "partners": [
    {
      "slug": "bulk-bark",
      "name": "Bulk Bark",
      "industry": "retail",
      "location": "hawaii",
      "description": "...",
      "website": "https://bulkbark.com",
      "siteUrl": null,
      "logoUrl": null,
      "services": ["Cheapest Bark", "Acacia"],
      "tagline": "Premium Acacia Bark Supplier",
      "brandColors": null,
      "totalClicks": 0,
      "contentMentions": 0,
      "featured": true,
      "featuredOrder": 1
    }
  ]
}
```

---

### GET /api/partner-directory/featured

Slim payload for the homepage scrollable banner. No authentication required.

**Response:**

```json
{
  "partners": [
    { "slug": "bulk-bark", "name": "Bulk Bark", "logoUrl": null, "industry": "retail", "tagline": "Premium Acacia Bark Supplier", "location": "hawaii" }
  ]
}
```

---

## Site Management Endpoints

All site management endpoints are authenticated and scoped to `/api/partners/:slug/site/`.

### GET /PUT /api/partners/:slug/site/config

Get or update microsite configuration (siteUrl, siteRepoUrl, siteConfig, siteDeployStatus).

### POST /api/partners/:slug/site/deploy

Trigger microsite deployment. Scaffolds a GitHub repo and optionally deploys to Vercel.

### GET /POST /api/partners/:slug/site/baseline

Get or set baseline analytics (monthlyVisitors, domainAuthority, topKeywords, sourceBreakdown).

### GET /POST /PUT /api/partners/:slug/site/content

CRUD for partner microsite blog content. Auto-generated MWF at 8am by content crons.

### POST /api/partners/:slug/site/content/:contentId/publish

Publish a draft content item to the partner's GitHub-hosted microsite.

### GET /api/partner-sites/:slug/feed

Public feed of published content for partner microsites (no auth).

---

## Tiers

| Tier      | Description                                           |
|-----------|-------------------------------------------------------|
| `proof`   | Trial/proof-of-concept tier -- limited visibility     |
| `partner` | Standard partner -- full content mentions and metrics |
| `premium` | Premium tier -- priority placement, dedicated support |

## Statuses

| Status    | Description                              |
|-----------|------------------------------------------|
| `trial`   | Onboarding, not yet fully active         |
| `active`  | Live and receiving traffic               |
| `paused`  | Temporarily inactive (partner request)   |
| `churned` | No longer active                         |

---

## Usage in Content

Partners are referenced in generated content via redirect links:

```
Check out [Acme Consulting](/api/go/acme-consulting?src=blog&cid=post-456) for blockchain advisory.
```

The content engine automatically injects partner mentions based on tier and industry relevance. Click tracking is transparent to end users -- the redirect happens instantly.
