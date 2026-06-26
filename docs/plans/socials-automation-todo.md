# TODO — Socials Automation Roadmap

> **Cluster:** Plans · **Tags:** socials, automation, publishing, approval, platform-caps, retention · **Related:** [Cron Inventory](../operations/cron-inventory.md), [Stigmergy Followups](stigmergy-followups.md), [Docs Index](../README.md)

> Running tracker for the multi-phase build that turns the `/socials` hub from
> a passive inventory into an active control plane: agent-generated drafts →
> human-gated approval → multi-platform auto-publishing → bounded data growth.
>
> **Last audited: 2026-05-08** (Phase 2 shipped via PR #35 + #37).

## Phase 1 — Make automation real ✅ shipped 2026-05-07

PR #34. Three feature branches merged. Migrations `0103_platform_caps`,
`0104_retention_columns` applied to prod Neon. VPS1 redeployed.

- [x] Bridge: approved `contentItems` → `social_posts` queue
  - `server/src/services/socials/content-bridge.ts`
- [x] `automation_mode` actually gates behavior (manual / assisted / full_auto / none)
  - Read in `services/content.ts:reviewItem` and `:generate`
- [x] `flagContent` for assisted gate (length cap, 7-day duplicate, banned-phrase placeholder)
- [x] `platform_caps` table + seeds (bluesky 5/5, x 10/10, reddit 2/2, linkedin 2/2, discord 6/6, instagram 3/3)
  - `packages/db/src/schema/platform_caps.ts`
  - `server/src/services/socials/platform-caps.ts`
- [x] `canGenerate` enforced at top of every JOB_DEFS handler (fail-open)
- [x] `canPublish` enforced per-row in social-relayer; over-cap rows stay scheduled
- [x] `GET /api/socials/platform-caps` + `PATCH /api/socials/platform-caps/:platform`
- [x] `POST /api/socials/posts/enqueue-from-content` (manual retry surface)
- [x] Nightly retention sweep cron (`maintenance:retention-sweep`, 3:15am)
- [x] `*_trimmed_at` columns + idempotent re-runs
- [x] `POST /api/maintenance/retention-sweep/run-now`
- [x] Bluesky env vars migrated from `repo/.env` → `.env.production`

## Phase 1.5 — Post-merge follow-up (open)

- [x] Update `social_accounts` row for `(brand=cd, platform=bluesky)`:
      `handle='coherencedaddy.bsky.social'`, `automation_mode='manual'`,
      `connection_type='api_key'`, `status='active'` — verified already correct on prod
- [ ] End-to-end smoke test: generate → approve → confirm `social_posts` row → confirm post on Bluesky within ~1 min
- [x] Confirm `maintenance:retention-sweep` and platform-caps endpoints visible in `/system-crons` — `maintenance:retention-sweep` and `socials:relay` confirmed registered
- [ ] First retention-sweep run will be largest — monitor logs at 3:15am UTC
- [ ] Consider populating `flagContent` BANNED_PHRASES with anything you'd never auto-post

## Phase 2 — Per-platform control panel UI ✅ shipped 2026-05-08

PR #35 (UI + counters endpoint) + #37 (drizzle ANY→IN hotfix). VPS1 redeployed; `/api/socials/platform-counters` returns all 6 platforms.

See full handoff: [`docs/products/socials-phase2-handoff.md`](../products/socials-phase2-handoff.md).

- [x] `GET /api/socials/platform-counters` — per-platform live counters (today's generated/published/queued/failed)
- [x] `ui/src/pages/socials/SocialsSchedule.tsx` — new tab card-per-platform with caps editor, automations list, accounts list, live counters
- [x] Inline cron-expression editor (reuse `CronManagement` widget)
- [x] Pause/resume toggle per `social_automation`
- [x] Per-account `automation_mode` dropdown wired to PATCH endpoint
- [x] Visual treatment for at-cap (red) and near-cap (yellow)
- Decision: **coexist with read-only Automation tab** for now; revisit after Schedule is exercised in production
- Decision: **stayed per-platform**; cross-account aggregation deferred to Phase 5

## Phase 3 — Native text publishing for the rest 🟡 not started

Adapters mirror `services/platform-publishers/bluesky.ts`. Order suggested by
ROI and onboarding friction:

- [ ] **Discord** — webhook publisher (no OAuth, immediate value)
  - `services/platform-publishers/discord.ts`
  - Discord webhook URL stored per `social_account` (new `webhook_url` column or in `oauth_ref`)
- [ ] **LinkedIn** — UGC API publisher
  - `services/platform-publishers/linkedin.ts`
  - LinkedIn OAuth flow (mirror x_oauth_tokens pattern)
- [ ] **Reddit** — submit API publisher
  - `services/platform-publishers/reddit.ts`
  - Reddit OAuth + per-subreddit posting rules
- [ ] **Instagram (text + IG Graph)** — already partial via `instagramPublisher`; extend for caption-only / single-image text posts
- [ ] Update `TEXT_PLATFORMS` set in `SocialsCompose.tsx` for each new adapter
- [ ] Update `automation_mode` semantics — currently effectively a no-op for non-Bluesky accounts because no other text publisher exists

## Phase 4 — Smarter learning loop 🟡 future

Once we have rejection/approval data from `manual` and `assisted` modes:

- [ ] Per-account approval-rate metrics surfaced in Schedule tab
- [ ] Auto-graduation suggestions ("This account has 95% approval rate over last 30 days; switch to `assisted`?")
- [ ] Reject-reason tagging in the review UI to feed back into prompts
- [ ] Per-personality + per-platform + per-topic quality dashboard

## Phase 5 — Cross-account aggregation 🟡 future

When multiple accounts per platform exist (CD + Tokns + ShieldNest on X, etc.):

- [ ] Schema: optional `account_caps` row layered on top of `platform_caps`
- [ ] Cross-account dedup (don't post the same text from two CD-owned X accounts)
- [ ] Multi-account Bluesky support (handoff mentions a `bluesky_credentials` table; today the publisher reads single-account env vars)

## Cross-cutting infra debts surfaced in Phase 1

- [ ] **Worktree isolation race** — Agent dispatch with `isolation: worktree` did not reliably create isolated filesystems during Phase 1 parallel implementation. Three agents collided on the same worktree, requiring stash recovery. Investigate before next parallel run.
- [ ] **Pre-existing `@paperclipai/plugin-sdk` typecheck errors** in `plugin-host-services.ts` and `routes/plugins.ts` — 65 errors that everyone has to filter past during typecheck. Worth fixing or pinning a working sdk version.
- [ ] **`docker-compose` env loading from one file only** (`.env.production`) — bit users in Phase 1 when creds were added to `repo/.env` and silently ignored. Document the canonical env file in `docs/deploy/env-vars.md` more loudly.

## Reference

- [Phase 2 handoff](../products/socials-phase2-handoff.md)
- [Socials Hub spec](../products/socials-hub.md)
- [Production deploy](../deploy/production.md)
