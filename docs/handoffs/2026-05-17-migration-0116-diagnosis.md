# `/admin-impersonate` 500 — Root-Cause Diagnosis

> **Cluster:** Handoffs · **Tags:** diagnosis, migration, admin-impersonate, neon-db, portal · **Related:** [Portal Smoke Test](2026-05-17-portal-smoke.md), [Docs Index](../README.md)

**Date:** 2026-05-17
**Author:** read-only diagnostic pass (no prod changes)
**Trigger:** PR #76 smoke test reported `POST /api/portal/admin-impersonate`
returning 500 instead of the spec'd 401.

## TL;DR

**Outcome: A.** Migration `0116_admin_impersonation.sql` has not been
applied to VPS4's Neon DB. The team-dashboard container is running the
new application code (PR #69's route handler is reachable, returns 500
instead of 404), but the table `admin_impersonation_nonces` that the
handler queries does not exist, so every exchange attempt throws and
hits the generic catch.

**One-shot remediation (run on a laptop with prod creds in `.env`):**

```bash
# From the team-dashboard repo root, with DATABASE_URL pointed at prod Neon:
DATABASE_URL="$(grep ^DATABASE_URL /path/to/prod/.env.production | cut -d= -f2-)" \
  pnpm db:migrate
```

That is the only action needed. Migration `0116` is idempotent
(`CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`), so re-running
is safe even if some other path partially applied it.

After it runs, re-curl:

```bash
curl -sS -i -X POST https://api.coherencedaddy.com/api/portal/admin-impersonate \
  -H 'Content-Type: application/json' -d '{"nonce":"deadbeef"}'
# Expected: 401 {"error":"Invalid or expired nonce"}
```

No container restart needed — the route handler creates a fresh DB
connection per request, so the new table is visible immediately.

---

## Evidence

### 1. Reproduce the 500 (read-only curl, no auth)

```
$ curl -sS -i -X POST https://api.coherencedaddy.com/api/portal/admin-impersonate \
    -H 'Content-Type: application/json' -d '{"nonce":"deadbeef"}'
HTTP/1.1 500 Internal Server Error
Server: nginx
Content-Type: application/json; charset=utf-8
X-Powered-By: Express

{"error":"Exchange failed"}
```

The body `{"error":"Exchange failed"}` is the literal string from
`server/src/routes/portal.ts:566` — the **catch-block** of the exchange
handler. The non-error path returns either 400 (`"nonce required"`),
401 (`"Invalid or expired nonce"`), or 200 with `{ok:true, ...}`. The
only way to land in the catch is for `impSvc.exchangeNonce(nonce)` to
throw.

`exchangeNonce` does exactly one thing that can throw: it issues an
`UPDATE admin_impersonation_nonces SET burned_at = ... WHERE ...`.
That table is created **only** by migration `0116_admin_impersonation.sql`.
If the table is missing, Postgres returns `42P01: relation
"admin_impersonation_nonces" does not exist` and the catch logs +
returns 500.

Companion endpoint sanity check:

```
$ curl -sS -i https://api.coherencedaddy.com/api/portal/admin-impersonate/status
HTTP/1.1 200 OK
{"active":false}
```

The status handler does NOT touch the new table (it only verifies a
cookie via HMAC), which is why it returns 200. This rules out a generic
route-mounting bug and isolates the failure to a DB call on the new
table.

### 2. Migration 0116 (file is on disk, content is clean)

`packages/db/src/migrations/0116_admin_impersonation.sql`:

```sql
CREATE TABLE IF NOT EXISTS admin_impersonation_nonces (
  nonce                  text        PRIMARY KEY,
  admin_actor_id         uuid        NOT NULL,
  admin_actor_label      text,
  target_account_id      uuid        NOT NULL,
  target_customer_label  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  expires_at             timestamptz NOT NULL,
  burned_at              timestamptz
);

CREATE INDEX IF NOT EXISTS admin_impersonation_nonces_expires_idx
  ON admin_impersonation_nonces (expires_at);

CREATE INDEX IF NOT EXISTS admin_impersonation_nonces_target_idx
  ON admin_impersonation_nonces (target_account_id);
```

Fully additive, all `IF NOT EXISTS`, no `DROP`, no constraints that
depend on un-migrated tables. It will succeed cleanly on the prod DB.

### 3. Route handler's dependency on the new table

`server/src/routes/portal.ts:514-568` — the exchange route:

```ts
router.post("/admin-impersonate", async (req, res) => {
  // ... parse nonce ...
  try {
    const result = await impSvc.exchangeNonce(nonce);
    if (!result) {
      res.status(401).json({ error: "Invalid or expired nonce" });
      return;
    }
    // ...success path...
  } catch (err) {
    logger.error({ err }, "portal/admin-impersonate: exchange failed");
    res.status(500).json({ error: "Exchange failed" });   // <-- prod hits this
  }
});
```

And `server/src/services/admin-impersonation.ts:193-203` — the only
thing that throws inside `exchangeNonce`:

```ts
const claim = await db
  .update(adminImpersonationNonces)              // table from migration 0116
  .set({ burnedAt: now })
  .where(
    and(
      eq(adminImpersonationNonces.nonce, nonce),
      isNull(adminImpersonationNonces.burnedAt),
      sql`${adminImpersonationNonces.expiresAt} > ${now}`,
    ),
  )
  .returning();
```

`adminImpersonationNonces` is the drizzle binding for the new table.
Schema file: `packages/db/src/schema/admin_impersonation.ts`. If the
underlying table does not exist, this is a hard SQL error.

### 4. The route handler IS deployed (rules out "old image")

