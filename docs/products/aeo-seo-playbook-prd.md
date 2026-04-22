# PRD: AEO / SEO / AdSense Playbook (v1 — 2026-04-22)

> The explicit "Do / Don't" rulebook that every CreditScore agent output is generated against and every admin-review approval is scored against. Owned by the CreditScore product; consumed ecosystem-wide.

## Purpose

Codify, in one authoritative document, the set of rules that make a page:

1. **Rank** in classical search (Google SEO, Core Web Vitals, crawl health).
2. **Get cited** by LLM answer engines (ChatGPT, Perplexity, Claude, Gemini) — AEO.
3. **Monetize cleanly** without violating AdSense / Google policy or poisoning AEO trust signals.

The Auditor scores against it. Content Agent, Schema Agent, and Sage generate against it. The admin review UI surfaces the exact rules a draft passed or violated so an operator can approve/reject in one click instead of reading the whole draft.

Goal: **top-ranked, LLM-cited, AdSense-compliant pages, deterministically produced.**

## Consumers

| Consumer | How it reads the playbook |
|---|---|
| **Auditor** (audit microservice) | Converts rule violations into the 5-signal score (see `creditscore-prd.md`). |
| **Content Agent** (`server/src/services/creditscore-content-agent.ts`) | Injects the Do / Don't lists into its generation prompt; self-checks output before persisting a draft. |
| **Schema Agent** (`server/src/services/creditscore-schema-agent.ts`) | Validates generated JSON-LD against the Structured Data rules. |
| **Sage Strategist** (`server/src/services/creditscore-sage-strategist.ts`) | Produces weekly strategy docs whose recommendations must map back to rule IDs. |
| **Competitor Agent** | Tags competitor wins/losses with the rule IDs they exploit or violate. |
| **Admin Review UI** (team-dashboard — planned) | Shows per-draft a checklist of the rules this document defines; operator approves/rejects with the rule ID visible. |

## Rule schema

Every rule has a stable ID. **Never renumber** — agents and historical drafts reference these IDs. To retire a rule, mark it `deprecated: true`; don't delete.

```
{ id: "AEO-007", category: "AEO", severity: "must" | "should" | "avoid",
  rule: "...", why: "...", example_good?: "...", example_bad?: "..." }
```

A machine-readable mirror of this file lives at `server/src/content-templates/aeo-seo-rules.json` (to be added). The admin review UI fetches from there; the prose below is the source of truth humans edit.

## Do / Don't — Technical SEO (`SEO-*`)

### Do

- **SEO-001 (must)** Serve every page over HTTPS with a valid cert. HSTS where possible.
- **SEO-002 (must)** Core Web Vitals: LCP < 2.5s, INP < 200ms, CLS < 0.1 on mobile.
- **SEO-003 (must)** One `<h1>` per page, matching the primary query intent.
- **SEO-004 (must)** Unique `<title>` (50–60 chars) and `<meta name="description">` (140–160 chars) per URL.
- **SEO-005 (must)** Canonical tag on every indexable page, self-referential unless intentionally consolidating.
- **SEO-006 (should)** XML sitemap linked from `robots.txt`; updated within 24h of publish.
- **SEO-007 (should)** Internal links use descriptive anchor text, not "click here" or raw URLs.
- **SEO-008 (should)** Image `alt` text on every non-decorative image; decorative images `alt=""`.
- **SEO-009 (should)** Mobile-first layout: tap targets ≥ 44×44px, no horizontal scroll at 360px width.

### Don't

- **SEO-101 (avoid)** Intrusive interstitials on mobile (cookie walls exempt if dismissible in one tap).
- **SEO-102 (avoid)** Duplicate content across URLs without a canonical consolidating them.
- **SEO-103 (avoid)** Render-blocking JS that pushes LCP past 2.5s. Defer or inline critical CSS.
- **SEO-104 (avoid)** Orphan pages (no internal links in). Every indexable page needs ≥1 internal link.
- **SEO-105 (avoid)** `noindex` by accident on production — check every template's meta robots before publish.
- **SEO-106 (avoid)** Chains of 301 redirects longer than 1 hop.

## Do / Don't — Content SEO (`CONTENT-*`)

### Do

