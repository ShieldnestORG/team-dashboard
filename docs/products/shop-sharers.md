# Shop Sharers

Email capture on `shop.coherencedaddy.com` that mints a **referral code, QR
code, and shareable link** for any visitor, then offers an opt-in path into
the existing affiliate program via a manual admin approval queue.

## Why this exists

The shop UI in `coherencedaddy-landing` lives at `app/shop-home/page.tsx` and is
rewritten from `shop.coherencedaddy.com` by the landing site's `middleware.ts`.
Before this feature we had no way to track who was sharing merch pages with
friends. "Sharer" is a lightweight entity deliberately kept out of the finance
pipeline (`affiliates`, `commissions`, `payouts`) — an affiliate row is only
created when admin explicitly approves.

Messaging on `/shop/share` tells sharers that "top sharers win prizes, details
TBA." There is no concrete prize program yet. Do not promise specifics.

## Data model

`packages/db/src/schema/shop_sharers.ts` — two tables:

### `shop_sharers`
| column                          | notes                                                  |
|---------------------------------|--------------------------------------------------------|
| `id`                            | uuid pk                                                |
| `email`                         | unique on `LOWER(email)`                               |
| `referral_code`                 | unique; 6-char lowercase alphanumeric (no ambiguity)   |
| `qr_object_key`                 | nullable; reserved for future storage-cached QRs       |
| `landing_path`                  | default `/shop-home`                                   |
| `affiliate_application_status`  | `null` \| `pending` \| `approved` \| `rejected`        |
| `affiliate_id`                  | FK → `affiliates.id`, set on approval                  |
| `shared_marketing_eligible`     | boolean, flips to `true` only on approval              |
| `source`                        | `shop_hero` \| `share_page` \| `admin`                 |
| `notes`                         | admin-only notes on reject                             |

### `shop_referral_events`
Hit/purchase events attributed to a sharer. Purchase events are not wired yet;
the `hit` event fires from the `/api/shop/ref/hit` beacon when a visitor lands
on the shop with `?ref=<code>`.

## Endpoints

Mounted at `/api/shop` in `server/src/app.ts` — [server/src/routes/shop-sharers.ts](../../server/src/routes/shop-sharers.ts).

### Public (no auth, inherits `*.coherencedaddy.com` CORS)

| Method + path                                    | Purpose                                        |
|--------------------------------------------------|------------------------------------------------|
| `POST /api/shop/sharers`                         | Upsert by email. Returns the public view.      |
| `GET  /api/shop/sharers/by-code/:code`           | Lookup by code. Returns the public view.       |
| `GET  /api/shop/sharers/:code/qr.png`            | Streams a 512px PNG QR encoding the share URL. |
| `POST /api/shop/sharers/:code/apply-affiliate`   | Flips status to `pending`. Idempotent.         |
| `POST /api/shop/ref/hit`                         | Fire-and-forget beacon for `?ref=<code>` visits. |

Public view shape:
```json
{
  "referralCode": "zk9f2x",
  "shareUrl": "https://shop.coherencedaddy.com/?ref=zk9f2x",
  "qrUrl": "/api/shop/sharers/zk9f2x/qr.png",
  "emailMasked": "al****e@example.com",
  "applicationStatus": null,
  "sharedMarketingEligible": false,
  "canApplyAffiliate": true
}
```

### Admin (`assertBoard` — board session required)

| Method + path                                 | Purpose                                       |
|-----------------------------------------------|-----------------------------------------------|
| `GET  /api/shop/admin/sharers?status=pending` | List sharers, optionally filtered by status.  |
| `POST /api/shop/admin/sharers/:id/approve`    | Create linked `affiliates` row, flip flags.   |
| `POST /api/shop/admin/sharers/:id/reject`     | Set status `rejected`, store optional notes.  |

Approval creates an affiliate with `status='active'`, a random placeholder
password, and a one-time `reset_token` (14-day TTL). The reset token is
returned in the approval response so admin can relay it to the sharer;
tokens are stored hashed (`sha256`) in `affiliates.reset_token`, matching the
scheme in `server/src/routes/affiliates.ts`.

## Approval workflow

