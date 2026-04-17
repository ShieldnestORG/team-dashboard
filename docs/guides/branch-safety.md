# Branch & Session Safety — Team Dashboard

## Concurrent Session Rule
**Never run multiple agent sessions editing the same branch simultaneously.**

Due to the nature of automated linting and import management, concurrent edits to the same file can lead to "phantom" deletions of new code. For example, an agent in Session A might add an import, while an agent in Session B runs a linter that removes the "unused" import before Session A's code is actually committed. This can lead to unstable builds and breaking changes in production.

### Rules for Parallel Work
If two or more agents need to work in parallel, they MUST use one of the following:
1. **Feature Branches**: Create a dedicated branch for the feature (e.g., `git checkout -b feat/my-feature`).
2. **Worktrees**: Use the `/worktree` command to create an isolated git worktree.

## Feature Branch Requirements
Any work that introduces the following must be performed on a feature branch, not directly on `master`:
- New backend services
- New API routes
- New database migrations
- Significant refactors of core systems

## Safe Workflow for Large Features
To ensure stability, follow this workflow:
1. **Create Feature Branch**: `git checkout -b feat/my-feature`
2. **Build and Verify**:
   - Run backend type check: `npx tsc --noEmit --project server/tsconfig.json`
   - Run frontend type check: `cd ui && npx tsc --noEmit`
3. **Merge to Master**: Only merge to master once the full feature compiles without errors.
4. **Push to VPS**: Push to master to trigger the Vercel deploy and subsequent manual VPS deploy.

## Git Hygiene
- **Stage Specific Files**: Do not use `git add -A`. Stage files individually by name to avoid accidentally committing artifacts from other sessions or local build files.
- **Express Params**: Always cast `req.params.*` as `string` to satisfy strict TypeScript requirements on the VPS.
