# Changelog

All notable changes to Team Dashboard are documented here. Versioning follows
calendar-ish dating (YYYY-MM-DD). Unreleased changes sit under `[Unreleased]`
until they ship to production.

## [2026-04-14] — SEO advisory loop + monetization plumbing + unified automation health

This release closes **8 of the 10** P0/P1 items from
`doc/PRD_automated_services_audit.md` (the PRD itself also landed in this
release). Everything compiles clean (`server + ui` both `tsc --noEmit` exit
0), is merged to `master`, deployed to VPS, and serving 200s on live
endpoints.

### Added

#### Sage SEO/AEO Advisory Loop
- `server/src/services/seo-audit.ts` — on-page auditor that fetches a URL,
  parses HTML, and validates the 16-item SEO/AEO checklist from
  `docs/guides/seo-aeo-checklist.md` (reuses `partner-seo-checklist.ts`
  validators).
- `server/src/services/repo-update-advisor.ts` — turns audit failures into
  pending suggestion rows with **Ollama-enriched site-specific rationale**
  (3-concurrency cap, 10s timeout, static `FIX_LIBRARY` fallback per
  checklist item).
- `server/src/services/seo-audit-cron.ts` — weekly Sundays 8:17am, owned by
  Sage. Audits 8 monitored URLs and sends a digest email via `alerting.ts`.
- `server/src/routes/repo-updates.ts` — admin queue API:
  list/get/approve/reject/reply/run-audit/stats/draft-pr/get-pr.
- `server/src/services/github-client.ts` + `repo-update-pr-worker.ts` —
  approved suggestions can spawn a review-only GitHub PR. **Never auto-merges.**
  Allowlisted repos only, `GITHUB_TOKEN` required, mandatory disclaimer in PR
  body. v1 uses marker-file approach
  (`.seo-audit/SUGGESTION-<id>.md`) — no source-file mutation.
- `ui/src/pages/RepoUpdates.tsx` — admin review UI with Approve/Reject/Reply
  + Draft-PR button + `pr_drafted` status badge with PR link.
- Migration `0065_repo_update_suggestions`.

#### Intel API Paid Tier
- `packages/db/src/schema/intel_billing.ts` — `intel_plans`,
  `intel_customers`, `intel_api_keys`, `intel_usage_meter` tables.
- `server/src/services/stripe-client.ts` — dependency-free raw-fetch Stripe
  wrapper (no `stripe` npm package required).
- `server/src/services/intel-billing.ts` + `routes/intel-billing.ts` — plan
  listing, checkout session, webhook (`checkout.session.completed` /
  `invoice.paid` / `customer.subscription.deleted`), API-key lifecycle with
  sha256 hashing, customer-self-service `/me`.
- `server/src/middleware/intel-rate-limit.ts` — API-key-aware tiered rate
  limits with usage metering, overage tracking for Stripe metered billing.
- `ui/src/pages/IntelPricing.tsx` (public) + `IntelBilling.tsx` (admin) +
  `IntelBillingSuccess.tsx`.
- Migration `0067_intel_billing`.

#### Directory Listings (Paid Tier)
- `packages/db/src/schema/directory_listings.ts` + `0066_directory_listings`
  migration.
- `server/src/services/directory-listings.ts` + `routes/directory-listings.ts`.
- `ui/src/pages/intel/ListingsTab.tsx` + `ListingDetailDrawer.tsx`.

#### Unified Automation Health Dashboard
- `server/src/services/automation-health.ts` — aggregator returning crons /
  plugins / integrations / advisory / warnings snapshot.
- `server/src/routes/automation-health.ts` — `GET /api/automation-health`.
- `ui/src/pages/AutomationHealth.tsx` — 4 stat cards, warnings banner,
  sortable cron staleness table with heuristic (ok / warn / critical),
  installed vs dormant plugin columns, 22 external integration chips.
- Live on deploy: currently surfaces **3 stale / 4 erroring crons** + 1
  dormant plugin manifest — the dashboard is immediately doing its job.

#### Echo Firecrawl Sync
- `server/src/services/firecrawl-sync.ts` — top-50 intel companies by
  30-day report count, scraped via Firecrawl, BGE-M3 embedded, inserted into
  `intel_reports` as `report_type='firecrawl-sync'`. 3-concurrency cap,
  30s per-request timeout, vectorless-insert fallback.
- `server/src/services/firecrawl-crons.ts` — `firecrawl:sync` Sundays 3:47am,
  owned by Echo.

#### Sage PR Drafting
- Allowlisted repos: `ShieldnestORG/{coherencedaddy, team-dashboard,
  v1_shieldnest_org, shieldnest_landing_page}`.
- Disclaimer baked into every PR body:
  *"Auto-drafted by Sage (SEO/AEO Audit Advisor). Human review required — DO
  NOT merge without verifying."*
- PR URL stored in existing `admin_response` column (`PR: <url> | number:
  <n>`) — no migration required.

#### Plugin Log Retention
- `server/src/services/plugin-log-retention.ts` now started from `app.ts` —
  7-day plugin log pruning. Previously dead code.

