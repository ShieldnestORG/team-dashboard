# PRD: Partner + Directory Expansion

**Owner:** Atlas / Sage | **Date:** 2026-04-14 | **Status:** Draft

## 1. Problem Statement

Coherence Daddy leadership is now physically vetting local partners (gyms, niche service businesses) on the road, but the current `partner_companies` schema has no concept of *in-person vetting*, no geolocation, and no structured services/hours beyond loose jsonb blobs. Scaling from 1 to 100 vetted partners will outpace the current admin workflow and the 6-personality content engine, which generates broad blog posts rather than hyper-local long-tail articles. Simultaneously, the 532-slug Project Directory refreshes on a 1–4hr intel cron that hits *everything* uniformly — priority entries get no special treatment, and stale data is visible to users because no `last_updated` field is exposed. The long-tail niche query space ("24/7 gyms Colorado Springs", "raw diet for dogs Austin") is entirely uncaptured.

## 2. Proposed Architecture

### D1. Vetted Partner Pipeline

**Purpose:** First-class support for in-person vetting with location, photos, and operational metadata.

- **Files to touch:**
  - `packages/db/src/schema/partners.ts` (extend `partnerCompanies`)
  - `server/src/routes/partner.ts` (new `POST /:slug/vet`, extend `PUT /:slug`)
  - `ui/src/pages/Partners.tsx` (admin vetting modal)
- **Schema additions** (new migration, e.g. `0066_partner_vetting.sql`):
  - `vetted_at timestamptz`, `vetted_by_agent text`, `vetting_notes text`
  - `visit_photos jsonb` (array of `{url, caption, takenAt}`)
  - `business_hours jsonb` (already have `hours` — reuse, standardize to 7-day object)
  - Promote `services` from jsonb to `services text[]` for GIN indexing
  - `lat numeric(10,7)`, `lng numeric(10,7)`, `geohash text`
  - Index: `(companyId, vetted_at)`, GIN on `services`
- **API:** `POST /api/partners/:slug/vet` (body: notes, photos[], hours, lat/lng) — marks `vetted_at=now()`, sets `vetted_by_agent` from auth context.
- **UI:** "Mark Vetted" button on partner detail; photo upload via existing media-drop (`/api/media/*`); map picker for lat/lng.
- **Cron impact:** none (manual workflow).

### D2. Niche Topic Article Engine

**Purpose:** High-frequency rotation through hyper-niche topics tied to partners or geography.

- **Files to touch:**
  - New schema: `packages/db/src/schema/niche_topics.ts`
  - New service: `server/src/services/niche-topic-engine.ts`
  - New cron registration in `server/src/services/content-crons.ts`
  - Content prompt hook: extend `server/src/services/partner-content.ts` with `injectNicheTopicContext()`
  - New routes file: `server/src/routes/niche-topics.ts`
  - New UI: `ui/src/pages/NicheTopics.tsx`
- **Schema:** `niche_topics` — `id, company_id, partner_id (nullable), topic text, category text, location text, seed_queries text[], refresh_interval_days int, priority int, last_generated_at timestamptz, generation_count int, engagement_score int, status text`
- **API:** CRUD at `/api/niche-topics/*`, `POST /:id/generate` for manual trigger, `GET /rotation` for next-due.
- **UI:** Topic queue with category filter, priority slider, "generate now" action, per-topic engagement column pulled from `content_items.click_count`.
- **Cron:** new `content:niche-rotation` every 2hr — picks top N due topics weighted by `priority * (1/days_since_last_gen) * engagement_score`, enriched with partner context + vector search over `intel_reports`. Separate lane from the 7 existing text content crons to avoid cannibalizing general content slots.

### D3. Partners Subdomain (`partners.coherencedaddy.com`)

**Purpose:** Public-facing vetted partner directory, distinct from the admin `/partners` page.

- **Files to touch:**
  - `coherencedaddy-landing/middleware.ts` (add `partners.` rewrite → `/partners-home`)
  - New Next.js routes: `coherencedaddy-landing/app/partners-home/page.tsx`, `app/partners-home/[slug]/page.tsx`
  - Data source: existing `GET /api/partner-directory/featured` (in `partner.ts:565`) — extend to accept filters (category, city, vetted=true)
  - New backend route: `GET /api/partner-directory/:slug` returning FAQ + content feed
- **Schema:** none (reuses D1 columns).
- **UI:** Landing with map + category chips; per-partner page renders LocalBusiness + FAQPage JSON-LD schema, hours, photos, recent niche articles from `partner_site_content` and `content_items`.
- **Cron impact:** none. ISR revalidation every 15min.

