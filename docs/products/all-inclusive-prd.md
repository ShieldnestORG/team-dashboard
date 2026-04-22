# PRD: All-Inclusive Package

## What It Is

One invoice. Every Coherence Daddy product at its highest tier. Positioned as the "own the whole ecosystem" option for operators who want maximum AEO presence and intelligence without managing multiple subscriptions.

---

## Customer Promise

> "One invoice. Every product. Maximum AEO coverage — nothing left on the table."

---

## Package Definition

**Price: $2,499/mo annual (single Stripe subscription)**

| Product | Tier Included | Standalone Value |
|---------|--------------|-----------------|
| CreditScore Monitoring | Pro — 3 domains | $149/mo |
| Directory Listing | Boosted | $1,499/mo |
| Partner Network | Premium | $499/mo |
| Intel API | Enterprise | $199/mo |
| **All-Inclusive Total** | | **$2,346/mo standalone → $2,499/mo** |

*Note: All-Inclusive is priced at a slight premium over individual products because of the managed service wrapper — dedicated agent team, priority support, and a unified account manager (Sage). The $153/mo premium buys coordination and priority.*

**No monthly option** — annual contract only. Minimum 12-month commitment.

---

## What's Different From AEO Scale

| Feature | AEO Scale ($1,299/mo) | All-Inclusive ($2,499/mo) |
|---------|-----------------------|--------------------------|
| Intel API | Pro ($49/mo) | **Enterprise ($199/mo)** |
| CreditScore domains | 1 | **3 domains** |
| Directory tier | Boosted | Boosted |
| Partner Network tier | Premium | Premium |
| Account manager | Agent-driven | **Sage (dedicated, named)** |
| Strategy cadence | Biweekly doc | **Weekly strategy doc + monthly video brief** |
| Support SLA | Standard | **Priority (24hr response)** |

---

## Agent Assignments

All agents from underlying products, plus:

| Agent | Added Responsibility |
|-------|---------------------|
| **Sage** | Named account manager: weekly strategy doc, monthly performance brief, coordinates all other agents for this client |
| **River** | Sprint planning for client deliverables: tracks all pending mentions, reports, reviews in a unified task board |
| **Atlas** | Quarterly business review (QBR) document: strategic recommendations, growth trajectory analysis |

---

## Backend Requirements

Reuses the **bundle entitlement system** from bundles-prd.md with one addition:

**In `bundlePlans` entitlements JSON:**
```json
{
  "creditscore": { "tier": "pro", "domains": 3 },
  "directoryListing": { "tier": "boosted" },
  "partnerNetwork": { "tier": "premium" },
  "intelApi": { "planSlug": "enterprise" },
  "allInclusive": true
}
```

The `allInclusive: true` flag activates:
- Priority support queue (separate admin view)
- 3-domain CreditScore entitlement
- Sage weekly strategy doc cron (more frequent than Premium's biweekly)
- Atlas QBR cron (quarterly)
- River task board creation for the company

**Stripe product:** `all_inclusive_annual` — $2,499/mo billed annually ($29,988/yr)

**Routes:** Handled by existing `server/src/routes/bundles.ts` — no separate route needed.

**Admin view additions:**
- "All-Inclusive Accounts" section in admin dashboard
- Shows each client's Sage/River/Atlas scheduled deliverables and their completion status

---

## Onboarding Flow

On `checkout.session.completed` for All-Inclusive:

1. `grantBundleAccess` runs for all 4 products at highest tier
2. River creates a new project for the client in the task board
3. Sage is assigned as account manager (creates initial strategy doc within 48hr)
4. Welcome email sent with dashboard access link, dedicated Slack channel invite, and Sage introduction

---

## Upsell Path to All-Inclusive

- AEO Scale customers → month 3 report → if AEO score improved 15+ points → "You've outgrown Scale. Let Sage take it from here." → All-Inclusive upgrade prompt
- Any Premium Partner Network customer with high click volume → "Your content is working. Get everything else that amplifies it."

---

## Not In Scope v1

- Multi-brand / holding company accounts (one all-inclusive per brand, v2)
- SLA guarantees with financial penalties
- Dedicated hosting or custom deployment
