# Content Hub — deploy notes

Branch `feat/marketing-content-hub`. Started during the 2026-07-02 review-fix
pass; extended 2026-07-02 by the Wave-4 final E2E agent after the full
authenticated-mode click-through (results at the bottom of this file).

## Env vars to add on VPS4 (`/opt/team-dashboard/.env.production`)

- **`ELEVENLABS_VOICE_KEY`** — REQUIRED for voice snippets. Minting steps:
  1. Log into the **voice-owning** ElevenLabs account (the one behind
     `Ig_Auditor/.env.elevenlabs` — NOT the account behind the existing
     `ELEVENLABS_API_KEY`, which has none of the 5 registry voices).
  2. Profile → API Keys → Create key. **Scope it**: enable only
     `text_to_speech` + `voices_read` ("Voices: Read"). Name it e.g.
     `team-dashboard-voice-snippets`.
  3. Add `ELEVENLABS_VOICE_KEY=<key>` to `/opt/team-dashboard/.env.production`
     and redeploy (compose runs from `/opt/team-dashboard` with
     `--env-file .env.production`).
  4. Verify from a signed-in admin session:
     `GET /api/voice-snippets/health` → `{"ok":true,"missingVoices":[]}`.
     (This exact check caught the wrong-account key during the build; it was
     also verified live in the final E2E with the real key: all 5 voices
     present, real generation + cache hit worked.)
  - There is deliberately **no fallback** to `ELEVENLABS_API_KEY` (different
    account; video-edit Scribe keeps using it). Unset key → plain 503.
  - Optional: `VOICE_SNIPPETS_DAILY_LIMIT` (default 200 paid generations per
    user per UTC day).

## Pre-deploy check: sign-up flag vs Eagan's invite

**Before minting Eagan's invite, check whether
`PAPERCLIP_AUTH_DISABLE_SIGN_UP=true` is set in
`/opt/team-dashboard/.env.production`** (unverified from this workstation).
The invite-accept flow requires the invitee to be **signed in** — a human
join request dead-ends if sign-up is disabled and the invitee has no
account. If it is set: temporarily remove it (or flip to `false`), restart,
let Eagan sign up + accept both invites, then re-enable and restart. The
invite TTL is **10 minutes** — mint the invite while Eagan is at the
keyboard.

## Runbook: Tokns company + marketing-user onboarding

Full decision record: `docs/tokns-project.md`. Condensed:

1. **Create the Tokns company** (once, instance admin): rail "+" →
   onboarding wizard → name exactly `Tokns` (prefix auto-derives to TOK) →
   the starter-agent steps are skippable (close the wizard after step 1) →
   set branding at `/TOK/company/settings`.
2. **Per marketing user (Eagan), mint TWO invites** — one for CD, one for
   TOK — BOTH with the marketing role. From an admin session:
   `POST /api/companies/<companyId>/invites` with body
   `{"allowedJoinTypes":"human","defaultsPayload":{"human":{"membershipRole":"marketing"}}}`
   (browser-origin gated: create it from the dashboard UI or with
   `Origin: <dashboard-url>` set). Send Eagan the returned `/invite/<token>`
   URL. 10-minute TTL each.
3. Eagan: sign up (see the sign-up pre-check above) → open the invite URL →
   "Submit join request". Admin: approve under the company's join requests.
   Repeat for the second invite.
4. **⚠ Never grant a marketing user an elevated (owner/root/admin) membership.**
   A plain `member` membership alongside `marketing` is now safe — the gate is
   fail-closed and keeps the user contained (see the mixed-role fix below). But
   an owner/root/admin membership ungates them entirely (by design — real owners
   keep their own surfaces). Prefer minting additional memberships with the
   `marketing` role regardless.
5. Verify as Eagan: login lands on `/CD/content-hub`, sidebar shows only
   Socials & Content + Content Hub, `/CD/costs` renders the plain
   "You don't have access" card.

## Migration

- `0147_voice_snippets.sql` auto-applies on boot. Idempotence verified in
  the final E2E: server restarted twice against the same already-migrated
  DB — banner reports "Migrations: already applied", ledger row count
  unchanged, `/api/health` 200. No 0122-style crash-loop risk observed.

## Kit refresh path

Edit `marketing/plans/plan-zernio-leverage.md` §6 → `pnpm kits:sync` (dev
machine; source path defaults to the absolute marketing/ path) → commit the
regenerated `ui/src/content/marketing-kits/kits.generated.ts` → deploy.
`pnpm kits:sync --check` in CI-style verification mode diffs the committed
artifact against a fresh parse.

## Decisions from the review-fix pass

