# PRD: Bundle Packages

## What They Are

Pre-packaged combinations of CreditScore, Directory Listings, Partner Network, and Intel API at a 20–35% discount vs. buying separately. One Stripe subscription ID grants access to all included products via a bundle entitlement system.

**Bundles solve two problems:**
1. Customers don't know which products to pair — bundles give them the answer
2. Monthly pricing per product feels like many invoices — bundles consolidate to one

---

## Bundle Tiers

### AEO Starter — $199/mo | $159/mo annual
**For:** Companies just starting to invest in AEO presence.

| Included Product | Tier | Standalone Value |
|-----------------|------|-----------------|
| CreditScore Monitoring | Starter ($49/mo) | $49/mo |
| Directory Listing | Featured ($199/mo) | $199/mo |
| Partner Network | Proof ($49/mo) | $49/mo |
| **Bundle Price** | | **$297/mo standalone → $199/mo** |

**Savings:** $98/mo (33%)

---

### AEO Growth — $499/mo | $399/mo annual
**For:** Companies actively growing AEO presence with more content volume.

| Included Product | Tier | Standalone Value |
|-----------------|------|-----------------|
| CreditScore Monitoring | Pro ($149/mo) | $149/mo |
| Directory Listing | Verified ($499/mo) | $499/mo |
| Partner Network | Performance ($149/mo) | $149/mo |
| **Bundle Price** | | **$797/mo standalone → $499/mo** |

**Savings:** $298/mo (37%)

---

### AEO Scale — $1,299/mo | $1,049/mo annual
**For:** Companies treating AEO as a primary growth channel.

| Included Product | Tier | Standalone Value |
|-----------------|------|-----------------|
| CreditScore Monitoring | Pro ($149/mo) | $149/mo |
| Directory Listing | Boosted ($1,499/mo) | $1,499/mo |
| Partner Network | Premium ($499/mo) | $499/mo |
| Intel API | Pro ($49/mo) | $49/mo |
| **Bundle Price** | | **$2,196/mo standalone → $1,299/mo** |

**Savings:** $897/mo (41%)

---

## Stripe Products to Create

| Bundle | Monthly Price ID | Annual Price ID |
|--------|-----------------|----------------|
| AEO Starter | `bundle_aeo_starter_monthly` | `bundle_aeo_starter_annual` |
| AEO Growth | `bundle_aeo_growth_monthly` | `bundle_aeo_growth_annual` |
| AEO Scale | `bundle_aeo_scale_monthly` | `bundle_aeo_scale_annual` |

All are single recurring Stripe subscriptions. Entitlement system handles access grants per product.

---

## Backend Requirements

### Bundle Entitlement System (all new)

**Database:** `packages/db/src/schema/bundle_entitlements.ts`
```
bundlePlans
  id, slug (aeo_starter|aeo_growth|aeo_scale), name, priceCents,
  annualPriceCents, stripePriceId, stripeAnnualPriceId,
  entitlements (jsonb), createdAt

  entitlements JSON shape:
  {
    creditscore: { tier: "starter"|"pro", domains: 1 },
    directoryListing: { tier: "featured"|"verified"|"boosted" },
    partnerNetwork: { tier: "proof"|"performance"|"premium" },
    intelApi: { planSlug: "pro" } | null
  }

bundleSubscriptions
  id, companyId, bundlePlanId, stripeSubscriptionId,
  status (active|past_due|canceled), currentPeriodStart,
  currentPeriodEnd, createdAt, updatedAt
```

**Service:** `server/src/services/bundle-entitlements.ts`
- `getEntitlementsForCompany(companyId)` — resolves all active entitlements (individual + bundle)
- `grantBundleAccess(companyId, bundlePlanId)` — activates each included product subscription
- `revokeBundleAccess(companyId, bundleSubscriptionId)` — deactivates all included products on cancel

**Middleware:** `server/src/middleware/entitlement-check.ts`
- `requireEntitlement(product, minTier)` — checks both individual subscriptions AND bundle entitlements
- Used on protected routes for each product

**Routes:** `server/src/routes/bundles.ts`
- `GET /api/bundles/plans` — list available bundles
- `POST /api/bundles/checkout` — create Stripe checkout session for bundle
- `GET /api/bundles/subscription` — fetch active bundle for authenticated company
- `POST /api/bundles/webhook` — Stripe webhook for bundle events

**Webhook handling:**
- `checkout.session.completed` → call `grantBundleAccess`
- `customer.subscription.deleted` → call `revokeBundleAccess`
- `invoice.payment_failed` → set bundle to `past_due`, email notice

---

## Frontend Requirements

**New page:** `ui/src/pages/Bundles.tsx`
- 3-column pricing grid (Starter / Growth / Scale)
- Toggle: Monthly / Annual (show per-month cost and annual total)
- Each column shows: bundle name, price, "save X%" badge, included products with tier labels, CTA button
- FAQ section: "What happens if I already have a product subscription?"

**Update existing pages:**
- `ui/src/pages/DirectoryPricing.tsx` — add "Or get it in a bundle" banner linking to `/bundles`
- `ui/src/pages/PartnersLanding.tsx` — add bundle CTA
- `ui/src/pages/IntelPricing.tsx` — add bundle CTA
- `ui/src/pages/CreditScorePricing.tsx` — add bundle CTA (new page, see creditscore-prd.md)

---

## Cross-Sell Logic

- After any individual product checkout → "You're X% of the way to an AEO Starter bundle — add [missing product] and save $Y/mo" 
- Bundle page compares "buying separately" total vs. bundle price dynamically

---

## Not In Scope v1

- Custom bundle builder (pick your own products)
- Discount codes / trial periods for bundles
- Multi-company bundle seats
