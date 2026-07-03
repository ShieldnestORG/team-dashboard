# HANDOFF — Marketing Content Hub + Dashboard Fixes

> **Cluster:** ops-deploy · **Tags:** team-dashboard, content-hub, zernio, elevenlabs, routing-bug, project-switcher, eagan, marketing-ux · **Related:** [CLAUDE.md](CLAUDE.md), [AGENTS.md](AGENTS.md), [plan-zernio-leverage §6 (the kits)](../marketing/plans/plan-zernio-leverage.md), [funnel board](../marketing/designs/BOARD-funnels-accounts-content.html), [PLAIN-UX-PRINCIPLES](../marketing/_shared/PLAIN-UX-PRINCIPLES.md)

> **Status:** Owner-approved 2026-07-02 (Mark). Self-contained handoff for a fresh session in THIS repo (`/Users/exe/Downloads/Claude/team-dashboard`). Read this file + repo `CLAUDE.md` + `AGENTS.md` before touching anything.

---

## §0 — Mission

Make the team dashboard (api.coherencedaddy.com) the ONE place Mark's marketing team (head of marketing: **Eagan**) logs in to produce funnel content: fix the broken `/CD` path links, promote **Tokns** to a first-class project in the switcher, build a **Content Hub** that surfaces the funnel kits with live Zernio status, and add an **ElevenLabs voice-snippet factory** so end-card audio is click-to-download / drag-drop. Quality bar is explicitly high: this is a UI for non-technical marketing employees.

**Execution protocol (owner directive):** use multiple parallel agents — as many as needed (ultracode/Workflow orchestration). ALL subagents run Opus. **3× independent review passes** (correctness · security/authz · UX-as-a-marketing-employee) **plus one final end-to-end pass** that actually runs the app and clicks through every new/changed screen. Typecheck + tests green. Report verified vs assumed honestly.

---

## §1 — Ground truth (verified 2026-07-02)

