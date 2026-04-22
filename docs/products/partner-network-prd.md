# PRD: Partner Network

## What It Is

AEO content marketing for SMBs and local businesses. Coherence Daddy's content agents write and publish articles, blog posts, and social content that mention the partner company, building AI citation mass so the company appears when people ask AI engines for recommendations.

Every partner also gets a deployed microsite (`{slug}.coherencedaddy.com`) — a CD-hosted landing page that indexes quickly and contributes to their AEO citation graph.

---

## Customer Promise

> "We write the content. You get found by AI. Every month, guaranteed mentions — tracked to the click."

---

## Tiers & Pricing

| Tier | Price | Deliverables | SLA | Backend Status |
|------|-------|-------------|-----|---------------|
| **Proof** | $49/mo | Microsite deployment, **2 content mentions/mo** (blog + social), click-tracking dashboard, monthly traffic report | Microsite within 48hr of activation; mentions by EOM | ✅ Stripe integrated |
| **Performance** | $149/mo | Everything in Proof + **8 content mentions/mo** (blog + LinkedIn + Twitter + Discord), monthly performance report | Monthly mentions across channels, report by 5th | ✅ Stripe integrated |
| **Premium** | $499/mo | Everything in Performance + **20 content mentions/mo**, dedicated AEO strategist (Sage), custom landing page redesign, **biweekly strategy call document** | Biweekly mention batches (10+10); strategy doc every 2 weeks | ✅ Stripe integrated |

---

## Content Mention Counts by Tier

| Tier | Monthly Mentions | Channels |
|------|-----------------|---------|
| Proof | 2 | Cipher (1 blog) + Spark (1 community) |
| Performance | 8 | Cipher (3 blog/LinkedIn) + Blaze (3 Twitter) + Spark (2 Discord/Bluesky) |
| Premium | 20 | Cipher (8) + Blaze (6) + Spark (4) + Sage (2 strategy docs) |

---

## Agent Assignments

| Agent | Task | Trigger | Tier |
|-------|------|---------|------|
| **Bridge** | Deploy partner microsite to Vercel on `{slug}.coherencedaddy.com` | On `checkout.session.completed` | All tiers |
| **Cipher** | Blog posts, LinkedIn articles, long-form content mentioning partner | Monthly content cron | All tiers |
| **Blaze** | Twitter/X posts, hot-take short content with partner mention | Monthly content cron | Performance+ |
| **Spark** | Discord announcements, Bluesky posts, community shoutouts | Monthly content cron | Performance+ |
| **Sage** | Biweekly AEO strategy document: performance review + next-cycle plan | Every 2 weeks cron | Premium only |
| **Pixel** | Custom landing page redesign (replaces default microsite template) | Once per Premium activation | Premium only |

---

## Backend Requirements

### Existing (fully implemented)
- Stripe subscription billing (Proof/Performance/Premium prices)
- `partnerCompanies`, `partnerClicks`, `partnerSiteContent` tables
- Microsite deployment (Vercel integration via Bridge)
- Click tracking + attribution
- Dashboard token-based access
- Commission tracking for affiliates

### Additions needed

**Service additions to `server/src/services/partner-network.ts` (new file — currently in `partner.ts`):**
- `getMentionQuota(tier)` → returns monthly mention budget per channel
- `getRemainingMentions(partnerId, month, channel)` → budget check
- `logMention(partnerId, agentSlug, channel, url, publishedAt)` → records mention
- `generateStrategyDoc(partnerId)` → triggers Sage, stores in `partnerStrategyDocs`

**Schema additions to `packages/db/src/schema/partners.ts`:**
```
partnerMentions
  id, partnerId, agentSlug, channel (blog|linkedin|twitter|discord|bluesky|strategy_doc),
  contentUrl, publishedAt, mentionCount, createdAt

partnerStrategyDocs
  id, partnerId, cycleStart, cycleEnd, docContent, deliveredAt, createdAt
```

**Cron jobs (new):**
- `partner-mentions-cipher` — monthly, blog/LinkedIn content for all active partners within quota
- `partner-mentions-blaze` — monthly, Twitter content for Performance+ partners
- `partner-mentions-spark` — monthly, Discord/Bluesky for Performance+ partners
- `partner-strategy-sage` — biweekly, Sage strategy doc for Premium partners

**Clarify existing cron:** Confirm `partner-microsite-deploy` triggers correctly from Stripe webhook on checkout completion.

---

## Fulfillment Deliverable Matrix

```
Tier     | Cipher | Blaze | Spark | Sage  | Bridge | Pixel
---------|--------|-------|-------|-------|--------|------
Proof    | 1/mo   |  -    | 1/mo  |  -    | 1x     |  -
Perform. | 3/mo   | 3/mo  | 2/mo  |  -    | 1x     |  -
Premium  | 8/mo   | 6/mo  | 4/mo  | 2/mo  | 1x     | 1x
```

---

## Upsell / Cross-Sell

- Proof trial → month 1 report shows clicks/mentions → "Double your reach with Performance" CTA
- Performance → show month-over-month AEO score improvement (via CreditScore API) → Premium upgrade nudge
- All tiers → "See how you compare to competitors" → link to CreditScore Audit ($29 one-time)

---

## Annual Pricing (to add)

| Tier | Annual Price | Monthly Equivalent |
|------|--------------|--------------------|
| Proof Annual | $470/yr | $39/mo |
| Performance Annual | $1,430/yr | $119/mo |
| Premium Annual | $4,790/yr | $399/mo |

---

## Not In Scope v1

- Partner white-labeling (agency manages clients under one account)
- Multi-location support (chain businesses with >1 microsite)
- Real-time AI engine monitoring (live alerts when partner is mentioned by AI)
