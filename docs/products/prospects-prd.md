# PRD: Unwebsited Prospects Engine (Initiative C)

**Status:** Planning — unshipped. **New product, not a directory feature.**
**Parent plan:** `coherencedaddy-landing/docs/plans/2026-04-24-directory-expansion.md`
**Target repos:** team-dashboard (schema, crons, classifier, demo generator, admin UI, Stripe), storefront (preview subdomain + pitch landing + email templates).

---

## What It Is

A discovery + outreach engine targeting small niche businesses that **don't have their own website yet** — they exist only on Facebook, Instagram, Yelp, Google Maps, TikTok, LinkedIn, Nextdoor, or Etsy. We find them via SERP, auto-render a templated HTML demo site, and email them a link to the demo with a flat-fee build offer.

This is a pure outbound funnel product. No freemium, no self-serve. The goal is to convert an unwebsited business into a paid website-build customer at a flat one-time fee.

---

## Customer Promise

> "We already built your website. Here's the preview. $499 and it goes live this week."

---

## Pricing

| Plan | Price | What They Get |
|---|---|---|
| **Build** | $499 one-time | Live site on our hosting, domain setup (reimburse up to $15 for .com), 1 round of edits, 30 days of hosting included |
| **Hosting** | $29/mo | Continued hosting + 1 content update/mo after month 1 |
| **Build + 12mo Hosting** | $799 one-time | Discounted bundle |

**Stripe setup:**
- `STRIPE_PRICE_PROSPECTS_BUILD` ($499 one-time)
- `STRIPE_PRICE_PROSPECTS_HOSTING` ($29/mo recurring)
- `STRIPE_PRICE_PROSPECTS_BUNDLE` ($799 one-time)

---

## Brand Decision (OPEN — blocks M1)

Coherence Daddy is a **508(c)(1)(A) faith-based nonprofit** focused on private, secure self-help products. Selling $499 website builds to local plumbers and tattoo shops is:

