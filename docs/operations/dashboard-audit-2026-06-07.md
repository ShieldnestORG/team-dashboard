# Dashboard Audit & To-Do — 2026-06-07

> **Cluster:** Operations · **Tags:** audit, todo, bugs, affiliate, crons, build-health · **Related:** [Cron Inventory](cron-inventory.md), [Key Files Reference](key-files.md), [Docs Index](../README.md)

Generated from a 6-agent parallel audit (build health, backend routes/services, UI pages,
crons/automation, affiliate program, docs/TODO drift). Ground-truth verified, not assumed.

## Build state (verified green)
- Server `tsc --noEmit`: CLEAN. UI `tsc --noEmit`: CLEAN.
- Tests: **855 passed / 0 failed / 52 skipped** (all 52 skips = no `pgvector` on this host).
- No lint configured anywhere (no eslint dep / config).
- Working tree: `directory-listings.ts` modified-uncommitted; affiliate audit-fix work
  already landed in `6343be01` + `f1ebc6f9`. Untracked data dumps in root (see P3-10).

---

## P0 — correctness bugs (fix first)

- [~] **1. Date-as-Drizzle-param (Neon pooler footgun).** Replace JS `Date` bound params with `sql\`now()\``.
  - [x] `server/src/services/affiliate-crons.ts` inactive-reengagement WHERE comparisons (the **double-email** throttle + 45d inactivity) — converted to `now() - interval`. (2026-06-07)
  - [x] `server/src/services/agent-memory.ts:181` `expireOldMemories` WHERE comparison — converted to `sql\`now()\``. (2026-06-07)
  - [ ] `affiliate-crons.ts` leaderboard-snapshot (756-757) + giveaway-eligibility (970-971) — **absolute month-boundary** comparisons. Lower risk (leaderboard is idempotency-guarded). Left intentionally: a naive ISO-string swap risks a timezone shift; needs a deliberate `::timestamptz` decision against the actual column type before touching.
  - [ ] `server/src/services/cron-registry.ts` SET-value `new Date()` writes (lastRunAt/updatedAt/nextRunAt). **Empirically working in prod** (scheduler runs, run-counts increment) — the footgun bites WHERE-clause comparisons, not these SET writes. `nextRunAt` is a genuine future timestamp with no `now()` equivalent. Convert the "now" ones to `sql\`now()\`` as hygiene only; do NOT rewrite `nextRunAt` blindly.
  - [ ] `server/src/services/knowledge-graph-crons.ts:172` — SET-value future timestamp on insert (same low-risk class as cron-registry).
