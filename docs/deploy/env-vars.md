# Environment Variables — Team Dashboard

## Overview
These variables are required for the project to function. **VPS** requires all variables in `.env.production` at `/opt/team-dashboard/`. **Vercel** gets `DATABASE_URL` via Neon integration and requires no other variables as it only serves the static UI.

## Variable Reference

| Variable | Required | Where | Purpose |
|----------|----------|-------|---------|
| **Database** | | | |
| `DATABASE_URL` | Yes | VPS + Vercel + Local | Neon PostgreSQL connection string |
| **Auth** | | | |
| `PAPERCLIP_AGENT_JWT_SECRET` | Yes | VPS | Agent JWT signing secret |
| `BETTER_AUTH_SECRET` | Yes | VPS | Better Auth session signing |
| `BETTER_AUTH_TRUSTED_ORIGINS` | Yes | VPS | CORS origins — comma-separated (Vercel URL + `https://affiliates.coherencedaddy.com`) |
| `PAPERCLIP_PUBLIC_URL` | Yes | VPS | Public URL for auth callbacks |
| `PAPERCLIP_ALLOWED_HOSTNAMES` | Yes | VPS | Allowed hostnames — comma-separated (includes `affiliates.coherencedaddy.com`) |
| `AFFILIATE_JWT_SECRET` | Recommended | VPS | Dedicated signing secret for affiliate JWTs — falls back to `BETTER_AUTH_SECRET`. Rotate independently of admin auth. Generate: `openssl rand -hex 32` |
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
| `CD_BLOG_API_URL` | Optional | VPS | Blog publish endpoint (default: `https://coherencedaddy.com/api/blog/posts`) |
| `CD_BLOG_API_KEY` | Yes | VPS | Bearer token for coherencedaddy blog API |
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
| `EMBED_URL` | Yes | VPS | Embedding service (`http://147.79.78.251:8000`) |
| `EMBED_API_KEY` | Yes | VPS | Embedding service auth |
| `FIRECRAWL_EMBEDDING_API_KEY` | Yes | VPS | Firecrawl scraping API auth |
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
| `OLLAMA_URL` / `OLLAMA_API_KEY` / `OLLAMA_MODEL` | Yes | VPS | Ollama Cloud endpoint (default VPS2, `gemma4:31b`). Powers the Content Agent (AEO page drafting), SEO Engine, and other content pipelines. |
| `INTEL_BILLING_SUCCESS_URL` | Optional | VPS | Checkout success redirect |
| `INTEL_BILLING_CANCEL_URL` | Optional | VPS | Checkout cancel redirect |
| `ENTERPRISE_BOOKING_URL` | Optional | VPS | Cal.com or Calendly booking URL for enterprise calls |
| `VITE_ENTERPRISE_BOOKING_URL` | Optional | UI build | Same URL exposed to frontend |
| **Monitoring** | | | |
| `SITE_METRICS_KEY` | Yes | VPS + coherencedaddy | Site analytics ingestion auth |
| `SMTP_HOST/PORT/USER/PASS` | Optional | VPS | Email alerting (Proton Mail) |
| `ALERT_EMAIL_TO/FROM` | Optional | VPS | Alert email recipients (also receives new affiliate application notifications) |
| `AFFILIATE_SUPPORT_EMAIL` | Optional | VPS | Support email shown to affiliates on pending/approved screens (default: `SMTP_USER`) |
