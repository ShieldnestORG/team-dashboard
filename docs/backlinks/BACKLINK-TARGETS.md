# Backlink Targets — Coherence Daddy Outreach Playbook

**Status:** Live. Maintained alongside Initiative B (Outbound AEO) and the topic-takeover roadmap.
**Owner:** Outbound + content. Update as targets close or new ones surface.
**Companion docs:**
- [docs/products/directory-outreach-prd.md](../products/directory-outreach-prd.md)
- [docs/products/topic-takeover-roadmap.md](../products/topic-takeover-roadmap.md)

---

## How to use this doc

Each row is a single submission target. Run them top-down by tier — don't skip
tiers, the high-DR Tier 1 links are what make the niche directories (Tier 2/3)
rank for their long-tail terms once they're indexed.

For every submission:
1. Use the listed submission URL.
2. Paste the **pre-filled copy** as-is unless the form requires variation.
3. After submission, log in `directory_listings` (see directory-listings-prd.md)
   so the cron tracker picks up status changes.

The email templates assume CD's standard signature block (set in Resend).

---

## Tier 1 — Mass-reach product directories (DR 80+)

| # | Target | Submission URL | Format | Notes |
|---|---|---|---|---|
| 1 | Product Hunt | https://www.producthunt.com/posts/new | Launch post | Schedule for a Tuesday 12:01am PT. Hunter required for surge. |
| 2 | AlternativeTo | https://alternativeto.net/contact/submitapp/ | App listing | List CreditScore as alternative to Ahrefs Site Audit + Surfer SEO. |
| 3 | SaaSHub | https://www.saashub.com/submit-software | Listing | Tag: SEO, AEO, AdSense. Free tier OK. |
| 4 | Crunchbase | https://www.crunchbase.com/add-new | Company profile | Use ShieldNest Inc. legal name; link CD as product. |
| 5 | r/InternetIsBeautiful | https://www.reddit.com/r/InternetIsBeautiful/submit | Reddit post | Lead with `dailycompound.app` or `tokencount.dev` — utility sites only. CreditScore will be removed as "promotional." |

**Pre-filled copy — Product Hunt tagline:**
> CreditScore — the free SEO + AEO + AdSense audit that tells you why ChatGPT won't cite your site.

**Pre-filled copy — AlternativeTo description:**
> CreditScore is a free site audit tool from Coherence Daddy. Unlike traditional SEO crawlers, CreditScore scores your site across three axes: classic SEO (crawlability, schema, internal links), Answer Engine Optimization (whether AI models like ChatGPT and Perplexity will cite you), and AdSense readiness (policy compliance + monetization potential). 48 rule IDs, no signup for the free tier.

---

## Tier 2 — Faith-based tech directories (508(c)(1)(A) moat)

| # | Target | Submission URL | Format | Status |
|---|---|---|---|---|
| 6 | faith.tools | https://faith.tools/submit | App listing | Submit each utility site separately. |
| 7 | FaithTech Collective | https://faithtech.com/contact/ | Org outreach (email) | Position CD as resource, not product. |
| 8 | Civic Tech Field Guide | https://docs.google.com/forms/d/e/1FAIpQLScivictech | Listing | Long approval queue (~3 weeks). |
| 9 | Indie Hackers | https://www.indiehackers.com/post | Forum post | Story angle: "How a 508(c)(1)(A) shipped 3 utility sites in 6 weeks." |

**Email template — FaithTech outreach:**
```
Subject: Coherence Daddy — open-source AI tutorials for the FaithTech community

Hi FaithTech team,

I run Coherence Daddy, a 508(c)(1)(A) faith-based software org. We've been
publishing open AI/SEO tutorials at github.com/Coherence-Daddy and shipping
free utility microsites (dailycompound.app, visawait.app, tokencount.dev).

Would you be open to a guest post or directory listing for the community? I
think the AEO/SEO audit work in particular ("why ChatGPT won't cite your
nonprofit") would land well with FaithTech members trying to get visibility
without ad budgets.

Happy to write something custom — just let me know the format you prefer.

— [signature]
```

---

## Tier 3 — Topic-takeover targets (from topic-takeover roadmap)