- [ ] **2. `owned-sites:sync-metrics` cron is a no-op** — `owned-sites.ts:217` GA4/AdSense sync are permanent `{ok:false}` stubs but the cron runs every 6h. Either wire credentials or unregister the cron. Same for `owned-sites:content-refresh` stub (`hostinger-crons.ts:33`).
- [x] **3. SystemHealth Nitter panel 401s** — FIXED (2026-06-07): `/api/intel/nitter/*` management endpoints now accept an authenticated board admin (the UI's cookie identity) OR the ingest key, via `requireIngestKeyOrBoard` in `intel.ts`.
- [x] **4. YT health-check logic inverted** — FIXED (2026-06-07): `automation-health.ts` now warns on `=== "false"` (matching the cron gate) and filters the actual `yt:` job prefix (was `youtube:`, matched zero).

## P1 — affiliate follow-ups (this subsystem was just audited)
- [ ] **5. Refund won't reverse no-invoice commission** — `directory-listings.ts:469` keys on `session.invoice ?? session.id`; `charge.refunded` matches `charge.invoice` (line 640). Latent for subscription flow; fix before any one-time-charge clawback.
- [x] **6. Compliance clawback relabels prior reversals** — FIXED (2026-06-07): the clawback UPDATE in `affiliate-compliance.ts` now excludes terminal statuses (`notInArray reversed/clawed_back/written_off`), so re-enforcing a violation no longer rewrites the audit trail of prior reversals.
- [ ] **7. `scheduled_for_payout` reverse has no UI** — `AffiliateAdminCommissions.tsx:225` only shows Reverse for pending/approved/held. Decide: expose with a "this adjusts the pending payout" confirm, or document as compliance-only.
- [ ] 8. (DRY nit) `affiliates.ts` reverse route reimplements `decrementUnsentPayouts` inline (1645-1651) instead of calling the shared helper.

## P2 — infra / security / orphans
- [ ] **9. `_journal.json` lag (cosmetic) + duplicate `0119`.** Initially mis-diagnosed as a "broken migrator / deploy blocker"; **disproven 2026-06-07.** The journal lags (≤ `0050`) but `inspectMigrations` derives pending from *filesystem `.sql` files − `__drizzle_migrations` rows* — the journal is used only for ORDERING, and zero-padded filenames sort correctly, so the lag is harmless. A full predeploy + `docker compose up -d --build` deploy succeeded against prod this session. **Caveat that caused the false alarm:** always `export DATABASE_URL` (from `.env`) before running `pnpm db:migrate`/`predeploy.sh` locally — without it, migrate falls back to the local embedded pgvector-less cluster and throws PG `42704`. Reconciling the journal is nice-to-have cleanup, not a blocker. Also **duplicate `0119`** (`creditscore_audit_runs` vs `watchtower_rank`) — renumber one.
- [ ] **10. SSRF guards string-match only** — `audit-deep.ts:19` + `audit.ts validateAuditUrl` don't resolve DNS; a public domain → `169.254.169.254` bypasses. Resolve + re-check the resolved IP. (Both env-gated.)
- [ ] 11. Remove orphaned pages: `ui/src/pages/MyIssues.tsx`, `ui/src/pages/Org.tsx`, page-level `AffiliateHowItWorks` (keep the `AffiliateHowItWorksModal` export), dead `_VideoPlaceholder` in `AffiliateLearnGuide.tsx:443`.
- [ ] 12. `canva-media-cron.ts` is paused (commented out in app.ts) — invisible to health dashboard. Either un-pause or note in cron-inventory that it's intentionally dormant.

## P3 — docs / hygiene
- [ ] 13. Re-audit `TODO.md` — Phase 4 (Content Agent → Claude API, review queue, per-tier rate limits) shipped but still `[ ]`. Check off completed items; update "Last audited" date.
- [x] 14. Added a `[2026-06-07]` CHANGELOG entry for this audit pass. (Older Watchtower/CreditScore backfill still worth a sweep, but the changelog is no longer silent on recent work.)
- [x] 15. Added Watchtower to the CLAUDE.md Reference Docs list. (2026-06-07)
- [x] 16. Deleted orphan `docs/deploy/environment-variables.md` (duplicate of `env-vars.md`). (2026-06-07)
- [x] 17. Gitignored root data dumps (`cellebrite-*`, `kg-*-backup-*.jsonl`, `CD-og*`, `scripts/scratch/`) — ~13MB now un-committable. (2026-06-07) Still TODO: commit the real new docs (`docs/products/knowledge-graph-positioning.md`, `docs/architecture/kg-extractor-prompt-fix.md`, `docs/operations/kg-burn-estimate.md`, `docs/products/demographic-targeting-report.md`) + `scripts/audit/kg-*` tooling.
- [x] 18. ~~Uncommitted `directory-listings.ts`~~ — already committed in `f1ebc6f9`. No action.

## Known-inert by design (not bugs — listed so they aren't re-flagged)
- `plugins.ts` 501s = capability gating when optional deps absent.
- watchtower/rizz/scribe/launch-monitor crons gated OFF by env (won't appear in health dashboard).
- `RunTranscriptUxLab.tsx` is a dev/QA fixture harness.
- `bluesky.ts` video publish returns a graceful "not implemented".
