---
name: Affiliate Learn & Teach — Running TODO
description: Iteration list for the /learn curriculum. Screenshot plan, content polish, v2 ideas, and notes discovered during build.
type: running-todo
last_updated: 2026-04-23
---

# Affiliate Learn — Running TODO

Index of everything that's still open, discovered during the v1 build, or lined up for v2. Update this doc whenever a new TODO surfaces.

## Status as of 2026-04-23

**Shipped (v1):**
- 17 walk-through guides across 4 sections (foundations, products, bundles, objections)
- `/learn` index page + `/learn/:slug` detail page
- Nav entry added between Tiers and Leaderboard
- Ungated (works without affiliate login, gets AffiliateNav when logged in)
- Screenshot placeholders with graceful fallback ("[ screenshot pending — alt text ]")
- Video embed slot wired, set to null for all guides, placeholder card renders instead
- Typecheck clean (server + ui)

**Where things live:**
- Content: [ui/src/content/affiliate-learn/](../../ui/src/content/affiliate-learn/) — one TS file per section
- Pages: [AffiliateLearn.tsx](../../ui/src/pages/AffiliateLearn.tsx), [AffiliateLearnGuide.tsx](../../ui/src/pages/AffiliateLearnGuide.tsx)
- Routes: `/learn` and `/learn/:slug` in [App.tsx](../../ui/src/App.tsx) under `AffiliateSite`
- Nav: [AffiliateNav.tsx](../../ui/src/components/AffiliateNav.tsx)
- Content spec: [affiliate-learn-curriculum.md](./affiliate-learn-curriculum.md)

## Screenshots to capture

Every `screenshot.src` path in the content files currently points to a placeholder. The detail page renders a graceful fallback while they're missing, so nothing is broken — but the guides read thin without them.

Plan: use a Claude browser agent to capture real screenshots from the live products. Save to `ui/public/affiliate-learn/screenshots/` with the exact filenames referenced below.

### Foundations
- [ ] `placeholder-google-serp.png` — Google SERP for "best plumber near me" or similar. Shows blue-link era. Real, anonymized.
- [ ] `placeholder-chatgpt-answer.png` — ChatGPT giving a single-business recommendation for a natural-language query. Real answer, real business (with permission) or a CD client.
- [ ] `placeholder-creditscore-free-scan.png` — the input field on coherencedaddy.com where a URL is entered for the free scan

### Products
- [ ] `placeholder-creditscore-hero.png` — CreditScore report hero view, big numeric score, trend below
- [ ] `placeholder-creditscore-trend.png` — 30-day trend chart on CreditScore report
- [ ] `placeholder-creditscore-tiers.png` — three-column pricing showing $29 / $49 / $149 tiers
- [ ] `placeholder-directory-listing.png` — example live directory listing page for a real client
- [ ] `placeholder-directory-tiers.png` — Directory Listings pricing tiers (Featured / Verified / Boosted)
- [ ] `placeholder-partner-network.png` — example partner microsite editorial page mentioning a business
- [ ] `placeholder-partner-tiers.png` — Partner Network tiers (Proof / Performance / Premium)
- [ ] `placeholder-intel-api-docs.png` — Intel API docs page showing a JSON response example

### Bundles
- [ ] `placeholder-aeo-starter.png` — AEO Starter bundle landing/pricing page
- [ ] `placeholder-aeo-growth.png` — AEO Growth bundle page
- [ ] `placeholder-aeo-scale.png` — AEO Scale bundle page
- [ ] `placeholder-all-inclusive.png` — All-Inclusive bundle page featuring the Sage callout

### Objections
- [ ] `placeholder-monthly-email.png` — example of the monthly client email digest (redact sensitive data)
- [ ] `placeholder-monthly-report.png` — full monthly client report with score trend and citation count
- [ ] `placeholder-cancel-flow.png` — dashboard view showing the cancel subscription button visible

### Capture workflow
1. Run the browser agent against each target URL (public pages or logged-in admin views)
2. Name file exactly as listed above
3. Save to `ui/public/affiliate-learn/screenshots/`
4. Verify the detail page renders real images (placeholders auto-swap)

