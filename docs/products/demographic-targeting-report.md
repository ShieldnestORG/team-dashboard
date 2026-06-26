# Demographic Targeting Report — Coherence Daddy Ecosystem

> **Cluster:** Products · **Tags:** demographics, personas, funnel, targeting, channels, ltv · **Related:** [CreditScore PRD](./creditscore-prd.md), [Directory Listings](./directory-listings-prd.md), [100 Agents](./agents-product-prd.md), [Ownership Matrix](../OWNERSHIP.md)

**Date:** 2026-04-30
**Purpose:** Map every revenue surface to a primary buyer persona, the channel that reaches them, and the path back to `coherencedaddy.com` as the central portal.

---

## TL;DR — three audiences, one funnel

The portfolio looks scattered, but every product fits one of three buyers. The
central portal at `coherencedaddy.com` is the only place all three ever meet —
which means it has to do three jobs at once and route each visitor to "their"
product within a click.

| # | Buyer | Knows AEO? | Anchor product | Anchor price | Lifetime value |
|---|-------|-----------|----------------|--------------|----------------|
| 1 | **SMB / local owner** (HVAC, dentist, salon, lawyer, restaurant) | No | CreditScore $19 audit | $19 → $49 → $199 | $588–$5,988/yr |
| 2 | **Crypto / AI / DeFi project team** (founder, marketing lead) | Yes | Directory Featured | $199 → $1,499 | $2,388–$31,000/yr |
| 3 | **Indie dev / AI engineer** (builder, plugin author, agent dev) | Implicitly | Intel API Free | $0 → $19 → $49 | $0–$2,388/yr |

A fourth surface — the **owned utility-site network** and the public
**Coherence-Daddy GitHub org** — is not a buyer; it's an *attention engine*
that drops cookies and email captures into the funnel for buyers #1 and #3.

---

## 1. Site & service inventory

A scrape of the public surfaces, grouped by what they actually do for revenue:

### Revenue products (the four-stack + bundles)
- **CreditScore** — `coherencedaddy.com/creditscore` — SEO+AEO audit, $19 / $49 / $199 / $499.
- **Directory Listings** — `directory.coherencedaddy.com` — paid AI-citation placement, $199 / $499 / $1,499/mo.
- **Partner Network** — `coherencedaddy.com/partners` + microsite at `{slug}.coherencedaddy.com` — content-mention subscription, $49 / $149 / $499/mo.
- **Intel API** — `api.coherencedaddy.com` (pricing at `/intel/pricing`) — data API, $0 / $19 / $49 / $199/mo.
- **Bundles** — `/bundles` — packaged combinations, $199 / $499 / $1,299/mo + All-Inclusive $2,499/yr.

### Vertical directories (specialized Directory Listings spinouts)
- Faith-Tech Directory, Cosmos IBC Directory, EigenLayer AVS Directory — niche placements that sit under the Directory rails but have their own audience profile.

### Attention surfaces (no direct revenue, drive traffic in)
- **Coherence-Daddy GitHub org** — public tutorials/skills repos (e.g. `use-ollama-to-enhance-claude`). Built to be forked, starred, shared on Twitter.
- **Tutorials Hub** — `coherencedaddy.com/tutorials/<slug>` — long-form share-ready content with mirrored GitHub repos.
- **Owned Utility-Site Network** — VPS3-hosted standalone tools (compound interest calc, immigration multi-tool, AI token counter/cost estimator). Display-ad monetized via AdSense → Ezoic/Mediavine; cross-links into CD where audience overlaps.
- **Socials Hub / Blog Distribution** — internal automation that fans CD content out to Twitter, LinkedIn, Bluesky, Discord, dev.to, HN.
- **Launch Monitor** — replies to launch-post comments on HN/Reddit/dev.to; effectively a CD ambassador on other people's surfaces.

### Operational / governance (not customer-facing)
- Team Dashboard itself, Knowledge Graph (now positioned as silent enrichment of Intel API responses, not a SKU), Affiliate / Learn curriculum, Shop Sharers.

---

## 2. Per-product demographic profile

### CreditScore — SMB owners who don't know AEO exists yet

- **Who they are:** owner-operators and small-team marketing leads at U.S. local businesses (HVAC, dentists, lawyers, real-estate brokers, restaurants, e-comm DTC sub-$5M revenue). Age 35–60. Already buying Yelp/Google Ads/SEO services.
- **Pain we name:** "When someone asks ChatGPT for the best dentist in [city], are they getting your name?" They don't know AEO is a thing — that's the wedge.
- **Buying trigger:** $19 is a coffee. They run the audit out of curiosity, see a 28/100 score, and the report itself does the upsell to Starter/Growth.
- **Channels that work:**
  - Twitter / LinkedIn threads with screenshots of the audit ("ran this on 50 dentists, here's what we found"). Blaze publishes these.
  - Reddit communities: r/smallbusiness, r/Entrepreneur, r/digitalmarketing, industry subs (r/HVAC, r/dentistry).
  - Local SEO podcasts and newsletters — guest spots and sponsorships.
  - **Shop Sharers / referral codes** — every audit has a shareable HTML report; the report itself is the marketing asset.
