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
- `packages/db/src/schema/zernio_engagement.ts` + `packages/db/src/migrations/0122_zernio_engagement.sql` — Zernio engagement tables (own-sequence numbering; see the migration header)
- `server/src/services/platform-publishers/zernio.ts` — publisher **plus** the Zernio engagement API client (automations, webhooks, contacts, analytics)
- `server/src/routes/zernio-webhook.ts` — raw-body webhook receiver, mounted pre-JSON-parser
- `server/src/services/socials/zernio-lead-capture.ts` — event → lead extraction + upserts
- `server/src/services/socials/zernio-sync.ts` — automation mirror + tagged-contact poll
- `server/src/services/socials/zernio-analytics.ts` — analytics ingest + summary/recommendations read models
- `server/src/services/socials/media-upload.ts` — Compose media-upload sniffing (magic bytes) + size caps; `POST /socials/media` route lives in `routes/socials.ts`
- `packages/shared/src/socials-compose.ts` — pure compose-time platform guard (`checkComposeForPlatform`), shared by the UI and `routes/socials.ts` POST /posts

### Frontend
- `ui/src/api/socials.ts`
- `ui/src/pages/socials/SocialsLayout.tsx`
- `ui/src/pages/socials/SocialsAccounts.tsx`
- `ui/src/pages/socials/SocialsAutomation.tsx`
- `ui/src/pages/socials/SocialsCalendar.tsx`
- `ui/src/pages/socials/SocialsCompose.tsx` — drag-drop/file-picker media upload + per-account guard
- `ui/src/pages/socials/compose-eligibility.ts` — pure `isAccountComposable()` (platform + Zernio-routing gate)
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
| GET/POST/DELETE | `/api/socials/zernio/automations[/:id]` | Comment-automation CRUD against Zernio (keyword funnels) |
| GET | `/api/socials/zernio/automations/:id/logs?zernioAccountId=` | Per-automation DM delivery logs |
| POST | `/api/socials/zernio/webhooks/register` | Idempotently register the webhook on every `ZERNIO_KEY_*` |
| GET | `/api/socials/zernio/events?type=&limit=` | Stored webhook events (cockpit stream) |
| GET | `/api/socials/leads?captureKind=&synced=` | Captured leads + Brevo sync state |
| POST | `/api/socials/leads/relay-now` | Force a Brevo sync tick |
| POST | `/api/socials/zernio/sync-now` | Force automation-mirror + contacts sync |
| GET | `/api/socials/zernio/analytics/{summary,posts,recommendations}` | Stored Zernio analytics (never blended with X-engine numbers) |
| GET | `/api/socials/zernio/analytics/accounts/:zid` | Per-account drill-down |
| GET | `/api/socials/zernio/analytics/live/:metric?zernioAccountId=` | Live passthrough to any allowlisted analytics path |
| POST | `/api/socials/zernio/analytics/ingest-now` | Force an analytics ingest tick |
| POST | `/api/zernio/webhook` | **Unauthenticated raw-body webhook receiver** (HMAC-verified; not under `/api/socials`) |

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
| 1. Inventory | ✅ shipped | Schema, CRUD, read-only Automation + Calendar |
| 2. Control | 🟡 partial | **Compose + Queue tabs shipped** with `social_posts` queue and `socials:relay` cron drainer. Still pending: edit/disable automations from UI, migrate `content-crons.ts` to read from `social_automations`, X token expiry alerts |
| 3. New platforms | 🟡 partial | **Bluesky AT Proto adapter shipped** (env-keyed app password). Still pending: Reddit OAuth, LinkedIn API, Substack, Skool, IG Graph publisher |

## Relayer (Phase 2)

The Compose tab writes rows to `social_posts`. A 1-minute cron job
(`socials:relay`, owned by `social-crons.ts`) drains rows where
`status='scheduled' AND scheduled_at <= now()` using `FOR UPDATE SKIP LOCKED`,
dispatches each row to the publisher resolved from `social_accounts.platform`
via `services/platform-publishers/`, and writes back `posted_url`,
`platform_post_id`, `error`, `attempts`. Below `max_attempts` the row stays
`scheduled` for retry; at/over → `failed`. The Queue tab polls
`/api/socials/posts` every 5s and lets the user cancel scheduled rows or
trigger a manual relayer tick (`POST /api/socials/posts/relay-now`).