These line up 1:1 with the five initiatives in
[topic-takeover-roadmap.md](../products/topic-takeover-roadmap.md). Each entry
is a directory or community CD wants either to be **listed in** or to
**eventually replace** as the canonical reference.

### 3a — EigenLayer / Restaking AVS

| # | Target | Submission URL | Goal |
|---|---|---|---|
| 10 | eigenfoundation/eigenlayer-ecosystem-network (GitHub README) | PR to add CD's directory page | Backlink + cross-ref |
| 11 | r/eigenlayer | https://www.reddit.com/r/eigenlayer/submit | Share AVS list page once populated |
| 12 | Bankless directory | https://www.bankless.com/submit | List CD as restaking research source |

### 3b — Faith-based companies directory

| # | Target | Submission URL | Goal |
|---|---|---|---|
| 13 | Christian Tech Jobs | https://christiantechjobs.io/contact | Cross-link directory ↔ jobs board |
| 14 | Indieweb church-tech ring | https://indieweb.org/church | Add CD to ring |

### 3c — AEO content cluster

| # | Target | Submission URL | Goal |
|---|---|---|---|
| 15 | r/SEO | https://www.reddit.com/r/SEO/submit | Post "Why ChatGPT Won't Cite Your Site" essay |
| 16 | r/bigseo | https://www.reddit.com/r/bigseo/submit | Same essay, technical angle |
| 17 | Hacker News | https://news.ycombinator.com/submit | Submit cornerstone piece, not product |
| 18 | Indie Hackers (AEO category) | https://www.indiehackers.com/post | Founder-story framing |

### 3d — Cosmos IBC ecosystem

| # | Target | Submission URL | Goal |
|---|---|---|---|
| 19 | cosmos.network/ecosystem/apps | https://github.com/cosmos/chain-registry | PR to chain-registry referencing CD |
| 20 | r/cosmosnetwork | https://www.reddit.com/r/cosmosnetwork/submit | Share CD's IBC relayer health page |

### 3e — DevTools live-signal intel

| # | Target | Submission URL | Goal |
|---|---|---|---|
| 21 | Console.dev | https://console.dev/submit | Submit CD as discovery source |
| 22 | Hacker News (Show HN) | https://news.ycombinator.com/submit | Show HN: live GitHub/Twitter signals for DevTools startups |

---

## Outreach email templates

### Generic Tier-3 directory inclusion
```
Subject: Adding Coherence Daddy to {{directory_name}}

Hi {{maintainer}},

I maintain Coherence Daddy's intel directory (directory.coherencedaddy.com),
which tracks {{vertical}} projects with live GitHub, Twitter, RSS, and
on-chain signals — not static listings. We currently track {{N}} {{vertical}}
companies.

I'd like to either:
1. Add CD to {{directory_name}} as a research/intel source, or
2. Cross-reference your listings in our directory (with full attribution).

Which works better on your end? Happy to send a sample profile.

— [signature]
```

### Reddit topic-takeover post (template)
```
Title: I built a free live-signal directory for {{vertical}} — what am I missing?

Body:
Most {{vertical}} directories are static — they list a name and a URL and
that's it. So I built one that pulls live GitHub commit activity, Twitter
follower deltas, RSS post cadence, and {{vertical}}-specific signals
({{example}}).

It's at directory.coherencedaddy.com/{{vertical}} — free, no signup.

Curious what signals you'd add. Open to PRs at github.com/Coherence-Daddy.
```

---

## Tracking + status

Submission status lives in the `directory_listings` table (see
[directory-listings-prd.md](../products/directory-listings-prd.md)). The
`directory-outreach` cron picks up status updates and emails the operator a
weekly digest of approvals/rejections.

When a target closes (approved, listed, indexed):
1. Strike through the row.
2. Add a `**Closed YYYY-MM-DD:**` annotation with the resulting URL.
3. Log the backlink in the audit so it shows up in CreditScore's own
   off-page signal score.

---

## Maintenance

- Re-audit this doc at the start of each topic-takeover initiative milestone.
- Drop tiers entirely if the conversion data shows no value — never grow this
  list past ~50 active targets. The point is dominance in selected niches,
  not link sprawl.