- **Marketing-only users land on the Content Hub, not the Dashboard.** The
  build plan's Wave-3 sketch listed Dashboard + Inbox in the marketing
  sidebar, but the server gate (deliberately) blocks every data read those
  pages make (`/api/companies/:id/dashboard`, approvals, heartbeats, issues) —
  showing them produced a first screen full of 403s. Resolution: the UI route
  allowlist is now `{socials, content-hub}`, the board index redirects
  marketing users to `/content-hub`, and the Dashboard/Inbox/New Issue/Search
  affordances are hidden for them. If Mark wants marketing users to have a
  Dashboard later, extend the server allowlist first (mirror every added
  prefix in `server/src/__tests__/marketing-role.test.ts`), then re-add the
  routes.
- **Voice-snippet cost guard:** `POST /api/voice-snippets` now caps paid
  generations (cache misses) at 200 per user per UTC day → plain-English 429.
  Override with `VOICE_SNIPPETS_DAILY_LIMIT` in the environment if Eagan's
  team legitimately needs more. Cached lines never count.

## Deferred review findings

- **Mixed-role marketing-role containment — FIXED (2026-07-03).** The gate
  previously restricted a user only when EVERY active membership had
  `membership_role='marketing'`; one non-marketing membership (e.g. an admin
  adding the marketing user to a second company with the default `member` role)
  voided ALL restrictions — including costs/secrets reads on the marketing
  company via `assertCompanyAccess`. That hole is now closed: a user is
  marketing-scoped whenever they hold a `marketing` membership AND no elevated
  (`owner`/`root`/`admin`) membership, so a plain `member` membership no longer
  lifts containment. Elevated roles remain ungated by design (real owners/admins
  keep their own surfaces; the gate logs a one-time heads-up for the
  marketing+elevated combination). Covered by
  `server/src/__tests__/marketing-role.test.ts` (marketing+member → 403;
  marketing+owner and marketing+root → 200). A per-company gate (restricting
  only on the companies where the role IS `marketing`) remains a possible future
  refinement, but containment no longer depends on it.

## Deferred findings from the final E2E (2026-07-02)

- **"Refresh from Zernio now" with zero `ZERNIO_KEY_*` configured is an
  empty success, not an error.** `GET /api/socials/zernio/automations`
  returns `{"automations":[],"errors":[]}` (200), so the button briefly
  reads "Just refreshed" even though nothing was fetched. The board stays
  honest — the "Zernio data as of …" label keeps the mirror's real
  timestamp and the mirror rows are NOT cleared — but a no-keys environment
  never tells the user keys are missing. Prod (VPS4) has the keys, so this
  only bites local/misconfigured environments. Suggested follow-up: have the
  endpoint report "no Zernio keys configured" in `errors[]` and surface it
  under the refresh button.
- **ffmpeg mastering delta (carried from the build decision):** voice
  snippets ship raw ElevenLabs v3 output; Mark's `build_brand_vo.py`
  "aggressive master" ffmpeg chain is not replicated. The chips sound like
  raw TTS, not the mastered brand VO. Flagging per decision #11.

## Final E2E — verified vs assumed (authenticated mode, 2026-07-02)

Environment: local pgvector Postgres (docker), server booted with
`PAPERCLIP_DEPLOYMENT_MODE=authenticated` + `BETTER_AUTH_SECRET` + real
`ELEVENLABS_VOICE_KEY` (Ig_Auditor account, process env only, never
committed), UI freshly built, Playwright click-through.

**VERIFIED (clicked/observed):**

- Admin bootstrap: UI sign-up → board-claim URL → "Claim ownership" works;
  the claim survives restarts (no new claim URL on subsequent boots).
- All 5 previously-broken sidebar links land correctly under /CD
  (Watchtower, Site Analytics, Sessions, University Emails, Video Edit);
  deep-pasted `/CD/university-emails` renders in place; bare `/dashboard`
  auto-corrects to `/CD/dashboard`.
- TOK: rail switch swaps the sidebar (Tokns/TX Ecosystem, no CD-only
  items); `/CD/tokns` → `/TOK/tokns` and `/CD/tx-ecosystem` →
  `/TOK/tx-ecosystem` redirects, no loop under /TOK.
- Marketing role end-to-end: invite minted with
  `defaultsPayload.human.membershipRole='marketing'` (TTL measured 10.0
  min) → brand-new user signed up + accepted via the real invite page →
  admin approved → fresh sign-in lands on `/CD/content-hub` with the
  marketing-only sidebar; `/CD/costs` + `/CD/watchtower` deep links render
  the graceful no-access card; API-level curl with the marketing session
  cookie: 403 on `/api/costs`, `/api/companies/:id/secrets`,
  `/api/routines`, `/api/instance-settings`; 200 on `/api/cli-auth/me`,
  `/api/companies`, `/api/socials/zernio/greenlight`.
  (Fix applied during this pass: `CompanyRootRedirect` sent everyone to
  `/dashboard`, so a marketing user's first screen was the no-access card;
  "/" now lands on the board index and the role-aware redirect picks
  Content Hub vs Dashboard.)
  (Second fix from the click-through: the sidebar's plugin-slot outlet
  rendered a red "Plugin extensions unavailable" jargon box when the
  marketing gate 403'd the plugin-contributions read; a 403 there now
  renders as "no plugin extensions" — nothing — and the clean sidebar was
  re-verified with a fresh marketing sign-in.)
