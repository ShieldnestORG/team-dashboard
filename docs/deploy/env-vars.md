# Environment Variables — Team Dashboard

## Overview
These variables are required for the project to function. **VPS** requires all variables in `.env.production` at `/opt/team-dashboard/`. **Vercel** gets `DATABASE_URL` via Neon integration and requires no other variables as it only serves the static UI.

## Variable Reference

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| **Database** | | | |
| `DATABASE_URL` | Yes | VPS + Vercel + Local | Neon PostgreSQL connection string. **Pooler endpoint, public TLS — not on Tailnet.** Reachable from any host with the creds; export from `.env` to run `pnpm db:migrate` or `psql` against prod from a local shell. |
| `PAPERCLIP_MIGRATION_AUTO_APPLY` | Yes (prod) | VPS | Set to `true` on VPS4. Boot-time safety net: if a container restarts against a stale schema (e.g. `predeploy.sh` was bypassed, or `docker compose up` reused an existing image), the server applies pending migrations during startup instead of refusing to boot. Without this, the server hard-fails on any pending migration — see the 2026-05-17 migration-0116 incident. |
| **Auth** | | | |
| `PAPERCLIP_AGENT_JWT_SECRET` | Yes | VPS | Agent JWT signing secret |
| `BETTER_AUTH_SECRET` | Yes | VPS | Better Auth session signing |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes | VPS | CORS origins — comma-separated (Vercel URL + `https://affiliates.coherencedaddy.com`) |
| `PAPERCLIP_PUBLIC_URL` | Yes | VPS | Public URL for auth callbacks |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | Yes | VPS | Allowed hostnames — comma-separated (includes `affiliates.coherencedaddy.com`) |
| `AFFILIATE_JWT_SECRET` | Recommended | VPS | Dedicated signing secret for affiliate JWTs — falls back to `BETTER_AUTH_SECRET`. Rotate independently of admin auth. Generate: `openssl rand -hex 32` |
| **Customer Portal** | | | |
| `PORTAL_SESSION_SECRET` | Yes (when portal enabled) | VPS | HMAC-SHA256 signing key for the `cd_portal_session` cookie. Must be ≥32 chars; rotate quarterly. Generate: `openssl rand -hex 32`. Without it, every `/api/portal/*` session-required endpoint fails closed. |
| `PORTAL_BASE_URL` | Optional | VPS | Public URL of the customer portal frontend (default: `https://app.coherencedaddy.com`). Used for magic-link emails and post-auth redirects. |
| `PORTAL_MAGIC_LINK_TTL_MIN` | Optional | VPS | Magic-link TTL in minutes (default: 15, clamped 1–60). |
| `PORTAL_COOKIE_DOMAIN` | Optional | VPS | Override the cookie `Domain=` attribute. Default: `.coherencedaddy.com`. Set to empty string in dev/test. |
| `PORTAL_STRIPE_RETURN_URL` | Optional | VPS | URL Stripe sends users back to after the Billing Portal. Default: `${PORTAL_BASE_URL}/billing`. |
| `PAPERCLIP_SECRETS_MASTER_KEY` | Yes (when portal credentials used) | VPS | 32-byte master key (hex/base64) used to encrypt `customer_credentials.encrypted_value` via AES-256-GCM. Same key as the company-secrets vault — rotating breaks all stored credentials. |
| **API** | | | |
| `PAPERCLIP_API_URL` | Yes | VPS | Backend API base URL |
| `TEAM_DASHBOARD_COMPANY_ID` | Yes | VPS + Local | `8365d8c2-ea73-4c04-af78-a7db3ee7ecd4` (Coherence Daddy) |
| **AI / LLM** | | | |
| `ANTHROPIC_API_KEY` | Yes | VPS | Claude API for agent runtime |
| `ANTHROPIC_MODEL` | Optional | VPS | Default model (default: claude-haiku-4-5-20251001) |
| `OLLAMA_URL` | Yes | VPS | Ollama API endpoint (default: `https://ollama.com/api`) |
| `OLLAMA_MODEL` | Optional | VPS | Ollama model (default: gemma4:31b-cloud) |
| `OLLAMA_API_KEY` | Yes | VPS | Ollama Cloud API bearer token |
| **Visual Content** | | | |
| `CONTENT_API_KEY` | Yes | VPS | Auth for content, visual content, and trend endpoints |
| `CD_BLOG_API_URL` | Optional | VPS | Blog publish endpoint for coherencedaddy.com (default: `https://www.coherencedaddy.com/api/blog/posts`). Posts land at `https://www.coherencedaddy.com/blog/<slug>`. |
| `CD_BLOG_API_KEY` | Yes | VPS | Bearer token for coherencedaddy.com blog API |
| `SN_BLOG_API_URL` | Optional | VPS | Blog publish endpoint for shieldnest.org (default: `https://shieldnest.org/api/articles`). Endpoint is provided by the `shieldnest_landing_page` Vercel project (`feat/blog-pipeline` branch). Posts land at `https://shieldnest.org/blog/<slug>`. |
| `SN_BLOG_API_KEY` | Optional | VPS | Bearer token for the shieldnest.org blog API. Matches `BLOG_API_KEY` on the shieldnest_landing_page side. Leaving blank silently drops the SN leg for any cron with `publishTarget: "sn"` or `"all"`. |
| `TOKNS_APP_BLOG_API_URL` | Optional | VPS | Blog publish endpoint for app.tokns.fi (default: `https://app.tokns.fi/api/articles`). Supabase-backed. Posts land in the dashboard "News & Insights" feed at `https://app.tokns.fi/articles/<slug>`. Also surfaced at `https://tokns.fi/lab` (reads from app.tokns.fi client-side). |
| `TOKNS_APP_BLOG_API_KEY` | Optional | VPS | Bearer token for the app.tokns.fi articles API. Must match `SN_ARTICLE_API_KEY` on the `tokns` Vercel project side. Leaving blank silently drops the tokns-app leg. |
| `INDEXNOW_KEY` | Optional | VPS | IndexNow verification key for search engine ping |
| `GEMINI_API_KEY` | Optional | VPS | Enables Gemini visual backend (Imagen 3 + Veo 2) |
| `GROK_API_KEY` | Optional | VPS | Enables Grok/xAI backend (grok-2-image + grok-imagine-video + TTS) |
| `GROK_TTS_VOICE` | Optional | VPS | Voice for Grok TTS (default: `rex`) |
| `CANVA_API_KEY` | Optional | VPS | Enables Canva template backend (Python bridge) |
| `CANVA_CLIENT_ID` | Optional | VPS | Canva Connect API client ID (OAuth 2.0) |
| `CANVA_CLIENT_SECRET` | Optional | VPS | Canva Connect API client secret |
| `CANVA_CALLBACK_URL` | Optional | VPS | Canva OAuth callback URL |
| `CANVA_MEDIA_FOLDER_ID` | Optional | VPS | Canva folder to pull designs from for media tweets |
| `YT_PIPELINE_ENABLED` | Optional | VPS | Set to `false` to leave the 5 YouTube crons dormant. Default: enabled |
| **Video Edit** | | | |
| `VIDEO_USE_BIN` | Optional | VPS | Absolute path to the `video-use` entry script on the host. Leave unset and jobs queue but won't run (UI shows "Engine not configured"). Used by `server/src/services/video-edit/engine.ts`. |
| `VIDEO_EDIT_DATA_DIR` | Optional | VPS | Base dir for raw-input folders + outputs. Default: `/paperclip/video-edit`. |
| `ELEVENLABS_API_KEY` | Optional | VPS | ElevenLabs Scribe key — required by video-use for word-level transcription. Sign up at <https://elevenlabs.io/app/settings/api-keys>. |
| **Platform Publishing** | | | |
| `YOUTUBE_CLIENT_ID/SECRET` | Optional | VPS | YouTube Shorts auto-publishing |
| `YOUTUBE_REFRESH_TOKEN` | Optional | VPS | YouTube OAuth refresh token |
| `TIKTOK_ACCESS_TOKEN` | Optional | VPS | TikTok Content Posting API |
| `TWITTER_API_KEY/SECRET` | Optional | VPS | Twitter/X video posting |
| `TWITTER_ACCESS_TOKEN/SECRET` | Optional | VPS | Twitter/X OAuth tokens |
| `X_CLIENT_ID_CD` | Optional | VPS | X OAuth 2.0 client ID for @coherencedaddy account |
| `X_CLIENT_SECRET_CD` | Optional | VPS | X OAuth 2.0 client secret for @coherencedaddy account |
| `X_CALLBACK_URL_CD` | Optional | VPS | OAuth callback URL for coherencedaddy account |
| `INSTAGRAM_ACCESS_TOKEN` | Optional | VPS | Instagram Graph API |
| `INSTAGRAM_BUSINESS_ACCOUNT_ID` | Optional | VPS | Instagram business account |
| **Moltbook** | | | |
| `MOLTBOOK_API_KEY` | Optional | VPS | Moltbook API key |
| **Discord Bot** | | | |
| `DISCORD_TOKEN` | Yes | VPS | Discord bot token from Developer Portal |
| `DISCORD_GUILD_ID` | Yes | VPS | Discord server ID (Next.ai: `1481053410152288422`) |
| `DISCORD_TICKET_CHANNEL_ID` | Yes | VPS | #submit-a-ticket channel for ticket threads |
| `DISCORD_TICKET_LOG_CHANNEL_ID` | Yes | VPS | #ticket-logs channel for status embeds |
| `DISCORD_ANNOUNCEMENTS_CHANNEL_ID` | Optional | VPS | #moderators-updates for mod action logs |
| `DISCORD_WELCOME_CHANNEL_ID` | Optional | VPS | #welcome channel |
| `DISCORD_ROLE_MEMBER` | Optional | VPS | Auto-assigned role on join |
| `DISCORD_ROLE_MODERATOR` | Optional | VPS | Role for mod commands |
| `DISCORD_ROLE_ADMIN` | Optional | VPS | Role for admin commands |
| **Intel Engine** | | | |
| `INTEL_INGEST_KEY` | Yes | VPS | Auth for intel data ingestion |
| `COIN_GECKO_API_KEY` | Optional | VPS | CoinGecko Demo API key |
| `COSMOS_LCD_URL` | Optional | VPS | Public Cosmos Hub LCD endpoint |
| `OSMOSIS_LCD_URL` | Optional | VPS | Public Osmosis LCD endpoint |
| `TX_LCD_URL` | Optional | VPS | TX Blockchain LCD endpoint |
| `TX_VALIDATORS_URL` | Optional | VPS | Public validator-list URL for TX chain |
| `SHIELDNEST_COSMOS_MONIKER` / `_OSMOSIS_MONIKER` / `_TX_MONIKER` | Optional | VPS | Validator monikers tracked for rank-delta content |
| `GITHUB_TOKEN` | Yes | VPS | GitHub API access for intel + deployment |
| `EMBED_URL` | Yes | VPS | BGE-M3 embedding service over Tailnet (`http://100.67.128.51:8080` — VPS1 `shield-llm`). Pre-2026-05-09 value `http://147.79.78.251:8000` (VPS3) is dead. |
| `FIRECRAWL_URL` | Yes | VPS | Firecrawl over Tailnet (`http://100.67.128.51:3002` — VPS1 `shield-llm`). |
| `FIRECRAWL_API_KEY` | Yes | VPS | `self-hosted` for Tailnet self-hosted Firecrawl (`USE_DB_AUTHENTICATION=false`). |
| `EMBED_API_KEY` | Yes | VPS | Embedding service auth |
| `FIRECRAWL_EMBEDDING_API_KEY` | Yes | VPS | Firecrawl scraping API auth |
| `CRAWLEE_FALLBACK_ENABLED` | Optional | VPS | `true` to activate the Crawlee + Playwright fallback when Firecrawl `/v1/scrape` fails. Currently wired into `firecrawl-sync` only. Requires Playwright browsers installed in the runtime (`pnpm exec playwright install chromium`). Default `false`. |
| `SYNTHETIC_MONITOR_ENABLED` | Optional | VPS | `true` to enable the synthetic uptime monitor (`server/src/services/synthetic-monitor.ts`) — Playwright-rendered canary checks that capture JS console errors, uncaught page errors, broken images, and load time. Requires Playwright browsers installed in the runtime (`pnpm exec playwright install chromium`). Default `false`. |
| `SITEMAP_CRAWL_ENABLED` | Optional | VPS | `true` to activate the sitemap deep-crawl service (`server/src/services/sitemap-crawl.ts`) — walks N same-origin pages of a target site (default 20 pages, depth 2) and returns markdown per page for competitor/partner intel. Standalone service; no consumers wired in yet. Requires Playwright browsers (`pnpm exec playwright install chromium`). Default `false`. |
| `AUDIT_DEEP_ENABLED` | Optional | VPS | `true` to enable `POST /api/audit/deep` — the premium deep-audit tier that renders pages in Playwright and captures console/page errors + broken images + an above-the-fold screenshot. Requires Playwright browsers installed (`pnpm exec playwright install chromium`). When unset the endpoint returns 503 `{ error: "deep audit disabled" }`. Default `false`. |
| `LAUNCH_MONITOR_CRAWLEE_ENABLED` | Optional | VPS | `true` to activate Crawlee-powered launch-monitor sources (`server/src/services/launch-monitor-crawlee-sources.ts`) for platforms with no usable API — currently Product Hunt discussion pages. Service-only until a follow-up PR wires it into the launch-monitor cron; setting the flag without that wiring is a no-op. Requires Playwright browsers (`pnpm exec playwright install chromium`). Default `false`. |
| `BING_NEWS_KEY` | Optional | VPS | Bing News Search API v7 key for trend scanning |
| **Payments** | | | |
| `STRIPE_SECRET_KEY` | Optional | VPS | Stripe API secret key for donations + Intel API paid tier |
| `STRIPE_WEBHOOK_SECRET` | Optional | VPS | Stripe webhook signature verification |
| `STRIPE_PRICE_STARTER_BASE` / `_METERED` | Optional | VPS | Stripe price IDs for Intel Starter plan |
| `STRIPE_PRICE_PRO_BASE` / `_METERED` | Optional | VPS | Stripe price IDs for Intel Pro plan |
| `STRIPE_PRICE_ENTERPRISE_BASE` / `_METERED` | Optional | VPS | Stripe price IDs for Intel Enterprise plan |
| `STRIPE_PRICE_FEATURED` | Optional | VPS | Stripe price ID for Directory Listings Featured tier ($199/mo) |
| `STRIPE_PRICE_VERIFIED` | Optional | VPS | Stripe price ID for Directory Listings Verified tier ($499/mo) |
| `STRIPE_PRICE_BOOSTED` | Optional | VPS | Stripe price ID for Directory Listings Boosted tier ($1499/mo) |
| `STRIPE_PRICE_PARTNER_PROOF` | Optional | VPS | Stripe price ID for Partner Network Proof tier ($49/mo) |
| `STRIPE_PRICE_PARTNER_PERFORMANCE` | Optional | VPS | Stripe price ID for Partner Network Performance tier ($149/mo) |
| `STRIPE_PRICE_PARTNER_PREMIUM` | Optional | VPS | Stripe price ID for Partner Network Premium tier ($499/mo) |
| `STRIPE_WEBHOOK_SECRET_DIRECTORY` | Optional | VPS | Dedicated signing secret for Directory Listings webhook |
| `DIRECTORY_CHECKOUT_SUCCESS_URL` | Optional | VPS | Post-checkout redirect |
| `DIRECTORY_CHECKOUT_CANCEL_URL` | Optional | VPS | Abandon-checkout redirect |
| `STRIPE_PRICE_CREDITSCORE_REPORT` | Optional | VPS | Stripe price ID for CreditScore One-Time Report ($19) |
| `STRIPE_PRICE_CREDITSCORE_STARTER` | Optional | VPS | Stripe price ID for CreditScore Starter ($49/mo) |
| `STRIPE_PRICE_CREDITSCORE_GROWTH_MONTHLY` | Optional | VPS | Stripe price ID for CreditScore Growth monthly ($199/mo) |
| `STRIPE_PRICE_CREDITSCORE_GROWTH_ANNUAL` | Optional | VPS | Stripe price ID for CreditScore Growth annual ($1,188/yr) |
| `STRIPE_PRICE_CREDITSCORE_PRO` | Optional | VPS | Stripe price ID for CreditScore Pro ($499/mo) |
| `STRIPE_WEBHOOK_SECRET_CREDITSCORE` | Optional | VPS | Dedicated signing secret for CreditScore Stripe webhook |
| `CREDITSCORE_SUCCESS_URL` | Optional | VPS | Post-checkout redirect (fallback: `freetools.coherencedaddy.com/creditscore-home?checkout=success`) |
| `CREDITSCORE_CANCEL_URL` | Optional | VPS | Abandon-checkout redirect (fallback: `freetools.coherencedaddy.com/creditscore-home?checkout=canceled`) |
| `CREDITSCORE_CALLBACK_KEY` | Optional | VPS + coherencedaddy | HMAC shared secret for email callback from team-dashboard → storefront. If unset, emails are skipped. |
| `CREDITSCORE_EMAIL_CALLBACK_URL` | Optional | VPS | Storefront endpoint that renders + sends via Resend (default: `https://freetools.coherencedaddy.com/api/email/creditscore`) |
| `WATCHTOWER_STRIPE_PRICE_ID` | Optional | VPS | Stripe price ID for Watchtower ($29/mo). Fallback when `lookup_key=watchtower_monthly` resolution fails. |
| `STRIPE_WEBHOOK_SECRET_WATCHTOWER` | Optional | VPS | Dedicated signing secret for Watchtower Stripe webhook. Falls back to `STRIPE_WEBHOOK_SECRET`. |
| `WATCHTOWER_RETURN_URL` | Optional | VPS | Legacy single-URL knob (used as both success + cancel base when set). Prefer `WATCHTOWER_SUCCESS_URL` / `WATCHTOWER_CANCEL_URL` below. |
| `WATCHTOWER_SUCCESS_URL` | Optional | VPS | Stripe success_url base. Default: `https://app.coherencedaddy.com/dashboard` (customer portal — surfaces the new entitlement + Watchtower cross-sell shelf). |
| `WATCHTOWER_CANCEL_URL` | Optional | VPS | Stripe cancel_url base. Default: `https://coherencedaddy.com/watchtower-home` (storefront signup page — bounced visitors land back where they were). |
| `WATCHTOWER_CHECKOUT_PUBLIC_URL` | Optional | VPS | URL embedded in `/api/public/answer-check/run` rate-limit error responses. Default: `https://coherencedaddy.com/watchtower-home#pricing`. |
| `WATCHTOWER_CALLBACK_KEY` | Required for emails | VPS + Vercel (storefront) | HMAC shared secret signing `POST /api/email/watchtower` envelopes. Required for the answer-check report email + the weekly digest. If unset, both emails are no-op'd with a warning. |
| `WATCHTOWER_EMAIL_CALLBACK_URL` | Optional | VPS | Storefront endpoint that handles both `answer_check_report` and `watchtower_weekly_digest` Resend dispatch (default: `https://freetools.coherencedaddy.com/api/email/watchtower` — 301-redirects to coherencedaddy.com). |
| `OLLAMA_URL` / `OLLAMA_API_KEY` / `OLLAMA_MODEL` | Yes | VPS | Ollama Cloud endpoint (`https://ollama.com/api`, default model `gemma4:31b-cloud`). Powers the Content Agent (AEO page drafting), SEO Engine, and other content pipelines. Self-hosted fallback runs on VPS1 Tailnet `http://100.67.128.51:11434` (gemma2:2b) for agent + KG workloads. |
| `INTEL_BILLING_SUCCESS_URL` | Optional | VPS | Checkout success redirect |
| `INTEL_BILLING_CANCEL_URL` | Optional | VPS | Checkout cancel redirect |
| `ENTERPRISE_BOOKING_URL` | Optional | VPS | Cal.com or Calendly booking URL for enterprise calls |
| `VITE_ENTERPRISE_BOOKING_URL` | Optional | UI build | Same URL exposed to frontend |
| **Monitoring** | | | |
| `SITE_METRICS_KEY` | Yes | VPS + coherencedaddy | Site analytics ingestion auth |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | Optional | VPS | Email alerting via Proton Mail SMTP (`smtp.protonmail.ch:587`). `SMTP_PASS` is a 16-char Proton SMTP token, NOT the account password. Rotate when `535 5.7.8 auth failed` appears (last rotated 2026-05-09). The host-level `egress-watch` cron on VPS1+VPS4 also reads from `/etc/egress-watch.env` — keep both in sync after rotation. |
| `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM` | Optional | VPS | Alert recipient + sender (also receives new affiliate application notifications). Production: `nestd@pm.me` ← `info@coherencedaddy.com`. |
| `AFFILIATE_SUPPORT_EMAIL` | Optional | VPS | Support email shown to affiliates on pending/approved screens (default: `SMTP_USER`) |
