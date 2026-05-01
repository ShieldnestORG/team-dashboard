# Plan: CreditScore audit — fail loudly when crawler is down

**Spec:** Inline handoff in conversation 2026-04-30 (P0: every audit currently saves fake `score:30` data with hardcoded `alt1.example.com` competitors when Firecrawl is unreachable).

**Scope:** Phase 1 only — stop the bleed. Phase 2 signal upgrades and Phase 3 audit trail are tracked separately.

## Context

- Firecrawl helpers in `server/src/routes/audit.ts` swallow errors → `null`/`[]` → degraded `runAudit` returns a 30/100 result with all-zero data subscores → `storeAuditResult` and `generateReport` persist it as `status:"complete"`.
- Two write paths to fix: storefront SSE → `POST /api/creditscore/audit/store` → `storeAuditResult` (anonymous free audits); webhook → `activateFromCheckout` → `generateReport` (paid one-time/sub).
- Storefront-side guards (Phase 0) already shipped in `coherencedaddy-landing` — they call `/api/public/audit/health` (404 today) and treat all-zero subscores as degraded client-side. Backend health endpoint is what flips the storefront banner off.
- DB schema: `creditscore_reports.status` is text, not enum. No migration needed to introduce `"degraded"` value, but we do need a `raw_data` JSONB column for replay/audit.

## Steps

- [x] **1. Make Firecrawl helpers throw, not swallow**
  - **Files:** `server/src/routes/audit.ts`
  - **Action:** Replace `} catch { return null/[]; }` in `fcScrape`, `fcMap`, `fcSearch` with throws. Convert HTTP non-2xx to thrown errors as well. Introduce a typed `FirecrawlError` so callers can distinguish crawler-down from "site genuinely empty."
  - **Verify:** `npx tsc --noEmit --project server/tsconfig.json` is clean.
  - **Depends on:** none
  - **Parallel-safe:** no (foundation for steps 2, 3, 5)

- [x] **2. `runAudit` propagates crawler failure as SSE error event**
  - **Files:** `server/src/routes/audit.ts`
  - **Action:** Wrap the map+scrape phase in try/catch on `FirecrawlError`; on failure, `emit({ type:"error", message:"Crawler temporarily unavailable. Try again in a few minutes." })` and `return` without emitting `complete`. Drop the hardcoded `alt1/alt2/alt3` competitor fallback (lines 401-405) — when `fcSearch` fails or returns empty, return `competitors: []`. Add `pagesScraped` to the `AuditResult` shape so validators can gate on it.
  - **Verify:** Mock-fetch test (or existing test if present) confirms an `error` SSE is emitted when fetch throws and no `complete` is emitted.
  - **Depends on:** 1
  - **Parallel-safe:** no

- [x] **3. Add `GET /api/public/audit/health`**
  - **Files:** `server/src/routes/audit.ts`
  - **Action:** New route on `auditRoutes()` router. Calls `${FIRECRAWL_URL}/v1/scrape` with `https://example.com` and 5s timeout (or `/v1/health` if Firecrawl exposes it — fall back to `/v1/scrape` for the self-hosted variant). Returns `{ ok: true }` on success, `503 { ok: false, reason }` on any error. Cache result in-memory for 30s to avoid hammering on repeated probes.
  - **Verify:** `curl https://api.coherencedaddy.com/api/public/audit/health` returns 200 when Firecrawl is up, 503 when down. Storefront `vercel.json` already rewrites this — banner flips automatically.
  - **Depends on:** 1
  - **Parallel-safe:** yes with 4

- [x] **4. Migration `0102_creditscore_reports_raw_data.sql`**
  - **Files:** `packages/db/src/migrations/0102_creditscore_reports_raw_data.sql`, `packages/db/src/schema/creditscore.ts`
  - **Action:** Add `raw_data JSONB` column (nullable, no default). Document the `status:"degraded"` value in a comment on the `status` column. Update Drizzle schema with the new column.
  - **Verify:** `npx tsc --noEmit --project server/tsconfig.json` clean. Migration file follows the project's idiomatic shape (cross-check `0101`).
  - **Depends on:** none
  - **Parallel-safe:** yes with 3

- [x] **5. `runAudit` populates `rawData` per scraped page**
  - **Files:** `server/src/routes/audit.ts`
  - **Action:** Track `rawScrapes: Array<{url, markdown, metadata}>` from `validScrapes` and include on the `AuditResult`. (This is what the new `raw_data` column will store.)
  - **Verify:** Type compiles; `AuditResult` has `rawData: Array<{...}>` field.
  - **Depends on:** 2, 4
  - **Parallel-safe:** no