- Content Hub: KIT 0 renders from the synced module; "Copy the whole kit"
  clipboard is byte-exact (2517 bytes, emoji 🟢🟡🔴 intact) and a per-field
  copy is byte-exact; KIT 1 shows both clickTags (`ig-room` / `room`) with
  the conflict note; sync-provenance footer renders.
- Green-light board: ROOM row green with triggered/DMs/clicks numbers,
  freshness label + account-level caption visible. **Caveat: the mirror row
  was SEEDED test data** (this DB has no Zernio keys/sync) — the rendering
  and tone-derivation path is verified, live Zernio numbers are not.
- Voice: `GET /api/voice-snippets/health` → `{"ok":true,"missingVoices":[]}`
  with the real key; first chip click = REAL ElevenLabs generation (~3.8 s,
  200 `cached:false`, 67 KB mp3, audio element actually plays); second
  click after reload = `cached:true`, same assetId, ~38 ms, exactly 1
  `voice_snippets` row; download URL returns 200 with Content-Disposition.
- Boot-safety: server restarted twice against the same migrated DB —
  "Migrations: already applied", ledger count unchanged (148), `/api/health`
  200, sessions survive restarts.
- Full `pnpm test:run` green when run without the live E2E server holding
  the same database (two suites — cli-auth, university-webhook — flake ONLY
  while a live server shares the pgvector DB on 5432; both pass in
  isolation and in the clean full run).

**ASSUMED / NOT VERIFIED:**

- VPS4 `.env.production` contents (whether `PAPERCLIP_AUTH_DISABLE_SIGN_UP`
  is set, storage provider) — check before Eagan's onboarding.
- Live Zernio numbers on the green-light board (mirror row was seeded; the
  refresh path was exercised only in its no-keys form, which is an empty
  success — see deferred findings).
- Zernio stats JSONB field names (probed defensively server-side; seeded
  row used the primary candidates `triggered`/`dmsSent`/`linkClicks`).
- Drag-out to Finder (DataTransfer DownloadURL is Chromium-only and not
  reliably scriptable headless); the download button was verified instead.
- ffmpeg mastering delta on the voice output (raw v3 shipped, see above).
- Tokns company creation via the onboarding wizard UI (this DB's TOK row
  was created by the earlier wave; the wizard path is documented in
  `docs/tokns-project.md` but was not re-clicked in this pass).

## Caption style picker (stacked branch `feat/caption-style-picker`, 2026-07-02)

> **Cluster:** content-hub · **Tags:** captions, styles, presets, caption-clip, picker, thumbnails · **Related:** [TODO-caption-style-system](../../../6-2026-new-youtube-automation/docs/TODO-caption-style-system.md), [HANDOFF-marketing-content-hub](../../HANDOFF-marketing-content-hub.md)

Built in a separate session, stacked ON TOP of `feat/marketing-content-hub`
(merge that branch first; this one follows). Adds the caption-look menu for
clip production:

- **UI:** `CaptionStylePicker` section at the bottom of the Content Hub page —
  six preset thumbnails (classic/beast/outline/boxed/coral/clean), copy-name
  buttons, brand/default badges. Pure committed data + static PNGs; no API
  call, no video rendering in the app (VPS4 rootfs is read-only and has no
  ffmpeg/ImageMagick/whisper — burns happen on Mark's Mac via
  `caption_clip.py`, in the `6-2026-new-youtube-automation` repo).
- **Agent surface:** `GET /api/socials/caption-styles` (read-only, inside the
  marketing-gate's `/api/socials` allowlist) returns `{styles, meta, usage}`
  so content agents can pick a `--style <name>` value without the tool repo.
- **Sync:** `pnpm caption-styles:sync` (scripts/import-caption-styles.py)
  importlib-loads `caption_clip.py`, mirrors its `STYLES` dict into
  `ui/src/content/caption-styles/styles.generated.ts` +
  `server/src/data/caption-styles.generated.ts`, and renders each preview PNG
  **with the tool's own `render_caption_png()`** over a synthetic 9:16 frame —
  thumbnails are pixel-true to a real burn. `--check` exits 1 on STYLES drift
  (CI-able). Render-only changes to the tool need a manual re-run.
- **Diagram note for Wave-4:** when the Content Hub node is added to
  `docs/architecture/company-structure.mmd`, include this surface in the same
  changelog line (endpoint granularity is below the diagram's level — no
  separate node needed).
- **Deliberately NOT built:** `--style-json` escape hatch on caption_clip.py
  (custom per-project style dicts). The picker is preset-only; add the flag in
  the tool repo only when a real custom-brand need shows up.
