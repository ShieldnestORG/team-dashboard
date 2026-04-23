---
name: Affiliate Learn & Teach Curriculum
description: Content outline for the /learn walk-through guides affiliates use to understand the product stack and pitch it to business owners
type: spec
status: draft v2 — content outline, pre-implementation
last_updated: 2026-04-23
---

# Affiliate Learn & Teach — Content Outline

## Purpose

Give affiliates a library of **walk-through guides** — same visual pattern as the existing [AffiliateHowItWorks](ui/src/pages/AffiliateHowItWorks.tsx) slide flow — so they can:
1. Understand the product stack well enough to explain it in plain English
2. Walk a business owner through what we do, how hands-off it is, and why AEO matters
3. Handle common objections without sounding rehearsed

Every guide is: **steps + screenshots + short paragraphs + optional video embed**. Not marketing copy. Not sales decks. Educational walk-throughs.

## Style guide (applies to every module)

- **Format:** HTML/CSS pages styled like `AffiliateHowItWorks` — numbered steps, eyebrow labels, one visual per step, short body copy. Alternative: raw MD files rendered with a simple walkthrough component. Either way, the *feel* is "read like a manual, not a pitch deck."
- **Tone:** Layman. Zero jargon without a plain-English swap in the same sentence. If the word "schema" appears, we failed.
- **Screenshots:** Real product screenshots (from the dashboard, the public landing, the creditscore report, directory listings, etc.). Not mockups.
- **Video embed slot:** Every module has a Loom/Vimeo embed field. Leave `null` for v1, fill in as we record.
- **Relationship-first framing:** Never teach affiliates to talk about commission, tiers, or money with the owner. The affiliate's earnings are *their* business — invisible to the pitch.

## Audience

- Authenticated affiliates, reading between visits on their phone or at home on a laptop
- Assumed baseline: knows what a website and a subscription are. Does NOT know SEO/AEO/LLM/citation jargon.
- Mobile-first layout required

## Access model

`/learn` is **ungated** (visible to non-logged-in visitors) so it doubles as a recruitment surface — potential affiliates can read the curriculum and get convinced. Logged-in affiliates get the same pages plus a "save for later" / "mark as read" lightweight state (localStorage is fine for v1, no DB).

Certification / progress tracking is **deferred** until we see engagement data.

## Page IA

New nav item on `AffiliateNav`: **Learn** — placed between `Tiers` and `Leaderboard`.

`/learn` — index page:
- Short intro: "Read these before your next owner visit."
- Section A: **Foundations** (start here)
  - AEO vs SEO explained in plain English
  - Reading the room: relationship vs transactional
  - The walk-in discovery flow
- Section B: **Product walk-throughs** (one per product)
  - CreditScore
  - Directory Listings
  - Partner Network
  - Intel API
- Section C: **Bundle walk-throughs**
  - AEO Starter, Growth, Scale, All-Inclusive
- Section D: **Objection handling** (walk-through style, scenario-based)

`/learn/:slug` — guide detail page: slide-style walk-through matching the HowItWorks pattern.

## Module schema

```ts
interface LearnGuide {
  slug: string;
  section: "foundations" | "product" | "bundle" | "objections";
  title: string;
  subtitle: string;                 // one-line plain-English hook
  readingMinutes: number;
  videoEmbedUrl: string | null;     // Loom/Vimeo — null for v1
  steps: Step[];
  relatedSlugs: string[];           // cross-links at the bottom
}

interface Step {
  number: number;                   // 01, 02, 03...
  eyebrow: string;                  // "Step 01", "The setup", etc.
  title: string;
  body: string;                     // 1-3 short paragraphs, layman
  screenshot: {
    src: string;                    // path in /public or CDN
    alt: string;
    caption?: string;
  } | null;
  callout?: {                       // optional emphasis block
    kind: "tip" | "watch-out" | "example";
    text: string;
  };
}
```

---

## Section A — Foundations

