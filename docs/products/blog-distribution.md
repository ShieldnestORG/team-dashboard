# Blog Distribution — Team Dashboard

Canonical state of blog generation and distribution across the Coherence Daddy + ShieldnestORG ecosystem. Last audited: 2026-04-22 (post-deploy, all surfaces live).

## Pipeline

1. **Generate** — content crons in `server/src/services/content-crons.ts` call the Ollama-backed content service (`server/src/services/content.ts`) or the blog-signal pipeline in `server/src/services/seo-engine.ts`. Output lands in `content_items` as `draft`.
2. **Format** — `server/src/services/blog-publisher.ts::buildBlogPostFromContent` extracts title/description/keywords from the raw HTML and assembles a `BlogPost`.
3. **Publish** — `publishToTargets` POSTs the `BlogPost` to one or more target surfaces in parallel via `Promise.allSettled`.
4. **Persist** — `content_items.slug` + `content_items.publish_results` (JSONB) are written with per-target success/error/url/publishedAt. Status flips to `published` when any leg succeeds.
5. **Index** — `pingIndexNow` notifies search engines; `embedPublishedContent` writes the post back to the intel vector store for future context enrichment.

## Target surfaces

All three writable surfaces are **LIVE**. One read-only surface (`tokns.fi/lab`) re-reads from `tokns-app`.

| Slug | Endpoint | Render URL | Storage | Vercel project | Status |
|---|---|---|---|---|---|
| `cd` | `POST https://www.coherencedaddy.com/api/blog/posts` | `https://www.coherencedaddy.com/blog/<slug>` | Neon Postgres | `shieldnestorg/coherencedaddy` | **LIVE** |
| `sn` | `POST https://www.shieldnest.org/api/articles` | `https://shieldnest.org/blog/<slug>` | Neon Postgres (shared with team-dashboard) | `shieldnestorg/shieldnest_landing_page` | **LIVE** |
| `tokns-app` | `POST https://app.tokns.fi/api/articles` | `https://app.tokns.fi/articles/<slug>` + rendered in `/dashboard` "News & Insights" | Supabase | `shieldnestorg/tokns` | **LIVE** |
| _(read-only)_ | `GET https://app.tokns.fi/api/articles` | `https://tokns.fi/lab` | _(reads `tokns-app` data)_ | `shieldnestorg/tokns.fi_landing_page` | **LIVE** — /lab fetches client-side, CORS allowed for tokns.fi |

> **Important.** The `shieldnest.io` domain is **dead** — never a property we owned. Every reference has been rewritten to `shieldnest.org`. Do not reintroduce it.

### Target-surface contracts

| Target | Auth header | Request body |
|---|---|---|
| `cd` | `Authorization: Bearer ${CD_BLOG_API_KEY}` | `{ slug, title, description, category, keywords[], content, reading_time, author_personality?, status?, content_format? }` |
| `sn` | `Authorization: Bearer ${SN_BLOG_API_KEY}` | Same as `cd`. Returns 409 on slug conflict. Apex redirects 307 → `www.`; the VPS env is pinned to the www form to skip the hop. |
| `tokns-app` | `Authorization: Bearer ${TOKNS_APP_BLOG_API_KEY}` | `{ slug, title, description, category, keywords[], content, reading_time }` — no `author_personality`/`status`/`content_format`. **Upserts on slug conflict** — no 409 returned. |

### Publishing behavior

- `target: "cd" | "sn" | "tokns-app"` → single surface
- `target: "all"` → all three in parallel
- `content_items.status` flips to `published` when any leg succeeds; failures per target are recorded on `publish_results` but non-fatal.
- Unset API keys → that leg is silently skipped (recorded as `{success:false,error:"KEY not set"}`).

## Persistence schema (content_items)

Migration `0092_content_items_publish_results.sql` (applied 2026-04-22):

```sql
ALTER TABLE content_items ADD COLUMN slug text;
ALTER TABLE content_items ADD COLUMN publish_results jsonb NOT NULL DEFAULT '{}';
CREATE INDEX content_items_slug_idx ON content_items(slug) WHERE slug IS NOT NULL;
```

`publish_results` shape:

```jsonc
{
  "cd":       { "success": true,  "publishedAt": "2026-04-22T21:41:24.317Z", "url": "https://www.coherencedaddy.com/blog/<slug>" },
  "sn":       { "success": true,  "publishedAt": "...", "url": "https://shieldnest.org/blog/<slug>" },
  "toknsApp": { "success": false, "error": "Unauthorized" }
}
```

