# Portal cross-origin smoke test — 2026-05-17

Read-only verification of the customer portal flow shipped 2026-05-09.
Frontend: `https://app.coherencedaddy.com` (Vercel/Next.js).
Backend: `https://api.coherencedaddy.com` on VPS4 (this repo).

## Works

- **SPA reachable** — `GET https://app.coherencedaddy.com/` → `HTTP/2 200`, served by Vercel (Next.js).
- **CORS preflight** — `OPTIONS /api/portal/login` with `Origin: https://app.coherencedaddy.com` →
  `Access-Control-Allow-Origin: https://app.coherencedaddy.com` + `Access-Control-Allow-Credentials: true`.
  Hostile origin (`evil.example.com`) gets no `ACAO` header. Regex in `server/src/app.ts:182-190` (`/\.coherencedaddy\.com$/`) is doing its job.
- **Cookie domain** — `POST /api/portal/logout` returns
  `Set-Cookie: cd_portal_session=; ...; Domain=.coherencedaddy.com; Secure`.
  Confirms `server/src/routes/portal.ts:37` (`COOKIE_DOMAIN = ".coherencedaddy.com"`) is the effective value in prod (no `PORTAL_COOKIE_DOMAIN` override). Cross-subdomain cookie reads will work.
- **/login no-enumeration** — `POST /api/portal/login {email:"smoketest@example.com"}` → `200 {"ok":true}` with `ACAO` + credentials headers.
- **/me unauth** — `GET /api/portal/me` (no cookie) → `401 {"error":"Unauthenticated"}`.
- **/auth missing token** — `POST /api/portal/auth` → `302 Location: https://app.coherencedaddy.com/auth?error=missing_token`. Redirects point at the SPA, not at the backend (fix from `b9e19552`).
- **Stripe linker wired** — `linkStripeCustomerToAccount` called from `creditscore.ts:477`, `bundle-entitlements.ts:276`, `intel-billing.ts:319`, `watchtower-stripe-handler.ts:173` on `checkout.session.completed`.

## Broken / suspicious

- **/admin-impersonate returns 500 on garbage nonce** — `POST /api/portal/admin-impersonate {"nonce":"xxx"}` → `500 {"error":"Exchange failed"}`. Per `server/src/routes/portal.ts:524-527` and `server/src/services/admin-impersonation.ts:188` it should fall through to `null` → `401 "Invalid or expired nonce"`. The most likely root cause is **migration `0116_admin_impersonation.sql` has not been applied on prod Neon** — the UPDATE against `admin_impersonation_nonces` throws ("relation does not exist") and the catch-all returns 500. Commit `4fb5d9b0` shipped the code but I cannot confirm the migration ran. Mitigated by /admin-impersonate/status which short-circuits on missing cookie before any DB hit (returns clean 200).

## Unverified

- **Magic-link end-to-end** — `/auth` POST + `Set-Cookie cd_portal_session` requires a real consumable token. Needs a real email send (or DB-issued token). Cookie attributes (`Secure`, `Domain=.coherencedaddy.com`, `Max-Age=2592000`, `HttpOnly`, `SameSite=Lax`) are deterministic from the same helper as `clearSessionCookie` (verified above), so very high confidence — but not directly observed.
- **Backfill execution** — `scripts/backfill-stripe-customer-id.ts` exists (PR #46, commit `47aa4410`) but is a one-shot, not a cron. No log entry, no SQL marker, no `docs/` note records that `--apply` was ever run in prod. Until run, all pre-2026-05-09 customers see `bundles: []` in `/me` and `400 "No Stripe customer linked..."` from `/stripe-portal`.
- **`PORTAL_COOKIE_DOMAIN` env override** — not exercised; default falls through cleanly so this is theoretical.

## Next actions (priority order)

1. Verify migration `0116_admin_impersonation.sql` is applied on prod Neon. If not, apply it. (Confirms 500 root cause.)
2. Run `npx tsx scripts/backfill-stripe-customer-id.ts` dry-run on prod; if the summary shows pending `set` rows, run `--apply`. Record the summary in this handoff or a follow-up doc.
3. Once a real test account exists, capture a `Set-Cookie` header from a live `POST /api/portal/auth?token=...` and append it here.
4. Consider tightening `exchangeNonce` to swallow `relation does not exist` and return `null` defensively — would have masked the migration-missing failure mode (debatable: fail-loud is arguably better).