- Legally fine (508(c)(1)(A) permits unrelated business income; it's just taxable)
- Mission-wise a stretch (not obviously "helping humanity be more coherent")
- Brand-wise potentially dilutive

**Three options:**

1. **Launch under Coherence Daddy** — subdomain `websites.coherencedaddy.com`. Simplest; no new brand to stand up. Accept some brand dilution.
2. **Launch under OUTRIZZD** — sibling brand already paired with shop.outrizzd.shop / Woo. Already established as the "commerce-oriented" sibling; website builds fit cleanly. New domain needed (e.g. `outrizzd.build`).
3. **Launch under a new brand** — e.g. "ShieldNest Build" or "Coherence Sites" — positions it as B2B infra work done by the ShieldNest arm. Clean separation.

**Recommendation:** Option 2 (OUTRIZZD). The local-business POD/commerce brand already exists; website services extend naturally. Domain: `outrizzd.build` or `outrizzd.sites`.

Must be resolved before M1 — affects subdomain routing, Stripe account, Resend sending domain, and every piece of copy.

---

## Data Flow

```
prospect_niche_queries (editable per-niche SERP patterns)
        ↓
prospects-serp-scan cron (every 6h per active niche)
        ↓
Firecrawl search → raw SERP results
        ↓
Unwebsited classifier
  pass: all top-5 results on fb/ig/yelp/tiktok/gmaps/linkedin/nextdoor/etsy
        + no owned domain in results
  fail: any .com/.net/.io/.co/.org in top 5 → skip
        ↓
Contact extractor
  GMaps: phone + occasional public email
  Instagram: bio email/link tree
  Yelp: business contact form URL (may require JS render)
        ↓
prospects row inserted (status = discovered)
        ↓
prospects-demo-render cron (hourly)
  For each new `discovered` row, generate templated HTML site preview
  Hero image from Google Maps listing (licensed use case TBD — see Risks)
  Color palette picked from logo/image via color extraction
  5 pages: home, about, services, contact, gallery
  Hosted at outrizzd.build/preview/{signed_token}
        ↓
prospects-outreach-send cron (daily, US-hours-staggered)
  Cap: 100/day total, 10/domain/day
  Prism-generated email per prospect
  Subject: "{business_name} — here's your new site"
  Body includes preview link + $499 CTA
        ↓
Resend delivery → prospects row status = contacted
        ↓
Tracking: opened, clicked, preview viewed, CTA clicked
        ↓
If CTA clicked → Stripe Checkout ($499 or bundle)
        ↓
On payment: status = converted, agent assigned to finalize
        ↓
Manual or semi-automated build: swap preview → live site on our hosting
```

---

## Schema Additions

### `prospects`
| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `name` | text | Business name |
| `category` | text | Niche slug (e.g. `plumber`, `tattoo-shop`, `coffee-roaster`) |
| `city` | text | |
| `state` | text | 2-letter US state code for v1 |
| `country` | text | Default `US`, v1 enforces US-only |
| `contact_email` | text | Nullable |
| `contact_phone` | text | Nullable |
| `contact_channel` | text | `gmaps` / `ig` / `yelp` / `tiktok` / `fb` / `linkedin` / `nextdoor` / `etsy` / `other` |
| `source_query_id` | int FK → `prospect_niche_queries.id` | |
| `discovered_at` | timestamptz | |
| `status` | text | `discovered` / `queued` / `contacted` / `replied` / `converted` / `rejected` / `opt_out` |
| `last_contacted_at` | timestamptz | |
| `demo_token` | text UNIQUE | Signed token for preview URL |
| `demo_rendered_at` | timestamptz | |
| `demo_opened_at` | timestamptz | First view |
| `cta_clicked_at` | timestamptz | |
| `converted_at` | timestamptz | When Stripe payment succeeded |
| `assigned_agent` | text | For semi-manual follow-up post-conversion |
| `notes` | text | Admin free-form |

### `prospect_niche_queries`
Mirror of `directory_niche_queries` but for local-business SERP patterns.

| Column | Type |
|---|---|
| `id` | serial PK |
| `niche` | text (e.g. `plumber`, `tattoo-shop`) |
| `query_template` | text (with `{city}` / `{state}` placeholders) |
| `geo_strategy` | text (`top-100-us-cities` / `all-us-states` / etc.) |
| `cadence_hours` | int |
| `last_run_at` | timestamptz |
| `active` | bool |

### `prospect_outreach`
Mirrors `directory_outreach` from Initiative B — email tracking rows. Reuse the same shape with `prospect_id` FK instead of `company_id`.

### `prospect_subscriptions`
Standard Stripe subscription/checkout state, modeled on `creditscore_subscriptions`:
| Column | Type |
|---|---|
| `id` | serial PK |
| `prospect_id` | int FK → `prospects.id` |
| `plan_slug` | text (`build` / `hosting` / `bundle`) |
| `stripe_checkout_id` | text |
| `stripe_subscription_id` | text (null for one-time plans) |
| `stripe_customer_id` | text |
| `status` | text (`pending` / `active` / `canceled` / `failed`) |
| `started_at` / `canceled_at` | timestamptz |

### `prospect_website_plans`
Static pricing config, seeded via migration:
| Column | Type |
|---|---|
| `slug` | text PK (`build` / `hosting` / `bundle`) |
| `label` | text |
| `price_cents` | int |
| `recurring_interval` | text (null / `month` / `year`) |
| `stripe_price_id` | text |
| `active` | bool |

---

## Unwebsited Classifier

A SERP result set is "unwebsited" when **all of the following** are true:

1. Top 5 results are hosted on one of: `facebook.com`, `instagram.com`, `yelp.com`, `tiktok.com`, `google.com/maps`, `linkedin.com`, `nextdoor.com`, `etsy.com`.
2. No owned domain (.com, .net, .io, .co, .org, .biz, country TLD) appears in top 10.
3. The Google Business / Yelp result has a populated "Website" field that points back to one of the social platforms above (not their own domain).
4. Result count ≥ 3 (not a dead business; still has some online footprint).

Fail-safe: if classifier is unsure, skip rather than false-positive. Better to miss a real prospect than to cold-email a business that already has a website and insult their existing work.

---

## Demo Generator

For each `discovered` prospect, render a 5-page templated site:

**Pages:** home, about, services, contact, gallery.

**Template options:**
- `classic-local` — clean Swiss-inspired, works for most service businesses
- `creative-studio` — bolder, works for tattoo/design/creative
- `food-bev` — warmer palette, imagery-forward, works for coffee/cafe/restaurant

Template selected by niche → template mapping table.

**Content sources (all automated):**
- Business name + category from `prospects` row
- Hero text: "Welcome to {name}" / category-appropriate tagline
- Services section: 3-5 services inferred from niche (plumber → "Emergency repairs, installations, maintenance")
- Contact section: phone + social link from scraped contact channels
- Gallery: 3-6 images scraped from the GMaps listing if available, else generic category stock

**Hero image licensing (OPEN DECISION):** Scraping GMaps user-uploaded photos is legally gray. Safer: use royalty-free category stock (Unsplash/Pexels API) for demo, tell prospect "your photos will replace these when you sign up." Adds one more sentence to the email copy.

**Demo hosting:** static HTML generated per-prospect, stored in team-dashboard S3-compatible bucket, served via storefront rewrite. Each preview is gated by `demo_token` — no enumeration.

**Demo lifespan:** 90 days. If the prospect doesn't convert, the preview URL expires (returns "This preview has expired — contact us to rebuild").

---

## Storefront Changes (coherencedaddy-landing OR new outrizzd repo, per brand decision)

- `middleware.ts` — new subdomain route for `websites.` (or `outrizzd.build`) → `/websites-home`
- `app/websites-home/page.tsx` — pitch landing page. Not individual-prospect-specific; general product page for organic / brand traffic. Shows $499 build, $29/mo hosting, testimonials (once we have them), 3 template examples.
- `app/websites-preview/[token]/page.tsx` — server component that fetches `/api/prospects/preview/:token` (returns the generated HTML), renders with `dangerouslySetInnerHTML`, shows the "Claim this site — $499" CTA floating bottom-right.
- `vercel.json` — add `/api/prospects/:path*` rewrite to the VPS.
- `app/unsubscribe` — reuse the page from Initiative B; extend to handle prospect-outreach tokens too.

---

## Agent Assignments

| Agent | Task | Trigger |
|---|---|---|
| **prospect-serp-scan** (new service, not an agent) | Firecrawl SERP per niche + geo | 6-hourly cron |
| **Extractor** (reused from Initiative A) | Parse SERP result metadata | Inline |
| **Builder** (new agent, or reused Blaze) | Generate demo site HTML from template + prospect data | Hourly cron `prospects-demo-render` |
| **Prism** (existing) | Generate personalized outreach email per prospect | Inline in `prospects-outreach-send` cron |

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `prospects-serp-scan` | Every 6 hours | Run active niche queries; populate new `prospects` rows |
| `prospects-contact-extract` | Every 30 min | Process newly-scanned prospects, extract contact channel |
| `prospects-demo-render` | Hourly | Generate HTML previews for `discovered` prospects |
| `prospects-outreach-send` | `0 15 * * 1-5` (Mon-Fri 15:00 UTC — after Initiative B's 14:00) | Send up to 100/day with domain caps |
| `prospects-attribution` | Nightly | Sweep Stripe events → update `prospects.status = converted` |
| `prospects-demo-expire` | Nightly | Mark previews older than 90 days as expired |

---

## Backend Endpoints

All in new `server/src/routes/prospects.ts`:

**Public (no auth):**
- `GET /api/prospects/preview/:token` — returns generated HTML for a signed token
- `POST /api/prospects/checkout` — creates Stripe Checkout Session for `prospect_id + plan_slug`, returns `checkoutUrl`
- `POST /api/prospects/unsubscribe` — signed-token opt-out

**Admin:**
- `GET /api/prospects/list?status=&niche=&city=&limit=&offset=` — dashboard table
- `GET /api/prospects/:id` — detail view
- `PATCH /api/prospects/:id` — edit notes, assigned_agent, manual status change
- `GET /api/prospects/stats` — MRR, conversion funnel, niche performance
- `POST /api/prospects/queries` — CRUD on niche queries
- `POST /api/prospects/pause` — emergency stop flag
- `GET /api/prospects/:id/rebuild-demo` — force-regenerate demo

**Webhook:**
- `POST /api/prospects/stripe-webhook` — handle `checkout.session.completed` / `invoice.paid` / `customer.subscription.deleted`

---

## Admin UI (team-dashboard `ui/src/pages/Prospects.tsx`)

New page with 4 tabs:

1. **Queue** — table view: `name | city | niche | channel | demo_rendered | last_contacted | status | actions`. Columns sortable/filterable. Bulk actions: `send outreach`, `hide`, `assign to me`.
2. **Queries** — CRUD on `prospect_niche_queries` with per-niche conversion stats.
3. **Demos** — preview any prospect's rendered demo in an iframe + force-regenerate.
4. **Analytics** — funnel chart (discovered → contacted → clicked → converted), MRR waterfall, niche performance leaderboard.

Link at top of Dashboard homepage: "Prospects: {N} new today / {M} pending outreach".

---

## Seed Queries (v1)

Ship with ~15 niches × ~50 US cities = ~750 queries, cadence 24h (so ~30 SERP calls/hour steady-state).

**Niches:**
- plumber
- electrician
- HVAC contractor
- tattoo shop
- barber shop
- nail salon
- coffee roaster
- craft brewery
- yoga studio
- martial arts dojo
- dog groomer
- landscaper
- house cleaner
- independent bookstore
- farmers market vendor (harder — skip v1)

**Geo strategy:** top 50 US metro areas for v1. Expand after the funnel is tuned.

Query template example: `"{niche} in {city}, {state}"` — Firecrawl handles the rest.

---

## Rollout Milestones

**M0 — Brand decision (blocker)**
- Resolve Coherence Daddy vs OUTRIZZD vs new brand.
- Register domain.
- Set up Stripe account (if new brand) or reuse existing.
- Set up Resend domain.

**M1 — Schema + discovery only (1 week)**
- Migration for all 5 new tables.
- `prospect_niche_queries` seeded with ~10 niches × top 10 metros (smaller than v1 full config to keep SERP cost manageable during dev).
- `prospects-serp-scan` + `prospects-contact-extract` crons running.
- Admin UI Queue tab (read-only, no outreach yet).
- Smoke: verify 100+ prospects land in the DB; verify classifier precision by manual sampling.

**M2 — Demo generation (1 week)**
- Three templates live.
- `prospects-demo-render` cron running.
- Demo preview endpoint + storefront preview page shipped.
- Smoke: preview 10 rendered demos, confirm they look legitimate.

**M3 — Stripe + checkout (3 days)**
- `prospect_website_plans` seeded.
- Stripe products + prices created.
- `/api/prospects/checkout` working end-to-end (test a real $499 purchase with our own card, refund after).
- Webhook wired to flip `prospects.status = converted`.

**M4 — Outreach warmup week 1 (1 week)**
- Prism template for prospects live.
- Outreach cron at 10/day cap for week 1.
- Resend webhook receiver extended.
- Manual review of first 20 sends before the cron runs them.

**M5 — Warmup weeks 2-6 (5 weeks)**
- Scale to 100/day per Initiative B's warmup curve.

**M6 — Fulfillment (parallel with M5)**
- When a prospect converts, an agent (initially human-assisted) takes the template demo, swaps in real content per the owner, points the domain, and flips the live URL.
- Goal for v1: time-from-payment-to-live ≤ 7 days.
- Goal for v2: time-from-payment-to-live ≤ 24 hours with a "claim + edit" self-serve flow.

---

## Success Metrics

**30 days post-M5:**
- **10,000 prospects discovered**
- **2% preview CTR** (clicks from email → preview)
- **0.1% conversion** to $499 build (10/month at 10,000 sent)
- **Gross MRR from Build plan ≈ $5,000/mo**

**90 days:**
- Conversion rate ≥ 0.3% after tuning
- 30% of Build customers add Hosting at month 2 → additional $29 × 30% recurring

---

## Risks + Open Decisions

- **Brand dilution.** Biggest open question. Affects domain, tone, and positioning.
- **Demo image licensing.** Royalty-free stock is safe; GMaps photo scraping is not. Lean stock, take the copy hit.
- **CCPA/state-specific outreach laws.** Some states (CA especially) have restrictions beyond CAN-SPAM. Consult before scaling.
- **Demo quality floor.** A bad-looking auto-generated demo makes the pitch feel spammy and hurts the brand. Budget manual template iteration in M2.
- **Fulfillment scaling.** M6 is the hardest long-term problem. If conversions outpace human build capacity, the whole funnel backs up. Have a pause mechanism ready.
- **Legitimacy concerns.** Business owners will Google our brand before paying $499. Whichever brand we pick needs a credible web presence (about page, case studies, testimonials) before M4 sends.
- **Competitor collision.** Wix, Squarespace, GoDaddy already target this segment with higher ad spend. Our angle is "we already built it — no blank canvas." Pitch must lead with the preview link, not features.
- **Stripe flat-rate fraud.** $499 one-time invites chargeback risk. Standard Stripe dispute handling; consider requiring a signed acceptance before marking status=converted.

---

## Dependencies

- **Upstream:** brand decision, Stripe account, Resend domain, Firecrawl budget.
- **Upstream shared:** Initiative B's opt-out table + webhook receiver (build shared version in Initiative B; reuse here).
- **Downstream:** potential v2 — per-niche subdirectories on `directory.coherencedaddy.com` showcasing our built sites as case studies + lead magnets.

---

## Post-Ship Documentation Updates

When M5 completes:
- New `team-dashboard/docs/architecture/prospects-overview.md` with its own mermaid diagram (SERP → classifier → demo → email → checkout → fulfillment).
- `team-dashboard/docs/operations/cron-inventory.md` — 6 new crons.
- `team-dashboard/docs/deploy/env-vars.md` — new Stripe price IDs, demo S3 bucket, optional OUTRIZZD domain vars.
- `coherencedaddy-landing/docs/ARCHITECTURE.md` mermaid — add prospects storefront branch.
- `coherencedaddy-landing/CLAUDE.md` — document the new subdomain routing if we launched on `websites.coherencedaddy.com`, or remove reference entirely if launched under OUTRIZZD.
- Close Initiative C checkboxes in `TODO.md`.
- Add entry to team-dashboard `docs/architecture/org-structure.md` describing the Prospects team/agent assignment.