1. Visitor submits email in the shop hero → sharer row created; response
   includes `shareUrl`, `qrUrl`, and `canApplyAffiliate: true`.
2. Visitor lands on `/shop/share` (landing site) and sees the QR + copy-link
   + **"Apply to become an affiliate"** CTA.
3. Click **Apply** → `POST .../apply-affiliate` → status `pending`. A
   notification email to `ALERT_EMAIL_TO` fires (reuses the existing
   `affiliate-application` transactional template).
4. Admin opens `/shop-sharers` in team-dashboard → reviews queue → clicks
   **Approve** or **Reject**.
5. On approve: `affiliate_id` is populated, `shared_marketing_eligible = true`,
   and the admin UI surfaces the one-time reset token to paste into an email
   to the new affiliate.

## Relationship to existing affiliate system

- **Not** a replacement: the `affiliates` table and all downstream finance
  (commissions, payouts, compliance, tiers, engagement) are untouched.
- **One-way link**: `shop_sharers.affiliate_id` → `affiliates.id`. There is
  no reverse FK; a sharer that was never promoted has `affiliate_id = null`.
- **`shared_marketing_eligible`** is a forward-looking flag. The commission
  engine does not yet consult it; wiring shared-marketing revenue splits is
  a follow-up that will filter `affiliates` rows by
  `EXISTS (SELECT 1 FROM shop_sharers WHERE affiliate_id = affiliates.id AND shared_marketing_eligible = true)`
  or similar.

## Out of scope for the initial ship

- **Automated approval**: all approvals are manual. Rate-limiting the apply
  endpoint is a nice-to-have follow-up.
- **Purchase attribution**: `shop_referral_events.event_type = 'purchase'`
  is reserved but no writer exists. Wire when shop checkout is live.
- **Prize program**: copy only; no entitlement logic.
- **Merch order fulfillment**: the existing `merch_requests` table is for
  affiliate swag and is independent of `shop_sharers`.

## Landing-side wiring — shipped

The storefront side lives in `coherencedaddy-landing`. Status as of
2026-04-23 (commits `a9ae317`, `6698bd2`):

- **Email capture** — `components/shop/share-capture.tsx`. Rendered between
  the hero `<section>` and `<FiltersBar />` by
  `components/shop-preview/shop-preview-client.tsx`. POSTs
  `{ email, source: "shop_hero" }` to `/api/shop/sharers` and
  `router.push()`es to `/shop/share?code=<referralCode>` on success.
- **Share page** — `app/shop/share/page.tsx`. Reads `?code=`, fetches
  `/api/shop/sharers/by-code/:code`, renders the QR via
  `<img src={shopApiUrl(sharer.qrUrl...)} />`, copy-link button, and
  `POST /api/shop/sharers/:code/apply-affiliate` on the Apply CTA with
  inline status handling for `null | pending | approved | rejected`.
- **Ref beacon** — `components/shop/ref-beacon.tsx`, mounted inside
  `<ShopPreviewClient />`, fires `POST /api/shop/ref/hit` on any shop
  page load with `?ref=<code>`.
- **API proxy** — `vercel.json` rewrites `/api/shop/:path*` to
  `https://api.coherencedaddy.com/api/shop/:path*`. Shared helper
  `lib/shop-api.ts → shopApiUrl()` reads
  `NEXT_PUBLIC_DASHBOARD_API_BASE` for local dev and defaults to
  origin-relative in prod.
- **Hostname rewrite** — `middleware.ts` rewrites
  `shop.coherencedaddy.com/` to `/shop-home`, which renders
  `<ShopPreviewClient />`.

## Verification checklist

See the feature branch plan for the full end-to-end verification walkthrough.
Key smoke test:

```bash
# dev server running via pnpm dev on :3200
curl -s -X POST http://localhost:3200/api/shop/sharers \
  -H "content-type: application/json" \
  -d '{"email":"test@example.com"}' | jq
# → { "sharer": { "referralCode": "...", "shareUrl": "...", ... } }
curl -sI http://localhost:3200/api/shop/sharers/<code>/qr.png
# → HTTP/1.1 200 OK, Content-Type: image/png
```
