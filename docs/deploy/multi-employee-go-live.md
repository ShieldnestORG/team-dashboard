# Go-live checklist: employees log in & post

Companion to the code in PR #115 (auth/config hardening + draft→approve posting).
The code changes are merged separately; the items below are **deploy-time config
on the box** — the app cannot set these for you. Work top to bottom.

## 1. Required env (the server now fails loud if these are wrong)

| Var | Value | Why |
|-----|-------|-----|
| `PAPERCLIP_DEPLOYMENT_MODE` | `authenticated` | Default is `local_trusted`, which treats **every** request as an implicit admin. Without this you do not have real logins. (Boot refuses `local_trusted` on a non-loopback host, so it won't silently run wide-open — but it won't be authenticated either.) |
| `DATABASE_URL` | your managed Postgres URL | Authenticated mode now **refuses to boot** without it (previously it silently used a throwaway embedded DB). |
| `BETTER_AUTH_SECRET` | a long random secret | Sessions are signed with it; boot fails without it. The old `paperclip-dev-secret` fallback was removed. |
| `PAPERCLIP_PUBLIC_URL` | `https://<your-domain>` | Must be `https://` so session cookies are marked `Secure` behind the proxy. |
| `PAPERCLIP_AUTH_DISABLE_SIGN_UP` | `true` | Public self-signup is **on** by default. With it off, only invited users get accounts. |
| `PAPERCLIP_DEPLOYMENT_EXPOSURE` | `public` | For an internet-facing deployment. |
| `PAPERCLIP_ALLOWED_HOSTNAMES` / `BETTER_AUTH_TRUSTED_ORIGINS` | your domain(s) | Host/CSRF trust. |

## 2. Posting credentials (per Instagram account)

| Var | Notes |
|-----|-------|
| `ZERNIO_KEY_<accountId>` | One per connected IG account. **Nothing publishes without it** — posts fail at dispatch with "publisher not configured" (visible in the queue). |
| `R2_*` / `PAPERCLIP_STORAGE_*` | Only if posts use internal (non-public) media that must be staged to a public URL first. Text + already-public media don't need it. |

> **Scope today: Instagram only.** X/Twitter is a stub; TikTok/YouTube/Bluesky
> publishers exist but aren't routed. Don't promise employees those yet.

## 3. Password-reset email (optional but recommended)

Set `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS` (and `ALERT_EMAIL_FROM`). Without SMTP,
the reset endpoint still returns success (no account-enumeration leak) but no
email is sent — so locked-out employees would need an admin to help.

## 4. Onboard employees

1. Bootstrap the first admin: `cli … auth-bootstrap-ceo` (one-time; promotes to `instance_admin`).
2. Admin invites each employee: `POST /api/companies/:companyId/invites` (UI). Invite token TTL is 10 minutes — send/accept promptly.
3. Employee accepts → admin approves the join request → membership active.
4. Confirm `TEAM_DASHBOARD_COMPANY_ID` points at the company whose social accounts they'll post to.

## 5. How posting works for them (verify after deploy)

- **Employee (non-admin):** composes a post → it's saved as **Draft (pending approval)**; the relayer ignores it.
- **Admin:** sees the draft in the Queue with the author's name → clicks **Approve** → it becomes `scheduled` and the every-minute relayer publishes it.
- The Queue shows status (scheduled / publishing / posted / failed / pending_approval), the error on failure, and stops retrying after `maxAttempts` (3).

## 6. Smoke test (do one real run)

1. Log in as a non-admin → create a post → confirm it shows **pending approval** and there's **no Approve button**.
2. Log in as an admin → **Approve** it → watch the Queue flip to `posted` within ~1–2 min, and verify the post on the IG account.
3. Trigger a password reset for a test user and confirm the email + reset page work.

There is no in-repo record of a confirmed live IG post yet — step 6 is the first
one to capture.
