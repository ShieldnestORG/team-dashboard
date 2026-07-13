# HANDOFF — University Voice Budget (Rex realtime minutes cap)

> **Cluster:** university · **Tags:** rex, voice, xai, budget, metering, stripe, handoff, phase2 · **Related:** [plan doc](./2026-06-30-university-voice-budget.md), [OWNERSHIP.md](../OWNERSHIP.md)
> **Status as of 2026-06-30:** Phase 1 BUILT + verified (static + money-path on real Postgres). NOT deployed, NOT pushed. Phase 2 Stripe prices created; checkout/webhook remaining.

---

## ⚠️ 2026-07-01 UPDATE — Phase 1 DEPLOYED (isolated), and a deploy landmine

**Phase 1 is LIVE in prod**, but deployed **in isolation** because prod `master` was booby-trapped (see below).

- **Backend (VPS4, api.coherencedaddy.com):** prod now runs branch **`deploy/rex-voice-only`** (tip `c57bf83b`) = deployed sha `65e6262d` + ONLY the 2 voice-budget commits, cherry-picked to EXCLUDE community-agents and the Sessions Waves 1-4B buildout. Migration `0137_aspiring_crystal` applied to prod Neon (voice tables confirmed present). Endpoints live (`/budget`, `/reserve`, `/usage` → 401 auth-gated). Container healthy. `.last-deployed-sha`=`c57bf83b`; loud marker at `/opt/team-dashboard/DEPLOY-STATE-WARNING.txt`.
- **Portal (Vercel, app.coherencedaddy.com):** `feat/rex-portal-coach` rebased onto `main` (auto-dropped 3 duplicate lesson-renderer commits) → 2 Rex commits pushed to `main` → auto-deployed (Ready). `X_AI_API_KEY` added to Vercel Production. Rex session route live (`POST /api/rex/session` → 400 on empty body = runs; `GET` → 405).
- **Post-deploy hotfix (2026-07-01, same day):** owner's first live test could not connect. Root cause: the Vercel `X_AI_API_KEY` value was the ENTIRE commented `_secrets/xai.txt` file (586 chars, newline-stripped) instead of the bare key — xAI auth was garbage, every mint 502'd. Fix: re-set the env var with the clean 84-char `xai-…` value (extract with `grep '^X_AI_API_KEY=' xai.txt | cut -d= -f2-`), verified the key mints tokens (200) directly against `api.x.ai`, redeployed. Same deploy (commit `80d016c` on main) renamed the coach's **user-facing name Rex → "Guide"** (dock labels, aria labels, spoken persona line in `lib/rex/lesson-context.ts`); code identifiers, file paths, and the xAI voice timbre `voice: "rex"` are unchanged.
- **STILL owner-manual:** the interactive end-to-end smoke (sign in as a real active member → open Rex → confirm token TTL == granted → talk → disconnect → `/budget` decremented → exhaust → out-of-minutes banner).

### 🚨 THE LANDMINE (read before ANY future backend deploy)
Prod backend is on a **non-master branch**. A standard `git checkout master && deploy` will:
1. **DROP Rex voice** — the voice-budget commits are NOT on master.
2. **ACTIVATE community-agents** — `.env.production` already has `AGENTS_RUNNER_ENABLED=true` and `AGENT_DAILY_TOKEN_BUDGET=5`, so shipping the agent-runner code turns AI agents loose in the live community.
3. Ship the Sessions Waves 1-4B buildout.

**Why isolated:** at deploy time, master carried the agents team's actively-in-progress work (they were pushing to master live) with activation flags already ON — not ours to ship/activate. Owner chose "isolated Rex-only deploy."

**To do it right later (coordinated go-live):** when the agents team is ready to activate, (a) merge `feat/university-voice-budget` into master so Rex survives the master deploy, (b) deliberately handle agents activation + Sessions go-live env (`UNIVERSITY_SESSION_ADMINS` ✓ set, `CREDITSCORE_CALLBACK_KEY` ✓ set), then deploy master. Prod DB already has the Sessions + agents migrations applied (verified); repo's custom disk-glob migrator handles the `0138`/`0139` journal gap at deploy (only a from-scratch rebuild would skip them — journaling them is recommended hygiene).

