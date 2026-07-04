# Eagan Access — Owner Runbook (mint / revoke / rotate / audit)

> **Cluster:** team-dashboard access control · **Tags:** eagan, board-api-key, cli-auth, key-expiry, audit-log, marketing-role, mcpb · **Related:** [Eagan Desktop Setup](eagan-desktop-setup.md), [Funnel Library](products/funnels-library.md)

Owner-side operations for the external-marketing ("Eagan") access layer.
The enforcement is all pre-existing server code: board API keys
(sha256-hashed, revocable) + the fail-closed `marketingRoleGate` path
allowlist + admin-only mutations. The extension on Eagan's machine is just
a REST client — nothing here trusts it.

Set once for the commands below:

```bash
API=https://api.coherencedaddy.com
```

## 1. One-time: Eagan's account

1. Invite Eagan as a board user with membership role **`marketing`** on the
   dashboard company (staff-admin UI, or the invite flow's
   `defaultsPayload.human.membershipRole: "marketing"`).
2. After signup, **verify his ONLY membership role is `marketing`** — a
   mixed elevated role (owner/root/admin anywhere) lifts the gate by
   design. Quick check: have him (or you, with his key later) call
   `GET /api/cli-auth/key-info` and confirm `memberships` shows only
   `role: "marketing"` and `isInstanceAdmin: false`.

## 2. Mint the key (90-day expiry — owner directive)

The CLI-auth challenge flow, approved with the `keyTtlDays` override
(default stays 30; the schema caps it at 90).

**Key fact that shapes this flow:** approval binds the key to the
**approving** user — the key inherits the APPROVER's memberships on every
request. So the 90-day key must be approved by EAGAN's (non-admin,
marketing) identity, not yours.

> **This is enforced, not just advised (HIGH-1).** The server **rejects**
> any `keyTtlDays > 30` when the approver is an instance admin, with:
> *"Long-lived keys must be approved by the key's own (non-admin) session,
> not an admin."* If you (an admin) try to approve the 90-day challenge
> directly, you'll get a 403 — that's expected. The bootstrap below routes
> approval through Eagan's own non-admin key, which is exactly why it works.
> (The 30-day default path is unaffected for any approver, admin included.)

The UI approval page doesn't send `keyTtlDays` (it mints the 30-day
default), so the 90-day mint is a two-step bootstrap you can run
end-to-end yourself:

```bash
# --- Step A: bootstrap key (30-day, via the normal UI click) -------------
curl -s -X POST "$API/api/cli-auth/challenges" \
  -H 'Content-Type: application/json' \
  -d '{"command":"eagan-claude bootstrap","clientName":"eagan-claude","requestedAccess":"board"}'
# → SAVE the response: { id, token, boardApiToken: KEY_A, approvalUrl, ... }

# Send approvalUrl to Eagan; he clicks Approve while signed in.
# KEY_A is now a live 30-day key bound to EAGAN's identity — and you
# already hold it (it came back in the challenge-create response).

# --- Step B: the real 90-day key, approved AS EAGAN via KEY_A ------------
curl -s -X POST "$API/api/cli-auth/challenges" \
  -H 'Content-Type: application/json' \
  -d '{"command":"eagan-claude desktop (90d)","clientName":"eagan-claude","requestedAccess":"board"}'
# → SAVE: { id: ID_B, token: TOKEN_B, boardApiToken: KEY_B, ... }

curl -s -X POST "$API/api/cli-auth/challenges/<ID_B>/approve" \
  -H "Authorization: Bearer <KEY_A>" \
  -H 'Content-Type: application/json' \
  -d '{"token":"<TOKEN_B>","keyTtlDays":90}'
# → { approved: true, keyId, keyExpiresAt: "<~90 days out>" }
#   (approver = KEY_A's user = Eagan, so KEY_B is Eagan-scoped)

# --- Step C: retire the bootstrap key ------------------------------------
curl -s -X POST "$API/api/cli-auth/revoke-current" -H "Authorization: Bearer <KEY_A>"

# --- Step D: sanity-check the 90-day key ---------------------------------
curl -s "$API/api/cli-auth/key-info" -H "Authorization: Bearer <KEY_B>"
# → daysRemaining ≈ 90, memberships [{ role: "marketing" }], isInstanceAdmin false
```

Deliver `boardApiToken` to Eagan **out-of-band** (one-time-secret link,
not email/Slack paste), together with the `.mcpb` file (§5).

## 3. Revoke / rotate / extend

