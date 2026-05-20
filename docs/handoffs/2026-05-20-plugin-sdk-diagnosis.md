# `@paperclipai/plugin-sdk` missing-module diagnosis

**Date:** 2026-05-20
**Author:** read-only diagnostic pass
**Status:** Diagnosis complete. No code change required on `master`. Already-open PR #61 lands the doc fix.

## tl;dr

1. The "65 pre-existing TypeScript errors on master" are **a verification-command artifact**, not a real regression. `master` is healthy.
2. `@paperclipai/plugin-sdk` lives at `packages/plugins/sdk/`, is a workspace member, and has never been deleted or renamed. Its `dist/` is just not built in a fresh checkout.
3. Open PR #61 (`chore/dx-pnpm-build-note-and-portal-secret-boot-check`) already updates CLAUDE.md's "Verify Before Merge" section with the missing `pnpm install && pnpm -r build` prerequisite — **just merge it**.

## Outcome: C (with a wrinkle)

> **C) Package exists but workspace linking is broken** → fix is a `pnpm install` / workspace config tweak.

The wrinkle: the workspace config is fine. What's missing is the **prerequisite build step** for workspace packages that export from `dist/`. The `CLAUDE.md` verify-before-merge snippet documents the tsc command but omits the `pnpm -r build` that must precede it.

## Timeline

| When | Commit | Event |
|---|---|---|
| (initial) | `80cdbdbd` "Add plugin framework and settings UI" | `packages/plugins/sdk/package.json` added with name `@paperclipai/plugin-sdk` |
| later | `0d4dd50b` "feat(plugins): add document CRUD methods to Plugin SDK" | feature add |
| later | `56985a32` "fix(plugins): address Greptile feedback on testing.ts" | fix |
| later | `4d22bc48` "fix(plugin-sdk): runWorker realpath-compares entrypoint to handle symlinked plugin packages" | most recent SDK-touching commit |
| 2026-05-13 | PR #61 opened | Documents the phantom-error trap in CLAUDE.md |

`git log --all --diff-filter=D --summary | grep plugin-sdk` returns nothing. The package was never deleted on any branch.

## Current state

### What imports `@paperclipai/plugin-sdk`

In `server/src/`:

- `app.ts:149`
- `services/plugin-host-services.ts` (16 errors all of form "parameter 'params' implicitly any" — these are downstream of the unresolved `ExecuteToolParams` import type, not independent bugs)
- `services/plugin-tool-dispatcher.ts:30`
- `services/plugin-tool-registry.ts:26` — imports `ToolRunContext, ToolResult, ExecuteToolParams`
- `services/plugin-worker-manager.ts:39,50`

Plus every plugin package (`packages/plugins/plugin-*`, `packages/plugins/examples/*`) declares `"@paperclipai/plugin-sdk": "workspace:*"`.

### Why tsc says "Cannot find module"

`packages/plugins/sdk/package.json` uses subpath `exports`:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  ...
}
```

There is no `"main"` / `"types"` at the top level — TS module resolution will only find type declarations via `./dist/index.d.ts`. In this worktree:

```
$ ls packages/plugins/sdk/dist/
(empty)
```

The build never ran, so the `.d.ts` files don't exist, so tsc can't resolve the module, so every site importing it errors. The 16 implicit-any errors in `plugin-host-services.ts` are *cascade* failures from `params` being typed against the unresolved `ExecuteToolParams`.

### Verify-before-merge snippet is incomplete

`CLAUDE.md` (lines 23–29) says:

```bash
npx tsc --noEmit --project server/tsconfig.json
cd ui && npx tsc --noEmit
```

But `server/package.json` knows better — its own `typecheck` script is:

```json
"typecheck": "pnpm --filter @paperclipai/plugin-sdk build && tsc --noEmit"
```

i.e. build the SDK first. Running raw `npx tsc` skips that build step. **That is the entire source of the 65-error baseline.** Running `pnpm install && pnpm -r build && npx tsc --noEmit --project server/tsconfig.json` → 0 errors (per PR #61's test plan, which was verified).

### How the WIP branch relates

`feat/site-metrics-product-revenue` is a UI/affiliate redesign. It deletes `ui/src/components/cd/CDPrimitives.tsx`, `ui/src/pages/WatchtowerAdmin.tsx`, etc., and modifies `ui/src/pages/Affiliate*`. **It does not touch:**

- `packages/plugins/sdk/`
- `pnpm-workspace.yaml`
- root `package.json`
- `server/package.json`
- any `server/src/services/plugin-*` file

Confirmed via `git diff master origin/feat/site-metrics-product-revenue --name-only | grep -i plugin` → empty.

There's no risk of stepping on the user's WIP from anything in this area.

## Recommendation

**Merge PR #61** (`chore(dx): fail-loud PORTAL_SESSION_SECRET check + pnpm build note in CLAUDE.md`).

It is already authored, already has the right diagnosis in its body ("a fresh `pnpm install` doesn't build workspace packages, so `@paperclipai/plugin-sdk` and `@paperclipai/shared` have no `dist/`. Running `pnpm -r build` first → 0 errors"), and the changeset is 2 files / 18 lines.

### Why no separate surgical PR is warranted

- Code: nothing is broken. No source file needs editing.
- Config: `pnpm-workspace.yaml` correctly includes `packages/plugins/*` (which globs `packages/plugins/sdk/`). No change needed.
- Docs: PR #61 already does this. Filing a competing doc PR would duplicate work and create a merge ordering question.

### What NOT to do

- Do **not** edit `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, or any `server/src/services/plugin-*.ts` file. They are correct.
- Do **not** delete the imports in `plugin-tool-registry.ts` etc. — the SDK is live and these consumers are intentional.
- Do **not** add a `"main"` / `"types"` fallback to `packages/plugins/sdk/package.json`. Subpath exports are the deliberate public-API surface (see PR history around the `exports` map).
- Do **not** wait for `feat/site-metrics-product-revenue` — it is unrelated and merging PR #61 will not conflict with it.

## Evidence appendix

```bash
# Package exists, is a proper workspace member
$ cat packages/plugins/sdk/package.json | head -3
{
  "name": "@paperclipai/plugin-sdk",
  "version": "1.0.0",

# Dist is empty (the actual problem)
$ ls packages/plugins/sdk/dist/
(empty / does not exist)

# Workspace glob covers it
$ cat pnpm-workspace.yaml
packages:
  - packages/*
  - packages/adapters/*
  - packages/plugins/*      # <-- covers packages/plugins/sdk
  ...

# No deletion history
$ git log --all --diff-filter=D --summary | grep plugin-sdk
(no output)

# WIP branch is unrelated
$ git diff master origin/feat/site-metrics-product-revenue --name-only | grep -i plugin
(no output)
```
