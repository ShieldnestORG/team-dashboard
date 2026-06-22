---
title: Control Plane
summary: Read-only admin view of the repo registry and coupled-repo liveness
---

The control plane exposes the project (repo) registry to board operators and
lets them probe whether the 4 **coupled** repos are reachable over the
`https://api.coherencedaddy.com` HTTP bus.

- **Auth:** admin/board only. Every route requires `req.actor.type === "board"`;
  anything else gets `401 { "error": "Admin only" }`.
- **Read-only v1:** these endpoints perform **no git writes** and trigger no
  deploys. The registry describes reality (see
  `docs/architecture/project-registry.md`); the only outbound action is a
  bounded HTTP liveness ping. This matches the owner's chosen architecture —
  *extend the HTTP bus + registry*, not give the control plane write access.
- **Backing store:** the static const-module
  `server/src/services/repo-registry.ts` (`REPO_REGISTRY`). There is no DB
  table for the registry.

Mounted at `/api/control-plane`.

## List repos

```
GET /api/control-plane/repos
```

Returns the full registry plus top-line counts.

```jsonc
{
  "repos": [ /* RepoEntry[] */ ],
  "counts": {
    "total": 16,
    "coupled": 4,
    "byOrg": { "ShieldnestORG": 10, "ShieldNEST": 2, "Coherence-Daddy": 2, "Owl-Listener": 1, "tokenize-x": 1 }
  }
}
```

`RepoEntry`:

| field | type | notes |
|-------|------|-------|
| `key` | string | stable identifier (path param for the other routes) |
| `name` | string | display name |
| `remote` | string | git remote URL |
| `org` | string | GitHub org |
| `localPath` | string | working-copy path on the dev machine |
| `role` | `"full-clone" \| "worktree" \| "non-git"` | checkout kind |
| `branch` | string | point-in-time snapshot of the checked-out branch |
| `deployTarget` | string | where it runs |
| `coupled` | boolean | reachable by the control plane over HTTP |
| `controlBase` | string? | present only when `coupled` (always `https://api.coherencedaddy.com` today) |
| `notes` | string? | e.g. when the local folder name differs from the key |

> The `counts.byOrg` numbers above are illustrative; the response reflects the
> live `REPO_REGISTRY` contents.

## Get one repo

```
GET /api/control-plane/repos/{key}
```

Returns a single `RepoEntry`. Responds `404 { "error": "Unknown repo" }` if the
`key` is not in the registry.

## Ping a coupled repo

```
POST /api/control-plane/repos/{key}/ping
```

Issues a bounded (5s timeout) HTTP `GET` to the repo's `controlBase` readiness
probe (`/api/health/readiness`) and reports liveness. Mirrors the
system-health api-routes ping. Only valid for **coupled** repos.

Success (200):

```jsonc
{
  "key": "team-dashboard",
  "controlBase": "https://api.coherencedaddy.com",
  "ok": true,
  "status": 200,
  "ms": 142
}
```

On a failed/timed-out request the route still returns 200 with `ok: false` and
the elapsed `ms` (no `status`). It never throws.

Error cases:

- `404 { "error": "Unknown repo" }` — unknown `key`.
- `400 { "error": "Repo is not coupled to the control plane", "key": "<key>" }`
  — the repo is an island (`coupled: false`) and has no `controlBase`, so there
  is nothing to ping.

## Use cases

- Board operators: inventory every repo in the ecosystem and confirm the
  coupled surfaces are up, from one admin page.
- Onboarding: a single authoritative list of repos, orgs, deploy targets, and
  which ones the control plane can reach.

## Future work

- v2 may add control actions (re-deploy, branch info) for coupled repos over the
  same HTTP bus. v1 is intentionally read-only.
