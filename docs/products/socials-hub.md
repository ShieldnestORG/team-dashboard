# Socials Hub

Single pane of glass for every social account the Coherence Daddy ecosystem
operates, the automations driving them, and a unified release calendar.

## Why

Social presence has sprawled across X/Twitter, Reddit, dev.to, HN, Instagram,
Facebook, YouTube, Discord, Bluesky, LinkedIn, plus wishlist platforms (Skool,
Substack). Before this hub:

- Only X had a first-class dashboard (`TwitterDashboard.tsx`).
- The "release calendar" was implicit — ~25 hardcoded cron defs in
  `server/src/services/content-crons.ts` + `yt_publish_queue` +
  `contentItems.publishedAt`.
- No record of which accounts existed on which platform for which brand,
  whether they were connected, or whether they were automated.

## Surface

Route: `/socials` (sidebar entry: **Socials**, icon `Share2`).

Three tabs:

| Tab | Source | Read/Write |
|---|---|---|
| **Accounts** | `social_accounts` | CRUD (soft-delete via `archived`) |
| **Automation** | `social_automations` (mirror of `JOB_DEFS` joined with `system_crons`) | Read + sync button |
| **Calendar** | `content_items` + projected `social_automations.nextRunAt` | Read |

## Data Model

### `social_accounts`

```
id, company_id (fk companies)
brand            -- 'cd' | 'tokns' | 'tx' | 'shieldnest' | 'directory' | 'partners' | 'coherencedaddy'
platform         -- 'x' | 'reddit' | 'devto' | 'hn' | 'instagram' | 'facebook' |
                    'youtube' | 'discord' | 'bluesky' | 'linkedin' | 'substack' |
                    'skool' | 'tiktok' | 'github'
handle, display_name, profile_url
connection_type  -- 'oauth' | 'api_key' | 'manual' | 'none'
oauth_ref        -- pointer like 'x_oauth_tokens:<account_slug>' or 'canva_oauth_tokens:<id>'
status           -- 'active' | 'dormant' | 'paused' | 'deprecated'
automation_mode  -- 'full_auto' | 'assisted' | 'manual' | 'none'
automation_notes
last_activity_at, owner_user_id, tags[], archived
```

### `social_automations`

Mirror of `content-crons.ts` JOB_DEFS, joined with live state from
`system_crons` (the existing global cron-registry table).

```
id, social_account_id (fk social_accounts, set null on delete)
kind             -- 'cron_post' | 'cron_repost' | 'reactive' | 'webhook' | 'manual'
cron_expr, personality_id, content_type
source_ref       -- unique; matches JOB_DEFS[].name
enabled, last_run_at, next_run_at, notes
```

`source_ref` is the unique anchor — re-running sync upserts on this column.

## Files

### Backend
- `packages/db/src/schema/social_accounts.ts`
- `packages/db/src/schema/social_automations.ts`
- `packages/db/src/migrations/0095_socials_hub.sql`
- `server/src/services/socials/platform-map.ts` — `contentType → platform` mapping
- `server/src/services/socials/cron-introspect.ts` — upserts JOB_DEFS into `social_automations`
- `server/src/services/socials/calendar.ts` — merges `content_items` + cron projections
- `server/src/routes/socials.ts` — `/api/socials/*`
- Mounted in `server/src/app.ts` at `api.use("/socials", socialsRoutes(db))`

### Frontend
- `ui/src/api/socials.ts`
- `ui/src/pages/socials/SocialsLayout.tsx`
- `ui/src/pages/socials/SocialsAccounts.tsx`
- `ui/src/pages/socials/SocialsAutomation.tsx`
- `ui/src/pages/socials/SocialsCalendar.tsx`
- `ui/src/App.tsx` — `<Route path="socials" element={<SocialsLayout />} />`
- `ui/src/components/Sidebar.tsx` — `<SidebarNavItem to="/socials" label="Socials" icon={Share2} />`

### Scripts
- `scripts/seed-social-accounts.ts` — idempotent seed from
  `x_oauth_tokens` + `canva_oauth_tokens` + a static list of public-facing
  handles (footer of `coherencedaddy-landing/components/sticky-footer.tsx`).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/socials/accounts?brand=&platform=&status=` | List active accounts |
| POST | `/api/socials/accounts` | Create |
| PATCH | `/api/socials/accounts/:id` | Update fields |
| DELETE | `/api/socials/accounts/:id` | Soft-delete (sets `archived=true`) |
| GET | `/api/socials/automations?accountId=` | List automations |
| POST | `/api/socials/automations/sync` | Re-run cron-introspect |
| GET | `/api/socials/calendar?from=&to=&brand=&platform=` | Unified events feed |

## Operations

### First-time setup

```bash
DATABASE_URL=… npm run --filter db migrate            # applies 0095_socials_hub.sql
DATABASE_URL=… npx tsx scripts/seed-social-accounts.ts
# Then in the UI, hit /socials → Automation → "Sync from JOB_DEFS"
```

### When you add a new cron in `content-crons.ts`

1. Give it a stable `name` (already required).
2. After deploy, hit `POST /api/socials/automations/sync` (or the **Sync**
   button on the Automation tab). The new row will appear, joined to the
   matching `social_account` if one exists for `(brand, platform[, xAccountSlug])`.

### When you onboard a new platform (e.g. Reddit OAuth)

1. Add OAuth tables/routes per existing pattern (mirror `x_oauth_tokens`).
2. Update `STATIC_SEEDS` in `scripts/seed-social-accounts.ts`.
3. Re-run the seed script (idempotent).
4. Set `connection_type='oauth'` and `oauth_ref` on the row.

## Phase Roadmap

| Phase | Status | What |
|---|---|---|
| 1. Inventory | ✅ this PR | Schema, CRUD, read-only Automation + Calendar |
| 2. Control | pending | Edit/disable automations from UI; migrate `content-crons.ts` to read from `social_automations`; "Schedule a post" button on Calendar; X token expiry alerts |
| 3. New platforms | pending | Reddit OAuth, LinkedIn API, Bluesky AT Proto, Substack, Skool |

## Verification

1. `pnpm --filter @paperclipai/db migrate` — both tables present.
2. `npx tsx scripts/seed-social-accounts.ts` — `inserted=N skipped=0` on first run, `inserted=0 skipped=N` on re-run.
3. `GET /api/socials/accounts?brand=cd` — returns seeded set.
4. UI **Socials → Accounts** — all brands grouped, archive button works.
5. UI **Socials → Automation → Sync from JOB_DEFS** — every cron in `content-crons.ts` shows with cron expression, personality, next-run.
6. UI **Socials → Calendar** — past 7 days of `content_items` + projected next-runs from automations; brand/platform filters narrow correctly.
