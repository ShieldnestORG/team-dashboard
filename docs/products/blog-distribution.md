# Blog Distribution — Team Dashboard

Canonical state of blog generation and distribution across the Coherence Daddy + ShieldnestORG ecosystem. Last audited: 2026-04-22.

## Pipeline

1. **Generate** — content crons in `server/src/services/content-crons.ts` call the Ollama-backed content service (`server/src/services/content.ts`) or the blog-signal pipeline in `server/src/services/seo-engine.ts`. Output lands in `content_items` as `draft`.
2. **Format** — `server/src/services/blog-publisher.ts::buildBlogPostFromContent` extracts title/description/keywords from the raw HTML and assembles a `BlogPost`.
3. **Publish** — `publishToTargets` POSTs the `BlogPost` to one or more target surfaces in parallel.
4. **Index** — `pingIndexNow` notifies search engines; `embedPublishedContent` writes the post back to the intel vector store for future context enrichment.
5. **Mark published** — `content_items.status` flips to `published` with `published_at` when *any* target succeeds. Partial failures are logged but do not fail the cron.

## Target surfaces

Three writable surfaces + one read-only surface that re-uses a sibling's data:

| Slug | Endpoint | Render URL | Storage | Vercel project | Status |
|---|---|---|---|---|---|
| `cd` | `POST https://www.coherencedaddy.com/api/blog/posts` | `https://www.coherencedaddy.com/blog/<slug>` | Neon Postgres | `ShieldnestORG/coherencedaddy` | **LIVE** |
| `sn` | `POST https://shieldnest.org/api/articles` | `https://shieldnest.org/blog/<slug>` | Neon Postgres | `shieldnestorg/shieldnest_landing_page` (`feat/blog-pipeline`) | **SHIPPING** — endpoint built this PR, awaiting deploy |
| `tokns-app` | `POST https://app.tokns.fi/api/articles` | `https://app.tokns.fi/articles/<slug>` + rendered in `/dashboard` "News & Insights" section | Supabase | `shieldnestorg/tokns` | **LIVE** — endpoint already existed |
| _(read-only)_ | `GET https://app.tokns.fi/api/articles` | `https://tokns.fi/lab` | _(re-reads app.tokns.fi data)_ | `shieldnestorg/tokns.fi_landing_page` | **SHIPPING** — /lab rewritten client-side this PR |

> **Important.** The old `shieldnest.io` domain is **dead** — never a property we owned. Every reference has been rewritten to `shieldnest.org`. Do not reintroduce it.

### Target-surface contracts

| Target | Auth header | Request body |
|---|---|---|
| `cd` | `Authorization: Bearer ${CD_BLOG_API_KEY}` | `{ slug, title, description, category, keywords[], content, reading_time, author_personality?, status?, content_format? }` |
| `sn` | `Authorization: Bearer ${SN_BLOG_API_KEY}` | Same as `cd` |
| `tokns-app` | `Authorization: Bearer ${TOKNS_APP_BLOG_API_KEY}` | `{ slug, title, description, category, keywords[], content, reading_time }` — no `author_personality`/`status`/`content_format`. Upserts on slug conflict. |

### Publishing behavior

- `target: "cd"` / `"sn"` / `"tokns-app"` → single surface
- `target: "all"` → all three surfaces in parallel via `Promise.allSettled`
- The DB marks the item `published` when any leg succeeds; failures per target are logged but non-fatal.
- Unset API keys → that leg is silently skipped (logged as "KEY not set").

## Cron → target mapping

All blog crons are registered in `server/src/services/content-crons.ts::JOB_DEFS`. Every `contentType: "blog_post"` job carries an explicit `publishTarget`:

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

> **Routing tune-up opportunity.** The current `publishTarget: "all"` jobs broadcast to cd + sn + tokns-app indiscriminately. If you want brand-aware routing (e.g. CD-branded posts should stay on CD only, tokns-brand posts should go to tokns-app + tokns.fi/lab but not CD), change each cron's `publishTarget` explicitly. This doc is the source of truth — update the table when you do.

