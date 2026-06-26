# Docs — Map of Content

> **Cluster:** Index · **Tags:** index, map-of-content, zettelkasten, navigation, docs · **Related:** [Ownership Matrix](OWNERSHIP.md), [System Overview](architecture/system-overview.md), [Project Structure](architecture/project-structure.md), [Repo Spec (CLAUDE.md)](../CLAUDE.md)

This is the hub for `team-dashboard`'s docs — the **engine room** of the Coherence Daddy + ShieldnestORG ecosystem (API routes, crons, agents, migrations, deploy). Docs are grouped **by cluster** below, each with a one-line hook and a relative link.

**Conventions used here**

- Each prose doc carries a one-line **meta block** under its H1: `> **Cluster:** … · **Tags:** … · **Related:** …`. Tags are the words you'd grep for; Related links are 2–5 genuinely adjacent docs. This makes docs findable by reading, by grep, and by semantic search.
- **Reference-style API/CLI/adapter/guide pages use YAML front-matter** and therefore have **no meta block** (a blockquote would break the front-matter parser). They are still listed below.
- Authoritative project spec: [`CLAUDE.md`](../CLAUDE.md) at the repo root. Cross-repo boundaries: [`OWNERSHIP.md`](OWNERSHIP.md).
- A queryable **code knowledge graph** exists at `graphify-out/` (built offline via `graphify` — per-developer, gitignored). Prefer `graphify query/explain/path` over grep for code questions; see the `## graphify` section in [`CLAUDE.md`](../CLAUDE.md).

---

## Architecture

The shape of the system — services, routes, schemas, the knowledge-graph engine, and how the repo is laid out.

- [System Overview](architecture/system-overview.md) — control plane, ecosystem subdomains, VPS topology, agents, monetization.
- [Project Structure](architecture/project-structure.md) — directory map of server/ui/packages: routes, services, schema, plugins, agents.
- [Org Structure](architecture/org-structure.md) — org chart, ecosystem ventures, shop/WooCommerce, subdomain ownership.
- [Structure Diagram Policy](architecture/structure-diagram-policy.md) — how the auto-synced Mermaid topology diagram is maintained.
- [SBOM Parser Design](architecture/sbom-parser-design.md) — `depends_on` extraction from package manifests into the knowledge graph.
- [KG 2026-04-28 Handoff](architecture/kg-2026-04-28-handoff.md) — dated snapshot of the knowledge-graph cleanup (Nexus/SBOM/relationship extractor).
- [KG Extractor Prompt Fix](architecture/kg-extractor-prompt-fix.md) — fixing subject-bleed in the Ollama triple extractor.
- [Ownership Matrix](OWNERSHIP.md) — canonical boundary between this repo and its sibling repos (pricing, Stripe, entitlements, fulfillment).

## API

REST + integration surfaces this backend exposes. *(Most pages here are front-matter reference docs without meta blocks.)*

Prose docs (with meta blocks):
- [Intel API](api/intel.md) — blockchain-directory query API, semantic search over pgvector, plan-aware rate limits.
- [Public Intel API](api/intel-public.md) — the unauthenticated read surface that powers directory.coherencedaddy.com.
- [Trends API](api/trends.md) — trend signals + SEO/blog generation pipeline (CoinGecko, HN, Google/Bing).
- [Twitter/X API](api/twitter.md) — X v2 client, OAuth PKCE, dollar-budgeted rate limiter, engagement automation.
- [Media Drops API](api/media-drops.md) — media upload/management for the content pipeline.
- [Partners API](api/partners.md) — partner CRUD, AEO microsites, referral/click tracking.
- [CreditScore API](api/creditscore.md) — audit + scoring endpoints, Stripe checkout/webhook, entitlements.
- [MCP Server](api/mcp-server.md) — Paperclip MCP server exposing task management as 35 tools over stdio.