### Guide: AEO vs SEO, explained like you're talking to your uncle
- **Slug:** `foundations/aeo-vs-seo`
- **Subtitle:** "Your customers stopped Googling. They started asking."
- **Why this guide exists:** this is THE concept. Every other guide assumes the affiliate can explain this in 30 seconds without jargon.
- **Steps (proposed):**
  1. **How people used to find you.** You Googled "best plumber near me," clicked the top blue link, called. That was SEO — **Search Engine Optimization** — the game of ranking high on Google.
  2. **How people find you now.** They open ChatGPT and type "I've got a leak under my sink in Austin, who should I call?" ChatGPT picks one business and names it. One. Not ten blue links — one answer.
  3. **What changed.** The question isn't "how do I rank on Google" anymore. It's "does ChatGPT know my business exists and does it trust me enough to say my name out loud?"
  4. **What AEO means.** **Answer Engine Optimization.** Same idea as SEO but for the AIs — ChatGPT, Claude, Gemini, Perplexity. You're not optimizing for a search results page, you're optimizing to be the answer.
  5. **Why business owners don't know this yet.** Most owners are still paying someone for SEO that's two years behind. Nobody has told them the game changed. You're telling them.
  6. **The line you can use.** "SEO got you on Google. AEO gets you mentioned when someone asks an AI. They're different games — and right now most of your competitors aren't playing the new one yet."
- **Screenshots:** side-by-side Google SERP vs. ChatGPT answer for the same query. Maybe a screenshot of a real ChatGPT response naming a business.
- **Video slot:** yes
- **Callout (watch-out):** "Don't say 'LLM' or 'generative AI' in a pitch. Say 'ChatGPT' — the owner knows what that is."

### Guide: Reading the room — relationship vs transactional owners
- **Slug:** `foundations/reading-the-room`
- **Subtitle:** "Not every owner wants the same pitch. Know which one you're talking to in the first two minutes."
- **Why this guide exists:** most of our target owners are relationship-led. Pitching them like they're transactional is how you lose the deal. But some ARE transactional and *want* the numbers-first approach — misreading that also costs you.
- **Steps (proposed):**
  1. **Two kinds of owners.** Most small business owners fall on a spectrum. On one side: the person who knows every customer by name, cares about their community, and decides who to work with based on whether they trust you. On the other: the owner who runs a spreadsheet, wants ROI numbers, and doesn't care if you're nice — they care if it works.
  2. **Signs you're with a relationship-led owner.** They asked about you before asking about the product. Photos of family on the wall. They mention community, church, neighborhood, or "my customers." They talk about their business like it's a person.
  3. **Signs you're with a transactional owner.** They looked at their watch in the first minute. They asked "what does this cost" before asking what it does. They reference metrics, conversion rates, or other vendors by name. They have a framed MBA certificate.
  4. **How to pitch a relationship-led owner.** Slow down. Ask about their story. Make the pitch feel like you're helping a neighbor, not closing a deal. Lead with the hands-off factor — "you don't have to think about this, we just handle it for you" — because what they're buying is peace of mind.
  5. **How to pitch a transactional owner.** Speed up. Use numbers. Lead with the competitor tracking, the monthly report, the citation count. They want to see evidence, not feel a vibe.
  6. **When in doubt.** Default to relationship-led. It's the larger slice of our target ICP, and a transactional owner won't be offended by warmth — but a relationship-led owner WILL be put off by a cold numbers pitch.
- **Callout (tip):** "The single fastest read: do they ask *what does it do* or *who are you*? 'What does it do' → transactional. 'Who are you' → relationship."

### Guide: The walk-in discovery flow
- **Slug:** `foundations/discovery-flow`
- **Subtitle:** "Five questions to ask before you ever mention the product."
- **Steps (proposed):**
  1. **Why you ask before you pitch.** If you talk first, you're a salesperson. If you ask first, you're a consultant. Owners buy from consultants.
  2. **Question 1 — "Have any customers mentioned finding you through ChatGPT lately?"** Plain English. Gets them thinking about AI without the jargon. If the answer is yes, you have a warm lead. If the answer is "no, why?" — you have an opening.
  3. **Question 2 — "Do you know what shows up when I ask ChatGPT 'best [category] in [city]'?"** Almost nobody knows. Offer to show them, right there on your phone. This becomes the demo.
  4. **Question 3 — "Who handles your website and digital stuff right now?"** You're not trying to replace them. You're looking for the person you'll coexist with. Write the name down.
  5. **Question 4 — "What's roughly the monthly budget for all of that?"** Not to quote against — to gauge whether bundles or individual products fit. Also to respect their time.
  6. **Question 5 — "Want me to pull up a free scan of your site real quick?"** This is the bridge. The free CreditScore audit is live at coherencedaddy.com. 60 seconds. Ends with "here's what ChatGPT sees when it looks at your business" — and that's your pitch window.
