# Credential Requests — AEO Marketing Push
**Date:** 2026-04-14
**Label:** credential-request
**Assignee:** admin

## Pending Items

| # | Credential | Phase Blocked | What To Do |
|---|-----------|---------------|------------|
| 1 | **`coherencedaddy` X OAuth tokens** | Phase 5 (X multi-account) | Create X Developer App for @coherencedaddy, run OAuth 2.0 PKCE flow, provide `X_CLIENT_ID_CD`, `X_CLIENT_SECRET_CD`, `access_token`, `refresh_token` |
| 2 | **`ENTERPRISE_BOOKING_URL`** | Phase 4c (Cal.com CTA) | Set up Cal.com or Calendly page, provide URL. Add to VPS `.env.production` as `ENTERPRISE_BOOKING_URL=https://cal.com/yourpage` and `VITE_ENTERPRISE_BOOKING_URL` in UI build env |
| 3 | **`STRIPE_PRICE_PARTNER_PROOF`** | Phase 1d (Partner billing) | Create 3 Stripe products in dashboard: Partner Proof (free/trial), Partner Performance ($10-15/client/mo recurring), Partner Premium (retainer). Provide price IDs |
| 4 | **`STRIPE_PRICE_PARTNER_PERFORMANCE`** | Phase 1d | See above |
| 5 | **`STRIPE_PRICE_PARTNER_PREMIUM`** | Phase 1d | See above |
| 6 | **Verify `STRIPE_PRICE_FEATURED/VERIFIED/BOOSTED` on VPS** | Phase 1b live | Confirm these 3 env vars are set in `/opt/team-dashboard/.env.production` on VPS `31.220.61.12` |
| 7 | **Verify `GROK_API_KEY` on VPS** | Phase 6 (YouTube TTS) | Required for Grok TTS in YouTube pipeline; confirm set on VPS |
| 8 | **Verify `CD_BLOG_API_KEY` on VPS** | Phase 6 (Blog publish) | Required for coherencedaddy.com blog API; confirm set |

## Once You Have Credentials

For X tokens (item 1): Provide them to an agent session — the agent will run the Phase 5 migration + OAuth refactor (about 2 hours of agent work).

For Stripe price IDs (items 3-5): Add to VPS `.env.production` and redeploy. No code changes needed.

For Cal.com URL (item 2): Add `ENTERPRISE_BOOKING_URL=<url>` to VPS `.env.production` AND `VITE_ENTERPRISE_BOOKING_URL=<url>` to the Vercel environment for the public sites. Redeploy both.