### Phase 2 status (built, reviewed, NOT deployed)
Add-ons built on `feat/university-voice-addons` (worktree `_wt/voice-addons`); 2 review bugs fixed (commit `a0f2d2b9`: referral-credit drain on add-on invoices; add-on cap-zeroing on out-of-order Stripe events). Portal CTA on `feat/rex-voice-addon-cta` (worktree `_wt/voice-addons-portal`, review verdict SHIP).

---

Read this top-to-bottom before touching anything. The full spec is the [plan doc](./2026-06-30-university-voice-budget.md); this is the "where things stand + what to do next + landmines" layer.

---

## 1. What this is
Meter Rex's xAI realtime voice against a **monthly per-member seconds budget**. Owner-approved model:
- Free with the $50/mo University membership: **3600 s (1 hr)/month**. Calendar-month reset (resets the 1st, UTC). **No rollover.**
- Paid add-ons (Phase 2): **+$10/mo → +3600 s** (2 hr total) · **+$20/mo → +9000 s** (3.5 hr total). No rollover.
- Metering unit = **whole-session wall-clock** (connect→disconnect). Conservative vs pure talk-audio; owner confirmed.
- Marketing may say "10x/30x" — owner's call, code is copy-agnostic. Actual delivery is +1 hr / +2.5 hr.

Two repos:
- **Backend** = `team-dashboard` (this repo, `api.coherencedaddy.com`, VPS4 `.14`, Neon Postgres). Owns tables, Stripe, entitlements.
- **Portal** = `app-coherencedaddy-portal` (`app.coherencedaddy.com`, Vercel/ShieldnestORG). Where Rex lives; consumes entitlements.

## 2. Exact locations / git state (nothing pushed, nothing deployed)
| | Backend | Portal |
|---|---|---|
| Worktree | `/Users/exe/Downloads/Claude/_wt/voice-budget` | `/Users/exe/Downloads/Claude/_wt/ai-step-lessons` |
| Branch | `feat/university-voice-budget` (off `origin/master` @ `268ac5ab`) | `feat/rex-portal-coach` |
| Tip commit | `6660ccf0` (cleanup) ← `5560de21` (Phase 1 impl) | `d1f468b` (budget) ← `403e7e9` (original Rex) |
| Pushed? | **No** | **No** |
| Base dependency | — | sits on `feat/ai-automation-step-lessons` (lesson renderer; on origin; **not merged to portal main**) |

## 3. What's built (Phase 1)
**Backend** (`feat/university-voice-budget`):
- `packages/db/src/schema/university.ts` — `universityVoiceMeter` (UNIQUE member_id+period_start) + `universityVoiceReservations` (status open/settled) + type exports; barrel-exported in `schema/index.ts`.
- `packages/db/src/migrations/0137_aspiring_crystal.sql` — creates ONLY the 2 tables + indexes. Journal entry idx `137`. (NOTE: numeric-prefix collision with `0137_university_agent_config` — harmless, migrator keys off journal tags; repo already has `0078`/`0119` collisions.)
- `server/src/services/voice-budget.ts` — `voiceLimitSeconds` (returns 3600; takes an ignored `member` arg so Phase 2 is a 1-line change), `resolveVoiceMemberId`, `getVoiceBudget`, `reserveVoiceSeconds`, `settleVoiceSeconds`. Reserve-then-reconcile, intel-meter-style atomic UPSERT, idempotent guarded settle.
- `server/src/routes/portal.ts` — 3 endpoints under `/api/portal/university/voice/*` (`GET /budget`, `POST /reserve`, `POST /usage`) + `requireVoiceMember` gate. Mutations impersonation-blocked.
- `server/src/services/customer-portal.ts` — `voiceMinutes { remainingSeconds, limitSeconds, periodStart }` added to the `university` entitlement in `getAccountWithEntitlements`.