- **Channels to skip:** ProductHunt, HN, dev.to. Wrong audience.
- **Funnel back to portal:** Every audit report carries a `coherencedaddy.com/audit/{slug}` URL. The audit report is the front door — it has to convert "this is a cool tool" into "I want monthly monitoring." This is where the bulk of TOFU email capture lives.

### Directory Listings — crypto / AI / DeFi project teams

- **Who they are:** founder, head of growth, or marketing lead at a 5–50-person crypto, DeFi, or AI infra project. Already burning $5–25k/mo on content and Twitter agencies. Already understand "we need to be cited by AI."
- **Pain we name:** "You write the content yourself. We have agents that publish 2/5/15 mentions a month, every month, on schedule, and we track the clicks."
- **Buying trigger:** they see a competitor in our directory. Or they hit our directory via a "best [x] projects" article we published. Or a partner referral.
- **Channels that work:**
  - Crypto Twitter — Blaze posts trend reports that cite directory companies. The cited companies see the post and self-onboard.
  - Vertical directories as wedges: a Cosmos project lands on Cosmos IBC Directory, then upgrades to broader Directory.
  - Discord ecosystems — Spark agent posts in chain-specific Discords with directory links.
  - Conference list-buying and outbound (Token2049, Devcon, EthCC, ETHGlobal hackathons).
  - Affiliate revshare with crypto newsletters (Bankless, The Defiant) — they get a cut of any signup.
- **Channels to skip:** Google Ads (too expensive, low intent), Reddit (too retail).
- **Funnel back to portal:** `directory.coherencedaddy.com` should always link upstream to `coherencedaddy.com/bundles` for the AEO Scale tier. A Boosted listing customer is one bundle conversation away from $1,299/mo.

### Partner Network — SMB owners who DO know they need content

- **Who they are:** same demographic as CreditScore TOFU, but one notch up the awareness ladder. They've heard "you need content." They tried ChatGPT-generating it themselves and hated it.
- **Pain we name:** "We write it. We publish it. You get a microsite at `you.coherencedaddy.com`. Every month, mentions land in your dashboard with click counts."
- **Buying trigger:** their CreditScore audit shows AEO score <40 — the in-product CTA routes them straight here.
- **Channels that work:**
  - **CreditScore is the channel.** ~70% of Partner Network signups should originate from a CreditScore audit's recommendation block. If it's lower than that, the CreditScore-to-Partner CTA is broken.
  - Local-business newsletters and chamber-of-commerce sponsorships.
  - The `{slug}.coherencedaddy.com` microsite itself is a marketing asset — every existing partner is a billboard for the next one.
- **Funnel back to portal:** the partner dashboard at `/partner-dashboard/{slug}` already lives on the central domain. Bundle CTAs (AEO Starter $199) belong on the dashboard, not just the pricing page.

### Intel API — indie devs and AI agent builders

- **Who they are:** solo developers, two-person AI-startup founders, hackathon teams, agent framework authors, crypto analytics tinkerers. Build with Claude / OpenAI / Cursor. Cheap, technical, value documentation > sales calls.
- **Pain we name:** "Live data on 500+ crypto + AI projects. One API. Free tier. No scraping."
- **Buying trigger:** they hit our docs via a Google search for "blockchain TVL API" or "github stars API for crypto projects." They use the free tier for a hackathon. They ship something. They upgrade.
- **Channels that work:**
  - **Coherence-Daddy GitHub org** — public tutorial repos that demonstrate Intel API usage. This is why the public org exists.
  - dev.to, HN Show, ProductHunt, Twitter/X dev community.
  - Hackathon sponsorships (small $ for ETHGlobal / Constellation / agent-themed events).
  - Discord presence in agent-builder communities (LangChain, AutoGen, CrewAI, Claude builder circles).
  - Sponsored mentions in dev newsletters (Bytes, JavaScript Weekly, AI Tidbits).
- **Funnel back to portal:** the API docs page must link to `coherencedaddy.com` and to the Tutorials Hub. Free → Starter conversion is mostly self-serve quota-pressure.

### Bundles — the upsell, not an entry point

- **Who they are:** existing single-product customers who've been paying for 2–4 months and gotten a result. Bundles are a *retention and ARPU* play, not a TOFU play.
- **Channels that work:**
  - In-app banners on every product page: "You're 60% of the way to AEO Starter — add Directory Featured for +$0/mo at this bundle." (The math works because bundle Featured = Featured price.)
  - Lifecycle email at month-3 of any subscription.
  - Quarterly Sage check-ins for Pro tier customers.
- **Channels to skip:** anything cold. No one buys a $1,299/mo bundle on a first visit.

### Owned Utility Network — display-ad arbitrage that *also* drops the CD logo

