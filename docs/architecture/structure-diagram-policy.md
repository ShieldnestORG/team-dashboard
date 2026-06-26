# Structure Diagram Policy — Team Dashboard

> **Cluster:** Architecture · **Tags:** mermaid, structure-diagram, auto-sync, topology, maintenance, vps · **Related:** [Project Structure](project-structure.md), [System Overview](system-overview.md), [Org Structure](org-structure.md), [Ownership Matrix](../OWNERSHIP.md)

## Overview

The company structure Mermaid diagram (rendered at `/structure`) is a **living document** and the single source of truth for the backend topology of the Team Dashboard. It must stay in sync with the codebase at all times.

## ⚡ Quick reference (the only thing you usually need)

**Single source of truth: [`docs/architecture/company-structure.mmd`](./company-structure.mmd)**

To update the diagram:

```bash
# 1. Edit the .mmd file
$EDITOR docs/architecture/company-structure.mmd

# 2. Commit + push to master (or your feature branch + merge)
git add docs/architecture/company-structure.mmd
git commit -m "chore(structure): <what changed>"
git push

# 3. Deploy (this triggers the auto-sync)
ssh root@31.220.61.14 'cd /opt/team-dashboard/repo && git pull && cd /opt/team-dashboard && docker compose up -d'
```

That's it. No API calls, no SQL, no JWT signing, no admin session. The server's `syncStructureDiagramFromRepo` runs at boot, hashes the file, and upserts the persisted document only if the content changed. Unchanged restarts don't bump the revision counter.

The UI also reads this same file directly (via Vite `?raw` import in `ui/src/pages/Structure.tsx`), so fresh installs render the up-to-date diagram from the start — no fallback drift to maintain.

## Maintenance rules

### 1. Mandatory updates

**Every structural change must include a corresponding update to the diagram.** A commit that adds, removes, or restructures any of the following must edit `company-structure.mmd` in the same PR:

- Backend services (new files in `server/src/services/`)
- API routes (new files in `server/src/routes/`)
- Cron jobs (newly added or modified schedules in `server/src/cron/`)
- Plugin services (new files in `plugins/*/server/`)
- Route mounting changes in `server/src/app.ts`
- Visual backends (newly added providers)

For each addition, also append a one-line dated changelog note to the `ECOSYSTEM OVERVIEW` comment block at the top of the .mmd file (the comment that begins `Last audited <DATE>`). This is the human-readable audit trail and must stay current.

### 2. Audit and fix

If you notice the diagram is stale, missing features, or has broken arrows during any session, fix it immediately in `company-structure.mmd`. Do not defer.

### 3. What's intentionally NOT in the diagram

- **Compose-level container hardening** (cap_drop, no-new-privileges, read_only) — config posture, not topology. Lives in [`docs/deploy/docker.md`](../deploy/docker.md).
- **Host-level cron jobs** (e.g. egress-watch on the VPSs themselves) — lives in [`docs/operations/cron-inventory.md`](../operations/cron-inventory.md) under "Host-level crons". The `EgressWatch` node IS shown under the Monitor subgraph because it's operationally significant; granular host-cron details are not.
- **Tailscale topology** — covered in [`docs/deploy/tailscale-private-access.md`](../deploy/tailscale-private-access.md).

## How the auto-sync works (under the hood)

Two components, defined in commit `c92ba1f5` (originally `0f17400d`):

1. **`server/src/services/structure-sync.ts`** — `syncStructureDiagramFromRepo(db, companyId)`:
   - Locates the .mmd file at `${cwd}/docs/architecture/company-structure.mmd`, falls back to `/app/docs/architecture/company-structure.mmd` (the path inside the Docker container).
   - Reads the file, computes a sha256-16 hash.
   - Calls `structureService.getDiagram(companyId)` to fetch the persisted version.
   - If hashes match → returns `{ status: "unchanged" }`, no DB write.
   - If different → calls `structureService.upsertDiagram(companyId, body, { changeSummary: "auto-sync from docs/architecture/company-structure.mmd (sha256:<hash>)" })` which inserts a new revision and updates the document head.
   - All writes happen under the **system actor** (no `agentId`, no `userId` — the createdBy columns stay null), so the auto-sync doesn't depend on a service-account agent existing in the `agents` table.

2. **Hooked into `startServer()` in `server/src/index.ts`** — fire-and-forget right next to `seedManagedInstructionsFromRepo`. Errors log via `logger.warn` but don't block boot, so a malformed .mmd file can't take the dashboard offline.

3. **UI side, `ui/src/pages/Structure.tsx`** — imports the .mmd file as a raw string via Vite (`import diagram from "../../../docs/architecture/company-structure.mmd?raw"`). The `vite/client` types declaration in `ui/src/vite-env.d.ts` makes this typesafe.

### Tests

`server/src/__tests__/structure-sync.test.ts` covers:
- Hash determinism
- Missing-file path
- Create-when-missing
- No-op-when-unchanged
- Upsert-when-changed

Run them after any change to the sync logic:

```bash
cd server && npx vitest run src/__tests__/structure-sync.test.ts
```

## Manual API push (legacy — only if auto-sync is disabled or for emergency override)

The `PUT /api/companies/:companyId/structure` endpoint still exists. Auth requirements:

- **Board API key** (the cleanest path) — mint one in Settings → API Keys for your user, send as `Authorization: Bearer <token>`. The actor is recorded as `type: "board"` with your `userId` for attribution.
- **Agent JWT** signed with `PAPERCLIP_AGENT_JWT_SECRET` — the `sub` claim must match a real `agents.id` UUID. The server middleware does a DB lookup to populate the actor; if the agent doesn't exist (or is `terminated`/`pending_approval`), the actor falls through to `none` and the route returns 401.

Use only when:
- Auto-sync is being intentionally bypassed (e.g., to test a one-off structural change without redeploying).
- The dashboard server isn't running and you need to seed the diagram against an empty DB.

For routine work, **always edit the .mmd file and let auto-sync do its thing** — that's the supported path.

## Common pitfalls

- **Editing `Structure.tsx`'s `DEFAULT_DIAGRAM` constant** — this constant no longer exists as of `c92ba1f5`. Structure.tsx imports `?raw` from the .mmd file. If you find `const DEFAULT_DIAGRAM = ...` in a stale branch, that's an outdated branch — rebase on master.
- **Forgetting to redeploy** — `git push` alone doesn't update the persisted DB. `docker compose up -d` on VPS4 has to run for the auto-sync to fire (because that's what triggers `startServer`).
- **Mermaid syntax errors silently failing** — the auto-sync pushes the file as-is; the UI is what fails to render if the syntax is broken. Run a quick balance check before commit:
  ```bash
  python3 -c "import re; src=open('docs/architecture/company-structure.mmd').read(); s=len(re.findall(r'(?m)^\\s*subgraph\\s', src)); e=len(re.findall(r'(?m)^\\s*end\\s*\$', src)); print('sub:',s,'end:',e,'ok:',s==e)"
  ```
- **Cherry-picking the auto-sync feature** to a stale branch will conflict with `Structure.tsx` (because the file changed shape). Resolve by taking the lean import-`?raw` version — never recreate the inline literal.

## Use `TEAM_DASHBOARD_COMPANY_ID`

The companyId for Coherence Daddy is hardcoded as the default in `structure-sync.ts`:
`8365d8c2-ea73-4c04-af78-a7db3ee7ecd4`. Override via `TEAM_DASHBOARD_COMPANY_ID` env var if syncing for a different company.
