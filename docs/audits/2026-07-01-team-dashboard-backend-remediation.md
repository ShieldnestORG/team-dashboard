# Team-Dashboard Backend Security Remediation — Log

> **Cluster:** security-audit · **Tags:** remediation, backend-audit, team-dashboard, vps4, fail-open-auth, ssrf, csrf, stripe-idempotency, leaked-secrets · **Related:** [Audit report](2026-07-01-team-dashboard-backend-security-audit.md), [Handoff](../2026-07-01-team-dashboard-security-audit-handoff.md), [Landing remediation log](../../../coherencedaddy-landing/docs/2026-07-01-security-remediation.md)

**Date:** 2026-07-01 · **Branch:** `security/backend-remediation-2026-07-01` · **Baseline:** `a53f14e0` (`origin/master`, production truth) · **Status: DEPLOYED TO PROD 2026-07-01 (owner-authorized direct-to-master). Host-side secret rotation still pending owner checkpoint.**

> **Deploy note (authorized):** owner said "go ahead" 2026-07-01 → deployed direct to `master` per the CLAUDE.md feature-branch-exception convention (like the 2026-04-22 CreditScore cutover). Server+UI tsc clean. **Rebased onto master first** — two University email-analytics commits (#131/#132) had landed in parallel; my migration renumbered `0142` → `0144` to avoid colliding with their `0142_university_email_log`/`0143_university_email_events`. Migration `0144` applies at container boot (VPS4 has `PAPERCLIP_MIGRATION_AUTO_APPLY=true`, verified live) — additive/idempotent (`ADD COLUMN IF NOT EXISTS` + `CREATE UNIQUE INDEX IF NOT EXISTS`). portal-csrf magic-link break caught + fixed pre-deploy (item 2 below).

Sibling to the [audit report](2026-07-01-team-dashboard-backend-security-audit.md). This log records what was changed in code to close the audit findings, what was verified, and — importantly — what remains **NOT done** (host-side secret rotation + the deploy itself), which is gated on owner checkpoint.

---

## Honest status banner

| Stage | State |
|-------|-------|
| Code fixes for the 3 Criticals + Highs | ✅ Written on `security/backend-remediation-2026-07-01` |
| `tsc --noEmit` server + ui | ✅ **Clean (0 errors)** after building workspace packages |
| Lockfile re-generated after `multer` bump | ✅ `pnpm-lock.yaml` updated (non-frozen install) |
| Committed to the remediation branch | ✅ (this session) |
| Merged/pushed to `origin/master` | ❌ **NOT DONE** |
| Deployed to VPS4 | ❌ **NOT DONE — prod still runs vulnerable `a53f14e0`** |
| DB migration `0144` applied to prod Neon | ✅ via boot auto-apply (`PAPERCLIP_MIGRATION_AUTO_APPLY=true`) on deploy |
| Host-side: `chmod` secret backups on VPS4 | ❌ **NOT DONE (owner checkpoint)** |
| Host-side: secret rotation | ❌ **NOT DONE (owner checkpoint — high blast radius)** |

**Bottom line: production is still exploitable.** The code that fixes it exists and compiles, but nothing is live until it is deployed and the host items are done.

---

## Code fixes applied (mapped to audit findings)

### Critical
- **#1 — Unauth destructive DB purge** (`server/src/routes/maintenance.ts`): router-level `logAdminAccess(db)` + fail-closed guard requiring `req.actor.type === "board"` and instance-admin (`isInstanceAdmin` or `local_implicit`). Anonymous `actor.type='none'` now 401s before `runRetentionSweep`.
- **#2 — Unauth cross-tenant Campaigns API** (`server/src/routes/campaigns.ts`): every handler now calls `assertBoard(req)` + `assertCompanyAccess(req, companyId)`; `companyId` is scoped to the actor, defaulting to `TEAM_DASHBOARD_COMPANY_ID` rather than trusting client query/body. Header comment corrected.
- **#3 + #11 — Fail-open `boardMutationGuard` → unauth paid-compute/LLM sinks**: fail-closed router-level board guards (+ `logAdminAccess`) added to `youtube.ts`, `firecrawl-admin.ts`, `video-edit.ts`, `moltbook.ts`, `auto-reply.ts`, `launch-monitor.ts`. Anonymous requests are now rejected before any Anthropic/Grok/ElevenLabs/Firecrawl spend.

### High
- **#4 — Unauth partner-directory writes** (`server/src/routes/partner.ts`): `assertBoard(req)` on create/update/delete; `logoUrl`/`website` validated as http(s)-only via `isSafeHttpUrl` (rejects `javascript:`/`data:` — addresses Low #26 too).
- **#5 / #16 / A.4 — Portal CSRF** (`server/src/middleware/portal-csrf.ts`, wired in `portal.ts`): new `portalCsrfGuard()` enforces an Origin/Referer allowlist on all unsafe methods (allowlist = `portalBaseUrl()` + `PORTAL_TRUSTED_ORIGINS` + dev origins in `NODE_ENV=development`). GET/HEAD/OPTIONS pass. Missing-Origin-and-Referer on an unsafe request is **rejected** (fail-closed).
- **#6 — Stripe intel-billing replay** (`server/src/services/intel-billing.ts` + schema `intel_billing.ts` + migration `0144`): idempotency keyed on Stripe checkout `session.id`. New UNIQUE column `intel_api_keys.stripe_checkout_session_id`; select-existing-first + UNIQUE-index race backstop; on replay returns existing key id with `rawKey: null` and skips the welcome email.
- **#8 — Unauth SSRF `repo-updates/run-audit`** (`server/src/routes/repo-updates.ts`): board guard + `logAdminAccess`, plus `assertPublicHttpUrl(url)` pre-fetch.
- **#9 — Public unauth SSRF `/public/audit`** (`server/src/routes/audit.ts`): `validateAuditUrl` now async, delegates to the shared `assertPublicHttpUrl` (DNS-resolving, blocks loopback/private/link-local/CGNAT/IPv4-mapped-v6/0.0.0.0); the Crawlee fallback path is guarded too.
- **#10 — SQLi via `sql.raw()`** (`server/src/routes/knowledge-graph.ts`): replaced string-concatenated `SET` with parameterized `sql\`\`` fragments joined via `sql.join`; `confidence` coerced+validated to a finite number, `verified` coerced to Boolean. No user data reaches `sql.raw`.
- **#13 — `multer` DoS CVE** (`package.json` override): bumped; `pnpm-lock.yaml` re-generated.

### Shared hardening
- **New `server/src/lib/ssrf-guard.ts`**: `assertPublicHttpUrl` (scheme + DNS-resolved IP-range classification) and `safeFetch` (redirect:"manual" + per-hop re-validation). Used by `audit.ts`, `repo-updates.ts`, and `seo-audit.ts`.
- **`.gitignore`** (#19): now ignores `.env.bak*` / `.env.*` so backup files can't be committed.

---

## Verification performed this session

- `pnpm install` (non-frozen — required because the `multer` override change invalidated the frozen lockfile).
- `pnpm -r --filter "./packages/**" build` (workspace packages must be built or `@paperclipai/plugin-sdk` types don't resolve — this is a build-order artifact, unrelated to the security edits).
- `node_modules/.bin/tsc --noEmit --project server/tsconfig.json` → **0 errors.**
- `cd ui && tsc --noEmit` → **0 errors.**
- Spot-verified the 3 Critical fixes present and correct in the working tree.

**Not performed:** runtime/behavioral testing against a live instance. No fix has been exercised with a real request. See pre-deploy checklist.

---

## ⚠️ Pre-deploy checklist (do these before/with any deploy — NOT yet done)

1. **✅ Migration `0144` ordering handled.** `intel-billing.ts` inserts `stripeCheckoutSessionId`; VPS4's `PAPERCLIP_MIGRATION_AUTO_APPLY=true` applies pending migrations at container boot *before* serving, so the column exists before the new code runs. The migration is additive + idempotent, so re-runs are safe. (No manual pre-migrate step needed; `predeploy.sh` also runs `db:migrate` when run with `DATABASE_URL`.)
2. **✅ RESOLVED pre-deploy — `portalCsrfGuard` magic-link break.** Verification (Explore sweep of team-dashboard + storefront) found exactly one legitimate flow the guard broke: the magic-link consume `POST /api/portal/auth`. Its interstitial HTML is served by the backend and the form POSTs back to the backend origin (`api.coherencedaddy.com`), which was NOT in the allowlist (only `app.coherencedaddy.com` was) → every sign-in would 403. **Fixed in code:** `portalApiBaseUrl()` exported and added to the CSRF allowlist (`portal-csrf.ts`), so the backend's own first-party origin is trusted. No other server-to-server portal caller exists (storefront has no `/api/portal` rewrite; no internal cron POSTs to portal). Prod config confirmed live: `PAPERCLIP_PUBLIC_URL=https://api.coherencedaddy.com`, `PORTAL_BASE_URL`/`PORTAL_TRUSTED_ORIGINS` unset (default correctly). Prod allowlist = `{app,api}.coherencedaddy.com`.
3. **Confirm `portalBaseUrl()` returns the real prod origin** (`https://app.coherencedaddy.com`) so the allowlist isn't empty in prod.
4. **Set `PORTAL_TRUSTED_ORIGINS` on VPS4** if any staging/alt frontend legitimately posts to the portal.
5. Board guards assume the board session sets `req.actor.type==='board'` in prod — smoke-test one board-only route (e.g. `/api/youtube`) with a real board session after deploy to confirm operators aren't locked out.
6. Restarting `team-dashboard-server-1` = brief `api.coherencedaddy.com` blip. Batch the deploy; verify `/health` after.

---

## ❌ NOT done — host-side (owner checkpoint required)

These need SSH write to VPS4 + coordinated secret rotation. **Deliberately left for owner sign-off** (high blast radius):

- **#14 — `chmod 600` the ~15 world-readable `.env.production.bak-*`** on `/opt/team-dashboard/` (+ `chmod 700` the dir, prune/relocate backups). The current `.env.production` is already `0600`; only the backups are `0644`.
- **#14 — ROTATE every secret that sat in a `0644` backup:** `BETTER_AUTH_SECRET`, `PAPERCLIP_AGENT_JWT_SECRET`, `AFFILIATE_JWT_SECRET`, all `STRIPE_WEBHOOK_SECRET*`, `STRIPE_SECRET_KEY`, `DISCORD_TOKEN`, `GITHUB_TOKEN`, `DATABASE_URL` creds. **Caveat (owner memory):** `CREDITSCORE_CALLBACK_KEY` also signs unsubscribe + member-login magic-link tokens — do not rotate it casually; reuse the prod value.
- **#24 — `.env.frontend` (0644)** on VPS4 — chmod.

---

## Remaining lower-severity items NOT yet coded (tracked, not closed)

P2 tail from the audit — deferred, not in this branch: #12 (rate-limit XFF / `trust proxy`), #15 (impersonation nonce identity-binding), #18 (media-drop auth), #20 (docker inspect secret exposure), #21 (moltbook auto-publish human gate), #23 (unmetered Firecrawl GET stream), #29 (CORS `/localhost/` anchor), #34 (Nitter SSRF), #36 (redaction completeness), #37/#38 (dep advisories). See the audit's prioritized checklist.

---

*Prod remains on `a53f14e0` (vulnerable) until this branch is deployed. This log is the source of truth for what's fixed-in-code vs. what's live.*