Key invariants:
- `publish_results[target].url` is populated only on success — never for failures.
- Only targets attempted in the original publish call get a key (missing key ≠ failure; it means `target !== "all"` skipped this leg).
- **Retries never regress a successful leg.** If a previously-successful leg returns 409 (unique-constraint, the post is already live), the prior success state is preserved and the retry error is surfaced only in the response body.

## Admin visibility

Blog publish results are surfaced in the admin UI at `/content-review`. On each `blog_post` or `slideshow_blog` card, the `PublishTargetChips` component renders one chip per target:

| State | Chip render | Action |
|---|---|---|
| **success** | Green, `CheckCircle` + open ↗ icon | Click ↗ opens the live post in a new tab |
| **failure** | Red, `XCircle` + retry button (tooltip = error message) | Click 🔄 re-runs the single leg; UI refreshes on response |
| **missing** | Gray + publish-now button | Click 🔄 publishes to that leg for the first time |

Source: [`ui/src/pages/ContentReview.tsx`](../../ui/src/pages/ContentReview.tsx) (`PublishTargetChips`).

### Retry endpoint

```
POST /api/content/queue/:id/republish/:target
Auth: x-content-key or admin session
Body: (none)
```

- `target` ∈ `cd | sn | tokns-app` (400 if anything else).
- Only `blog_post` / `slideshow_blog` rows accepted.
- Rebuilds the `BlogPost` from stored `content` + `topic` + `slug` so the retry hits the same URL.
- Merges the single-target result into `publish_results`. Preserves prior success on 409.
- If this was the first successful leg for a `draft` item, flips `status → published`.

Route: [`server/src/routes/content.ts`](../../server/src/routes/content.ts) (`/queue/:id/republish/:target`).

## Cron → target mapping

All blog crons are registered in `server/src/services/content-crons.ts::JOB_DEFS`. Every `contentType: "blog_post"` / `"slideshow_blog"` job carries an explicit `publishTarget`:

| Cron | Schedule | `publishTarget` | Brand | Topic picker |
|---|---|---|---|---|
| `content:blog` | `0 10 * * 2,4` | `all` | cd | (default — recent intel) |
| `content:aeo:blog` | `0 11 * * 1,4` | `all` | cd | (default) |
| `content:comparison:blog` | `0 10 * * 3,6` | `all` | tx | `comparison` |
| `content:xrp:blog` | `0 9 * * 1,3,5` | `all` | tokns | `xrp-focus` |
| `content:tokns-promo:blog` | `0 14 * * 2,5` | `all` | tokns | `tokns-promo` |
| `content:tx-chain-daily` | `0 8 * * *` | `sn` | tx | `chain-metrics` |
| `content:slideshow-blog:cd` | `0 12 * * 3,6` | `cd` | cd | — |
| `content:slideshow-blog:sn` | `0 13 * * 2,5` | `sn` | tx | — |
| `content:city-trends:blog` | `0 9 * * 2` | `cd` | cd | `city-trends` |

> **Routing tune-up opportunity.** The current `publishTarget: "all"` jobs broadcast to cd + sn + tokns-app indiscriminately. If you want brand-aware routing (e.g. CD-branded posts stay on CD only; tokns-brand posts go to tokns-app only), change each cron's `publishTarget` explicitly. This doc is the source of truth — update the table when you do.

## Env var → target matrix

| Env var | Owner | Lives on | Notes |
|---|---|---|---|
| `CD_BLOG_API_URL` | team-dashboard | VPS1 | default: `https://www.coherencedaddy.com/api/blog/posts` |
| `CD_BLOG_API_KEY` | team-dashboard | VPS1 | must match `BLOG_API_KEY` in `coherencedaddy` Vercel env |
| `SN_BLOG_API_URL` | team-dashboard | VPS1 | set to `https://www.shieldnest.org/api/articles` (www form skips 307 hop) |
| `SN_BLOG_API_KEY` | team-dashboard | VPS1 | must match `BLOG_API_KEY` in `shieldnest_landing_page` Vercel env |
| `TOKNS_APP_BLOG_API_URL` | team-dashboard | VPS1 | default: `https://app.tokns.fi/api/articles` |
| `TOKNS_APP_BLOG_API_KEY` | team-dashboard | VPS1 | must match `SN_ARTICLE_API_KEY` in `tokns` Vercel env |
| `DATABASE_URL` | shieldnest_landing_page | Vercel | Neon pooled connection — **same Neon DB as team-dashboard** (shares `blog_posts` table) |
| `BLOG_API_KEY` | shieldnest_landing_page | Vercel | ingress auth for POST /api/articles |
| `INDEXNOW_KEY` | shieldnest_landing_page | Vercel | IndexNow verification key. Key file: `public/<key>.txt` |
| `SN_ARTICLE_API_KEY` | tokns | Vercel | ingress auth for app.tokns.fi POST /api/articles |

