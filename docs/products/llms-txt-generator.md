# llms.txt + agents.json Generator

> One-shot service that crawls a customer's domain, summarizes each page
> against the [llmstxt.org](https://llmstxt.org/) spec, and returns three
> files: `llms.txt`, `llms-full.txt`, `agents.json`.

This is the GEO-tactics roadmap row "(a) email + portal download" surface:
the lowest-friction entry point into the AEO product line.

## What it does

Given a domain like `example.com`, the service:

1. Discovers the sitemap by trying `/sitemap.xml`, `/sitemap_index.xml`,
   then parsing `/robots.txt` for a `Sitemap:` directive.
2. Recurses into sitemap-index files (capped at `maxPages`, default 500).
3. For each page URL: fetches the HTML, parses `<title>`,
   `<meta name="description">`, first `<h1>`, and the first ~600 chars of
   stripped body text.
4. Groups pages by first path segment (e.g. `/blog/*` → "Blog" group) and
   emits:
   - `llms.txt` — short-form site outline per the llmstxt.org format.
   - `llms-full.txt` — same outline + per-page snippet for richer LLM
     ingestion.
   - `agents.json` — minimal compliant skeleton (the spec is moving;
     ships with `name`, `version: "0.1"`, empty `endpoints`, and
     `x-llms-txt` / `x-llms-full-txt` cross-links).

Generation runs **async** in the local node process — fire-and-forget into
a job row. No external queue (no bullmq/sqs/temporal in this repo) — see
the "what's next" section for the queue story.

## Pricing

| Tier | Price |
|---|---|
| Standalone one-time | **$19** per generation |
| Free with any $49+/mo bundle | $0 |

Stripe product + price config: see [`docs/deploy/stripe-products.md`](../deploy/stripe-products.md).

## API surface

All routes mounted at `/api/llms-txt`. Public (no auth required) — IP
rate-limited to 10 generations per hour.

| Method + Path | Purpose |
|---|---|
| `POST /generate` | Body `{domain, sitemapUrl?, accountId?, email?}`. Returns `202 {jobId}`. Either `accountId` or `email` is required. |
| `GET /jobs/:id` | Returns `{id, domain, status, requestedAt, completedAt, error, pageCount}`. Status one of `queued | crawling | generating | complete | failed`. |
| `GET /jobs/:id/llms.txt` | `text/plain` body when complete; 404 otherwise. |
| `GET /jobs/:id/llms-full.txt` | `text/plain` body when complete. |
| `GET /jobs/:id/agents.json` | `application/json` body when complete. |

Customers retrieve their files via the tokenized job URL until the
customer portal lands (Worker A); after that, the portal will resolve by
`accountId` and surface a "my generations" tab.

## Failure modes

The service stores a useful error string on the job row (`status='failed'`,
`error='...'`) for these conditions:

- Sitemap not discovered at any of the 3 fallback locations.
- Sitemap fetched but contains zero URLs (e.g. an empty `<urlset/>`).
- All page fetches failed (404s, CORS-only domains, JS-only sites with no
  server-rendered HTML, network timeouts past 15s).
- Malformed XML — the regex-based parser is tolerant but if a sitemap is
  not even shaped like `<urlset>` or `<sitemapindex>`, no URLs are
  extracted and the job fails with the zero-URLs message.

Per-page failures are silent (page is dropped from the output set);
missing pages don't fail the whole job unless every fetch fails.

### Edge cases observed in the wild

- **Yoast / RankMath emit `<sitemap><loc>` and `<url><loc>` with leading
  whitespace + comments.** The hand-rolled regex parser handles this.
- **Webflow sitemaps** wrap URLs in CDATA inside `<loc>` blocks. Currently
  parsed correctly because we extract by tag boundary, not text content.
  If we hit a Webflow site that breaks, swap the parser for
  `fast-xml-parser` (already in pnpm overrides; not yet a direct dep).
- **Shopify sitemaps** use deep sitemap-index nesting (index → product
  index → product sitemap). Recursion handles this; the `visited` set
  prevents loops if a sitemap accidentally references itself.
- **JS-only SPAs** (no server-rendered HTML) return blank `<title>` /
  `<meta>` / `<h1>` — the page lands in the output with the URL slug as
  the title fallback. Acceptable degradation; we do not run a headless
  browser per page (cost prohibitive for $19 product).

## Spec references

- llms.txt — https://llmstxt.org/
- agents.json — https://github.com/wellknown/agents.json (early draft)

## Files

| Path | Purpose |
|---|---|
| `packages/db/src/migrations/0108_llms_txt_generator.sql` | Tables `llms_txt_jobs` + `llms_txt_outputs`. |
| `packages/db/src/schema/llms_txt.ts` | Drizzle schema. |
| `server/src/services/llms-txt-generator.ts` | Sitemap discovery, crawl, output assembly, Stripe webhook handler. |
| `server/src/routes/llms-txt.ts` | Public REST surface mounted at `/api/llms-txt`. |
| `server/src/__tests__/llms-txt-generator.test.ts` | Unit tests for parser + builder + end-to-end mock-site runJob. |
| `server/src/__tests__/llms-txt-routes.test.ts` | Route-level tests with mocked service + db stub. |

## What's blocked on Worker A (portal)

- **Authenticated "my generations" view.** The `/api/llms-txt/jobs/:id`
  endpoints are public (token-by-obscurity); the portal will need to scope
  by `accountId` once the auth context lands.
- **Stripe webhook routing.** The handler `handleLlmsTxtCheckout` is
  ready; we just need it dispatched from the consolidated webhook router
  Worker A is building. Until then, paid generations are not auto-created
  — only direct `POST /generate` calls work.

## What's next (post-A)

- Wire the Stripe webhook case to `handleLlmsTxtCheckout`.
- Portal "my generations" tab (list + download).
- Email-on-complete using the existing `coherencedaddy-landing` Resend
  template surface (per CLAUDE.md, do not duplicate templates here).
- A real queue (BullMQ + Redis) once daily volume crosses ~50 jobs/day —
  current fire-and-forget loses jobs across server restarts.

## Structure-diagram changelog

A new backend service was added — the structure diagram needs an update
per the [Structure Diagram Policy](../architecture/structure-diagram-policy.md).
Add a node `llms-txt-generator` under the AEO/SEO product cluster, edge
from "public-form / portal" → `llms-txt-generator` → `llms_txt_jobs`.
Orchestrator: please apply on merge.