- [x] **6. Validation gate in `storeAuditResult` and `generateReport`**
  - **Files:** `server/src/services/creditscore.ts`
  - **Action:** Helper `isDegraded(result)` checks `pagesScraped === 0` OR `(structuredData.score + contentQuality.score + freshness.score) === 0`. In `storeAuditResult`: if degraded, write `status:"degraded"` (not `"complete"`) and skip `score`. In `generateReport`: same — also `raw_data` column gets the rawScrapes if present.
  - **Verify:** New unit test in `server/src/__tests__/creditscore-audit-validation.test.ts` covers: (a) all-zero subscore degrades, (b) zero pages scraped degrades, (c) healthy result writes `complete`. Run `npm test -w server -- creditscore-audit-validation` (or framework equivalent — match existing test conventions).
  - **Depends on:** 4, 5
  - **Parallel-safe:** no

- [x] **7. Exclude `degraded` rows from cron mailing + entitlement upsells**
  - **Files:** `server/src/services/creditscore-fulfillment-crons.ts`, any other consumer of `creditscore_reports` that filters by `status`.
  - **Action:** Search for `eq(creditscoreReports.status, "complete")` and confirm all consumers already filter on `complete` (degraded won't match). If any consumer uses `!= "failed"` or similar broad filter, tighten it to whitelist `complete` only.
  - **Verify:** `grep -rn 'creditscoreReports.status' server/src` — every match should narrow to `complete` (or be a write site).
  - **Depends on:** 6
  - **Parallel-safe:** no

- [ ] **8. Backfill SQL: mark existing zero-scrape rows as `degraded`**
  - **Files:** `scripts/audit/creditscore-backfill-degraded.sql` (new)
  - **Action:** SQL script (not migration — one-shot data fix to run manually against prod): `UPDATE creditscore_reports SET status='degraded' WHERE status='complete' AND score < 35 AND (result_json->>'pagesScraped')::int IS NOT DISTINCT FROM 0`. Include a `SELECT COUNT(*) ... FOR REVIEW` first; commit a dry-run output as `kg-audit`-style note in `docs/operations/`.
  - **Verify:** Script runs cleanly against a local DB copy or shows expected row count via `EXPLAIN ANALYZE`. Exec against prod is a separate, gated step (user runs).
  - **Depends on:** 6
  - **Parallel-safe:** yes with 7

- [ ] **9. Typecheck + smoke test + commit**
  - **Files:** none (verification only)
  - **Action:** Run server typecheck, UI typecheck (per CLAUDE.md — UI doesn't touch this but it's the project rule before merging), run any creditscore-related test suite. Hand-trigger one audit against `https://stripe.com` via curl/`runAudit` if dev env is available.
  - **Verify:** `npx tsc --noEmit --project server/tsconfig.json` clean; `cd ui && npx tsc --noEmit` clean; Phase 1 verification checklist from handoff items 1-3 (skip 4 — DB query — until backfill runs in prod).
  - **Depends on:** 1-8
  - **Parallel-safe:** no

## Order

```
Group A (sequential):  1 → 2 → 5
Group B (parallel after 2):  3, 4
Group C (sequential after 4 + 5):  6 → 7
Group D (parallel after 6):  7, 8
Final:  9
```

## Out of scope (tracked separately)

- **Phase 2 — signal upgrades:** real GPTBot fetches, structured-data validation API, Lighthouse, SerperAPI, SimilarWeb. Per handoff: "next 2 weeks." File: `docs/plans/2026-05-XX-creditscore-signal-upgrades.md` to be written after Phase 1 ships.
- **Phase 3 — audit trail:** `audit_runs` table, replay tool, Slack alerts on Firecrawl health changes.
- **Crawler restoration itself:** redeploy self-hosted Firecrawl OR swap to hosted (`api.firecrawl.dev`). This is an ops step, not a code change. Tracked in `.env` config; no code change needed beyond what step 3 enables.

## Done when

- [ ] Every checkbox above ticked.
- [ ] `curl https://api.coherencedaddy.com/api/public/audit/health` returns 200 (after deploy + crawler back up) or 503 (when crawler is down — but never 404).
- [ ] Killing Firecrawl, then running an audit, returns SSE `error` event (not fake `complete`).
- [ ] No new rows in `creditscore_reports` with `status='complete' AND score<35 AND pagesScraped=0`.
- [ ] Storefront banner stops showing "down" once Firecrawl is restored, with no client change.
