# Test Isolation Under Parallel Runs — the macOS port-steal race

> **Cluster:** testing-infra · **Tags:** port-steal, supertest, EADDRINUSE, flaky-tests, useLocalServer, embedded-postgres, workspace-runtime · **Related:** [Branch & Session Safety](branch-safety.md), [Agents Runtime](../agents-runtime.md), [`supertest-server.ts` header](../../server/src/__tests__/helpers/supertest-server.ts)

This is the run-time companion to [branch-safety.md](branch-safety.md): that guide
prevents parallel *edits* from corrupting each other; this one prevents parallel
*test execution* from stealing each other's network ports. Both are "parallel work"
hazards, on different axes.

## The failure it prevents

Under parallel full-suite load, status- or body-shape assertions flaked — e.g.
`university-sessions` "patch a missing session → 404" intermittently got `200`
(in ~9ms), and branding checks saw `200 "ok"` where they expected `undefined`.
Not a query bug and not test-state coupling: a **foreign process answered the
request**.

**Mechanism (macOS-specific, proven by repro):** supertest handed a bare Express
app calls `listen(0)` per request, binding the **IPv6 wildcard `::`**, but always
dials `127.0.0.1:<port>`. macOS lets another process bind `127.0.0.1:<same port>`
*specifically* while the wildcard listener holds it — and the IPv4-specific
listener **steals the dial**. The thief was any test actor using the racy
"allocate a port on `127.0.0.1` → hold it unbound through a delay → bind it later"
pattern; `workspace-runtime`'s mock agents answer `200 "ok"` to anything, so a
stolen dial returns `200 "ok"`. Load-correlated because the steal window = the
actor's spawn delay, and the kernel's rolling ephemeral allocator wraps in seconds
under suite churn. One steal even returned the local Ollama desktop app's HTML.

## The rule (supertest — every server test)

**Never call `request(app)` with a bare Express app.** Route every request through
the shared 127.0.0.1-bound server:

```ts
import request from "supertest";
import { useLocalServer } from "./helpers/supertest-server";

const local = useLocalServer();                 // module or describe scope
const res = await request(local.via(app)).get("/path");
```

`useLocalServer()` binds **one** `http.Server` with `listen(0, "127.0.0.1")` in
`beforeAll` and re-points its handler per call. A same-family specific bind means a
thief gets `EADDRINUSE` instead of the traffic. Tests in a file run sequentially, so
re-pointing the handler is safe — **do not use `test.concurrent`** in a file that
shares the server. The authoritative rationale lives in the
[`supertest-server.ts` header comment](../../server/src/__tests__/helpers/supertest-server.ts).

The whole `server/src/__tests__` tree (44 files) is on this helper. To check for
regressions, there must be zero unwrapped call sites:

```bash
# pcre2 — matches request( that is NOT request(local.via(
rg -Pn '(?<![.\w])request\((?!local\.via\()' server/src/__tests__
```

## The deeper half (the late-binder actors themselves)

The four actors that allocate-then-late-bind were both the *thieves* and
steal-vulnerable themselves. `:0`-self-bind was ruled out wherever a `PORT`-env
contract exists; each site is fixed by its own constraint instead:

| Site | Fix |
|---|---|
| `packages/db/src/test-embedded-postgres.ts` | `startEmbeddedPostgresCluster()` — run **initdb first** (slow, never binds a port) so allocation happens immediately before postgres binds (window: seconds → ms), and **retry on a fresh port** when startup logs show a bind conflict. Postgres can't listen on `:0`, so allocate-late + retry is the play. Exported from `@paperclipai/db`. |
| `server/src/__tests__/helpers/embedded-postgres-no-pgvector.ts` | Dropped its duplicate allocator; reuses the shared cluster helper. |
| `server/src/services/workspace-runtime.ts` (**production**) | Keeps the `PORT`-env contract. Spawn wrapped in a retry loop (max 3): a nonzero-exit `close` carrying `EADDRINUSE` races `waitForReadiness`; on conflict, respawn on a fresh port. A **settle-recheck** (hold until the startup window closes, then re-check the conflict flag) defeats a squatter that answers the readiness probe `ok` *before* the real child finishes crashing. |
| `cli/src/__tests__/company-import-export-e2e.test.ts` | Healthcheck requires the app's health shape (`status === "ok"`, not any `200`) so a squatter can't satisfy it; server spawn wrapped in respawn-on-`EADDRINUSE` (max 3). |

## Verifying against the race

Baseline green is not enough — verify under a hostile stale-binder loop:

- **Steal engine:** children that probe a `127.0.0.1` port the racy way
  (`listen(0)` → close), wait a beat, then re-bind it with a `200 "ok"` HTTP server
  and hold it — plus ephemeral-port churners to recycle port numbers.
- Run the target suites repeatedly under 8 stale-binders + 4 churners; expect 0
  failures. For the retry paths, a **deterministic proof** is cleaner than
  probability: a mock that binds an already-held blocker port on its first spawn
  (guaranteed `EADDRINUSE`) must retry and serve the correct marker on a fresh port.

## Status

Both halves are implemented and hostile-verified (full server suite green; target
suites green under attack; deterministic retry-recovery proven). As of 2026-07-02
the changes are **uncommitted on `master`** (owner's commit gate). When they ship,
add a `[Unreleased]` → dated entry to [CHANGELOG.md](../../CHANGELOG.md).
