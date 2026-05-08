# Phase 2 Handoff — Socials Control Panel

**Date:** 2026-05-07
**Status:** Phase 1 shipped (PR #34). Phase 2 not started.

This handoff captures everything a future session needs to build the
per-platform control panel on top of the Phase 1 plumbing.

## Context (what's already live after Phase 1)

After PR #34 merges and VPS1 redeploys, the running system is:

- `content-crons.ts` JOB_DEFS generate drafts → `contentItems` (status `pending`).
- `content.ts:reviewItem(approved)` → `socials/content-bridge.ts:enqueueApprovedContent` → inserts into `social_posts`.
- `automation_mode` on `social_accounts` actually gates behavior:
  - `manual` — wait for human approval (default for all accounts in this phase)
  - `assisted` — auto-approve + auto-enqueue if `flagContent` returns null (length cap, 7-day duplicate, banned-phrase placeholder)
  - `full_auto` — skip review entirely
- `platform_caps` table caps generation + publishing per UTC day.
  - `canGenerate` checked at top of every JOB_DEFS handler (fail-open on error).
  - `canPublish` checked per-row in `social-relayer.ts`; over-cap rows stay `scheduled` without bumping `attempts` so they retry the next day.
- `maintenance:retention-sweep` runs nightly at 3:15am, prunes published rows older than the configured windows. Idempotent via `*_trimmed_at` columns.

API surfaces ready to consume:

| Endpoint | Purpose |
|---|---|
| `GET /api/socials/platform-caps` | List all platform caps |
| `PATCH /api/socials/platform-caps/:platform` | Update cap fields |
| `GET /api/socials/automations` | Read automations (already existed) |
| `POST /api/socials/automations/sync` | Re-introspect JOB_DEFS (already existed) |
| `PATCH /api/socials/accounts/:id` | Update `automation_mode` (already existed) |
| `POST /api/socials/posts/enqueue-from-content` | Manual enqueue trigger |
| `POST /api/maintenance/retention-sweep/run-now` | Manual retention trigger |
| `PATCH /api/system-crons/:jobName` | Edit cron schedule (already existed) |

## Goal of Phase 2

A new tab on `/socials` (suggested name: **Schedule** or **Controls**) where the
admin can, per platform:

1. See and edit `max_generated_per_day` and `max_published_per_day`
2. See and toggle each automation's `enabled` / pause state
3. See and edit each automation's cron expression
4. See and toggle each personality assigned to the platform (which agents write)
5. Switch each social_account's `automation_mode` between `manual` / `assisted` / `full_auto`
6. See live counters: "today: 3/5 generated, 2/5 published"

All backend hooks exist. Phase 2 is purely UI + a couple of small backend
counter endpoints.

## Suggested implementation steps

### Step 1 — counter endpoint

Add `GET /api/socials/platform-counters` returning, per platform:
```json
{ "platform": "bluesky", "generatedToday": 3, "generatedCap": 5,
  "publishedToday": 2, "publishedCap": 5,
  "queued": 1, "failed24h": 0 }
```
Reuse the COUNT queries in `socials/platform-caps.ts:canGenerate` and
`canPublish`. Add a queued count from `social_posts WHERE status='scheduled'`
joined to platform.

### Step 2 — Schedule tab UI

`ui/src/pages/socials/SocialsSchedule.tsx`. Layout: one card per platform.
Each card shows:
- platform name + counters
- caps (inline-editable, PATCH on blur)
- list of `social_automations` for that platform
  - name + cron expression (inline-edit, reuses `CronManagement` widget)
  - personality + brand
  - pause toggle
- list of `social_accounts` for that platform
  - handle + automation_mode (dropdown)

Add a 5s poll for counters, longer for everything else.

### Step 3 — wire into router

Add to `ui/src/pages/socials/SocialsLayout.tsx` Tabs: `Schedule`. Route
under `/socials/schedule`.

### Step 4 — visual polish

Counters should turn red when at-cap, yellow within 1 of cap. Pause toggle
should grey out the row. Use existing design tokens (see
`docs/products/socials-hub.md` for the existing tab pattern).

## Files to read first

- `docs/products/socials-hub.md` — current state of the hub
- `ui/src/pages/socials/SocialsAutomation.tsx` — the read-only Automation tab; Schedule replaces or complements it
- `ui/src/pages/CronManagement.tsx` — the inline schedule editor pattern to reuse
- `server/src/services/socials/platform-caps.ts` — caps service
- `server/src/services/socials/content-bridge.ts` — bridge logic (referenced by counters)

## Open design questions for the user

1. **Replace or coexist with Automation tab?** Phase 2 Schedule tab can either replace the read-only Automation tab or sit beside it. Suggest replace once Schedule covers everything Automation shows.
2. **Per-account caps vs per-platform caps?** Today caps are per-platform. If you eventually have multiple Bluesky accounts (e.g. CD + Tokns), do they share a cap or each get their own? Easy to change schema later but worth deciding before UI ships.
3. **Pause "scope"** — pausing an automation should pause future generation. Should it also cancel pending `social_posts` rows for that source? Default: no, paused = stop creating new ones, existing queue still drains.

## What Phase 2 explicitly does NOT cover

- New text publishers for LinkedIn / Discord / Reddit / Instagram-text. That's Phase 3.
- Cross-account cap aggregation (e.g. "across all my X accounts, max 30/day").
- Automated "graduate from manual to assisted" based on rejection rate. Future
  ML/heuristic work.

## Phase 1 known issues to address opportunistically

1. **`automation_mode` UI badge in Accounts tab is editable but not currently meaningful for any account other than Bluesky** (no other text publishers are wired). Once Phase 3 ships, this becomes universal.
2. **`flagContent` BANNED_PHRASES is empty by design.** Populate when Phase 2 ships if there are obvious things you'd never auto-post.
3. **Bridge enqueues `mediaUrls=[]` always.** When `content_items.media_urls` exists for a draft (e.g. visual content), bridge should pass them through.
4. **Worktree-agent isolation race** observed during Phase 1 parallel implementation — agents dispatched with `isolation: worktree` ended up sharing state. Worth a separate investigation before next big parallel run.

## Migrations applied in Phase 1

- `0103_platform_caps.sql` — new table + 6-row seed
- `0104_retention_columns.sql` — `body_trimmed_at` / `payload_trimmed_at` on three existing tables

## Cron jobs added in Phase 1

| Job | Schedule | Owner | Source |
|---|---|---|---|
| `maintenance:retention-sweep` | `15 3 * * *` | system | `maintenance-retention-cron.ts` |

(`socials:relay` shipped in PR #30; not new in this phase.)
