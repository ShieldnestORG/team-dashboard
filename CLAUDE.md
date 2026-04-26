# CLAUDE.md — Team Dashboard

## Repo Identity
This repo is the internal admin control plane for the Coherence Daddy ecosystem. It manages AI agents, intel pipelines, operational dashboards, and authenticated admin workflows.
**Not public-facing.** Requires authentication.

Primary Company:
- **Coherence Daddy**
- `TEAM_DASHBOARD_COMPANY_ID=8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`

## Critical Rules

### One Writer Per Branch
**Never run multiple agent sessions editing the same branch simultaneously.**
Use feature branches or worktrees for parallel work. See: [Branch & Session Safety](docs/guides/branch-safety.md)

### Feature Branch Requirements
Any new backend service, route, or DB migration must be done on a feature branch.

**Permitted exceptions:**
- **2026-04-22 — commit `676f29d2`** (PRD 1 CreditScore cutover): pushed directly to `master` with explicit user authorization. Typechecks clean on both server and UI before push. Two migrations applied to prod Neon, Stripe webhook endpoint created, VPS1 redeployed same session. Noted here so the rule stays in force for future PRs — re-request explicit authorization before bypassing again.

### Verify Before Merge
Always run these commands and confirm zero errors before merging or pushing to master:
```bash
npx tsc --noEmit --project server/tsconfig.json
cd ui && npx tsc --noEmit
```

### Git Hygiene
- Stage specific files only. Do not use `git add -A`.
- Cast `req.params.*` as `string` in Express routes.

## GitHub Identity Map

Three GitHub accounts/orgs operate across this ecosystem. Be deliberate about which one a new repo belongs in:

| Identity | Type | Used for |
|---|---|---|
| **`ShieldNEST`** (HEAD_DEV, `nestd@pm.me`) | Personal user | Active dev account; owns no repos directly — admin in both orgs below |
| **`ShieldnestORG`** | Org (private + public mix) | All ecosystem **infrastructure** repos: `coherencedaddy` (storefront), `team-dashboard` (this repo), `shieldnest_landing_page`, `tokns.fi_landing_page`, `tokns` (app.tokns.fi), validator scripts |
| **`Coherence-Daddy`** | Org (public) | Public-facing **share-ready content** repos meant to be discovered, starred, and forked: tutorials, copy-paste prompts, demo code. First repo: [`use-ollama-to-enhance-claude`](https://github.com/Coherence-Daddy/use-ollama-to-enhance-claude) (launched 2026-04-25). |

**Decision rule for a new repo:** infrastructure / private / proprietary → `ShieldnestORG`. Tutorial / hero asset / something we *want* random builders on Twitter to fork → `Coherence-Daddy`.

## Ownership Matrix

This repo is the engine room for a two-repo system. The public storefront
(`coherencedaddy-landing`) is the front door. Canonical boundary:
[docs/OWNERSHIP.md](docs/OWNERSHIP.md).

**Owned here (team-dashboard):**
- Product pricing + plan definitions (`*_plans` tables)
- Subscription state (`*_subscriptions` tables)
- Stripe checkout session creation + Stripe webhooks (all products)
- Entitlement resolution (`bundle-entitlements.ts`)
- Product fulfillment crons (rescans, agent runs, report mailing)

**Owned in coherencedaddy-landing:**
- Public storefront UI (pricing pages, CTAs, report viewer)
- Free audit SSE stream (browser-side)
- Resend email templates (team-dashboard invokes via callback; do not duplicate)

When adding a new product: add tables + service + routes here, then expose a
`/plans` + `/checkout` + `/webhook` + `/entitlement` surface for the storefront
to call via its `vercel.json` rewrites. Never re-fork pricing or webhook logic
in the storefront.

## Documentation Rules
Documentation must be updated whenever code structure or behavior changes.
- Update relevant docs in `docs/`
- Remove stale references
- Verify accuracy during final review

## Structure Diagram Rules
Any structural change must update the company structure diagram.
- **Triggers**: New/removed backend services, routes, cron jobs, or plugin restructuring.
- **Required**: Update persisted structure via API, update fallback `DEFAULT_DIAGRAM` in `ui/src/pages/Structure.tsx`, and include a dated changelog summary.
- See: [Structure Diagram Policy](docs/architecture/structure-diagram-policy.md)

## Build & Run
```bash
# UI dev server (port 5173)
cd ui && npm run dev

# Backend
npm run dev

# Build
cd ui && npm run build
```

## Deployment Summary
Production is split across Vercel (frontend), VPS (backend + admin), and Neon (DB).
- See: [Production Deployment](docs/deploy/production.md)
- See: [Environment Variables](docs/deploy/env-vars.md)

## Reference Docs
- [System Overview](docs/architecture/system-overview.md) — Ecosystem and core systems.
- [Org Structure](docs/architecture/org-structure.md) — 508(c)(1)(A) governance → ShieldNest → ventures → storefronts flow chart; Hostinger WooCommerce shop detail.
- [Project Structure](docs/architecture/project-structure.md) — Directory map and key files.
- [Cron Inventory](docs/operations/cron-inventory.md) — Scheduled jobs and ownership.
- [Key Files Reference](docs/operations/key-files.md) — Critical file mapping.
- [Branch Safety](docs/guides/branch-safety.md) — Concurrent session rules.
- [Production Guide](docs/deploy/production.md) — VPS and Docker cleanup.
- [Environment Variables](docs/deploy/env-vars.md) — Full variable reference.
- [Structure Diagram Policy](docs/architecture/structure-diagram-policy.md) — Mermaid maintenance.
- [Blog Distribution](docs/products/blog-distribution.md) — Target surfaces, cron → target map, current wiring status.
- [Socials Hub](docs/products/socials-hub.md) — Unified `/socials` view: account registry + automation mirror + release calendar.
- [Shop Sharers](docs/products/shop-sharers.md) — Email capture on shop.coherencedaddy.com → referral code + QR + shareable link + opt-in affiliate approval queue.