## Rendering — read side per surface

- **coherencedaddy.com/blog** — Next.js App Router SSR, queries Neon directly via `@neondatabase/serverless`. Article JSON-LD + Breadcrumb + FAQ schemas on each post. IndexNow ping on publish.
- **shieldnest.org/blog** — Next.js App Router SSR, same pattern as CD (Neon + shadcn cards). Article JSON-LD schema. IndexNow ping on publish.
- **app.tokns.fi/articles & /dashboard** — Next.js App Router, reads from Supabase `articles` table. The dashboard's `NewsInsightsSection` and `ChainNewsFeed` components auto-pick up new rows. GET `/api/articles` returns CORS headers for allowlisted origins (`tokns.fi`, `www.tokns.fi`, localhost).
- **tokns.fi/lab** — Pure static HTML. `/lab/index.html` fetches `https://app.tokns.fi/api/articles?limit=24` client-side and renders cards matching the site's earthy design tokens. The 3 legacy hand-written posts at `/lab/<slug>.html` remain as static fallbacks.

## Adding a new target

1. Add the slug to `PublishTarget` union in `server/src/services/blog-publisher.ts`.
2. Add `publishToX(post: BlogPost)` and wire it into `publishToTargets` + `publishBlogFromContent` (`anySuccess`, IndexNow ping URL, error collection).
3. Extend `liveUrlFor()` so the admin UI can link to the live post.
4. Add `X_BLOG_API_URL` + `X_BLOG_API_KEY` constants + document in `docs/deploy/env-vars.md` and `.env.production`.
5. Add the target to this doc's matrix and cron mapping.
6. Extend the `TARGETS` array in [`ui/src/pages/ContentReview.tsx`](../../ui/src/pages/ContentReview.tsx) so the chip row includes the new target.
7. If the new target repo needs an endpoint, mirror the `shieldnest_landing_page` `/api/articles/route.ts` pattern.

## Operational health

Quick live probes:

```bash
# CD
curl -s "https://www.coherencedaddy.com/api/blog/posts?limit=3" | jq '.posts[].slug'

# SN
curl -sL "https://shieldnest.org/api/articles?limit=3" | jq '.posts[].slug'

# tokns-app
curl -s "https://app.tokns.fi/api/articles?limit=3" | jq '.articles[].slug'
```

DB health:

```sql
-- per-target success rate, last 7 days
SELECT
  COUNT(*) FILTER (WHERE publish_results->'cd'->>'success' = 'true')       AS cd_ok,
  COUNT(*) FILTER (WHERE publish_results->'cd'->>'success' = 'false')      AS cd_fail,
  COUNT(*) FILTER (WHERE publish_results->'sn'->>'success' = 'true')       AS sn_ok,
  COUNT(*) FILTER (WHERE publish_results->'sn'->>'success' = 'false')      AS sn_fail,
  COUNT(*) FILTER (WHERE publish_results->'toknsApp'->>'success' = 'true') AS tokns_ok,
  COUNT(*) FILTER (WHERE publish_results->'toknsApp'->>'success' = 'false') AS tokns_fail
FROM content_items
WHERE content_type IN ('blog_post','slideshow_blog')
  AND created_at > NOW() - INTERVAL '7 days';

-- items with a failed leg still needing retry
SELECT id, slug, status,
  jsonb_object_agg(k, v->>'error') FILTER (WHERE (v->>'success')::bool = false) AS failures
FROM content_items, jsonb_each(publish_results) AS j(k, v)
WHERE content_type IN ('blog_post','slideshow_blog')
  AND jsonb_path_exists(publish_results, '$.* ? (@.success == false)')
GROUP BY id, slug, status
ORDER BY created_at DESC LIMIT 20;
```

Cron health:

```sql
SELECT job_name, last_run_at, run_count, error_count, LEFT(COALESCE(last_error,'-'), 80) AS err
FROM system_crons
WHERE job_name LIKE 'content:%blog%' OR job_name LIKE 'content:%chain%' OR job_name LIKE 'content:%slideshow%'
ORDER BY job_name;
```