## Video embed plan

Every guide has a `videoEmbedUrl: string | null` field. All null for v1.

Priorities for first recordings (highest impact):
1. **AEO vs SEO** — the foundational concept, would massively boost conversion for recruitment
2. **CreditScore** — most common product pitch, showing the live free scan is gold
3. **Reading the room** — soft-skills content works much better as video than text
4. **Discovery flow** — demo the 5 questions in a mock walk-in

Format suggestion: Loom or Vimeo, 2-4 min per video. Fill in `videoEmbedUrl` with the embed URL, the detail page auto-replaces the placeholder with the player.

## Content polish — things spotted during build

- [ ] **Commission callout** — the curriculum spec had a commission-math module; killed per user feedback. BUT — consider adding a small, separate, logged-in-only page at `/learn/commission-reference` that just shows "at your current tier, a $199/mo bundle pays you $X/mo" — pure reference, no scripting. Separate from the teaching curriculum.
- [ ] **Sage bio page** — every bundle guide mentions Sage. Right now there's nothing for an affiliate to link to. Consider a `/learn/team/sage` page with a photo, bio, and "when to bring Sage in" criteria.
- [ ] **Language pass on objections** — the 6 objection guides use some direct language. User said tone is "relationship-led, not transactional." Do a warmth pass once first affiliates give feedback.
- [ ] **\"My nephew handles it\" variants** — in some markets this will be "my brother-in-law" or "my church friend." Consider adding 2-3 alternate phrasings in the same guide.
- [ ] **Industry-specific pitches** — currently generic. v2 idea: "CreditScore for a plumber" / "CreditScore for a lawyer" micro-guides showing how to tune the pitch for specific industries. Defer until we see which verticals affiliates are actually working.

## v2 ideas (not blocking)

- [ ] **Progress tracking** — localStorage "read" state with a checkmark on each guide card. No backend needed. Would show affiliates how far they've gotten without forcing certification.
- [ ] **Mobile-optimized "quick reference"** mode — one-page condensed version of each guide showing just the Step titles + the watch-outs + the "one line" callouts. For affiliates checking their phone in the parking lot before a visit.
- [ ] **Print / Save as PDF view** — separate `/learn/:slug/print` route with print-optimized CSS for one-pagers the affiliate can hand to the owner. Currently deferred.
- [ ] **"After the pitch" guide** — what to do after a signup: submit attribution, follow-up cadence, how to keep the relationship warm. Would fit under Foundations.
- [ ] **Roleplay library** — 2-3 mock dialogues per product showing a full pitch from "hello" to "they said yes." Could be static written scripts or future video.
- [ ] **Leaderboard tie-in** — show "X affiliates have read this guide" under each card. Social proof for curriculum engagement.
- [ ] **Admin CRUD for curriculum content** — deferred per spec. Revisit only if content is edited more than once per week.

## Structural things discovered during build

- **Preview server quirk** — `/affiliates.` subdomain simulated locally via `?affiliate=1` query param (see `IS_AFFILIATES_SUBDOMAIN` check in App.tsx). All internal `<a href="/learn/...">` links preserve path but DROP the query — need to confirm prod affiliate subdomain routing handles these paths correctly. Test once deployed. (Relevant to SPA route resolution on Vercel/VPS.)
- **Pre-existing runtime error** — `AffiliateHowItWorks.tsx` has a `ReferenceError: MapPin is not defined` in the Vite preview console. Not caused by Learn work but noticed during verification. Separate fix.
- **Documentation** — [docs/architecture/structure-diagram-policy.md](../architecture/structure-diagram-policy.md) says structural changes should update the company structure diagram. This adds new routes but no backend surface — confirm if UI-only route additions warrant a structure diagram update.

## Backlog bucket — ideas that aren't formed enough to spec

- Interactive "pick your prospect type" flow that walks an affiliate through a decision tree and outputs which guide to read next
- Shareable quote cards extracted from the guides (Twitter-style) affiliates can post to their own social
- Weekly "new guide" email to affiliates when content is added
- Annotated transcripts of real successful pitches (with permission)