#### Auto-Reply → Central Cron Registry
- `server/src/services/auto-reply.ts` refactored from rogue `setInterval`
  into `registerCronJob("auto-reply:poll", "*/30 * * * *", "core", ...)`.
  Now visible in `/crons` admin UI.

#### PRD
- `doc/PRD_automated_services_audit.md` — 700-line audit of all 62 crons,
  plugin dormancy, agent reality check, external integration status, 6
  interconnection enhancements, 10-path monetization roadmap ranked by
  time-to-first-dollar.

### Changed

- `docs/guides/agent-cron-ownership.md` — Sage 1 → 2 jobs, Echo 9 → 10 jobs,
  Moltbook schedule reconciled to match code (not stale docs). Total 60 → 63
  system crons + 5 plugin jobs.
- `agents/sage/AGENTS.md` — new "Advisory Loop — Repo Updates" section +
  PR-drafting duty.
- `agents/moltbook/AGENTS.md` — schedule matches code reality.
- `agents/echo/AGENTS.md` — firecrawl:sync cron row added.
- `server/src/services/youtube/yt-crons.ts` — dormant path now logs `warn`
  instead of silent `info` when `YT_PIPELINE_ENABLED` is unset.
- `CLAUDE.md` — env var reference updated: `YT_PIPELINE_ENABLED` documented,
  `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` marked as **used** (not
  just declared).
- `.env.example` — added `YT_PIPELINE_ENABLED`.
- `ui/src/pages/Structure.tsx` — Mermaid diagram updated with SEO audit
  subsystem, PR worker, GitHub client, Firecrawl sync, Intel Billing,
  Automation Health, plugin log retention. Both the fallback
  `DEFAULT_DIAGRAM` and the persisted `/api/companies/:id/structure` record
  are updated.
- `ui/src/components/Sidebar.tsx` — new nav items: Repo Updates, Automation
  Health, Intel Billing.
- `server/src/routes/repo-updates.ts` — extended with `POST /:id/draft-pr`,
  `GET /:id/pr`, new `pr_drafted` state.
- `server/src/app.ts` — mounts for `/repo-updates`, `/automation-health`,
  `/intel-billing`, `/directory-listings`, `/stripe` (webhook with scoped
  raw-body middleware), plus `startSeoAuditCron`, `startPluginLogRetention`,
  `startFirecrawlCrons`.

### Fixed

- `.gitignore` — `ui/.claude/` now ignored (dev-only launch config).
- `ui/src/pages/Structure.tsx` — earlier Mermaid nodes wired up with edges
  (previously nodes existed without flow connections).

### Deferred (follow-up)

- **Partner subscription billing via Stripe** — intel tier is live;
  partner tier needs 1 follow-up day of work on top of the existing
  `stripe-client.ts` (write `partner-billing-crons.ts` + `/api/billing/partner-checkout` route). Original worktree implementation was
  SDK-based and collided with master's fetch-based client.
- **Option B PR drafting** — current Option A writes a marker file only;
  Option B (Ollama-merged real file diffs) is noted as a follow-up in
  `agents/sage/AGENTS.md` and `repo-update-pr-worker.ts` header.
- **Erroring crons surfaced by automation-health** — `content:xrp:blog`,
  `content:aeo:blog`, `content:tokns-promo:blog` (fetch failures) and
  `eval:smoke` (EACCES on `/app/data` inside the container). Track these
  separately.
- **Dormant moltbook plugin manifest** — `coherencedaddy.moltbook` is on
  disk but not registered in `plugin_config`. Run through the plugin loader
  flow documented in `docs/guides/plugin-registration.md`.

### Infrastructure

- Neon migrations applied: `0065_repo_update_suggestions`,
  `0066_directory_listings`, `0067_intel_billing`. All 6 new tables verified
  via `information_schema.tables`.
- VPS deployed: `docker compose` pulled master HEAD at `ee4bc20e`, built,
  restarted, healthy. `https://api.coherencedaddy.com/api/automation-health`
  returns 200 with a live snapshot.
- Live endpoint smoke: `/api/health`, `/api/repo-updates`,
  `/api/automation-health`, `/api/intel-billing/plans`,
  `/api/partner-directory/featured` all 200.

### Docs

- `doc/PRD_automated_services_audit.md` (new)
- `docs/guides/plugin-registration.md` (new — explains why a raw SQL seeder
  is the wrong approach and documents the real discover → install → activate
  flow via `PluginLoader.installPlugin`)
- `CHANGELOG.md` (new — this file)

---

## [2026-04-13] — Earlier work in-flight

Pre-changelog baseline included: knowledge graph engine, agent memory,
slideshow blog generator, intel discovery, partner network click tracking,
Moltbook social presence plugin, content feedback loop, SEO engine,
YouTube automation pipeline, Canva visual backend, auto-reply engine, Sage
content orchestrator, 19-agent team. See `doc/PRD_automated_services_audit.md`
for the full pre-release inventory.
