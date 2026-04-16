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
