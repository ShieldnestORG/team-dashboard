# Credential Requests — AEO Marketing Push
**Date:** 2026-04-14
**Label:** credential-request
**Assignee:** admin

## Status Summary

| # | Credential | Status | Notes |
|---|-----------|--------|-------|
| 1 | **`coherencedaddy` X OAuth tokens** | **WIRED — needs VPS env** | Code done (migration 0075, multi-account schema, 3 AEO crons). Admin just needs to add `X_CLIENT_ID_CD` + `X_CLIENT_SECRET_CD` to VPS `.env.production` then run OAuth flow from dashboard |
| 2 | **`ENTERPRISE_BOOKING_URL`** | **RESOLVED** | Calendly URL hardcoded as default (`https://calendly.com/coherencedaddy-info`) in `CalendlyWidget.tsx`. Env var is optional override — set `ENTERPRISE_BOOKING_URL` + `VITE_ENTERPRISE_BOOKING_URL` on VPS/Vercel if you want a different URL |
| 3 | **`STRIPE_PRICE_PARTNER_PROOF`** | Pending admin action | Create 3 Stripe products in dashboard: Partner Proof (free/trial), Partner Performance ($10-15/client/mo recurring), Partner Premium (retainer). Provide price IDs |
| 4 | **`STRIPE_PRICE_PARTNER_PERFORMANCE`** | Pending admin action | See above |
| 5 | **`STRIPE_PRICE_PARTNER_PREMIUM`** | Pending admin action | See above |
| 6 | **Verify `STRIPE_PRICE_FEATURED/VERIFIED/BOOSTED` on VPS** | Confirmed set (2026-04-14) | Set during Directory Listings Stripe wiring session. Prices: Featured `price_1TMGB2QvkbvTR7Ogh1YtR17F`, Verified `price_1TMGB2QvkbvTR7OgfnPKiX9k`, Boosted `price_1TMGB3QvkbvTR7Ogzr82GHzk` |
| 7 | **Verify `GROK_API_KEY` on VPS** | Pending admin action | Required for Grok TTS in YouTube pipeline; confirm set on VPS |
| 8 | **Verify `CD_BLOG_API_KEY` on VPS** | Pending admin action | Required for coherencedaddy.com blog API; confirm set |

## Pending Items

### Item 1: X Multi-Account (@coherencedaddy)

Code is fully wired as of CHANGELOG `[2026-04-14m]`:
- Migration 0075 drops old unique constraint, adds composite `(company_id, account_slug)` key
- 3 AEO cron jobs ready: daily AEO tips, Mon/Wed/Fri directory spotlights, Tue/Thu blog link pushes

**Admin action required:**
1. Create an X Developer App for @coherencedaddy (separate app from the main ShieldNest app)
2. Add to VPS `.env.production`:
   ```
   X_CLIENT_ID_CD=<your client id>
   X_CLIENT_SECRET_CD=<your client secret>
   ```
3. Redeploy + run the OAuth flow from the dashboard to get user tokens stored in `x_oauth_tokens`
4. The 3 AEO crons will activate automatically once user tokens exist for the `coherencedaddy` account slug

### Items 3–5: Partner Stripe Billing

Create in Stripe Dashboard (https://dashboard.stripe.com/products):
- **Partner Proof**: Free/trial tier — $0/mo recurring (or omit, use manual enrollment)
- **Partner Performance**: $10–15/client/mo recurring — set price per actual rate card
- **Partner Premium**: Monthly retainer — set price per rate card

Then add to VPS `.env.production`:
```
STRIPE_PRICE_PARTNER_PROOF=price_xxx
STRIPE_PRICE_PARTNER_PERFORMANCE=price_xxx
STRIPE_PRICE_PARTNER_PREMIUM=price_xxx
```

### Items 7–8: API Key Verification

SSH into VPS_1 and confirm:
```bash
grep -E "GROK_API_KEY|CD_BLOG_API_KEY" /opt/team-dashboard/.env.production
```
If missing, add them. `GROK_API_KEY` = xAI API key. `CD_BLOG_API_KEY` = coherencedaddy.com blog bearer token.

## Resolved Items

### Item 2: ENTERPRISE_BOOKING_URL — RESOLVED 2026-04-14

`CalendlyWidget.tsx` now hardcodes `https://calendly.com/coherencedaddy-info` as the default URL. The Calendly inline widget is live on IntelPricing and DirectoryPricing pages. No env var needed unless you want to override the Calendly link — in which case set:
```
ENTERPRISE_BOOKING_URL=https://calendly.com/your-actual-page    # VPS
VITE_ENTERPRISE_BOOKING_URL=https://calendly.com/your-actual-page  # Vercel (UI build)
```