- **Callout (example):** include a short mock dialogue showing the discovery flow in practice, with a real-feeling owner response.

---

## Section B — Product walk-throughs

### Guide: CreditScore walk-through
- **Slug:** `products/creditscore`
- **Subtitle:** "A credit score, but for whether ChatGPT trusts your business."
- **Steps (proposed):**
  1. **What it is in one sentence.** It's a score between 0 and 100 that tells a business owner how visible and trustworthy their site looks to an AI.
  2. **How it works (we do the work, they do nothing).** Every 6 hours we scan their site and rescore. They don't touch it. They get an email when the score changes.
  3. **What the three tiers get them.** One-time $29 audit (one scan, static report). $49/mo Starter (ongoing scans, trend chart, email alerts). $149/mo Pro (everything + competitor tracking + monthly coaching doc). Screenshot the actual report at each tier so the affiliate can recognize it.
  4. **What the owner actually does each month.** Opens one email. Maybe forwards a note to their web person. That's it.
  5. **What a good pitch sounds like.** Keep it about the owner, not the tech. "Want to see what your site looks like through ChatGPT's eyes? Takes 60 seconds, costs nothing." Let the product do the selling.
  6. **Where to send them to try it free.** coherencedaddy.com — the free scan is a real thing, not a trap. They don't even need to sign up.
- **Screenshots needed:** free scan flow, full report, monthly email, competitor tracking view
- **Video slot:** yes

### Guide: Directory Listings walk-through
- **Slug:** `products/directory-listings`
- **Subtitle:** "The Yellow Pages of the AI era — but the listings are written to be quoted, not just indexed."
- **Steps (proposed):**
  1. **What it is in one sentence.** Managed listings across our directory network, written every month so AI answers keep pulling fresh content about the business.
  2. **Why this matters.** LLMs trust businesses they see mentioned in more than one place. One Yelp listing isn't enough anymore.
  3. **The three tiers.** Featured $199/mo (managed listing, monthly refresh), Verified $499/mo (adds verification badge and review aggregation), Boosted $1,499/mo (adds top placement and syndication across partner microsites).
  4. **What the owner does.** Approves the first month's listing content at signup. Updates their hours if they change. That's it.
  5. **What we do.** Write and refresh content monthly. Distribute it across partner sites. Track which AI answers are pulling from it. Handle review aggregation.
  6. **What to show them.** A live example of a current client's listing. Shows real, not promised.

### Guide: Partner Network walk-through
- **Slug:** `products/partner-network`
- **Subtitle:** "Get mentioned by name in real editorial content — the way LLMs decide who's trustworthy."
- **Steps (proposed):**
  1. **What it is in one sentence.** A network of editorial microsites that write about real businesses by name. Monthly mentions, real content, real links.
  2. **Why LLMs care about this.** AIs learn who's trustworthy by seeing consistent, varied mentions across multiple sources. One site saying you're great = ignored. Five sites over three months = cited.
  3. **The three tiers.** Proof $49/mo (one mention/month), Performance $149/mo (three mentions + their own microsite page), Premium $499/mo (adds monthly editorial feature + inbound contact form).
  4. **What the owner does.** Sends us three bullet points about what they do. Once. At signup.
  5. **What we do.** Write the content, place it, rotate sites, refresh monthly so LLM crawlers keep seeing fresh material.
  6. **Addressing "is this a link farm."** Include a real example showing editorial quality. Show, don't tell.

