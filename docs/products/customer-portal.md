# Customer Portal — MVP

The customer portal is the first **customer-facing** (non-board) auth surface in
team-dashboard. Until this exists, every AEO upsell SKU has nowhere to send the
buyer after checkout — no place to manage credentials, no place to view
entitlements, no Stripe billing self-serve. This doc covers the shipped MVP.

> Status: shipped (Worker A, branch `feat/customer-portal-mvp`). Frontend under
> `app.coherencedaddy.com` is owned by Worker B; storefront-side magic-link
> email template (Resend) is owned by Worker C.

## Architecture

```
storefront / portal SPA  ──>  /api/portal/login          (POST email)
                                       │
                                       ▼
                          customer_magic_links row + Resend send
                                       │
   email link click ──>  /api/portal/auth?token=…  (302 + Set-Cookie)
                                       │
                                       ▼
                          customer_accounts row created on first login
                                       │
                          cd_portal_session cookie issued (HMAC SHA-256, 30 d)
                                       │
                                       ▼
                          /api/portal/me, /credentials, /stripe-portal
                          (session cookie verified per request)
```

### Tables (migration `0107_customer_portal.sql`)

| Table | Purpose |
|---|---|
| `customer_accounts` | Leaf actor identity. `email citext UNIQUE`, optional `stripe_customer_id` linkage. |
| `customer_magic_links` | Single-use tokens, 15-min TTL. Token is the PK. |
| `customer_credentials` | Per-account third-party creds (Cloudflare, Reddit, X, GA4). AES-256-GCM at rest. Soft-revoke. |
| `customer_action_log` | Append-only audit trail (`magic_link_issued`, `session_started`, `credential_added`, etc.). |

### Auth model

- **No passwords.** Magic-link only for V1. The HMAC-signed cookie is the only
  credential after consumption.
- **Cookie format:** `${accountId}.${expiryMs}.${hmacHex}` — verified with
  `timingSafeEqual` over equal-length buffers. Secret is `PORTAL_SESSION_SECRET`.
- **Cookie attributes:** `HttpOnly`, `SameSite=Lax`, `Secure` (off only in dev),
  `Domain=.coherencedaddy.com` (configurable via `PORTAL_COOKIE_DOMAIN`),
  `Max-Age=2592000` (30 d).
- **Single-use enforcement:** `consumeMagicLink` updates `consumed_at` with a
  `WHERE consumed_at IS NULL` predicate. The first racing request wins; the
  loser sees `null`.

### Credential storage

We deliberately **reuse** the existing AES-256-GCM helper from
`server/src/secrets/local-encrypted-provider.ts` (functions
`loadLocalEncryptionKey`, `encryptValue`, `decryptValue`,
`asLocalEncryptedMaterial`). The encrypted envelope is stored as a JSON string
in `customer_credentials.encrypted_value`; the master key comes from
`PAPERCLIP_SECRETS_MASTER_KEY` (or the on-disk `data/secrets/master.key` for
dev). Plaintext **never** crosses an API boundary — `GET /credentials` returns
only `{id, kind, createdAt}`. No "show value" affordance exists.

> **Hard rule:** never sell credential-paste SKUs (Cloudflare-pasted, Reddit
> bot, X poster, etc.) until the credential vault has been audited end-to-end:
> master-key rotation runbook, decryption authorization model, and an
> egress allowlist for outbound calls that use stored creds. The MVP gives us
> the schema and a safe pipeline; it does not authorize a public launch of any
> "paste your token" SKU until that audit lands.

## API surface (mounted at `/api/portal`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/login` | none | Body `{email}`. Always returns `{ok: true}` (no enumeration). Stores a `customer_magic_links` row and dispatches the email via the existing `sendCreditscoreEmail` callback (Worker C will switch this to a dedicated `portal_magic_link` template). |
| GET | `/auth?token=…` | none | Consumes token, sets cookie, 302 to `${PORTAL_BASE_URL}/`. Failures redirect to `/auth?error=…`. |
| POST | `/logout` | cookie | Clears cookie. |
| GET | `/me` | cookie | Returns `{account, entitlements: {creditscore, bundles}}`. Joins on email for creditscore; on `stripe_customer_id` for bundles. |
| GET | `/credentials` | cookie | Lists `{id, kind, createdAt}` only. Never plaintext. |
| POST | `/credentials` | cookie | Body `{kind, value}`. Soft-revokes any prior active credential of the same kind. |
| DELETE | `/credentials/:id` | cookie | Soft-revoke (sets `revoked_at`). |
| POST | `/stripe-portal` | cookie | Returns `{url}` for the Stripe Billing Portal. Fails 400 if no `stripe_customer_id` is linked. |

### Entitlement resolution

V1 resolves on **email** only (no multi-tenant workspaces yet):

1. **CreditScore** — joins `creditscore_subscriptions` on `LOWER(email) = LOWER(account.email)`,
   filters `status IN ('active','past_due','fulfilled')`, returns the most
   recent row.
2. **Bundles** — `bundle_subscriptions` is keyed by `company_id`, not email.
   We therefore join via `stripe_customer_id` once that linkage is set
   (Stripe webhook flow will populate `customer_accounts.stripe_customer_id`
   on first purchase). Until then, bundles return an empty list.

Future work (out of scope for MVP): a customer can have multiple companies and
a portal session can switch between them.

## Env vars

See [docs/deploy/env-vars.md](../deploy/env-vars.md) "Customer Portal" section.
TL;DR: `PORTAL_SESSION_SECRET` (required, ≥32 chars), `PORTAL_BASE_URL`
(default `https://app.coherencedaddy.com`), `PORTAL_MAGIC_LINK_TTL_MIN`
(default `15`), and the existing `PAPERCLIP_SECRETS_MASTER_KEY` for credential
encryption.

## Tests

`server/src/__tests__/portal-routes.test.ts` covers:
- `/login` writes a magic-link row and returns ok.
- `/login` rejects malformed emails with 400.
- `/auth` consumes a valid token, sets the cookie, 302s, and creates the
  `customer_accounts` row.
- `/auth` with an invalid token redirects with `?error=invalid_or_expired`.
- `/me` returns 401 without a cookie.
- `/me` returns the account and entitlements end-to-end after `/auth`.

Stripe and the email callback are mocked — the test surface is route +
service composition, not third-party integrations.

## Followups (handed off, not blocking)

- Worker B: portal SPA at `app.coherencedaddy.com` (Vercel) consuming the
  routes above. Login form, credentials manager, Stripe portal launcher.
- Worker C: dedicated `portal_magic_link` Resend template in
  coherencedaddy-landing; team-dashboard switches `sendCreditscoreEmail` call
  to the new kind once it exists.
- Stripe webhook side-effect: on `customer.created` / first purchase, set
  `customer_accounts.stripe_customer_id` so bundles resolve via the join.
- Multi-tenant workspaces: `portal_workspaces` + per-workspace credentials.
- Credential vault audit before any "paste-your-token" SKU is offered.