Reference pages (front-matter, no meta block): [Overview](api/overview.md) · [Authentication](api/authentication.md) · [Agents](api/agents.md) · [Companies](api/companies.md) · [Costs](api/costs.md) · [Dashboard](api/dashboard.md) · [Goals & Projects](api/goals-and-projects.md) · [Issues](api/issues.md) · [Approvals](api/approvals.md) · [Activity](api/activity.md) · [Routines](api/routines.md) · [Secrets](api/secrets.md) · [Site Metrics](api/site-metrics.md).

## Agents & Runtime

How agents run, register, and are configured.

- [Agents Runtime](agents-runtime.md) — heartbeat/wakeup protocol, adapters, agent runtime model.
- [Agent Config UI](specs/agent-config-ui.md) — spec for the agent configuration UI (org chart, budgets, heartbeat).
- [ClipHub Plan](specs/cliphub-plan.md) — marketplace of team blueprints / company packages.
- [Companies Spec](companies/companies-spec.md) — vendor-neutral company-package + agent-skills format.

Reference pages (front-matter): adapters — [Overview](adapters/overview.md) · [Process](adapters/process.md) · [HTTP](adapters/http.md) · [Claude (local)](adapters/claude-local.md) · [Codex (local)](adapters/codex-local.md) · [Gemini (local)](adapters/gemini-local.md) · [Creating an Adapter](adapters/creating-an-adapter.md).

## Products / PRDs

Product requirement docs and roadmaps for the revenue-bearing surfaces.

Directory & verticals:
- [Directory SERP Ingest](products/directory-serp-ingest-prd.md) — discovery/enrichment ingestion for the directory catalog.
- [Directory Outreach](products/directory-outreach-prd.md) — outbound email outreach to directory prospects.
- [Directory Listings](products/directory-listings-prd.md) — paid-placement monetization of directory listings.
- [Cosmos/IBC Directory](products/cosmos-ibc-directory-prd.md) · [EigenLayer AVS Directory](products/eigenlayer-avs-directory-prd.md) · [Faith-Tech Directory](products/faith-tech-directory-prd.md) · [DevTools Live Signals](products/devtools-live-signals-prd.md) — vertical directory cuts.

Intel & knowledge graph:
- [Intel API PRD](products/intel-api-prd.md) — the paid blockchain data API product.
- [Knowledge Graph Positioning](products/knowledge-graph-positioning.md) — how the KG/intel enrichment is positioned.

SEO / AEO / content:
- [AEO/SEO Playbook](products/aeo-seo-playbook-prd.md) · [AEO Content Cluster](products/aeo-content-cluster-prd.md) · [Blog Distribution](products/blog-distribution.md) · [AdSense Go-Live Checklist](products/adsense-go-live-checklist.md) · [Topic Takeover Roadmap](products/topic-takeover-roadmap.md) · [Geo Tactics Roadmap](products/geo-tactics-roadmap.md) · [LLMs.txt Generator](products/llms-txt-generator.md) · [Tutorials Hub](products/tutorials-hub.md).

Monitoring & monetization:
- [Watchtower](products/watchtower.md) — $29/mo brand-mention monitor across answer engines (see [audit](audits/watchtower-portal-audit-2026-05-13.md)).
- [CreditScore PRD](products/creditscore-prd.md) · [Agents Product](products/agents-product-prd.md) · [Bundles](products/bundles-prd.md) · [All-Inclusive](products/all-inclusive-prd.md) · [Customer Portal](products/customer-portal.md) · [Partner Network](products/partner-network-prd.md) · [House Ads](products/house-ads.md) · [Shop Sharers](products/shop-sharers.md) · [Prospects](products/prospects-prd.md) · [Tool-Niche Harvest](products/tool-niche-harvest-prd.md) · [Demographic Targeting](products/demographic-targeting-report.md).

Socials & video:
- [Socials Hub](products/socials-hub.md) · [Socials Phase-2 Handoff](products/socials-phase2-handoff.md) · [Launch Monitor](products/launch-monitor.md) · [Video Edit](products/video-edit.md).