**Portal** (`feat/rex-portal-coach`, commit `d1f468b`):
- `app/api/rex/session/route.ts` — after `getMe()`, server-side reserve (cookie-forward like `portal-me.ts`); `grantedSeconds<=0` → **402** `{error:"out_of_minutes",...}`, no mint; else mint xAI token with `expires_after.seconds = grantedSeconds`; adds `reservationId/grantedSeconds/remainingSeconds` to response. Reserve-call failure → 502 fail-closed (never mints unmetered).
- `lib/rex/lesson-context.ts` — added fields to `RexSessionResponse`, `"out_of_minutes"` to `RexStatus`, surfaced on `RexVoiceController`.
- `components/rex/use-rex-voice.ts` — stamps session start + reservationId; on cleanup/disconnect reports `actualSeconds` via `portalApi.reportVoiceUsage` (swallowed try/catch); 402 → status `out_of_minutes`.
- `components/rex/RexDock.tsx` — out-of-minutes banner ("used your minutes — resets on the 1st"), no CTA yet (Phase 2 adds it).
- `lib/api.ts` — `portalApi.getVoiceBudget()` + `reportVoiceUsage(reservationId, actualSeconds)`.

### HTTP contract (the seam — both sides match this)
```
GET  /api/portal/university/voice/budget  → 200 {periodStart,usedSeconds,limitSeconds,remainingSeconds}
POST /api/portal/university/voice/reserve {requestedSeconds}       → 200 {reservationId,grantedSeconds,remainingSeconds}
POST /api/portal/university/voice/usage   {reservationId,actualSeconds} → 200 {ok:true,usedSeconds,remainingSeconds}
Auth: cd_portal_session cookie (client credentials:'include'; server forwards Cookie header).
```

## 4. Verification status (be honest about this)
- ✅ Both repos typecheck clean (`npx tsc --noEmit --project server/tsconfig.json`; portal `pnpm typecheck`).
- ✅ HTTP contract matches on both sides.
- ✅ Migration SQL creates only the 2 new tables — safe to apply.
- ✅ **Money-path empirically proven on real Postgres 17** (throwaway docker): reserve→settle→refund, idempotent double-settle (no double-credit), over-report clamp, exhaust caps at 3600, `GREATEST(0,…)` floor never negative. All passed.
- ⚠️ **NOT tested at runtime:** the live HTTP wiring (portal→backend over a real cookie), the capped-TTL token mint, and the UI banner rendering. Do this as a **first-deploy smoke test** (below). Not built into a local harness because it needs both apps + seeded DB + a login session, and Rex ships capped with ~0 members.

## 5. NEXT ACTIONS

