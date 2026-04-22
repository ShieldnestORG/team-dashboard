# House Ads

Admin-managed in-house creatives served to `*.coherencedaddy.com` subdomains
while AdSense approval is pending — and a permanent fallback for AdSense
no-fill impressions once it's live.

**Context:** AdSense is under review (submitted 2026-04-22, typical 1–14 days).
**Approval-day task list:** see [adsense-go-live-checklist.md](adsense-go-live-checklist.md).
During that window we must not run third-party ad networks — they can delay
or block approval — and we have no affiliate programs signed up. House ads
double as upsell funnels for our own products (CreditScore, Tokns, utility
network).

---

## Architecture at a glance

```
  coherencedaddy-landing (storefront)            team-dashboard (control plane)
  ─────────────────────────────────              ───────────────────────────────
  <AdSlot id="header" />                         /api/house-ads/active?slot=X
        │                                        /api/house-ads/:id/image
        │  fetch (first-party,                   /api/house-ads/:id/click
        │  via vercel.json rewrite)              (admin CRUD behind board auth)
        ▼                                                │
   /api/house-ads/active?slot=X  ───────────────────────▶│
                                                         ▼
                                                  house_ads table
                                                  (image → assets table)
```

Storefront `<AdSlot>` is the sole consumer; all fetch logic, impression/click
counters, and admin CRUD live in team-dashboard.

---

## Data model

**Table: `house_ads`** (migration `0093_house_ads.sql`)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid, pk | |
| `company_id` | uuid, fk → `companies.id` | |
| `title` | text | Admin label only; not shown to viewers. |
| `image_asset_id` | uuid, fk → `assets.id` | Uploaded via existing assets API. |
| `image_alt` | text | Accessibility + AEO. |
| `click_url` | text | Destination. |
| `slot` | text | Free-text; convention: `header`, `in-article-1`, `in-article-2`, `sidebar`, `footer`. |
| `weight` | int | Weighted random rotation within a slot. |
| `active` | bool | |
| `starts_at` / `ends_at` | timestamptz, nullable | Optional scheduling window. |
| `impressions` / `clicks` | bigint | |
| `created_at` / `updated_at` | timestamptz | |

Indexes: `(company_id)`, `(slot, active)`.

---

## Endpoints

All mounted at `/api/house-ads`. Global CORS already allows `*.coherencedaddy.com`.

### Public

- `GET /api/house-ads/active?slot=header`
  - Picks a weighted-random live ad for the slot, honouring `active` +
    `starts_at` / `ends_at` window.
  - Increments `impressions` (fire-and-forget).
  - Response: `{ id, image_url, image_alt, click_url }` with paths relative
    to the API host.
  - **`204 No Content`** if no ad is eligible — storefront must render the
    reserved-height placeholder, not collapse the slot (see CLS rule below).

- `GET /api/house-ads/:id/image` — streams creative bytes. `Cache-Control: public, max-age=300`.

- `GET /api/house-ads/:id/click` — records a click and `302`s to `click_url`.

### Admin (board auth required)

- `GET /api/house-ads`
- `POST /api/house-ads` — body `{ title, imageAssetId, imageAlt?, clickUrl, slot, weight?, active?, startsAt?, endsAt? }`
- `PATCH /api/house-ads/:id`
- `DELETE /api/house-ads/:id`

---

## Admin UI

`/house-ads` in team-dashboard — table view with per-row impressions, clicks,
CTR, active toggle, and a create/edit dialog with inline image upload
(namespace `house-ads`, routed through `StorageService`).

---

## Storefront contract (`coherencedaddy-landing`)

The storefront owns the `<AdSlot>` component. This team-dashboard spec is
authoritative for behavior; the storefront must conform.

```tsx
<AdSlot id="header" />
<AdSlot id="in-article-1" />
<AdSlot id="sidebar" />
```

### Required behavior (v1, pre-AdSense)

1. **Reserve space always.** The slot renders a fixed-height placeholder
   from the moment the component mounts, regardless of fetch state.
   Prevents Cumulative Layout Shift (CLS); CLS is a Core Web Vitals ranking
   factor Google *and* AdSense both weight.
