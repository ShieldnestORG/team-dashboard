# University Voice Budget — Rex realtime minutes cap

> **Cluster:** university · **Tags:** rex, voice, xai, budget, metering, stripe, entitlements · **Related:** [OWNERSHIP.md](../OWNERSHIP.md), [university-checkout.ts](../../server/src/routes/university-checkout.ts), portal repo `app-coherencedaddy-portal` `feat/rex-portal-coach`

Meter Rex realtime voice usage against a monthly per-member seconds budget. **Phase 1** = the free-hour cap (ship-blocker, no Stripe). **Phase 2** = paid add-ons (upsell, needs Starwise Stripe key).

## Pricing model (owner-approved 2026-06-30)
- Free with $50 membership: **3600 s (1 hr)/month**. Calendar-month reset (mirrors intel meter).
- +$10/mo add-on → **+3600 s** (total 2 hr). +$20/mo add-on → **+9000 s** (total 3.5 hr). No rollover.
- Both paid tiers profitable at full use ($3/hr xAI cost). Marketing "10x/30x" is owner's call, copy-agnostic.
- Metering unit: **whole-session wall-clock** (connect→disconnect), conservative vs pure talk-audio.

## Design (mirrors `intel_usage_meter`)
- **Reserve-then-reconcile** (anti-freeride): mint reserves `min(300, remaining)` s up front (debits meter); session close credits back the unused portion. A client that lies/never reports still eats the full grant.
- Limit computed dynamically: `VOICE_FREE_SECONDS (3600) + addonSeconds(member)`; Phase 1 addon = 0.

### Schema (migration 0135, in packages/db/src/schema/university.ts)
- `university_voice_meter(member_id uuid, period_start date, seconds_used bigint default 0, created_at, updated_at, UNIQUE(member_id, period_start))`
- `university_voice_reservations(id uuid pk, member_id uuid, period_start date, granted_seconds int not null, actual_seconds int, status text default 'open' check('open','settled'), created_at, settled_at)`
- Generate with `pnpm db:generate` (auto-creates 0135_*.sql + snapshot + journal entry). Do NOT hand-write the SQL.

### Service `server/src/services/voice-budget.ts`
- `voiceLimitSeconds(member)` → 3600 (Phase 1 constant).
- `getVoiceBudget(memberId)` → `{ periodStart, usedSeconds, limitSeconds, remainingSeconds }`.
- `reserveVoiceSeconds(memberId, requestedSeconds)` → granted = clamp(requested, 0, remaining); atomic UPSERT `seconds_used += granted` (intel-style ON CONFLICT); insert open reservation; return `{ reservationId, grantedSeconds, remainingSeconds }`.
- `settleVoiceSeconds(reservationId, memberId, actualSeconds)` → idempotent; clampedActual = clamp(actual, 0, granted); refund = granted − clampedActual; `seconds_used -= refund` (never < 0); mark settled.
- Resolve member from accountId with the same `LOWER(email)=… OR account_id=…`, newest active row query used by the entitlement resolver.

### Endpoints (portal-scoped, `/api/portal/university/voice/*`, gated by `requireUniversityMember`)
- `GET  /budget`  → getVoiceBudget
- `POST /reserve` `{ requestedSeconds }` → reserveVoiceSeconds
- `POST /usage`   `{ reservationId, actualSeconds }` → settleVoiceSeconds
Add to `getAccountWithEntitlements` (customer-portal.ts) a `voiceMinutes: { remainingSeconds, limitSeconds, periodStart }` block on the `university` entitlement.

## HTTP contract (the seam between portal & backend)
```
GET  /api/portal/university/voice/budget
  → 200 { periodStart:"YYYY-MM-01", usedSeconds, limitSeconds, remainingSeconds }
POST /api/portal/university/voice/reserve   { requestedSeconds:number }
  → 200 { reservationId:string, grantedSeconds:number, remainingSeconds:number }
POST /api/portal/university/voice/usage      { reservationId:string, actualSeconds:number }
  → 200 { ok:true, usedSeconds, remainingSeconds }
Auth: cd_portal_session cookie (client credentials:'include'; server forwards Cookie header).
```

## Portal side (`app-coherencedaddy-portal`, worktree `_wt/ai-step-lessons`, feat/rex-portal-coach)
- **Session route** (`app/api/rex/session/route.ts`): after `getMe()`, server-side `reserveVoice(300)` (portal-me.ts cookie-forward style). If `grantedSeconds <= 0` → `402 {error:"out_of_minutes", remainingSeconds, periodStart}` (no mint). Else mint xAI token with `expires_after.seconds = grantedSeconds`; include `reservationId, grantedSeconds, remainingSeconds` in `RexSessionResponse`.
- **Contract types** (`lib/rex/lesson-context.ts`): add `reservationId?, grantedSeconds?, remainingSeconds?` to `RexSessionResponse`; add `"out_of_minutes"` to `RexStatus`; surface on `RexVoiceController`.
- **Hook** (`components/rex/use-rex-voice.ts`): stamp session start; on `cleanup()`/`disconnect()` compute `actualSeconds = round((now - start)/1000)` and `portalApi.reportVoiceUsage(reservationId, actualSeconds)` (resilient try/catch, mirror `recordUniversityRep`). On session-route 402 → set new `out_of_minutes` status with remaining/reset info instead of generic error.
- **RexDock** (`components/rex/RexDock.tsx`): in the banner slot render an "out of minutes — resets on the 1st" state (Phase 1: no CTA; Phase 2: upgrade CTA).
- **Client API** (`lib/api.ts`): `portalApi.getVoiceBudget()` (GET) + `portalApi.reportVoiceUsage(reservationId, actualSeconds)` (POST), reusing `request<T>()` (credentials:'include').

## Phase 2 (later — Stripe prices already created 2026-06-30)
- Two LIVE prices on Starwise acct (`UNIVERSITY_STRIPE_SECRET_KEY`, a restricted key confirmed to have Products/Prices write), resolved by lookup_key (mirror `PLAN_PRICE_CONFIG`):
  - `voice_addon_1hr`  → price `price_1ToG6HAf8PjDIzDYmjHp5WqU` · product `prod_UnrpPuGd4gtGhh` · $10/mo · +3600 s
  - `voice_addon_2p5hr` → price `price_1ToG6HAf8PjDIzDYVQR6KsV6` · product `prod_UnrpmoSPKasr9P` · $20/mo · +9000 s
  - NOT yet attached to any checkout — no customer can purchase until the Phase 2 checkout+webhook below is built.
- Add-on checkout + webhook → sets member add-on → `voiceLimitSeconds` adds addon seconds.
- "Out of minutes" banner becomes upgrade CTA → add-on checkout.

## Verify (Phase 1 done-criteria)
- [ ] `pnpm db:generate` produces 0135 + snapshot + journal; `pnpm db:migrate` applies clean on dev DB.
- [ ] Backend typecheck/build clean; reserve→settle round-trips correctly (used goes up on reserve, back down by unused on settle, never < 0, idempotent).
- [ ] Portal typecheck/build clean; session route returns 402 when remaining ≤ 0; TTL == grantedSeconds.
- [ ] End-to-end with `PORTAL_DEV_ADMIN`: talk → disconnect → budget decrements by ~session length; exhaust → dock shows out-of-minutes.
