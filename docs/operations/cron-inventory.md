# Cron Inventory — Team Dashboard

## Cron Overview
The system relies on a vast array of scheduled jobs to power the intel engine, content generation, and agent memories. All cron jobs are associated with an `ownerAgent` for accountability and operational clarity.

## Intel Engine Crons
- **Ingest (5 jobs)**: Data collection for the blockchain intel pipeline.
- **Backfill (1 job)**: Historical data building for sparse companies.
- **Discovery (1 job)**: Automated trending project discovery (CoinGecko + GitHub).
- **Chain Metrics LCD (1 job)**: Staking APR, validator count, block height.
- **Chain TVL DefiLlama (1 job)**: TVL ingestion for cosmos/osmosis.
- **Validator Ranks LCD (1 job)**: Top-50 validator rank tracking.
- **Billing Overage (1 job)**: Daily reporting of Intel API usage to Stripe.

## Socials Hub
All content cron jobs below are mirrored into `social_automations` (linked to `social_accounts` by `brand` + `platform`). View them in the UI at `/socials → Automation`. The mirror is upserted by `POST /api/socials/automations/sync` — see [docs/products/socials-hub.md](../products/socials-hub.md).

## Content Engine Crons
- **SEO Engine (1 job)**: Daily blog generation from trends at 7:03 AM (`content:seo-engine`).
- **Retweet Cycle (1 job)**: Automated content sharing.
- **Partner Sites (1 job)**: Coordination of partner content injection.
- **Text Generation (7 jobs)**: Personality-driven content for various platforms.
- **Video Scripts (3 jobs)**: Script generation for YouTube/Reels.
- **Intel Alerts (2 jobs)**: Triggering content based on intel signals.
- **TX Chain Daily (1 job)**: Daily blockchain-focused reports. Target `sn` → shieldnest.org/blog (LIVE).
- **XRP/Vanguard (4 jobs)**: Specialized Ripple/XRP reports.
- **AEO Comparison/Forge (3 jobs)**: Competitive analysis reports.
- **Slideshow Blog (2 jobs)**: Interactive HTML slideshow generation. `:cd` → coherencedaddy.com/blog; `:sn` → shieldnest.org/blog. Both LIVE.

> **Blog publish targets.** Crons with `publishTarget: "all"` fan out to `cd` + `sn` + `tokns-app` in parallel via `Promise.allSettled`. Per-target outcomes (`success`, `error`, `url`, `publishedAt`) are persisted to `content_items.publish_results` (JSONB, migration 0092) and surfaced in the `/content-review` admin UI with retry buttons. See [docs/products/blog-distribution.md](../products/blog-distribution.md) for the full target matrix, contracts, and SQL health queries.

## Product Fulfillment Crons
- **Directory Mentions (1 job)**: Monthly batch content generation for active Featured/Verified/Boosted listings — Blaze + Prism agents, 1st of month at 9 AM (`directory:mentions:generate`).
- **Directory Expire (1 job)**: Expire past_due listings overdue 30+ days — 3 AM daily (`directory:expire-listings`).
- **Partner Mentions (1 job)**: Monthly content batch for all active partner tiers — Cipher/Blaze/Spark, 1st of month at 10 AM (`partner:mentions:generate`).
- **Partner Strategy Docs (1 job)**: Biweekly Sage strategy document for Premium partners — 1st and 15th at 8 AM (`partner:strategy-doc:premium`).
- **CreditScore Scans (1 job)**: Rescans active Starter/Growth (monthly cadence) and Pro (weekly cadence) subscriptions when the last complete report is older than the tier cadence. Sends `monthly_report` (Starter/Growth), `weekly_report` (Pro), or `score_drop_alert` (≥10pt drop) email via storefront callback. Owner: `auditor`. Every 6 hours (`creditscore:scan`).
- **CreditScore Fix-Priority Digest (1 job)**: On the 1st of each month at 9 AM UTC, pulls latest complete report for every active Starter+ subscription, extracts the top-priority recommendation, sends `fix_priority_monthly` coaching email. Owner: `sage`. Monthly (`creditscore:fix-priority-digest`).
- **CreditScore Content Drafts (1 job)**: On the 1st of each month at 10 AM UTC, generates AEO-optimized page drafts for every active Growth (2 pages) and Pro (4 pages) subscription via Ollama Cloud (`https://ollama.com/api`, default model `gemma4:31b-cloud`), targeting the weakest audit signals. Drafts land in `creditscore_content_drafts` with `status=pending_review` for board approval. Owner: `cipher`. Monthly (`creditscore:content-drafts`).
- **CreditScore Schema Impls (1 job)**: On the 1st of each month at 11 AM UTC, generates JSON-LD implementations (Growth=1, Pro=2) per active subscription via Ollama. Prefers schema.org types the audit shows are missing (FAQPage → Organization → Article → Product → LocalBusiness → BreadcrumbList → WebSite). Lands in `creditscore_schema_impls` pending review. Owner: `core`. Monthly (`creditscore:schema-impls`).
- **CreditScore Competitor Scans (1 job)**: On the 1st of each month at 11:30 AM UTC, runs the audit pipeline against the top competitor domains identified in the latest report (Growth=3, Pro=5) and stores comparative results with a short gap summary in `creditscore_competitor_scans`. Owner: `forge`. Monthly (`creditscore:competitor-scans`).
- **CreditScore Sage Weekly (1 job)**: Every Monday at 12:00 UTC, generates a 1-page strategy doc per active Pro subscription by synthesizing latest audit + 45d competitor scans + content drafts + schema impls. Delivers via `sage_weekly_digest` email kind. Stored in `creditscore_strategy_docs`. Owner: `sage`. Weekly (`creditscore:sage-weekly`).
- **Owned Sites Metrics Sync (1 job)**: Pulls GA4 + AdSense daily rows into `owned_site_metrics` for sites in `live` / `adsense_pending` / `monetized` status. Owner: `metrics-agent`. Every 6 hours (`owned-sites:sync-metrics`).
- **Owned Sites Content Refresh (1 job)**: Monthly trigger for Ollama-driven article refresh (pipeline wiring follow-up; was previously scoped to VPS2 — now targets Ollama Cloud per `reference_ollama_routing.md`). Owner: `content-agent`. Monthly, 1st at 9 AM (`owned-sites:content-refresh`).
- **Watchtower Weekly Runs (1 job)**: Every Monday at 09:00 UTC, fans out across active+weekly `watchtower_subscriptions` rows (concurrency 5) and replays each subscription's prompts × engines (chatgpt/claude/perplexity/gemini), persisting one `watchtower_results` row per cell and a `watchtower_runs` summary. Sends a digest email per subscription via the `WATCHTOWER_EMAIL_CALLBACK_URL` storefront callback. Engines without API keys configured are skipped with a single warning log per run (Gemini specifically per spec). Owner: `watchtower`. Weekly (`watchtower:weekly-runs`). See [docs/products/watchtower.md](../products/watchtower.md).