### D4. Directory Freshness Upgrade

**Purpose:** Faster refresh for priority directory entries + public `last_updated`.

- **Files to touch:**
  - `packages/db/src/schema/intel.ts` (add `priority int default 0`, `last_refreshed_at timestamptz` on companies/intel_companies table)
  - `server/src/services/intel-crons.ts` (add `intel:priority-refresh` every 15min, filters `priority > 0`)
  - `server/src/services/intel.ts` (add `refreshCompany(slug)` entry point)
  - `server/src/routes/intel.ts` (new `POST /:slug/refresh` admin action, expose `last_refreshed_at` publicly)
  - `ui/src/pages/Intel.tsx` ("Refresh now" button per row, priority toggle)
- **Cron:** 1 new priority cron; existing 8 intel crons unchanged. Discovery cron already runs every 6hr.
- **Risk mitigation:** priority cron paginates at 20 entries max to avoid rate-limit blowout on CoinGecko/GitHub.

### D5. Niche Topic Picker + SEO Cluster Generation

**Purpose:** Given a new vetted partner, auto-propose 5–10 niche article topics.

- **Files to touch:**
  - New service: `server/src/services/niche-topic-picker.ts` (Ollama prompt: category + location + services → topic list)
  - Hook: `partner.ts` `POST /:slug/vet` triggers picker, inserts into `niche_topics` with `priority=5`, `refresh_interval_days=30`
  - UI: review queue in `NicheTopics.tsx` — approve/reject/edit before activation
- **Schema:** none beyond D2.
- **Cron:** none (event-triggered on vetting).

## 3. Rollout Phases

- **Week 1 — D1:** migration, schema extension, vetting UI + media upload wiring. Vet first 5 gyms end-to-end.
- **Week 2 — D2:** `niche_topics` table, picker service, rotation cron (manual trigger only), prompt enrichment. Dry-run 20 niche articles, Sage reviews quality.
- **Week 3 — D4 + D5:** priority intel cron, refresh-now button, `last_updated` exposure, auto-picker on vet event. Enable niche rotation cron at 2hr cadence.
- **Week 4 — D3:** middleware rewrite, Next.js partner pages, LocalBusiness/FAQ schema, Google Search Console submission. Soft launch to 10 partners.

## 4. Risks + Mitigations

1. **Niche content slop embarrasses partners.** Ollama may produce generic "top 10 gyms" fluff with wrong local facts. *Mitigation:* D2 includes a mandatory review queue status (`status=pending_review`), partner-page posts only go public after Sage or partner confirms. Engagement feedback penalties (existing `content_quality_signals`) auto-downrank bad templates.
2. **Niche topics cannibalize general SEO.** 100+ niche posts/day could dilute coherencedaddy.com authority or trigger Google thin-content penalties. *Mitigation:* niche posts publish to `partners.coherencedaddy.com` subdomain (D3), NOT the main blog. Main blog content engine is untouched.
3. **Priority intel cron hits rate limits.** 15min cadence × N priority companies could burn CoinGecko/GitHub quotas. *Mitigation:* hard cap of 20 priority slots per cron tick; panic-mode integration with existing `rate-limiter.ts` pattern.

## 5. Success Metrics (90-day)

- **Partner scale:** 50+ vetted partners with `vetted_at` set, ≥80% with lat/lng + photos.
- **Niche content:** 500+ published niche articles, median engagement_score ≥ 2× general content baseline.
- **Partner traffic:** `partner_clicks` from `partners.coherencedaddy.com` exceeds main-site partner clicks within 60 days.
- **Directory freshness:** priority entries show median `last_refreshed_at` age under 30min (vs current 2hr).
- **Revenue proxy:** ≥15 partners convert from "proof" to paid tier.

## 6. Open Questions

1. **Partner photo hosting:** reuse S3/local media-drop, or new dedicated partner-photos bucket with CDN? Affects D1 media pipeline.
2. **Geocoding provider:** which service for lat/lng lookup from address — Mapbox, Google, OSM Nominatim? Cost and ToS differ sharply.
3. **`partners.` subdomain:** should it inherit main nav and footer, or be a standalone branded experience? Affects D3 page layout budget.
4. **Content approval workflow:** do vetted partners get per-partner dashboard approval rights (via existing `dashboardToken`), or does Sage approve all niche posts centrally?
5. **Geographic scope:** start with Austin + Colorado Springs only, or accept any lat/lng from day one? Affects D5 picker prompt constraints.