## Env var → target matrix

| Env var | Target | Owner repo | Notes |
|---|---|---|---|
| `CD_BLOG_API_URL` | cd | team-dashboard | default: `https://www.coherencedaddy.com/api/blog/posts` |
| `CD_BLOG_API_KEY` | cd | team-dashboard | must match `BLOG_API_KEY` in coherencedaddy-landing Vercel env |
| `SN_BLOG_API_URL` | sn | team-dashboard | default: `https://shieldnest.org/api/articles` |
| `SN_BLOG_API_KEY` | sn | team-dashboard | must match `BLOG_API_KEY` in shieldnest_landing_page Vercel env |
| `TOKNS_APP_BLOG_API_URL` | tokns-app | team-dashboard | default: `https://app.tokns.fi/api/articles` |
| `TOKNS_APP_BLOG_API_KEY` | tokns-app | team-dashboard | must match `SN_ARTICLE_API_KEY` in tokns Vercel env |
| `DATABASE_URL` | sn | shieldnest_landing_page | Neon pooled connection; standard Vercel-Neon integration |
| `BLOG_API_KEY` | sn | shieldnest_landing_page | ingress auth for POST /api/articles |
| `INDEXNOW_KEY` | sn | shieldnest_landing_page | optional, for fire-and-forget IndexNow ping on publish |

## Rendering — read side per surface

- **coherencedaddy.com/blog** — Next.js App Router SSR, queries Neon directly via `@neondatabase/serverless`. Article JSON-LD + Breadcrumb + FAQ schemas on each post. IndexNow ping on publish.
- **shieldnest.org/blog** — Next.js App Router SSR, same pattern as CD (Neon + shadcn cards). Article JSON-LD schema. IndexNow ping on publish.
- **app.tokns.fi/articles & /dashboard** — Next.js App Router, reads from Supabase `articles` table. The dashboard's `NewsInsightsSection` and `ChainNewsFeed` components auto-pick up new rows.
- **tokns.fi/lab** — Pure static HTML. `/lab/index.html` fetches `https://app.tokns.fi/api/articles?limit=24` client-side and renders cards matching the site's earthy design tokens. The 3 legacy hand-written posts at `/lab/<slug>.html` remain as static fallbacks.

## Adding a new target

1. Add the slug to `PublishTarget` union in `server/src/services/blog-publisher.ts`.
2. Add `publishToX(post: BlogPost)` and wire it into `publishToTargets` + `publishBlogFromContent` (`anySuccess`, IndexNow ping URL, error collection).
3. Add `X_BLOG_API_URL` + `X_BLOG_API_KEY` constants + document in `docs/deploy/env-vars.md` and `.env.production`.
4. Add the target to this doc's matrix and cron mapping.
5. If the new target repo needs an endpoint, mirror the shieldnest_landing_page `/api/articles/route.ts` pattern.

## Operational health

Use these quick checks:

```bash
# CD live
curl -s "https://www.coherencedaddy.com/api/blog/posts?limit=3" | jq '.posts[].slug'

# SN live (after shieldnest_landing_page deploy)
curl -s "https://shieldnest.org/api/articles?limit=3" | jq '.posts[].slug'

# tokns-app live
curl -s "https://app.tokns.fi/api/articles?limit=3" | jq '.articles[].slug'
```

DB check:
```sql
SELECT DATE(published_at) AS day, COUNT(*) AS published
FROM content_items
WHERE content_type='blog_post' AND status='published'
  AND published_at > NOW() - INTERVAL '7 days'
GROUP BY day ORDER BY day DESC;
```

Cron health:
```sql
SELECT job_name, last_run_at, run_count, error_count, LEFT(COALESCE(last_error,'-'), 80) AS err
FROM system_crons
WHERE job_name LIKE 'content:%blog%' OR job_name LIKE 'content:%chain%' OR job_name LIKE 'content:%slideshow%'
ORDER BY job_name;
```