- **CONTENT-001 (must)** Lead with the answer. First 150 words must directly answer the primary query.
- **CONTENT-002 (must)** Target one primary query per page; supporting queries as H2s.
- **CONTENT-003 (should)** Cite primary sources (gov't, academic, original research) with outbound links.
- **CONTENT-004 (should)** Include author byline with credentials; author bio page with `sameAs` to LinkedIn/ORCID.
- **CONTENT-005 (should)** Publish date + last-updated date visible in page and in schema.
- **CONTENT-006 (should)** Use short paragraphs (≤3 sentences), frequent H2/H3, bulleted lists for scannable facts.
- **CONTENT-007 (should)** Include an FAQ section covering the top 3 related PAA queries.

### Don't

- **CONTENT-101 (avoid)** AI-generated prose published without a human editor touching it. Content Agent drafts require admin approval before publish.
- **CONTENT-102 (avoid)** Keyword stuffing. Target density < 2% on primary query.
- **CONTENT-103 (avoid)** Thin pages (< 300 words) on commercial intent queries.
- **CONTENT-104 (avoid)** Doorway pages — near-duplicate pages varying only by city/keyword.
- **CONTENT-105 (avoid)** Fake or undisclosed AI authorship bylines.

## Do / Don't — AEO (`AEO-*`)

Core insight: LLMs cite pages that are **citable** — unambiguous facts, clean structure, trustable provenance. Most "SEO content" fails this because it's fluffed for word-count.

### Do

- **AEO-001 (must)** Answer in a standalone sentence near the top. LLMs extract single sentences; if the answer is spread across 3 paragraphs it won't get cited.
- **AEO-002 (must)** Use entity-rich phrasing. Say "Stripe Radar (Stripe's fraud product)" not "their fraud tool."
- **AEO-003 (must)** Facts in tables where possible. LLMs parse tables better than prose for numeric data.
- **AEO-004 (must)** Include a brief, explicit "What is X?" definition even when the whole page is about X. That sentence is what gets quoted.
- **AEO-005 (should)** Publish an `/about` and `/authors/{name}` page. Answer engines lean hard on entity authority; a 1-line footer isn't enough.
- **AEO-006 (should)** Use stable, human-readable URLs (`/guides/stripe-radar-pricing`, not `/p?id=4892`).
- **AEO-007 (should)** Include a TL;DR block above the fold. `summary` schema extraction prefers it.
- **AEO-008 (should)** Offer a structured facts block ("Founded: 2010 · HQ: San Francisco · Employees: 9,000") — this is what gets lifted into Perplexity cards and ChatGPT cites.
- **AEO-009 (should)** Keep the primary answer stable across time. LLM caches reward stability; wholesale rewrites reset trust.

### Don't

- **AEO-101 (avoid)** Burying the answer under SEO intro fluff ("In today's fast-paced world…"). LLM extractors skip the page.
- **AEO-102 (avoid)** Pronoun-only references ("it", "this", "the company") in fact-bearing sentences. The extracted sentence will be ambiguous and dropped.
- **AEO-103 (avoid)** Facts only inside images or video. LLMs can't cite what they can't read.
- **AEO-104 (avoid)** Paywall / login wall the primary answer. If the cite-worthy sentence is gated, the page won't get cited.
- **AEO-105 (avoid)** Contradicting your own prior content without explicit "Updated YYYY-MM-DD: previously we said X, now Y." LLMs notice contradictions and downrank.
- **AEO-106 (avoid)** Over-anthropomorphized AI-generated prose ("Let's dive in!" "Buckle up!"). These phrases are strong AI-slop signals and are getting filtered by answer engines.

## Do / Don't — Structured Data (`SCHEMA-*`)

### Do

- **SCHEMA-001 (must)** JSON-LD, not Microdata or RDFa. One `<script type="application/ld+json">` per type.
- **SCHEMA-002 (must)** Match schema content to visible page content exactly. Google's structured-data spam policy triggers on mismatches.
- **SCHEMA-003 (must)** Every page: `WebPage` + `BreadcrumbList`. Article pages add `Article` (or `NewsArticle` / `BlogPosting`). Product pages add `Product` + `Offer`. Service pages add `Service` + `Organization`.
- **SCHEMA-004 (must)** `Organization` schema on the homepage with `name`, `url`, `logo`, `sameAs` (social + Wikipedia + Crunchbase where applicable).
- **SCHEMA-005 (should)** `FAQPage` schema when the page has a visible FAQ section. Don't fake one.
- **SCHEMA-006 (should)** `HowTo` schema on step-by-step guides with `step` arrays.
- **SCHEMA-007 (should)** `author` as a full `Person` entity with `url`, `sameAs`, `jobTitle`. Strings are downweighted.
- **SCHEMA-008 (should)** `datePublished` + `dateModified` in ISO 8601.

### Don't

- **SCHEMA-101 (avoid)** Review schema for reviews that aren't visible on the page (policy violation).
- **SCHEMA-102 (avoid)** Aggregate rating without an actual `reviewCount` source.
- **SCHEMA-103 (avoid)** `HowTo` on marketing pages that aren't actually how-tos.
- **SCHEMA-104 (avoid)** Stuffing irrelevant types (e.g., `Event` schema on a product page).
- **SCHEMA-105 (avoid)** Mixing `@type` inside a single JSON-LD block incorrectly — validate every change in Google's Rich Results Test.

## Do / Don't — AdSense & Monetization (`ADS-*`)

AdSense rules double as AEO trust signals — an ad-spammy page rarely gets LLM-cited.

### Do

- **ADS-001 (must)** Separate ads from content visually. Never make ads look like navigation, answers, or download buttons.
- **ADS-002 (must)** Label sponsored and affiliate content ("Sponsored", `rel="sponsored"`, `rel="nofollow"` where appropriate).
- **ADS-003 (must)** Publish a Privacy Policy, Terms, and Contact page linked from every footer. AdSense approval and LLM trust both require them.
- **ADS-004 (must)** Cookie consent banner for EU/UK traffic (TCF v2.2 compliant if serving personalized ads).
- **ADS-005 (should)** Max 3 ad units above the fold on desktop, 1 on mobile. LCP suffers otherwise.
- **ADS-006 (should)** Use `loading="lazy"` on below-the-fold ad containers.

### Don't

- **ADS-101 (avoid)** Click-bait ad placement that obscures the primary answer.
- **ADS-102 (avoid)** Auto-play audio or unskippable interstitial ads.
- **ADS-103 (avoid)** Pop-ups on entry. Allowed: exit-intent, explicit user-action triggered.
- **ADS-104 (avoid)** Thin content pages served primarily to host ads — AdSense policy violation and instant AEO disqualifier.
- **ADS-105 (avoid)** Artificial traffic inflation or paid clicks. Instant ban.
- **ADS-106 (avoid)** More ad weight than content weight. If the page is > 40% ad pixels above the fold, rework it.

## Severity → score mapping

| Severity | Violation impact on CreditScore 0–100 |
|---|---|
| `must` violated | −8 points per unique violation, capped at −40 per category |
| `should` violated | −2 points per unique violation |
| `avoid` present | −5 points per unique violation |

Auditor emits one row per `{rule_id, url}` pair into `creditscore_report_findings`. The admin review UI groups by rule_id.

## Agent integration

### Content Agent

- Prompt prepends the full `CONTENT-*` and `AEO-*` Do lists and the Don't lists.
- After draft, runs a deterministic self-check: regex for AEO-106 slop phrases, word-count check for CONTENT-103, H1 count for SEO-003.
- Drafts failing `must` rules are marked `status=needs_revision` and never surfaced to admin review. Drafts with only `should`/`avoid` violations are surfaced with violations highlighted.

### Schema Agent

- Every generated JSON-LD goes through local validation (schema type registry + required fields) before persist.
- Rule IDs violated are attached to the `schema_impls.validation_errors` JSONB column.

### Sage Strategist

- Weekly strategy docs are constrained to recommend changes in terms of rule IDs. Prompt: "Every recommendation must cite the rule_id it addresses."
- This makes recommendations actionable and trackable in the admin UI.

## Admin review UI (forward reference)

The planned team-dashboard admin review UI for `content-drafts`, `schema-impls`, `competitor-scans`, `strategy-docs` (~500–800 LOC React, next chunk in this repo) consumes this playbook by:

- Fetching `aeo-seo-rules.json` once per session.
- Rendering a per-draft checklist of rules the content passed / violated.
- Exposing one-click approve (writes `approved_at`, `approved_by`) and reject-with-reason (operator picks the rule_id(s)).
- Rejected drafts go back to the agent with the failed rule_ids as the revision prompt.

Not in this PRD's scope to build; captured here so the playbook's machine-readable contract (`aeo-seo-rules.json`) is specified before the UI consumes it.

## Maintenance

- **Owner:** CreditScore product.
- **Review cadence:** Monthly on the 1st. Sage drafts proposed changes based on the month's observed wins/losses; human approves.
- **Changelog:** Append-only section at bottom of this file. Never rewrite history — deprecate with a date.
- **Stability contract:** Rule IDs are permanent. Severity can change; text can be clarified; rules can be deprecated. New rules get the next ID in the category.

## Out of scope

- The audit microservice itself (external, owned separately).
- Storefront-side implementation of any of these rules on coherencedaddy.com (owned in `coherencedaddy-landing`).
- Backlink / off-page SEO strategy (separate PRD if/when we productize).

## Changelog

- **2026-04-22** — v1 initial. 48 rules across 5 categories.