### Compose UX — multi-account + kit handoff (2026-07-03 UX completion pass)

`SocialsCompose.tsx` selects accounts via a **multi-select chip grid**
(grouped by platform, "Select all" per group) instead of a single-account
`<select>`. Submit fans the existing `POST /api/socials/posts` out over every
selected account with `Promise.allSettled` — there is still **no bulk
endpoint**; each call independently gets the server's per-actor
`pending_approval`/`scheduled` split (`server/src/routes/socials.ts` line
~487), and a partial failure (e.g. 3 of 5 queued) is surfaced per-account
with the failed accounts left selected so a retry is one click. Grouping by
platform is real infrastructure that scales automatically as more publishers
are registered (see "Adding a new text publisher" below) — today it shows
Bluesky, plus Instagram/TikTok for accounts routed through Zernio (see
"Posting with media" below).

Content Hub's "Send to Compose" (`KitCard.sendToCompose`) no longer dumps the
kit's raw production brief into the post text box — that block is an
internal script/thumbnail/DM-copy/Zernio-settings brief, not a caption, and
was routinely 5-8x Bluesky's 300-char limit. It now only pre-selects the
kit's target account (parsed from the `ACCOUNT:` line) and shows the raw
brief in a collapsible, read-only "Kit details" reference panel; the
marketer writes their own caption in the Text box.

### Posting with media (Instagram/TikTok, 2026-07-03)

