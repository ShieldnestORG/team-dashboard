# PRD: Directory Listings

## What It Is

Paid placement in the Coherence Daddy AI/blockchain company directory (`directory.coherencedaddy.com`). The directory indexes 500+ blockchain, AI, DeFi, and DevTools companies.

**The AEO value proposition:** CD's content agents actively write and publish articles, trend reports, and social posts that cite directory companies by name. This builds AI citation mass — the mechanism by which companies appear in ChatGPT/Perplexity/Gemini responses organically.

---

## Customer Promise

> "Get your company in front of AI engines. We write the content that makes you citable."

---

## Tiers & Pricing

| Tier | Price | Deliverables | SLA | Backend Status |
|------|-------|-------------|-----|---------------|
| **Featured** | $199/mo | Featured badge, priority search rank, highlighted card, **2 content mentions/mo**, monthly traffic report | Monthly mentions by last day of month | ✅ Stripe integrated |
| **Verified** | $499/mo | Verified badge, top-3 placement, **5 content mentions/mo**, quarterly AEO strategy review doc | Monthly mentions; quarterly review in month 3 | ✅ Stripe integrated |
| **Boosted** | $1,499/mo | Homepage spotlight, cross-directory promotion, **15 content mentions/mo**, **monthly** AEO strategy review, dedicated account manager agent, full analytics dashboard | Biweekly (8 + 7 mentions split across month) | ✅ Stripe integrated |

**Stripe price IDs:** Configured via `STRIPE_PRICE_DIRECTORY_FEATURED`, `STRIPE_PRICE_DIRECTORY_VERIFIED`, `STRIPE_PRICE_DIRECTORY_BOOSTED` env vars.

---

## Content Mention Counts by Tier

| Tier | Monthly Mentions | Channels |
|------|-----------------|---------|
| Featured | 2 | Blaze (Twitter/articles) |
| Verified | 5 | Blaze (3) + Prism (2, long-form) |
| Boosted | 15 | Blaze (8) + Prism (5) + Sage strategy review |

---

## Agent Assignments

| Agent | Task | Trigger | Tier |
|-------|------|---------|------|
| **Blaze** | Short-form content: Twitter posts, hot-take articles mentioning the company | Monthly cron per active listing | Featured+ |
| **Prism** | Long-form trend reports with company citation | Monthly cron | Verified+ |
| **Sage** | Written AEO strategy review doc (delivered via email/dashboard) | Quarterly cron (Verified), Monthly cron (Boosted) | Verified+ |
| **Echo** | Enrich company profile: funding data, GitHub activity, chain metrics, news | Weekly cron for all active listings | All tiers |

---

## Backend Requirements

### Existing (fully implemented)
- Stripe subscription billing
- `directory_listings` table with status workflow
- Traffic attribution (mention clicks)
- Self-serve enrollment endpoint
- Webhook handling

### Additions needed
**Schema additions to `packages/db/src/schema/directory_listings.ts`:**
```
directoryListingMentions
  id, listingId, agentSlug, contentType (twitter|article|report|strategy_review),
  contentUrl, publishedAt, mentionCount, createdAt
```

**Service additions to `server/src/services/directory-listings.ts`:**
- `getMentionQuota(tier)` → returns monthly mention budget
- `getRemainingMentions(listingId, month)` → checks remaining budget
- `logMention(listingId, agentSlug, contentType, url)` → records fulfilled mention

**Cron jobs (new):**
- `directory-mentions-blaze` — monthly, triggers Blaze for Featured+ listings within quota
- `directory-mentions-prism` — monthly, triggers Prism for Verified+ listings
- `directory-review-sage` — monthly for Boosted, quarterly for Verified; triggers Sage AEO review

---

## Upsell / Cross-Sell

- Directory enrollment checkout confirmation → "Pair with Partner Network to amplify your AEO presence" CTA
- Monthly analytics email → show AEO score comparison (link to CreditScore Audit)
- Featured/Verified customers whose mentions spike → auto-flag for Boosted upgrade prompt

---

## Annual Pricing (to add)

Current pricing is monthly-only. Annual options (20% discount) to add:

| Tier | Annual Price | Monthly Equivalent |
|------|--------------|--------------------|
| Featured Annual | $1,910/yr | $159/mo |
| Verified Annual | $4,790/yr | $399/mo |
| Boosted Annual | $14,390/yr | $1,199/mo |

---

## Not In Scope v1

- Self-serve mention scheduling (client picks publish date)
- White-label directory (reseller tier)
- Industry-specific sub-directories