- **Who they are:** anyone Googling "compound interest calculator," "H1B visa wait time," "openai token counter." Hyper-transient, but the AI/LLM tooling pair (token counter + cost estimator) overlaps directly with Intel API's audience.
- **Channels that work:**
  - SEO is the entire strategy — this is a long-tail organic play.
  - Cross-link from CD where the audience overlaps (token counter → Intel API; nowhere else).
- **Funnel back to portal:** only on the AI-tooling sites. Compound interest, immigration, etc. should NOT cross-link to CD — wrong audience, hurts ad density. Treat them as standalone revenue.

### Coherence-Daddy GitHub org / Tutorials Hub — top-of-funnel for builders

- **Who they are:** developers who found us via a tweet, a starred repo, or a Google search for "how to give Claude memory." They're not buyers yet; they're future Intel API customers (and a small fraction of Directory customers when their own crypto/AI side project gets bigger).
- **Channels that work:**
  - Twitter/X — every new tutorial gets a launch thread with a video.
  - HN Show — soft cadence, one good launch every 6–8 weeks.
  - Reddit r/ClaudeAI, r/LocalLLaMA, r/programming.
  - The Skill itself spreading peer-to-peer (the `becoming-a-coherence-agent` skill model).
- **Funnel back to portal:** every tutorial repo's README links to `coherencedaddy.com`. Every tutorial page has an Intel API and Bundles CTA in the footer. This is where the email-capture-to-newsletter handoff lives.

---

## 3. Pulling everyone back to the central portal

Three audiences, one URL: `coherencedaddy.com`. The portal needs to do
*audience routing* in the first viewport — not "explain the company."

### Recommended hero structure

A three-card chooser above the fold, no marketing prose:

1. **"I run a local business."** → CreditScore audit, $19.
2. **"I'm building a crypto / AI project."** → Directory listings + Intel API.
3. **"I'm a developer."** → Tutorials + free Intel API key.

This replaces a generic "AEO platform" pitch that tries to speak to all three at once and converts none of them.

### Single email list, segmented on entry

Every entry point captures email and tags the lead with their audience:
- Audit submitter → `audience=smb`
- Directory enrolment → `audience=project`
- Intel API signup → `audience=dev`
- Tutorial download → `audience=dev`
- Utility-network email capture (AI tooling sites only) → `audience=dev`

Lifecycle email then upsells *within* their lane. Don't pitch Directory to dentists or Partner Network to indie devs.

### Cross-product CTAs (rules)

- **CreditScore audit → Partner Network** when AEO sub-score <40.
- **CreditScore audit → Directory Featured** when AEO sub-score 40–65.
- **Directory Boosted → AEO Scale bundle** at month 2.
- **Intel API Pro → CreditScore audit** as a "see how your own project ranks" prompt.
- **Tutorials → Intel API free tier** as the "now build something" CTA at the bottom of every tutorial.
- **Utility Network → CD** only on AI-tooling sites, never on finance/immigration/contractor sites.

### What to STOP doing

- Stop putting all four products on the same hero. Pick the three audience cards, route in.
- Stop cross-promoting Directory inside SMB-targeted content. Crypto-Twitter language poisons CreditScore conversion.
- Stop putting CD links on the compound-interest / immigration / contractor utility sites. Wrong audience, hurts ad density, the network is a separate revenue line.

---

## 4. Proposed targeting matrix (decision-ready)

| Product | Primary persona | Best channel | Secondary channel | Don't bother |
|---------|----------------|--------------|-------------------|--------------|
| CreditScore | SMB owner-operator | Twitter audit threads + Reddit r/smallbusiness | Local-SEO podcasts | HN, dev.to |
| Partner Network | SMB owner with budget | CreditScore in-product CTA | Chamber of Commerce sponsorships | Crypto Twitter |
| Directory Listings | Crypto/AI project team | Crypto Twitter + Discord ecosystems | Bankless/Defiant revshare | Reddit |
| Intel API | Indie dev / agent builder | Coherence-Daddy GitHub + dev.to | Hackathon sponsorships | LinkedIn |
| Bundles | Existing 3-month customers | In-app banner + lifecycle email | Sage quarterly call | Cold ads |
| Tutorials Hub | Developer / Claude user | Twitter launch threads + HN | r/ClaudeAI | Paid ads |
| Utility Network | SEO long-tail searcher | Organic Google | (none) | Paid promotion |

---

## 5. Open questions to resolve before spending

1. **Hero rebuild ownership** — the three-card chooser lives in `coherencedaddy-landing`, not this repo. Who owns the redesign sprint?
2. **Audience tag plumbing** — is there a single email list system across CreditScore, Directory, Intel, Tutorials? If not, the segmented lifecycle plan can't run.
3. **Utility network ad density vs. CD cross-link** — confirm the AI-tooling pair is the *only* utility site that cross-links. Decision should land in `docs/products/utility-network/README.md`.
4. **Per-vertical-directory branding** — Faith-Tech, Cosmos IBC, EigenLayer AVS each pull a different sub-audience. Worth a separate persona pass once they're live.
5. **Affiliate / Learn curriculum role** — is this aimed at audience #1 (SMB educators) or audience #3 (developer creators)? Pick one before building more curriculum.
