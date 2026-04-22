# CreditScore API

Owned end-to-end by team-dashboard per [`docs/OWNERSHIP.md`](../OWNERSHIP.md). Product spec: [`docs/products/creditscore-prd.md`](../products/creditscore-prd.md).

Base path: `/api/creditscore`. Public host: `https://api.coherencedaddy.com`.

---

## Plans catalog

### `GET /api/creditscore/plans`

Public. Returns all active tiers from `creditscore_plans`.

```json
{
  "plans": [
    {
      "slug": "report_onetime",
      "name": "One-Time Report",
      "tier": "report",
      "billingInterval": "one_time",
      "priceCents": 1900,
      "stripePriceId": "price_1TOumI...",
      "entitlements": { "oneTimeReport": true }
    },
    // starter_monthly, growth_monthly, growth_annual, pro_monthly ...
  ]
}
```

Tiers: `report | starter | growth | pro`. Billing intervals: `one_time | monthly | annual`. Entitlement shape varies per tier — see `docs/products/creditscore-prd.md`.

---

## Checkout

### `POST /api/creditscore/checkout`

Public. Storefront (`coherencedaddy-landing`) proxies this from `freetools.coherencedaddy.com/creditscore-home`. Creates a Stripe checkout session and inserts a `creditscore_subscriptions` row with `status=pending` keyed on the returned session ID.

**Body**

```json
{
  "tier": "starter_monthly",        // plan slug from /plans
  "url": "https://customer-site.com",
  "email": "customer@example.com",  // optional
  "audit_result_id": "<uuid>",      // optional; from a prior free audit
  "companyId": "<uuid>"             // optional; if known
}
```

**Returns**

```json
{ "url": "https://checkout.stripe.com/...", "sessionId": "cs_..." }
```

**Errors**
- `400` — `tier` or `url` missing / invalid URL
- `501` — plan has no Stripe price configured (shouldn't happen in prod)

Redirect URLs resolve from env (`CREDITSCORE_SUCCESS_URL` / `CREDITSCORE_CANCEL_URL`) with a `freetools.coherencedaddy.com` fallback.

---

## Stripe webhook

### `POST /api/creditscore/webhook`

Public, but signature-verified against `STRIPE_WEBHOOK_SECRET_CREDITSCORE`. Mounted **before** `express.json()` with raw body.

Handles four event types:

| Event | Action |
|---|---|
| `checkout.session.completed` | Flip pending sub → `active` (sub) / `fulfilled` (one-time). Kick off initial audit. Fire tier-appropriate welcome email. |
| `invoice.paid` | Update `current_period_start`/`end`, ensure `status=active` |
| `customer.subscription.updated` | Map Stripe status → `active | past_due | canceled`, update period |
| `customer.subscription.deleted` | `status=canceled`, `canceled_at=now()` |

Returns `{ received: true, handled: true, type }` on success; `400` on invalid signature; `500` on handler error.

---

## Entitlement lookup

### `GET /api/creditscore/entitlement?domain=X&email=Y`

Public. At least one of `domain` or `email` required. Resolves the highest-tier active standalone CreditScore subscription matching either filter.

```json
// active customer
{ "active": true, "tier": "starter", "status": "active", "currentPeriodEnd": "..." }
// no match
{ "active": false, "tier": null }
```

Bundle-granted CreditScore tiers are resolved via the bundle entitlement resolver — see `GET /api/bundles/entitlements`. Higher-of-bundle-or-standalone wins.

---

## Reports

### `GET /api/creditscore/report/:id`

Public (shareable). Returns the stored report row.

```json
{
  "report": {
    "id": "<uuid>",
    "domain": "example.com",
    "score": 72,
    "previousScore": 65,
    "status": "complete",
    "shareableSlug": null,
    "resultJson": { /* full audit result */ },
    "createdAt": "..."
  }
}
```

`404` if not found.

### `POST /api/creditscore/audit/store`

Public. Storefront proxies this to persist a free-audit result originated in the browser SSE stream.

**Body**

```json
{
  "url": "https://example.com",
  "email": "optional@example.com",
  "result": { /* AuditResult from server/src/routes/audit.ts */ }
}
```

Returns `{ reportId: "<uuid>" }`. Row is created with `subscriptionId=null`, `status=complete`.

---

## Content drafts — review queue (board-auth)

All routes below require `req.actor.type === "board"`. Unauthenticated → `401`.

### `GET /api/creditscore/content-drafts`

List all `pending_review` drafts (newest first, limit 100).

```json
{ "drafts": [ /* creditscore_content_drafts rows */ ] }
```

### `GET /api/creditscore/content-drafts/:id`

Single draft. `404` if not found.

### `POST /api/creditscore/content-drafts/:id/approve`

**Body:** `{ "reviewNotes": "optional string" }`. Sets `status=approved`, stamps reviewer.

### `POST /api/creditscore/content-drafts/:id/reject`

**Body:** `{ "reviewNotes": "optional string" }`. Sets `status=rejected`.

### `POST /api/creditscore/content-drafts/:id/published`

**Body:** `{ "publishedUrl": "https://customer-site.com/the-page" }`. Marks the draft as live on the customer site. `400` if `publishedUrl` missing.

---

## Schema implementations — review queue (board-auth)

### `GET /api/creditscore/schema-impls`

List all `pending_review` schema impls.

### `GET /api/creditscore/schema-impls/:id`

Single impl; response includes `jsonLd` (object) and `htmlSnippet` (copy-paste `<script type="application/ld+json">`).

### `POST /api/creditscore/schema-impls/:id/approve`
### `POST /api/creditscore/schema-impls/:id/reject`
### `POST /api/creditscore/schema-impls/:id/delivered`

Same semantics as content-drafts counterparts. `delivered` marks the impl as installed on the customer site.

---

## Competitor scans (read-only, board-auth)

### `GET /api/creditscore/subscriptions/:id/competitor-scans?cycleTag=2026-04`

Returns scans for a given subscription. Optional `cycleTag` query filters by ISO month. Scans are generated by the `creditscore:competitor-scans` cron — see [`docs/operations/cron-inventory.md`](../operations/cron-inventory.md).

---

## Strategy docs (Pro tier, read-only, board-auth)

### `GET /api/creditscore/subscriptions/:id/strategy-docs`

Returns the last 12 weekly strategy docs for a Pro subscription. Generated by the `creditscore:sage-weekly` cron and emailed via `sage_weekly_digest`.

---

## Related

- **Crons that populate these tables:** [`docs/operations/cron-inventory.md`](../operations/cron-inventory.md) § CreditScore.
- **Email callback contract** (team-dashboard → storefront): `server/src/services/creditscore-email-callback.ts`. HMAC-SHA256 signed POST using `CREDITSCORE_CALLBACK_KEY`.
- **Env vars:** [`docs/deploy/env-vars.md`](../deploy/env-vars.md) § Payments (all `STRIPE_PRICE_CREDITSCORE_*`, `STRIPE_WEBHOOK_SECRET_CREDITSCORE`, `CREDITSCORE_*`).