## Other Operational Crons
- **Trends Scan (1 job)**: CoinGecko, HackerNews, Google Trends, Bing News every 6h.
- **Maintenance (2 jobs)**: Stale content cleanup and general health checks.
- **SSL Monitor (1 job)**: Certificate expiry check every 6h.
- **Auto-Reply (1 job)**: Single `search/recent` query covering all targets (default 30 min).
- **Moltbook Backend (5 jobs)**: Ingest, post, engage, heartbeat, and performance tracking.
- **YouTube Pipeline (6 jobs)**: Production, publish-queue, analytics, strategy, optimization, and 30-day video file cleanup.
- **Discord Plugin (2 jobs)**: Ticket cleanup and daily stats.
- **Twitter Plugin (4 jobs)**: Post-dispatcher (2m), engagement-cycle (30m), queue-cleanup (6h), analytics-rollup (daily).
- **Moltbook Plugin (3 jobs)**: Content-dispatcher (5m), heartbeat (30m), daily-cleanup (midnight).
- **Knowledge Graph (9 jobs)**: 
  - Nexus Extraction (2 jobs)
  - Weaver Curation (3 jobs)
  - Recall Memory (3 jobs)
  - Oracle Cache (1 job)

For a full mapping of which agent owns which specific cron, refer to:
`docs/guides/agent-cron-ownership.md`

## Host-level crons (VPS1 + VPS4)

> **Scope note.** The crons listed below are **not** part of the team-dashboard application cron registry (`system_crons` table / `server/src/cron/`). They are system-level cron entries managed via `/etc/cron.d/egress-watch` on the VPS hosts themselves. They appear here so operators looking for "what's scheduled on our infra" can find them in one place — but they will not show up in the `/automation-health` dashboard or the in-app cron UI, and they cannot be paused/edited from the team-dashboard.

Added 2026-05-09 alongside the day's container hardening (cap_drop / no-new-privileges / read_only on Ollama, BGE-M3, team-dashboard, partial on Firecrawl).

- **Egress Watch (every 5 min, VPS1 + VPS4)**
  - **Schedule**: `*/5 * * * *`
  - **Path on VPS**: `/usr/local/bin/egress-watch.sh` (mode 750 root:root)
  - **Cron file**: `/etc/cron.d/egress-watch` (root)
  - **Config**: `/etc/egress-watch.env` (mode 600 root:root) — Proton SMTP creds + thresholds.
  - **What it actually does**: Samples eth0 RX/TX bytes from `/proc/net/dev` over 10s, reads `/proc/loadavg`, appends a line to `/var/log/egress-watch/YYYY-MM-DD.log`. Sends Proton SMTP alert (`curl --ssl-reqd smtp://smtp.protonmail.ch:587`) when **either** TX > 500 KB/s **or** load15 > nproc × 0.9. 1-hour cooldown via `/var/lib/egress-watch/last-alert`.
  - **Why this catches miners**: XMRig pool traffic is small (KB/s) and slips under bandwidth alerts — load15 is the more reliable signal because miners peg cores. Designed to catch a repeat of the 2026-05-08 Ollama-RCE → XMRig pattern early.
  - **Alert destination**: `nestd@pm.me` from `info@coherencedaddy.com` via Proton SMTP (16-char token, rotated 2026-05-09).
  - **Owner**: Infra (HEAD_DEV / `nestd@pm.me`); not assigned to an in-app agent.

- **Egress Daily Summary (23:55 daily, VPS1 + VPS4)**
  - **Schedule**: `55 23 * * *`
  - **Path on VPS**: `/usr/local/bin/egress-daily-summary.sh` (mode 750 root:root)
  - **Cron file**: `/etc/cron.d/egress-watch` (root)
  - **What it actually does**: Roll up the day's `/var/log/egress-watch/YYYY-MM-DD.log` entries into a single digest email and prune logs older than 30 days. Always sent, even on clean days, so a missing email is itself a signal that the host or cron is dead.
  - **Alert destination**: `nestd@pm.me` from `info@coherencedaddy.com` via Proton SMTP.
  - **Owner**: Infra (HEAD_DEV / `nestd@pm.me`); not assigned to an in-app agent.

> **Status (2026-05-09 EOD):** team-dashboard's `.env.production` on VPS4 has been synced with the new Proton SMTP token and the container restarted (hardening preserved, healthy). VPS1 Tailscale re-auth + admin-console key-expiry-disable on both `shield-llm` and `shield-main-1` are complete. Both egress-watch crons firing on schedule on both VPSs.