2. **Fetch provider chain.** v1 has only `house`. Post-AdSense-approval
   the chain becomes `['adsense', 'house']` — AdSense fills first, house
   fills on no-fill. No parallel loading — sequential only (stacking two
   networks in the same slot violates AdSense TOS).
3. **Lazy-load below the fold.** `header` and `in-article-1` fetch
   eagerly; `in-article-2`, `sidebar`, `footer` defer until within ~200px
   of the viewport via `IntersectionObserver`.
4. **204 → render placeholder, not null.** Empty pool still reserves the
   box to keep layout stable; can display a muted "Advertisement" label
   or stay blank.
5. **Label every slot.** A small "Advertisement" (or "Ad") label above the
   creative. Required by FTC disclosure rules and AdSense policy for
   content-adjacent placements.
6. **Anchor attributes.** House-ad link is
   `<a href={click_url} target="_blank" rel="sponsored noopener noreferrer">`.
   `rel="sponsored"` is Google's explicit signal for monetized links.
7. **Image hints.** `<img loading="lazy" decoding="async">` + the slot's
   reserved aspect ratio on the wrapper to keep CLS at zero.
8. **Fail silent.** Network error → render the reserved placeholder and
   log once per session. Never surface a broken image or error state.
9. **Respect data-saver.** Skip the fetch when
   `navigator.connection?.saveData === true`.
10. **No admin self-clicks.** Suppress the click beacon in non-production
    builds so dev traffic doesn't pollute counters (and builds the habit
    before AdSense, where self-clicks can terminate the account).

### Ad density rules (enforced at placement, not in the component)

- **Max 3 ad slots per page.** Blog post example: 1 header + 1 in-article + 1 footer.
- **Max 1 per ~300 words of content.** Thin utility pages get zero.
- **Never two ad slots adjacent** without content between them.
- **No ads on:** `/privacy`, `/terms`, `/login`, 404, form-result pages,
  or any page under ~300 words. AdSense policy violation + policy applies
  uniformly to house ads.

### Slot config shape (`lib/ad-slots.ts` in storefront)

```ts
export const AD_SLOT_CONFIG: Record<SlotId, {
  providers: ('adsense' | 'house')[];
  adsenseSlot?: string;
  reserveClass: string;     // tailwind classes for reserved box dims
  lazy: boolean;
}> = {
  'header':       { providers: ['house'], reserveClass: 'min-h-[90px]',  lazy: false },
  'in-article-1': { providers: ['house'], reserveClass: 'min-h-[250px]', lazy: false },
  'in-article-2': { providers: ['house'], reserveClass: 'min-h-[250px]', lazy: true  },
  'sidebar':      { providers: ['house'], reserveClass: 'min-h-[600px]', lazy: true  },
  'footer':       { providers: ['house'], reserveClass: 'min-h-[90px]',  lazy: true  },
};
```

### Post-AdSense-approval migration

When approval lands, single-commit change in `lib/ad-slots.ts`:
`providers: ['house']` → `providers: ['adsense', 'house']` for the slots
you want AdSense on. Deploy. Done. No component changes required.

---

## Out of scope (v1)

- Per-subdomain / per-geo / per-page targeting — global pool only.
- Frequency capping per viewer.
- Bulk A/B tests beyond weighted rotation.
- Automatic provider flip to AdSense — manual config change at approval time.
- Cookie-consent integration (house ads are first-party, no tracking cookie
  required; AdSense's existing consent flow stays with `AdSenseUnit`).

---

## Verification end-to-end

1. Apply migration `0093_house_ads.sql` to Neon.
2. Deploy team-dashboard to VPS; confirm `/api/house-ads/active?slot=X`
   returns 204 with an open pool.
3. Upload one creative via `/house-ads` admin, slot=`sidebar`, weight=1,
   active=true.
4. Re-hit `/api/house-ads/active?slot=sidebar` — confirm JSON response;
   confirm impressions increment on repeat.
5. Storefront: `<AdSlot id="sidebar" />` on a tool page renders the image
   at reserved height. Click → opens new tab, redirects through the click
   endpoint, clicks counter increments.
6. Lighthouse run on the page — CLS score remains 0.
