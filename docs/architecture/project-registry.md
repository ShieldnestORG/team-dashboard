# Project Registry

The **project (repo) registry** is the single source of truth for every
repository in the Coherence Daddy ecosystem and which of them the team-dashboard
**control plane** can reach.

It is a static const-module, not a database table:
`server/src/services/repo-registry.ts` (exporting `REPO_REGISTRY: RepoEntry[]`
and `getRepoCounts()`). It mirrors the `api-registry.ts` pattern deliberately —
the inventory is small, hand-curated, and reviewed in PRs, so a migration +
table would be overhead with no payoff. To refresh a row, re-run
`git -C <localPath> remote get-url origin` and `git rev-parse --abbrev-ref HEAD`
and edit the const.

## The coupling model

Every repo is either **coupled** or an **island**.

- **Coupled (`coupled: true`)** — the repo sits behind the
  `https://api.coherencedaddy.com` HTTP bus, so the control plane can reach it
  over HTTP (today: a liveness ping; see `docs/api/control-plane.md`). These
  carry a `controlBase` of `https://api.coherencedaddy.com`.
- **Island (`coupled: false`)** — a repo we track for inventory only. It may be
  deployed and healthy, but the control plane has no HTTP path to it in v1.
  Islands have no `controlBase` and cannot be pinged.

This is **read-only v1**: the registry *describes* reality. It performs no git
writes and triggers no deploys. The architecture the owner chose was to *extend
the existing HTTP bus + a registry*, not to give the control plane git/SSH
write access to every repo.

## How the control plane reaches the 4 coupled repos

All four coupled repos are fronted by the same API host,
`https://api.coherencedaddy.com` (VPS4). The control plane reaches them by
issuing a bounded (5s timeout) HTTP `GET` to that host's readiness probe
(`/api/health/readiness`) and reporting `ok` + `status` + round-trip `ms`. It
never opens a shell, never clones, never pushes.

```
control-plane route ──HTTP GET (5s)──▶ https://api.coherencedaddy.com/api/health/readiness
                                       (shared bus fronting the 4 coupled repos)
```

## The registry

### Coupled repos (reachable via api.coherencedaddy.com)

| key | name | org | remote slug | role | deploy target |
|-----|------|-----|-------------|------|---------------|
| `team-dashboard` | Team Dashboard | ShieldnestORG | `team-dashboard` | full-clone | VPS4 (api.coherencedaddy.com) — hosts the control plane itself |
| `coherencedaddy-landing` | Coherence Daddy Landing | ShieldnestORG | `coherencedaddy` | full-clone | coherencedaddy.com (public marketing site) |
| `app-coherencedaddy-portal` | Coherence Daddy Portal | ShieldnestORG | `app-coherencedaddy-portal` | full-clone | app.coherencedaddy.com (customer/member portal) |
| `architect` | ARCHITECT | ShieldnestORG | `ARCHITECT` | full-clone | VPS4 (api.coherencedaddy.com bridge) |

### Islands (inventory-only; not control-plane reachable)

| key | name | org | remote slug | role | deploy target |
|-----|------|-----|-------------|------|---------------|
| `evntrace` | Evntrace | ShieldnestORG | `evntrace` | full-clone | standalone (Evntrace billing/forensics) |
| `freeflow` | Freeflow | ShieldnestORG | `freeflow` | full-clone | standalone (text-to-speech) |
| `Ladder` | Ladder | ShieldnestORG | `Ladder` | full-clone | standalone (pipeline/telemetry) |
| `Southern-Oregon-Law` | Southern Oregon Law | ShieldNEST | `Southern-Oregon-Law` | full-clone | standalone (client site) |
| `Personal_AI_Infrastructure` | Personal AI Infrastructure | ShieldNEST | `Personal_AI_Infrastructure` | full-clone | standalone (personal infra) |
| `autoresearch` | Autoresearch | Coherence-Daddy | `autoresearch` | full-clone | standalone (research harness) |
| `advisory-board` | Advisory Board | Coherence-Daddy | `advisory-board` | full-clone | standalone |
| `designer-skills` | Designer Skills | Owl-Listener | `designer-skills` | full-clone | standalone (skills repo) |
| `tx-xrpl-token-migrator` | TX XRPL Token Migrator | tokenize-x | `tx-xrpl-token-migrator` | full-clone | standalone (XRPL migration) |
| `txen_arcade` | TXEN Arcade | ShieldnestORG | `txen_arcade` | full-clone | standalone (txen.ai arcade) |
| `youtube-automation-agent` | YouTube Automation Agent | ShieldnestORG | `youtube-automation-agent` | full-clone | standalone (YouTube automation) |
| `toolsonhostinger` | Tools on Hostinger | ShieldnestORG | `toolsonhostinger` | full-clone | Hostinger (standalone tools) |

> Some local folder names differ from the repo key/slug — these are recorded in
> each entry's `notes` field. For example: `evntrace` lives under
> `Digital Forensics/`, `freeflow` under `Freeflow-text to speech/`,
> `autoresearch` under `CD-skill-research/`, `txen_arcade` under `txen.ai/`, and
> `youtube-automation-agent` under `youtube automation/`. The `remote` +
> `localPath` pair is the stable identity; `branch` is a point-in-time snapshot
> captured 2026-06-21.

## Roles

- **full-clone** — a normal checkout of the repo.
- **worktree** — a `git worktree` of a parent full-clone (grouped under its
  parent). `team-dashboard` has many sibling worktrees under `_wt/`; they share
  the same remote and are not listed individually in the registry.
- **non-git** — a tracked working folder that is not a git repo (none in v1).

## Counts

`getRepoCounts()` returns `{ total, coupled, byOrg }`, consumed by
`GET /api/control-plane/repos`:

- `total` — number of registry entries.
- `coupled` — entries with `coupled: true` (4 today).
- `byOrg` — entry count keyed by GitHub org (`ShieldnestORG`, `ShieldNEST`,
  `Coherence-Daddy`, `Owl-Listener`, `tokenize-x`).