Compose can now attach a photo or video and post directly to Instagram/TikTok
accounts that are **routed through Zernio** (`GET /socials/accounts` returns
`routing: "zernio"` when the account's `oauthRef` starts with `"zernio:"`).
Non-Zernio Instagram/TikTok accounts are deliberately left out of the account
chip grid — this app has no working native publisher for either platform
(`platform-publishers/instagram.ts` and `tiktok.ts` don't implement
`publishText`), so showing them would only fail later, at relay time against
Zernio, instead of never being selectable at all. Since that exclusion is
otherwise silent, an active but non-Zernio-routed IG/TikTok account is
surfaced as an inline amber note under the Accounts list (e.g. *"@handle
(Instagram) isn't connected for posting yet — connect through Zernio to use
it in Compose."*) — see `compose-eligibility.ts`'s
`isExcludedForNonZernioRouting`.

**Upload.** `POST /api/socials/media` (multipart `file` field, one file per
call) sits behind the same board-actor gate as the rest of `/api/socials` —
any authenticated marketing user can reach it, not just an admin. It sniffs
the actual bytes (magic numbers, not the declared MIME type or filename) via
`server/src/services/socials/media-upload.ts`, classifies image (jpg/png/webp)
vs. video (mp4/mov), enforces a size cap per kind (`SOCIALS_MEDIA_IMAGE_MAX_BYTES`,
default 10MB / `SOCIALS_MEDIA_VIDEO_MAX_BYTES`, default 200MB), and stores the
file via the existing company-scoped `StorageService` under namespace
`socials/compose`. Both the client-side precheck (`SocialsCompose.tsx`) and
this route's own cap give an actionable, next-step message rather than a bare
"Exceeds NMB" — e.g. *"This video is over the 200MB limit — trim it or
export at a lower resolution in CapCut and try again."* (CapCut being the
target users' actual video source). The response's `objectKey` goes straight into a post's
`mediaUrls` — exactly the same shape `services/socials/content-bridge.ts`'s
`mediaObjectKeys` already produces, and the relayer's `resolveMediaUrls`
(`social-relayer.ts`) stages any non-public entry to the public R2 bucket at
publish time. No new public-serving route was needed: nothing renders these
objectKeys as an `<img>`/`<video>` src before then (the Queue tab only shows
an attachment count).

**Guard parity.** `packages/shared/src/socials-compose.ts` exports a single
pure function, `checkComposeForPlatform()`, run on **both** sides:
- Client: `SocialsCompose.tsx`'s `submit()` runs it per selected account
  before calling the API. Instagram (media-required) chips disable with
  "needs a photo or video" until at least one attachment is present;
  TikTok (video-required) chips separately gate on an actual **video**
  attachment (`readyVideoCount`, not just any media) and show "needs a
  video", so the chip's enabled state always matches what submit will
  accept. The Queue button is disabled while any upload is still in flight.
- Server: `POST /socials/posts` (`server/src/routes/socials.ts`) re-runs the
  identical check — this is the real trust boundary, since the UI check is
  only a courtesy. A violation returns `400` with a plain-English message
  (e.g. *"Instagram needs a photo or video attached before you can post."*,
  *"TikTok posts need a video — none of the attached files are recognized as
  one (.mp4/.mov/.webm/.m4v)."*, *"Bluesky captions are limited to 300
  characters (this one is 344)."*).

  A media item's `isVideo` for this server-side check is **not** derived
  solely from the objectKey's filename extension (`isVideoRef`) — an
  objectKey's extension comes from the client-supplied `originalname` and
  can disagree with the bytes (e.g. a JPEG renamed `clip.mp4`). The route
  first tries `storageService.headObject()`'s stored `contentType` (the
  magic-byte sniff `POST /media` already performed) and only falls back to
  the filename-extension guess when that metadata isn't available (pasted
  public URLs, or a storage backend/test stub that doesn't return
  `contentType`) — see `resolveIsVideoRef()` in `routes/socials.ts`.

Current rules (see `socials-compose.ts` for the source of truth):

| Platform | Media required | Video required | Caption limit |
|---|---|---|---|
| Bluesky | no | no | 300 |
| Instagram | yes | no | 2200 |
| TikTok | yes | yes | 2200 |

Every platform shares a 4-attachment cap (`MAX_COMPOSE_MEDIA_ITEMS`) —
previously a cosmetic label only, now enforced both client- and server-side.
YouTube was deliberately left out of Compose: nothing in this app has
verified Zernio text+media publishing there end-to-end, and YouTube's
metadata model (title vs. description, required video) doesn't fit the
caption-only compose form.

**Relay-time failures still surface.** If Zernio itself rejects a
compose-time-clean post (a format quirk on Zernio's end), the row lands
`status='failed'` with `error` set (`social-relayer.ts`) and the Queue tab
already renders that `error` string directly on the post card — no
tooltip/detail view needed, it was never hidden.

### Status + platform colors

Every status pill (`StatusBadge`, `ui/src/components/StatusBadge.tsx`) and
platform pill (`PlatformBadge`, `ui/src/components/PlatformBadge.tsx`) reads
from one canonical map in `ui/src/lib/status-colors.ts`
(`statusBadge` / `platformBadge` / `PLATFORM_META` / `normalizePlatform`).
Queue, Funnels, Inspiration, and ContentReview all render through these two
components — adding a new status or platform means adding one key to
`status-colors.ts`, not another ad-hoc color function.

### Bluesky configuration

The Bluesky adapter (`services/platform-publishers/bluesky.ts`) currently
reads a single account from env:

- `BLUESKY_HANDLE` — e.g. `coherencedaddy.bsky.social`
- `BLUESKY_APP_PASSWORD` — created at <https://bsky.app/settings/app-passwords>
- `BLUESKY_SERVICE` — defaults to `https://bsky.social`

For multi-account support a follow-up will introduce a `bluesky_credentials`
table keyed by `social_accounts.id`.

### Content-side char-limit enforcement

Bluesky's 300-char limit is enforced at **generation time** in
`services/content.ts` (and the X-API tweet path in
`services/x-api/content-bridge.ts`). Both call `enforceCharLimit()` from
`services/char-limit.ts`, which re-prompts Ollama up to 2× with strict
instructions before falling back to sentence-aware truncation. Don't add a
new Ollama call site for short-form content without piping through this —
without it, drafts pile up over the limit and the relayer either fails or
silently truncates mid-thought.

Bluesky drafts also get a **rotated CTA** appended via `pickBlueskyCta()`
in `services/aeo-cta.ts`, sampling uniformly across `cd` (directory),
`creditscore`, `optimizeme`, `affiliate`, `partners`. This is bluesky-only;
tweet/blog paths still use the deterministic `getAeoCta(brand)`.

If a queue of overflow drafts ever needs cleanup, see
`server/scripts/tighten-overflow-content.ts` (`--dry-run`, `--regenerate`).

## Zernio Engagement Layer (2026-07-01)

The comment→DM→captured-lead loop from
`marketing/plans/plan-zernio-leverage.md` §2 (levers L1/L4/L6). Zernio is the
capture rail; **Brevo stays the nurture CRM** — a lead row only syncs to Brevo
once it carries an email.

**Flow.** A keyword comment (ROOM / COHERENT / …) fires a Zernio
comment-automation → Zernio delivers `comment.received` / `message.received` /
`lead.received` webhooks to `POST /api/zernio/webhook` (HMAC-SHA256 on
`X-Zernio-Signature`, deduped on the payload's stable event id —
delivery is at-least-once) → deterministic extraction upserts `social_leads`
(keyword + clickTag attributed against the local automation mirror) → the
`socials:lead-sync` cron pushes email-bearing leads to the Brevo founding list
(`SOURCE` = clickTag, e.g. `ig-room`). `account.disconnected` auto-pauses the
matching `social_accounts` row.

**Crons.** `socials:lead-sync` (every 5 min), `socials:zernio-sync` (hourly —
automation mirror + tagged-contact poll), `socials:zernio-analytics` (daily
06:40 — snapshots + per-post analytics with External-Post-ID correlation back
to `social_posts`). All three no-op quietly when no `ZERNIO_KEY_*` is set.

**Env.** `ZERNIO_KEY_<accountId>` (per-account Bearer keys — each key only
sees its own account), `ZERNIO_WEBHOOK_SECRET`, `BREVO_API_KEY`,
`BREVO_FOUNDING_LIST_ID`, optional `ZERNIO_API_BASE` / `BREVO_ENDPOINT`.

**Hard lines (owner-settled — do not "fix"):**
- **No Zernio Conversions API.** The in-house Meta CAPI/TikTok Events build off
  the Stripe webhook is canonical; double-firing double-counts Purchases.
- **No multi-day DM drips, no comment-list broadcasts.** ToS won't-build list
  in `Ig_Auditor/DM-FUNNEL-PLAYBOOK.md`; automation creation validates
  keyword-gating, `dmMessage` ≤640 chars, ≤3 buttons.
- **Zernio analytics ≠ X-engine analytics.** `x_engagement_log` numbers are a
  different dataset; every Zernio response is tagged `source: "zernio"` and the
  two must never be blended in one panel.

**Still unbuilt:** the Socials Hub UI analytics tab (Goal B lane 3B remainder)
and the ROOM funnel content itself (create via
`POST /api/socials/zernio/automations` once the LP destination is settled).

### Adding a new text publisher

1. Implement `publishText(opts)` on a new file in
   `services/platform-publishers/<name>.ts` returning `PublishResult`.
2. Register it in `platform-publishers/index.ts`.
3. Add the platform string to `COMPOSABLE_PLATFORMS` in
   `packages/shared/src/socials-compose.ts` so the composer surfaces it (and,
   if it needs media/a caption limit, add it to `MEDIA_REQUIRED_PLATFORMS` /
   `VIDEO_REQUIRED_PLATFORMS` / `PLATFORM_CAPTION_LIMITS` there too — see
   "Posting with media" above). If it's Zernio-only like Instagram/TikTok,
   also gate it on `routing === "zernio"` in
   `ui/src/pages/socials/compose-eligibility.ts`.

## Verification

1. `pnpm --filter @paperclipai/db migrate` — both tables present.
2. `npx tsx scripts/seed-social-accounts.ts` — `inserted=N skipped=0` on first run, `inserted=0 skipped=N` on re-run.
3. `GET /api/socials/accounts?brand=cd` — returns seeded set.
4. UI **Socials → Accounts** — all brands grouped, archive button works.
5. UI **Socials → Automation → Sync from JOB_DEFS** — every cron in `content-crons.ts` shows with cron expression, personality, next-run.
6. UI **Socials → Calendar** — past 7 days of `content_items` + projected next-runs from automations; brand/platform filters narrow correctly.
