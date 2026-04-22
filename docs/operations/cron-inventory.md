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

## Content Engine Crons
- **SEO Engine (1 job)**: Daily blog generation from trends at 7:03 AM (`content:seo-engine`).
- **Retweet Cycle (1 job)**: Automated content sharing.
- **Partner Sites (1 job)**: Coordination of partner content injection.
- **Text Generation (7 jobs)**: Personality-driven content for various platforms.
- **Video Scripts (3 jobs)**: Script generation for YouTube/Reels.
- **Intel Alerts (2 jobs)**: Triggering content based on intel signals.
- **TX Chain Daily (1 job)**: Daily blockchain-focused reports.
- **XRP/Vanguard (4 jobs)**: Specialized Ripple/XRP reports.
- **AEO Comparison/Forge (3 jobs)**: Competitive analysis reports.
- **Slideshow Blog (2 jobs)**: Interactive HTML slideshow generation.

## Product Fulfillment Crons
- **Directory Mentions (1 job)**: Monthly batch content generation for active Featured/Verified/Boosted listings — Blaze + Prism agents, 1st of month at 9 AM (`directory:mentions:generate`).
- **Directory Expire (1 job)**: Expire past_due listings overdue 30+ days — 3 AM daily (`directory:expire-listings`).
- **Partner Mentions (1 job)**: Monthly content batch for all active partner tiers — Cipher/Blaze/Spark, 1st of month at 10 AM (`partner:mentions:generate`).
- **Partner Strategy Docs (1 job)**: Biweekly Sage strategy document for Premium partners — 1st and 15th at 8 AM (`partner:strategy-doc:premium`).
- **CreditScore Scans (1 job)**: Rescans active Starter/Growth (monthly cadence) and Pro (weekly cadence) subscriptions when the last complete report is older than the tier cadence. Sends `monthly_report` (Starter/Growth), `weekly_report` (Pro), or `score_drop_alert` (≥10pt drop) email via storefront callback. Owner: `auditor`. Every 6 hours (`creditscore:scan`).
- **CreditScore Fix-Priority Digest (1 job)**: On the 1st of each month at 9 AM UTC, pulls latest complete report for every active Starter+ subscription, extracts the top-priority recommendation, sends `fix_priority_monthly` coaching email. Owner: `sage`. Monthly (`creditscore:fix-priority-digest`).
- **CreditScore Content Drafts (1 job)**: On the 1st of each month at 10 AM UTC, generates AEO-optimized page drafts for every active Growth (2 pages) and Pro (4 pages) subscription via Ollama Cloud (gemma4:31b by default on VPS2), targeting the weakest audit signals. Drafts land in `creditscore_content_drafts` with `status=pending_review` for board approval. Owner: `cipher`. Monthly (`creditscore:content-drafts`).
- **Owned Sites Metrics Sync (1 job)**: Pulls GA4 + AdSense daily rows into `owned_site_metrics` for sites in `live` / `adsense_pending` / `monetized` status. Owner: `metrics-agent`. Every 6 hours (`owned-sites:sync-metrics`).
- **Owned Sites Content Refresh (1 job)**: Monthly trigger for Ollama-driven article refresh on VPS2 (pipeline wiring follow-up). Owner: `content-agent`. Monthly, 1st at 9 AM (`owned-sites:content-refresh`).

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