Utility network:
- [Utility Network Portfolio](products/utility-network/README.md) · [DailyCompound Pivot](products/utility-network/dailycompound-pivot-brief.md) · [TokenCount Pivot](products/utility-network/tokencount-pivot-brief.md).

## Deploy & Infrastructure

How this backend is built, configured, and shipped (VPS + Vercel + Stripe). *(Several pages here use front-matter.)*

Prose docs (meta blocks):
- [Production Deploy](deploy/production.md) — VPS4/Vercel/Docker/nginx deploy + DNS.
- [VPS Cheat Sheet](deploy/vps-cheat-sheet.md) — SSH/DNS/host quick reference.
- [Env Vars](deploy/env-vars.md) — environment variable reference (VPS, secrets, Stripe, portal).
- [Tailnet Session Access](deploy/tailnet-session-access.md) — Tailscale egress/ACL for agent sessions + Firecrawl.
- [Multi-Employee Go-Live](deploy/multi-employee-go-live.md) — authenticated-mode go-live steps.
- [Stripe Products](deploy/stripe-products.md) · [Stripe Runbook](deploy/stripe-runbook.md) — price IDs, accounts, webhooks, gotchas.

Reference pages (front-matter): [Overview](deploy/overview.md) · [Deployment Modes](deploy/deployment-modes.md) · [Docker](deploy/docker.md) · [Database](deploy/database.md) · [Local Development](deploy/local-development.md) · [Secrets](deploy/secrets.md) · [Storage](deploy/storage.md) · [Tailscale Private Access](deploy/tailscale-private-access.md) · [Vercel/VPS Split](deploy/vercel-vps-split.md).

## Guides

How-to and operational guides. *(Agent-developer and board-operator guides use front-matter.)*

Prose guides:
- [Agent Cron Ownership](guides/agent-cron-ownership.md) — which agent owns which cron; heartbeat/wakeup model.
- [Plugin Registration](guides/plugin-registration.md) · [Discord Bot Plugin](guides/discord-bot-plugin.md) · [OpenClaw Docker Setup](guides/openclaw-docker-setup.md) — plugin/adapter setup.
- [Affiliate System (Upgraded)](guides/affiliate-system-upgraded.md) · [Affiliate User Journeys](guides/affiliate-user-journeys.md) · [Admin Affiliate Testing](guides/admin-affiliate-testing.md) — the affiliate stack.
- [SEO/AEO Checklist](guides/seo-aeo-checklist.md) · [Branch Safety](guides/branch-safety.md) — content + git hygiene.
- [VPS3 Ollama Setup](guides/vps3-ollama-setup.md) — **HISTORICAL** (VPS3 decommissioned 2026-05-08; do not provision here).

Reference pages (front-matter): agent-developer — [How Agents Work](guides/agent-developer/how-agents-work.md) · [Task Workflow](guides/agent-developer/task-workflow.md) · [Heartbeat Protocol](guides/agent-developer/heartbeat-protocol.md) · [Handling Approvals](guides/agent-developer/handling-approvals.md) · [Comments & Communication](guides/agent-developer/comments-and-communication.md) · [Cost Reporting](guides/agent-developer/cost-reporting.md) · [Writing a Skill](guides/agent-developer/writing-a-skill.md). board-operator — [Dashboard](guides/board-operator/dashboard.md) · [Creating a Company](guides/board-operator/creating-a-company.md) · [Managing Agents](guides/board-operator/managing-agents.md) · [Managing Tasks](guides/board-operator/managing-tasks.md) · [Delegation](guides/board-operator/delegation.md) · [Approvals](guides/board-operator/approvals.md) · [Costs & Budgets](guides/board-operator/costs-and-budgets.md) · [Activity Log](guides/board-operator/activity-log.md) · [Importing & Exporting](guides/board-operator/importing-and-exporting.md) · [Org Structure](guides/board-operator/org-structure.md).

## Operations

Running-the-system audits and inventories.