### Guide: Intel API walk-through
- **Slug:** `products/intel-api`
- **Subtitle:** "The data pipe behind Coherence Daddy — for owners with a technical team."
- **Steps (proposed):**
  1. **Who this is for.** Agencies, consultancies, and SaaS companies that want to build on top of our data — not for most walk-in owner conversations. Know when to skip this one.
  2. **What it does.** Gives a developer access to AI visibility data as raw JSON.
  3. **The four tiers.** Free $0 (100 req/mo, attribution required), Starter $19/mo (5k req), Pro $49/mo (50k req + team), Scale $199/mo (500k req + priority).
  4. **How to spot a candidate.** They mention a dev team. They say "can we integrate this." They ask about white-labeling.
  5. **What NOT to do.** Don't pitch this to a plumber. Know when to set it down.

---

## Section C — Bundle walk-throughs

**Framing note for every bundle guide:** bundles are the cleanest story for a relationship-led owner. One invoice, one decision, we handle everything. Lead with bundles whenever budget allows; fall back to individual products only if the bundle is a hard no.

### Guide: AEO Starter walk-through
- **Slug:** `bundles/aeo-starter`
- **Subtitle:** "$199/mo — the starting package for owners who know AI matters but don't know where to start."
- **Steps (proposed):**
  1. **What's in it.** CreditScore Starter + Directory Featured + Partner Proof. Screenshot each inside the bundle.
  2. **Why it's the right entry point.** Three products instead of one. 33% cheaper than buying them separately. One invoice.
  3. **What the owner does each month.** Reads one email digest. Approves content at signup and never again unless they want to.
  4. **What we do each month.** Rescan site every 6 hours. Refresh directory listing. Place monthly brand mention across the partner network. Send one consolidated report.
  5. **How to present it.** Lead with the outcome, not the ingredients. "For $199 a month, your business shows up in AI answers, gets mentioned on other sites every month, and gets watched and coached automatically. You get one email a month. That's the whole relationship."
- **Screenshots:** bundle page on public site, consolidated monthly report, dashboard view

### Guide: AEO Growth walk-through
- **Slug:** `bundles/aeo-growth`
- **Subtitle:** "$499/mo — for owners past the curiosity phase who want volume."
- **Steps (proposed):** same structure as AEO Starter. CreditScore Pro + Directory Verified + Partner Performance. Emphasize: "this is for a business that already knows one solid lead pays for this several times over."

### Guide: AEO Scale walk-through
- **Slug:** `bundles/aeo-scale`
- **Subtitle:** "$1,299/mo — for businesses where AI visibility directly drives revenue."
- **Steps (proposed):** same structure. CreditScore Pro + Directory Boosted + Partner Premium + Intel Pro. Emphasize the Intel API inclusion unlocks integrations for the owner's own tooling.

### Guide: All-Inclusive walk-through
- **Slug:** `bundles/all-inclusive`
- **Subtitle:** "$2,499/mo annual — max tier of everything + Sage, your dedicated account manager."
- **Steps (proposed):** same structure, but the hero is **Sage**. "After signup, you barely talk to me. You talk to Sage. She handles everything." This is the differentiator for owners who just want the problem to go away.

---

## Section D — Objection handling (walk-through style)

Each objection gets its own short walk-through page — same pattern. Three steps: **what they said → what it actually means → how you respond.** Relationship-first. Never defensive.

### Guide: "We already have SEO / we already pay for marketing"
- **Slug:** `objections/we-already-have-seo`
- **Steps (proposed):**
  1. **What they said.** "We already pay someone for SEO."
  2. **What it actually means.** They feel like they already checked the box. They're not refusing — they're deflecting because they don't want a second line item.
  3. **How to respond.** Agree first, then reframe. "Good — SEO is important and you should keep it. What I'm talking about is the part of the internet SEO doesn't touch. When someone asks ChatGPT for a recommendation, SEO doesn't help there — that's a different system. Would you want to see what ChatGPT is saying about you right now?" This turns the objection into the demo.