Both the route handler AND migration 0116 ship together in commit
`4fb5d9b0` (PR #69, merged 2026-05-17T03:25:08Z). The fact that the
prod backend returns `{"error":"Exchange failed"}` (a 500 with the new
catch body) — instead of `{"error":"API route not found"}` (the 404 that
old code would emit) — proves the new image was deployed.

So:
- new code: yes
- new migration sql file (in the image): yes (shipped together)
- new table in prod DB: **no**

### 5. Deploy path inspection — why didn't auto-apply run?

`scripts/predeploy.sh` only verifies DNS resolves to `31.220.61.14`.
It does NOT run migrations. It prints the recommended deploy command,
which is just:

```bash
ssh root@31.220.61.14 'cd /opt/team-dashboard/repo && git pull && \
  cd /opt/team-dashboard && docker compose build && docker compose up -d && \
  docker image prune -f && docker container prune -f && docker builder prune -f'
```

Migrations are NOT run as a separate step. The application is expected
to auto-apply them on boot when `PAPERCLIP_MIGRATION_AUTO_APPLY=true` is
set. `server/src/index.ts:144-167` shows the boot flow:

- If `PAPERCLIP_MIGRATION_AUTO_APPLY=true` → apply pending migrations,
  log "Applying N pending migrations", continue boot.
- If unset and there are pending migrations → throw + refuse to start.

The example compose at `docs/deploy/vercel-vps-split.md:66` sets it:

```yaml
PAPERCLIP_MIGRATION_AUTO_APPLY: "true"
```

But: prod is up (health returns 200), and the new route is reachable.
There are only three plausible explanations:

1. **`PAPERCLIP_MIGRATION_AUTO_APPLY` is not actually set in
   `/opt/team-dashboard/docker-compose.yml` on VPS4** (drift between
   docs and reality). The server logic in `index.ts:158-161` would
   then refuse to start — except the prior boot was already past
   journal idx 50 / 0109 and somehow `inspectMigrations` returned
   `upToDate` for the running container. This is most likely if the
   container was last rebuilt before 0116 shipped and has been running
   continuously since.

2. **`PAPERCLIP_MIGRATION_AUTO_APPLY=true` IS set, but the container
   has not been restarted since the post-#69 deploy.** `git pull &&
   docker compose up -d` with image caching would replace the image
   only if Dockerfile inputs changed. If it picked up the new build
   but the old container wasn't recreated (no `--force-recreate`),
   `ensureMigrations` never re-ran. This is the most likely root cause
   given the symptom set.

3. **The migration was rejected by Postgres at apply time and the
   error was swallowed.** Code review of `applyPendingMigrationsManually`
   (`packages/db/src/client.ts:238-285`) shows it does NOT swallow
   errors — a failed migration throws and crashes boot. So this is
   ruled out (the container would not be serving traffic).

Explanation (2) is the most consistent with all evidence: new image
was built (new code is live), but `docker compose up -d` reused the
existing running container instead of recreating it, so the boot
sequence that includes `ensureMigrations` never ran with the new
migrations folder.

### 6. Migration journal cross-check (not the bug, just a note)

`packages/db/src/migrations/meta/_journal.json` only contains entries
through idx 50 (`0050_tough_forge`). Migrations 0107–0116 are present
as `.sql` files on disk but are NOT in the drizzle journal. This is
fine — `client.ts` has a manual-apply fallback that scans the filesystem
(`listMigrationFiles`) and applies any pending files, with hash-based
deduplication against `__drizzle_migrations`. The journal-gap is
not the root cause; it has been this way since at least 0107 and prior
admin migrations (`0114_admin_access_log.sql`) clearly applied
successfully (the admin access log feature works in prod).

### 7. Recent migration-ordering history (informational)

Commit `4fa13901 fix(admin): renumber migration 0113 → 0114 to avoid
collision with PR #64`. There was a numbering collision that was
resolved before any of these migrations shipped to prod, so no journal
drift on the prod DB.

---

## Remediation

### Recommended (one shot, no SSH needed)

The Neon connection string in `.env.production` on VPS4 (or wherever
the human has a copy) lets you run the migration from any machine:

```bash
cd /path/to/team-dashboard
# Use the same DATABASE_URL the running container uses.
# Easiest: scp /opt/team-dashboard/.env.production from VPS4, source it.
DATABASE_URL="postgresql://...@...neon.tech/..." pnpm db:migrate
```

`pnpm db:migrate` calls `packages/db/src/migrate.ts`, which uses the
same `applyPendingMigrations` path the container uses on boot — so
this is byte-for-byte equivalent to what auto-apply would have done.

Verify with the curl from §1 — expect a `401` after.

### Alternative (recreate the container, which is also free)

If a redeploy is already on the agenda, force-recreate the container
so boot-time auto-apply runs:

```bash
ssh root@31.220.61.14 \
  'cd /opt/team-dashboard && docker compose up -d --force-recreate server'
```

This is cleaner than `pnpm db:migrate` because it also surfaces any
future migration issues at boot. But it requires SSH; the laptop-side
`pnpm db:migrate` does not.

### Followup: make this not happen again

The deploy command in `docs/deploy/production.md` should be:

```bash
... && docker compose up -d --force-recreate ...
```

…instead of:

```bash
... && docker compose up -d ...
```

Otherwise a built-but-not-restarted server is the default outcome of
the documented playbook. This is a docs-only one-line change; not
included in this diagnosis PR to keep the surface minimal. Spawn a
followup if the human agrees with the diagnosis.

---

## What this PR contains

- This document only.
- No code changes. No migration changes. No deploy.