- [Cron Inventory](operations/cron-inventory.md) — every registered cron, its owner agent, and schedule.
- [KG Burn Estimate](operations/kg-burn-estimate.md) — knowledge-graph cost/burn modeling.
- [Key Files](operations/key-files.md) — codebase map of the most important routes/services.
- [Dashboard Audit 2026-06-07](operations/dashboard-audit-2026-06-07.md) — dated bug/TODO audit.
- [Firecrawl SERP Connectivity Audit](operations/firecrawl-serp-connectivity-audit.md) — tailnet/egress connectivity diagnosis.

## Plans

Forward-looking plans and TODOs.

- [Unified Affiliate Hub Plan](plans/unified-affiliate-hub-plan.md) — commission ledger, attribution, payouts.
- [Skills Pipeline Integration](plans/skills-pipeline-integration.md) · [Stigmergy Follow-ups](plans/stigmergy-followups.md) — skills/knowledge tooling.
- [Socials Automation TODO](plans/socials-automation-todo.md) — publishing/approval automation backlog.
- [Issue Documents Plan](plans/2026-03-13-issue-documents-plan.md) · [CreditScore Audit Fail-Loudly](plans/2026-04-30-creditscore-audit-fail-loudly.md) — dated plans.

## Launch (Two-Engine Round 2)

The launch kit for the "two-engine" round-2 push.

- Social posts: [Show HN](launch/two-engine-round-2/hn-show.md) · [Reddit Posts](launch/two-engine-round-2/reddit-posts.md) · [X Thread](launch/two-engine-round-2/x-thread.md) · [Discord Blurbs](launch/two-engine-round-2/discord-blurbs.md) · [dev.to Round 2](launch/two-engine-round-2/devto-round-2.md).
- Video scripts: [Day-in-the-Life](launch/two-engine-round-2/youtube-day-in-life-script.md) · [YouTube Short](launch/two-engine-round-2/youtube-short-script.md) · [Speed Test](launch/two-engine-round-2/youtube-speed-test-script.md).
- Assets & SEO: [Screenshot Shot List](launch/two-engine-round-2/screenshot-shot-list.md) · [GIF Shot List](launch/two-engine-round-2/gif-shot-list.md) · [OG Image Spec](launch/two-engine-round-2/og-image-spec.md) · [GSC/Bing Checklist](launch/two-engine-round-2/gsc-bing-checklist.md) · [Awesome-PR Templates](launch/two-engine-round-2/awesome-pr-templates.md).

## Handoffs

Point-in-time handoff notes.

- [2026-05-09 Geo-Tactics Execution](handoffs/2026-05-09-geo-tactics-execution.md)
- [2026-05-17 Migration 0116 Diagnosis](handoffs/2026-05-17-migration-0116-diagnosis.md)
- [2026-05-17 Portal Smoke](handoffs/2026-05-17-portal-smoke.md)

## Audits, Backlinks & Companies

- [Watchtower Portal Audit 2026-05-13](audits/watchtower-portal-audit-2026-05-13.md) — portal/upsell audit for Watchtower.
- [Backlink Targets](backlinks/BACKLINK-TARGETS.md) — outreach/AEO backlink target list.

## CLI & Getting Started

Reference pages (front-matter, no meta block):
- CLI: [Overview](cli/overview.md) · [Setup Commands](cli/setup-commands.md) · [Control-Plane Commands](cli/control-plane-commands.md).
- Start: [Quickstart](start/quickstart.md) · [Architecture](start/architecture.md) · [Core Concepts](start/core-concepts.md) · [What is Paperclip](start/what-is-paperclip.md).

## Archived

Kept for history; canonical content has moved.

- [Tools — Control Systems](tools/CONTROL-SYSTEMS.md) — **MIGRATED** to `ShieldnestORG/coherencedaddy`.
- [Tools — Master Documentation](tools/TOOLS-MASTER-DOCUMENTATION.md) — **MIGRATED**; canonical is `coherencedaddy/docs/TOOLS.md`.

---

*Affiliate learn material ([curriculum](products/affiliate-learn-curriculum.md), [TODO](products/affiliate-learn-todo.md)) uses front-matter and is listed without a meta block.*
