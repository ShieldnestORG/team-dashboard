# Handoff — Branch/Worktree/PR Cleanup Follow-ups (2026-07-23)

> **Cluster:** repo-hygiene · **Tags:** cleanup, stale-branches, worktrees, migration-collision, trends-digest, handoff · **Related:** [voice-budget handoff](2026-06-30-university-voice-budget-HANDOFF.md), memory `project_2026_07_22_branch_worktree_cleanup`

**Author:** cleanup session 2026-07-22/23. **Audience:** the next agent (this repo, or portal/landing).
**Status of the repo when this was written:** team-dashboard `master @ 3d8962d9`, CI `verify_canary=SUCCESS`, **0 open PRs**, 15 local / 26 remote branches. Every ref deleted this session has its SHA logged in `/tmp/deleted_recovery.txt`; all closed-PR branches survive on origin.

---

## Ground rules (read first — these bit us this session)

1. **This repo SQUASH-MERGES.** `git branch --merged/--no-merged` and ancestry LIE. Classify a branch by **content**: `git diff <ref> origin/master -- $(git diff --name-only $(git merge-base origin/master <ref>) <ref>)` — empty ⇒ already live.
2. **`git branch -d/-D` refuses a branch checked out in a worktree.** `git worktree remove <path>` FIRST (no `--force`, so a raced-dirty tree is skipped not clobbered), then delete the branch.
3. **Migration-collision footgun** (this is why PR #122 is closed): a stale branch's migration `NNNN_*.sql` may reuse a number master has already used. Master is at **0157**. Any revived branch adding a migration must be **renumbered to the next free slot** and its drizzle `meta/_journal.json` + snapshot regenerated, or it silently no-ops in prod → missing table → 500s.
4. **Stale monorepo build ⇒ false tsc errors.** Typechecking a worktree via symlinked `node_modules` can resolve a STALE `@paperclipai/db` build (e.g. "no exported member `universityCheckins`"). Trust CI `verify_canary` on the commit, or rebuild `packages/db` first.
5. **Concurrency is real.** ~15 live agent sessions were running in portal + landing (and one in this repo's `unruffled-wilson` worktree). Before removing ANY worktree/branch, `lsof -a -d cwd | grep <path>` and check file mtimes. Never touch a `.claude/worktrees/*` that has a live process, the locked worktree, or an open-PR head.

---

## Open items

### 1. PR #122 `feat/trends-anti-hallucination-method` — CLOSED, revival path documented
Closed 2026-07-22 for production safety (migration 0138 collides with master's `0138_university_session_recording_url.sql`; also activates Serper/Firecrawl crons = an ops decision). Branch preserved at `origin/feat/trends-anti-hallucination-method @ 2aa7fe19`. **Full revival checklist is on the closed PR's comment.** Short version:
- Renumber `packages/db/src/migrations/0138_trends_digest.sql` → `0158_…`; regenerate `meta/_journal.json` + snapshot.
- Rebase onto master — only conflict is a trivial export-union in `packages/db/src/schema/index.ts` (keep both master's exports and `trendsDigests`).
- Provision `SERPER` / `FIRECRAWL` keys on VPS4; run the digest cron once and verify a `pending` row + citation/number gates.
- **⚠️ Overlap:** `feat/watchtower-performance-and-linkage` ALSO carries a trends-digest pipeline (see item 2). Reconcile — do not ship two.

### 2. Five unmerged-unique branches — owner decision needed (kept, NOT deleted)
| Branch | Unique content (what's lost if deleted) | Recommendation |
|---|---|---|
| `feat/coherent-ones-university-referrals` | A 240-line integration test `server/src/__tests__/portal-stripe-portal-dual-account.test.ts` — the **only** coverage for a dual-account stripe-portal fix that IS live on master (shipped without a test). | **Cherry-pick the test onto master**, then delete the branch. Highest-value, lowest-risk. |
| `feat/watchtower-performance-and-linkage` | Watchtower "Performance" weekly digest (GA4 + Google-Ads spend, migration `0139_watchtower_performance`) **+** a trends-digest pipeline overlapping #122. | Decide if Watchtower Performance is wanted; if so, own PR (renumber 0139). Reconcile trends overlap with #122. |
| `feat/affiliate-learn-revamp` | Full GSAP "Learn v2" affiliate revamp (`AffiliateLearnWalkthrough.tsx`, `cdMotion.ts`, `learnProgress.ts`, gsap deps). Not on master. | Product call: ship Learn v2 or abandon. Large UI surface. |
| `fix/affiliate-quick-wins` | Overlaps `affiliate-learn-revamp` (same GSAP learn UI) **+** affiliate quick-wins (409 duplicate-lead surfacing in `affiliates.ts`). | Consolidate with `affiliate-learn-revamp` — don't ship both. |
| `feat/ad-attribution-td` (worktree `_wt/ad-attribution__td`) | Server-side ad-conversion attribution: Meta CAPI (`meta-capi.ts`) + TikTok Events (`tiktok-events.ts`) + M2/M3 capture+webhook + `university_attribution` table, migrations `0127…`. Master ships a DIFFERENT attribution approach. | Compare vs master's approach; likely SUPERSEDED. If so, `git worktree remove _wt/ad-attribution__td` then delete. |

### 3. `feat/controller-zernio-analytics` — stranded control-plane feature (REMOTE-ONLY)
`gh` says PR #119 MERGED, **but that is misleading**: squash `91aa96fb` is only on `origin/x-accounts-optimize`, **never reached master**. Unique + absent from master: a repo-registry / project-registry control plane (`server/src/routes/control-plane.ts`, `services/repo-registry.ts`, `ui/src/pages/ControlPlane.tsx`, `docs/architecture/project-registry.md`). Also `x-accounts-optimize` carries unique X-API thread-posting (`x-api/content-bridge.ts`). **Decision needed:** resurrect the control-plane feature (own PR off master) or discard both remotes. Not safe to auto-delete — it's genuinely unique, unshipped work.

### 4. Sibling repos `app-coherencedaddy-portal` + `coherencedaddy-landing` — deferred (active agents)
NOT cleaned this session — ~15 live agent sessions were working there (landing had 6+ `.claude/worktrees` + a locked one; portal 1). Their ~30–50 branches each are live working state, not stale. **When those repos are idle**, run the same method: the deterministic content-classifier (`/tmp/analyze_repo.sh <repo> <default-branch>` from this session, or reconstruct it) → then a content-verify workflow → remove only shipped/backup worktrees + delete only content-in-`main` branches. Respect every `.claude/worktree`, locked worktrees, `backup/*`, `rescue/*`, and open-PR heads.

### 5. Housekeeping (low priority)
- `backup/*` (3 on origin, dated 2026-07-12) and the teammate `rescue/*` / `chore/rescue-*` / `docs/rescue-*` branches are **intentional safety refs — keep**.
- `_wt/accomplishments-portal` scaffold was removed; its `.env.local` (a dev `PORTAL_SESSION_SECRET`) is backed up at `/tmp/accomplishments-portal.env.local.bak` — delete when confirmed unneeded.
- Recovery log for all deletions: `/tmp/deleted_recovery.txt`.

---

## What was DONE this session (context, don't redo)
- Verified master (`tsc` server+ui = 0 errors) after teammates merged #165–#184.
- Deleted 41 verified-contained local branches + 8 merged teammate branches (6 remote) + removed 5 orphan worktrees. Content-verified by a 141-agent workflow + adversarial skeptics (0 refutations).
- Triaged 13 open PRs: **closed 10 dead** (superseded/stale, each with a comment), **landed #123** (username-token fix) + **#109** (admin-ui error boundary + toasts, conflict resolved by nesting `ErrorBoundary` outside `Suspense`), **closed #122** (above).