### Guide: "Is this another dashboard I'll never log into?"
- **Slug:** `objections/another-dashboard`
- **Steps (proposed):**
  1. **What they said.** "I already have a dashboard for my website. I never look at it."
  2. **What it actually means.** They've been burned by software that required them to do work.
  3. **How to respond.** "Honestly, same. That's why the product is the email, not the dashboard. One email a month tells you if something needs your attention. The dashboard exists for when you want to dig in — which is probably never, and that's fine."

### Guide: "How do I know it's working?"
- **Slug:** `objections/how-do-i-know-it-works`
- **Steps (proposed):**
  1. **What they said.** "How do I know this actually works?"
  2. **What it actually means.** They've been sold vague services before. They want proof.
  3. **How to respond.** Show them the monthly report. Show a real client's trend line. Show a real AI answer pulling content we placed. Specifics beat promises. "Every month you get a number. If the number isn't moving, you cancel."

### Guide: "I need to think about it"
- **Slug:** `objections/need-to-think-about-it`
- **Steps (proposed):**
  1. **What they said.** "Let me think about it."
  2. **What it actually means.** One of three things: (a) they're not the decision maker, (b) they don't trust the product yet, (c) it's a polite no.
  3. **How to respond.** Don't push. Offer to run the free scan while you're there. "No commitment — let's just see what it says. Takes a minute." The scan itself becomes the follow-up hook; you leave them with a real artifact about their own business.

### Guide: "My nephew handles my website"
- **Slug:** `objections/nephew-handles-it`
- **Steps (proposed):**
  1. **What they said.** "My nephew / cousin / kid takes care of my website."
  2. **What it actually means.** They don't want to step on a family relationship.
  3. **How to respond.** Never position against the nephew. "Perfect — he'll love the monthly report. We handle the AI visibility piece, he keeps doing what he's doing. Not a replacement, an add-on."

### Guide: "How do I cancel?"
- **Slug:** `objections/how-do-i-cancel`
- **Steps (proposed):**
  1. **What they said.** "What if I want to stop?"
  2. **What it actually means.** They want to know it's safe to start.
  3. **How to respond.** Show them the cancel flow in the dashboard, directly. "One click. Month-to-month, no contract." Showing the cancel button builds more trust than avoiding the question.

---

## What we explicitly are NOT doing (v1)

- **No teaching affiliates to talk about commission in the pitch.** Their earnings are private to them. Any hint of "I get paid more if you upgrade" in the pitch poisons the relationship. (Removed from prior draft — that was wrong.)
- **No certification / progress tracking.** Deferred until we see engagement.
- **No admin CRUD for curriculum.** Content lives in TS/MD files for v1. Move to CMS only if content churn justifies it.
- **No gating.** `/learn` is visible to non-authenticated visitors so it doubles as recruitment.

## Implementation sketch (for after content sign-off)

- `ui/src/pages/AffiliateLearn.tsx` — index page listing all guides by section
- `ui/src/pages/AffiliateLearnGuide.tsx` — detail route rendering the slide-style walk-through (reuse the visual pattern from [AffiliateHowItWorks.tsx](ui/src/pages/AffiliateHowItWorks.tsx))
- `ui/src/content/affiliate-learn/` — one file per guide (TS or MDX — decide during build). Each file exports a `LearnGuide` matching the schema above.
- Add `/learn` + `/learn/:slug` routes in `App.tsx`
- Add `Learn` item to `AffiliateNav` between `Tiers` and `Leaderboard`
- Screenshots live in `public/affiliate-learn/` — named by slug
- Video embed field wired up now, left `null` until videos are recorded

## What I need from you before writing code

1. **Screenshot plan.** Who's capturing them? I can stub placeholder images so build can proceed, then swap in real screenshots as they arrive.
2. **File format.** TS-as-content (type-safe, requires deploy to edit) vs. MDX (a bit more flexible for prose + images). Leaning TS for v1 — smaller surface. OK?
3. **Section A ordering on the index page.** Foundations → Products → Bundles → Objections, or rearrange?
4. **Any guides missing.** The list above is what I'd build for v1. Anything you want added (e.g. a "how to leave a review that helps us rank" guide, or a "what to do after a signup" guide) before I lock it?