- **App:** this repo = the controller serving `api.coherencedaddy.com`. `ui/` = React (App.tsx, components/, api/, adapters/). `server/` = API (`server/src/routes/*` — note `authz.ts`, `access.ts` exist). Zernio adapter: `server/src/services/platform-publishers/zernio.ts`; relayer `server/src/services/social-relayer.ts`; routes `server/src/routes/socials.ts`.
- **Deploy:** VPS4, compose runs from `/opt/team-dashboard` with `--env-file .env.production`, **read-only rootfs**, external postgres. Don't design anything that writes to the container filesystem.
- **Migrations:** sequence lives in `packages/db/src/migrations` — the engagement layer took **0122** but files up to **0145** exist on master (older "next = 0122" notes are stale). VERIFY the actual next free number there before adding tables; never reuse the university app's numbering.
- **✅ COLLISION RESOLVED (verified 2026-07-02 PM):** the Zernio lead-loop **MERGED to master** as PR #134 (`54a396a1`, plus 0122-supersede fix `52379276`); `feat/zernio-engagement` has zero unmerged commits and the main tree is back on `master`. Build from `origin/master` and **REUSE** the merged engagement surface (comment-automation CRUD, webhook receiver, analytics endpoints) instead of avoiding it. Build worktree: `/Users/exe/Downloads/Claude/_wt/content-hub-build` on branch `feat/marketing-content-hub`. One remaining overlap risk: a security-remediation branch (`security/backend-remediation-2026-07-01`, worktree under `~/.claude/jobs/419cf8c0/tmp/td-fix`) — check overlap on auth files before changing `authz.ts`/`access.ts`. Other feature worktrees exist under `../_wt/` and `~/.claude/jobs/`.
- **Zernio facts:** keys are env `ZERNIO_KEY_<accountId>`; account id lives on `social_accounts.oauth_ref` as `"zernio:<id>"`. Base `https://zernio.com/api/v1`. Live automations right now: `COHERENT` (account-wide, both brand IGs), `ROOM` (account-wide, @coherencedaddy, id `6a46e05af48898fb750519e4`, created 2026-07-02), OutRizzd `SHIRT`/`FIT` (per-post, matchMode=contains). 8 accounts connected, ~$36/mo.
- **DM #2 is NOT the dashboard's job:** a cron on Mark's Mac (`Ig_Auditor/two_step.py`, every 15 min) sends the reply-gated second DM for COHERENT + ROOM. The dashboard must never send DM #2 (double-send risk). Treat automations as **read-only** unless Mark explicitly asks.
- **The team already reaches Zernio via Claude (per Mark, 2026-07-02):** Eagan + other team members use a **separate Claude account** with the **SAME Zernio API key(s)** Mark uses (`ZERNIO_KEY_<accountId>`) to access Zernio and produce content. Implications: (a) the Content Hub is NOT the team's only Zernio path — it's the kit/status/asset layer that complements their Claude workflow, don't build duplicate content-creation tooling into it; (b) there is a **fourth Zernio writer** besides the VPS4 engagement engine, Mark's DM#2 cron, and the in-flight lead-loop session — and it shares the key, so the green-light board must render automations it didn't create, per-account stats INCLUDE team activity (label them as account-level truth, not engine-only), and rate limits are shared; (c) automations stay **read-only** for this build — if the hub ever needs Zernio writes, coordinate with Mark on which surface owns them first.
- **Kits (content source of truth):** `/Users/exe/Downloads/Claude/marketing/plans/plan-zernio-leverage.md` **§6** — KIT 0 (Eagan's end-card pack) through KIT 9, each with idea/thumbnail/script/voice-snippet/DM copy/settings. Mirrored visually in `/Users/exe/Downloads/Claude/marketing/designs/BOARD-funnels-accounts-content.html` (Section E).
- **ElevenLabs:** credentials at `Ig_Auditor/.env.elevenlabs` (Mark's cloned voice + persona voices; working usage examples in `Ig_Auditor/assemble_brand_official.py` and `build_brand_beds.py`). `team-dashboard/.env` also carries an ElevenLabs/XI entry — verify which is current before wiring.
- **Brand/UX standards:** coral `#FF6B4A`; `marketing/_shared/PLAIN-UX-PRINCIPLES.md` (plain English, one-thing-at-a-time, honest UI); voice per `marketing/_shared/VOICE.md`.

---

## §2 — Workstream A: fix the `/CD` path bug

**Symptom (Mark, from live use):** pages live under a project prefix — e.g. `https://api.coherencedaddy.com/CD/university-emails` — but many internal links are built WITHOUT the `/CD` prefix, so "a bunch of the paths don't work."

**Work:** find how the project/workspace prefix routing works in `ui/` (router in App.tsx); centralize link-building in ONE helper that always injects the current project slug; sweep every sidebar item, in-page link, breadcrumb, and redirect to use it; add a test that walks all registered routes under a prefix.

**Accept:** clicking every sidebar entry and every in-page link under `/CD/...` lands correctly — zero 404s/mis-routes. Deep-linking (paste a full `/CD/...` URL) also works.

## §3 — Workstream B: Tokns as a first-class project

**Symptom:** the left project rail shows ONLY the Coherence Daddy icon (+ an add button). Tokns should be a main project like CD.

**Work:** discover how projects/workspaces are registered (config, repo registry, or db — find it, don't guess); register **Tokns** (tokns.fi / TX ecosystem) as a top-level project with its own slug (e.g. `/TOKNS/...`), icon, and sidebar. Note the CD sidebar currently carries `Tokns` and `TX Ecosystem` pages under PRODUCTS — decide with evidence whether those move under the Tokns project (preferred, with redirects from old paths) or stay cross-listed; document the decision.

**Accept:** rail shows CD + Tokns; switching projects switches sidebar + routes; old links redirect.

## §4 — Workstream C: Marketing Content Hub (the big one)

One place for Eagan + employees to get kits, assets, and live funnel status. Today they juggle the board file + the Zernio dashboard + their own Claude account (see §1 — they already create content via Claude→Zernio; that workflow stays). The hub collapses the *lookup* side into this app:

1. **Employee login:** verify what auth exists (`server/src/routes/authz.ts`, `access.ts`). If there's no simple way to invite a user with a scoped role, add one: a **marketing role** that sees Socials & Content + the new Content Hub, and does NOT see ops/admin/billing.
2. **Content Hub section** (under Socials & Content or top-level): render the funnel **kit cards** (KIT 0–9 from the marketing plan §6). Per card: status badge, the kit body, and **one-click copy** for the whole kit AND for individual fields (end-card text, spoken line, thumbnail idea, DM copy). Import: do NOT hand-copy the text into components — sync from the md source (import script or build step) so the plan doc stays the single source of truth; document the refresh path.
3. **LIVE green-light board:** don't hardcode status — read automations live from Zernio (`GET /v1/comment-automations` per account key) and render green/amber/red per keyword + per-funnel stats (triggered / DMs sent / link clicks). This kills the need for employees to ever open Zernio's own dashboard.
4. **Flow:** employee logs in → picks a kit → copies what they need → (optional) drafts the post via the existing socials surface. Dead simple, plain-English labels, one thing per screen.

**Accept:** a brand-new user with the marketing role can log in, find KIT 0, copy an end-card, see that ROOM is green with live numbers — without training and without touching Zernio or the board file.

## §5 — Workstream D: ElevenLabs voice-snippet factory

**Goal:** every kit's VOICE SNIPPET and end-card spoken lines become generated audio the team can **click to download or drag-drop into their edit**.

- Voice routing: Mark's cloned voice for brand kits (ROOM/COHERENT/SHIRT/SCORE/READY); persona voices (Brianna/Mami/Solène/Remy) for theirs.
- Generate via ElevenLabs API (creds per §1); **click-to-generate, never on page load**; cache by (voiceId, text-hash) so views don't re-bill; store in whatever writable asset path the app already uses (see `routes/assets.ts`; remember prod rootfs is read-only).
- UI: an audio chip next to each snippet — play, download, drag-drop (native HTML5 drag with the file). Show voice name + duration.

**Accept:** on the ROOM kit, one click produces Mark-voiced audio of the end-card line; second view plays the cached file; the file drags into Finder/a video editor.

---

## §6 — Hard constraints

- **Never** send DMs from this app (two_step.py owns DM #2). Automations read-only unless Mark says otherwise.
- **No Zernio Conversions API** (in-house Meta CAPI build is canonical — double-firing double-counts). No multi-day DM drips / comment-list broadcasts (ToS bans).
- Secrets stay in env files; never commit or log key values.
- Own migration numbering (next 0122); respect read-only rootfs; match repo conventions (read `CLAUDE.md` + `AGENTS.md` first).
- Coordinate with `feat/zernio-engagement` (§1) — branch fresh, rebase, don't re-implement.

## §7 — Final acceptance checklist

- [ ] All `/CD/...` links work (sweep + test) — Workstream A
- [ ] Tokns project in the rail with working routes/redirects — B
- [ ] Marketing role login → Content Hub with kits + copy buttons — C
- [ ] Green-light board reads LIVE from Zernio with stats — C
- [ ] Voice chips: generate/cache/download/drag on every kit — D
- [ ] 3× reviews done (correctness, security/authz, UX) + findings fixed
- [ ] Final E2E pass: app run, every changed screen clicked through as a marketing employee
- [ ] Typecheck + tests green; honest verified-vs-assumed report; deploy notes for VPS4 written

---

## §8 — Coordination note: caption style picker (added 2026-07-02, separate session)

A separate session shipped the **caption style picker** (per
`6-2026-new-youtube-automation/docs/TODO-caption-style-system.md`) as branch
**`feat/caption-style-picker`** (commit `368912b1`, worktree
`../_wt/caption-style-picker`), **stacked on `feat/marketing-content-hub` tip
`04b56e10`** — nothing on your branch was touched.

- Adds: `CaptionStylePicker` section at the bottom of `ContentHub.tsx` (one
  import + one JSX line there — the only shared-file edit), new
  `ui/src/content/caption-styles/` + `ui/pages/content-hub/CaptionStylePicker.*`,
  `GET /api/socials/caption-styles`, `pnpm caption-styles:sync`, six committed
  preview PNGs. Details: `docs/deploy/content-hub-notes.md` § "Caption style
  picker" (on the stacked branch).
- **Merge order:** yours first, then `feat/caption-style-picker` (or fold it
  into your PR). If you rebase/amend your branch, ping so the stack rebases.
- **Wave-4 asks:** include this surface in the company-structure.mmd changelog
  line when you add the Content Hub node (no separate node needed), and keep
  `/api/socials` in the marketing-gate allowlist (the endpoint lives there).