### A. Ship Phase 1 (task #4) — ORDER MATTERS
Portal **fails closed (502)** if the backend reserve endpoint isn't live → **deploy backend FIRST.**
1. **Backend:** merge `feat/university-voice-budget` → `master`; deploy VPS4 (run `./scripts/predeploy.sh` first — confirms `.14`); apply migration `0137` to prod Neon (`pnpm db:migrate`). Per repo CLAUDE.md, prod migration + master push is a deliberate step — get explicit owner authorization.
2. **Portal:** merge `feat/ai-automation-step-lessons` → main, then `feat/rex-portal-coach` → main; set `X_AI_API_KEY` in the Vercel project (ShieldnestORG) env; deploy. (Vercel deploy is the OWNER's manual step — not doable from CLI here.)
3. **First-deploy smoke test:** sign in as a real active member → open Rex → confirm token TTL == granted → talk → disconnect → `GET /budget` decremented ~session length → exhaust → out-of-minutes banner. Do on staging/first deploy **before opening Rex to members.**

### B. Phase 2 — paid add-ons (task #5) — prices ALREADY created
Stripe prices exist LIVE on the Starwise account (created 2026-06-30, resolved by lookup_key like the existing university prices):
- `voice_addon_1hr`  → `price_1ToG6HAf8PjDIzDYmjHp5WqU` · `prod_UnrpPuGd4gtGhh` · $10/mo · +3600 s
- `voice_addon_2p5hr` → `price_1ToG6HAf8PjDIzDYVQR6KsV6` · `prod_UnrpmoSPKasr9P` · $20/mo · +9000 s
- Restricted key `UNIVERSITY_STRIPE_SECRET_KEY` **confirmed write-capable**. NOT yet attached to any checkout — nobody can buy until this is built.

Remaining:
1. Add-on data model: how an active add-on maps to +seconds (a column/flag on `university_members`, or a small add-on-subscription table). Add-on is a *second* Stripe subscription on top of the $50 membership.
2. Checkout + webhook: mirror `university-checkout.ts` `createCheckout` (uses `createCheckoutSession`, `universityStripeKey()`) + `dispatchUniversityEvent`/`university-stripe-handler.ts` to set the member's add-on on `subscription.updated/deleted`.
3. `voiceLimitSeconds(member)` → `VOICE_FREE_SECONDS + addonSeconds(member)` (the param is already there, stubbed).
4. Portal: out-of-minutes banner → **upgrade CTA** that starts add-on checkout.

## 6. LANDMINES / gotchas (read these)
- **No dev-admin bypass on reserve** (by design, fail-closed). `PORTAL_DEV_ADMIN=1` short-circuits `getMe()` but reserve still hits the real backend → E2E needs a running backend + a real `active`/`past_due` member row for `admin@coherencedaddy.com`.
- **Backend never emits 402.** `/reserve` returns `200 {grantedSeconds:0}` when exhausted; the PORTAL session route turns `granted<=0` into 402. Don't "fix" the backend to 402.
- **`resolveVoiceMemberId` requires active/past_due.** `requireVoiceMember` gate is status-agnostic, but a `pending`/`cancelled` member gets `403` from the voice routes (mirrors `voiceMinutes:null` in `/me`). Intended.
- **`periodStart` is best-effort in the 402 path** (reserve contract doesn't return it; portal banner text is static "resets on the 1st"). Cheap improvement: add `periodStart` to the reserve response so the banner can show the real date.
- **Step-change churn (reprime):** Rex re-hits the session route on every lesson step → reserves a new segment each time. Portal settles the prior segment on swap, so net usage == wall-clock (correct), but there's transient over-reservation that can trip out-of-minutes slightly early near exhaustion. Optional Phase-1.1: a `reprime:true` request flag so the route skips reserve/mint on mid-session updates.
- **Drizzle drift (pre-existing, NOT this feature's fault):** recent migrations `0135/0136/0138/0139` added no snapshot; `0138/0139` aren't in the journal. `drizzle-kit generate` will produce noisy diffs until someone re-baselines deliberately. I DROPPED the impl agent's 28k-line auto re-baseline snapshot (out-of-scope; only affects dev-time generate, never `db:migrate`). Do a dedicated cleanup PR for the drift; don't smuggle it into a feature branch.
- **Two Stripe accounts.** University bills on the **Starwise** account via `UNIVERSITY_STRIPE_SECRET_KEY` — NOT the shared `STRIPE_SECRET_KEY`. See `docs/deploy/stripe-runbook.md`.

## 7. Secrets (locations, never commit values)
- **xAI key** (`X_AI_API_KEY`, account `x.relieve478@passmail.net`): `/Users/exe/Downloads/Claude/_secrets/xai.txt` + portal `_wt/ai-step-lessons/.env.local` (gitignored). Prod = set in Vercel (owner manual). Memory note: `reference_xai_rex_key.md`.
- **University/Starwise Stripe** (`UNIVERSITY_STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET_UNIVERSITY`, `UNIVERSITY_STRIPE_PRICE_ID`): `/Users/exe/Downloads/Claude/_secrets/community-agents.secrets.env` + VPS prod env. Key is a restricted `rk_` key with Products/Prices write.

## 8. Task tracker (session state)
#1 Backend Phase 1 ✅ · #2 Portal Phase 1 ✅ · #3 Review+verify ✅ · #4 Ship (pending, owner deploy) · #5 Phase 2 (pending; prices done, checkout/webhook remaining).