> **⚠️ A COMPLETE cutoff needs BOTH actions: (1) revoke the key id AND
> (2) remove the `marketing` membership** (or wait for expiry). Neither alone
> is sufficient, for two different reasons:
>
> - **Revoke-only is not enough.** While the `marketing` membership exists,
>   any *other* live key Eagan (or a leaker) still holds can mint a fresh
>   replacement key through the challenge flow (the same non-admin-approves-
>   non-admin mechanism the §2 bootstrap uses). Revoking one key id is
>   whack-a-mole against a determined/compromised holder.
> - **Membership-removal-only is not enough.** Removing the membership
>   instantly kills every *company-scoped* operation — voice generation
>   (`POST /api/voice-snippets` calls `assertCompanyAccess`), the media-bytes
>   asset endpoint, and any per-company read — AND it stops new keys being
>   minted. BUT a still-valid (un-revoked, un-expired) key keeps **read**
>   access to the socials hub: `/api/socials/*` and `/api/voice-snippets/health`
>   gate only on `actor.type === "board"` + the hardcoded
>   `TEAM_DASHBOARD_COMPANY_ID`, with **no per-caller company-scope check**, so
>   a membership-less board key can still read accounts, funnels, drafts,
>   daily briefs, and inspiration. (This is a **pre-existing property of those
>   routes** — the socials surface was built as a single-company board-level
>   read surface; this feature did not introduce it. It's why you must also
>   revoke the key, not a bug in this branch.)
>
> **So the definitive lockout is: revoke the key id, then remove the
> membership.** Revoke closes the open socials-read door on the key you know
> about; membership-removal closes company-scoped ops and blocks re-minting a
> new key. (Long-lived keys can never carry admin power — HIGH-1 blocks an
> admin from approving a >30-day key — so the blast radius stays
> marketing-only throughout.)

The kill switches:

```bash
# EMERGENCY / compromised holder — do BOTH, in this order:
# 1) Revoke the key id (closes the still-open socials-read surface on it).
curl -s -X POST "$API/api/cli-auth/revoke-current" -H "Authorization: Bearer <the key>"
#    (or admin-revoke by key id via revokeBoardApiKey — staff admin surface / DB —
#     if you don't hold the raw key.)
# 2) Remove his `marketing` membership (or delete the user) — kills
#    company-scoped ops instantly and prevents re-minting a new key.
#    Done via the staff-admin UI / membership table.
```

Ordering rationale, weak → strong:

- **(weak, alone) Revoke ONE key id** (`revoke-current` / admin
  `revokeBoardApiKey`): stops THAT key entirely, but a live membership can
  re-mint. Fine for routine rotation; NOT a full cutoff by itself.
- **(weak, alone) Remove the `marketing` membership**: kills company-scoped
  ops + blocks re-minting instantly, but leaves any un-revoked key reading the
  socials hub until it expires. NOT a full cutoff by itself.
- **(definitive) BOTH — revoke the key id AND remove the membership**: no
  socials read, no company-scoped op, no re-mint. This is the real lockout.
- **(passive backstop) Do nothing**: the key self-expires (`expiresAt`,
  checked every lookup) in ≤90 days — a backstop, never a response to a leak.

**Rotate** = mint a new key (§2) → Eagan swaps it in
Settings → Extensions → settings form → revoke the old one.

**Extend** = same as rotate. `keyTtlDays` applies at MINT time only; an
existing key's expiry is never retro-extended (idempotent re-approve
keeps the stored expiry).

**Countdown:** Eagan's tools warn him automatically at ≤14 days
remaining on every tool call (data from `GET /api/cli-auth/key-info`),
so expect his ping around then.

## 4. Read the audit trail

Every call on `/api/socials/*` and `/api/voice-snippets/*` (plus the rest
of the admin surface) writes an `admin_access_log` row: actor id + type,
method, path, status, duration, and a **redacted** request shape (keys +
value kinds — never values). Retention: 90 days (daily purge cron).

```sql
-- Everything Eagan's identity did, newest first:
SELECT created_at, method, path, status_code, duration_ms, request_summary
FROM admin_access_log
WHERE actor_id = '<eagan auth_users.id>'
ORDER BY created_at DESC
LIMIT 200;

-- Anonymous probes against the marketing surfaces (leaked-URL sniffing):
SELECT created_at, method, path, status_code
FROM admin_access_log
WHERE actor_type = 'none' AND (path LIKE '/api/socials%' OR path LIKE '/api/voice-snippets%')
ORDER BY created_at DESC;
```

## 5. Build + hand over the extension

```bash
pnpm --filter @paperclipai/mcp-server build:mcpb
# → packages/mcp-server/dist-mcpb/team-dashboard-marketing.mcpb
```

The bundle is fully self-contained (esbuild inlines all deps); Eagan needs
only Claude Desktop. Install steps + the custom-instructions block he
pastes into his Claude live in [eagan-desktop-setup.md](eagan-desktop-setup.md)
— including the **"OWNER FILLS IN: content guidelines"** placeholder that
is waiting for your brand/content rules.

## 6. What the key can and cannot do (reference)

Can: read funnels/catalog/coverage/hook-posts, caption styles,
inspiration, briefs, accounts, Zernio analytics reads; generate ≤200 new
voice clips/day (voices server-fixed, ElevenLabs key never leaves the
server); create `pending_approval` drafts; upload staged media; add
inspiration items; cancel his own drafts.

Cannot: publish or approve anything, touch funnels/accounts/automations/
settings/users/costs/secrets (403 from `marketingRoleGate` or
`requireAdmin`), see `oauthRef`s, or reach any non-allowlisted `/api`
path. Blast radius on leak = the "can" list above until revocation.
