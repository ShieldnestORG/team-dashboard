# Handoff — GEO/AEO Tactics Execution (2026-05-09)

**From:** Strategy + dispatch chat (Opus, ~50% context, dispatched-at: 2026-05-09)
**To:** Orchestrator chat (Opus recommended; you will integrate, verify, merge, and deploy)
**Authority granted:** CEO authorization for VPS actions, push/pull, and merge to master once typecheck is clean. See "Authority & guardrails" below for what authorization does NOT cover.

---

## TL;DR for the orchestrator

Three Opus workers are running **in the background right now**, each in an isolated worktree on its own feature branch, building the 30-day P0 from `docs/products/geo-tactics-roadmap.md`. Your job:

1. Wait for / monitor the three workers
2. Read each worker's report
3. Pull each branch back into a single integration branch (or keep separate per the user's preference — see decision point below)
4. Run `npx tsc --noEmit` on both server and ui
5. Run any tests
6. **Update the structure diagram** per CLAUDE.md — three new services count as a structural change
7. Open PRs (or merge directly to master per CEO authorization, but ONLY if typechecks clean and review is honest)
8. Trigger VPS1 redeploy if backend services land
9. Verify post-deploy

---

## Context: why we're here

The user asked about GEO/AEO/SEO and adjacent AI-era visibility tactics. Three Opus persona agents (Contrarian, Enthusiast, Realist) analyzed the tactic stack and produced the roadmap at `docs/products/geo-tactics-roadmap.md`. The synthesis identified the **customer-portal MVP as the #1 unblocker** for productizing AEO upsell SKUs (verified: today the only post-purchase customer surface is Stripe Checkout + Resend email + token-URL viewer; no login, no dashboard, no credential vault, no Stripe Customer Portal).

The 30-day P0 list:
1. Customer Portal MVP
2. `llms.txt` + `agents.json` generator
3. Watchtower brand-mention monitor v1
4. Stripe Customer Portal (deferred — bundle with Worker A's portal work in your integration pass)

Workers A, B, C cover items 1–3. Item 4 should be folded into integration.

---

## Background workers in flight

**You will receive completion notifications for each.** Do NOT poll; do NOT tail their output files (will overflow context).

### Worker A — Customer Portal MVP
- **Branch:** `feat/customer-portal-mvp`
- **Worktree:** isolated (auto-created by Agent tool with `isolation: worktree`)
- **Scope:** migrations (`customer_accounts`, `customer_magic_links`, `customer_credentials`, `customer_action_log`), service `customer-portal.ts`, routes `/api/portal/*`, magic-link auth via Resend, Stripe Billing Portal proxy, env vars docs, tests
- **Spec:** `docs/products/geo-tactics-roadmap.md` §3 (architecture is verbatim what the worker is building)

### Worker B — llms.txt + agents.json Generator
- **Branch:** `feat/llms-txt-generator`
- **Worktree:** isolated
- **Scope:** migrations (`llms_txt_jobs`, `llms_txt_outputs`), service `llms-txt-generator.ts`, sitemap parser (handles index recursion), routes `/api/llms-txt/*`, Stripe product config doc, tests
- **Plug-in point:** routes are public + token-URL access in v1; portal-auth integration happens after Worker A merges

### Worker C — Watchtower Brand-Mention Monitor v1
- **Branch:** `feat/watchtower-mention-monitor`
- **Worktree:** isolated
- **Scope:** migrations (`watchtower_subscriptions`, `watchtower_runs`, `watchtower_results`), service `watchtower-monitor.ts`, engine adapters (ChatGPT, Claude, Perplexity, Gemini), weekly cron, routes `/api/watchtower/*`, Stripe $29/mo product config doc, email digest template, tests
- **Plug-in point:** read-only token-URL routes in v1; portal-CRUD wraps after Worker A

---

## Migration coordination

All three workers are creating migrations. They were told to coordinate by using the next-available number. **You may need to renumber** if collisions occurred. Recent precedent: commit `7665c6ae chore(creditscore): renumber migration 0102 → 0106 (collision with 0102_social_posts)`.

Latest pre-handoff migration in `master` HEAD: ~`0106_creditscore_*`. Workers will likely produce `0107`, `0108`, `0109`. Verify before merging.

---

## Decision point: integration strategy

**You decide between two paths, then execute:**

**Path A — Single integration branch, single PR** (recommended for clean review history)
1. Branch `integration/geo-portal-stack` off master
2. Cherry-pick or merge each worker's commits
3. Resolve any cross-cutting issues (esp. migration numbering, route registration file conflicts)
4. Update structure diagram in same branch
5. One PR for the full stack

**Path B — Three independent PRs**
1. Each worker's branch becomes its own PR
2. Land Worker A first (others depend on it for portal-auth integration)
3. Then B and C in parallel
4. Structure diagram update is its own PR after all three land

CEO recommendation: **Path A**, because the three deliverables are interdependent for the customer experience and reviewing them in isolation will miss integration issues. The user said "have an orchestrate agent verify everything is flowing" — that's path A.

---

## Verify-before-merge checklist (CLAUDE.md mandate)

```bash
# From repo root, BEFORE any push to master:
npx tsc --noEmit --project server/tsconfig.json
cd ui && npx tsc --noEmit
```

Both must report zero errors. If either fails, **do not merge**. Diagnose, fix, re-verify. If the worker's branch has the type error, push the fix as a follow-up commit on the integration branch (not on the worker's original branch — the worker is done).

---

## Structure diagram update (REQUIRED — CLAUDE.md policy)

Per `docs/architecture/structure-diagram-policy.md`:

> Any structural change must update the company structure diagram. **Triggers**: New/removed backend services, routes, cron jobs, or plugin restructuring.

This handoff lands **3 new services + 3 new route files + 1 new cron + 1 new product surface (`app.coherencedaddy.com`).** That's textbook structural change.

Action:
1. Read `ui/src/pages/Structure.tsx` for the current `DEFAULT_DIAGRAM`
2. Read whatever API stores the persisted version
3. Add nodes for: `customer-portal-service`, `llms-txt-generator-service`, `watchtower-monitor-service`, `app.coherencedaddy.com (frontend)`, `watchtower-weekly cron`
4. Update via the persisted-structure API AND update `DEFAULT_DIAGRAM`
5. Add a dated changelog summary

Do this in your integration branch.

---

## VPS deployment (when typechecks pass)

**Authority:** CEO has authorized VPS actions for this work. Reference VPS layout: `~/.claude/projects/-Users-exe-Downloads-Claude-team-dashboard/memory/reference_vps.md`.

Sequence:
1. SSH to VPS1 (where the team-dashboard backend runs)
2. `git pull origin master`
3. Apply migrations: identify how migrations are run in this repo (check `package.json` scripts and `server/src/migrations/` for any runner)
4. Restart the backend service (likely PM2 or systemd — verify before assuming)
5. Smoke test:
   - `curl -i https://team-dashboard-host/api/portal/login -d '{"email":"test@example.com"}'` → expect 200 `{ok:true}` and a row in `customer_magic_links`
   - `curl https://team-dashboard-host/api/llms-txt/generate` (POST) for a tiny domain
   - `curl https://team-dashboard-host/api/watchtower/runs/{seeded-id}` for a manually-seeded subscription
6. Set new env vars in VPS env file: `PORTAL_SESSION_SECRET`, `PORTAL_BASE_URL`, `PORTAL_MAGIC_LINK_TTL_MIN`, plus any Worker C engine keys not already present
7. Set up `app.coherencedaddy.com` as a new Vercel project pointed at the new portal frontend (Worker A may have only built the backend; if no frontend Vercel project exists yet, defer this and document)

**Frontend (`app.coherencedaddy.com`) — likely NOT in this batch.** Worker A's scope was the backend portal. The Next.js storefront app is a separate ~6-route project; spawn a follow-up worker for it once the backend lands.

---

## Authority & guardrails

**CEO has authorized:**
- Push to feature branches and master (after typecheck passes)
- Merge PRs
- VPS SSH + redeploy + migration apply
- Vercel project creation/config for `app.coherencedaddy.com`
- Stripe dashboard product creation per the docs the workers wrote

**CEO has NOT authorized (still need explicit re-confirmation):**
- Deleting any existing data or tables
- Force-pushing to master
- Bypassing pre-commit hooks (`--no-verify`)
- Spending any third-party LLM budget above ~$100/mo without sanity-checking with user
- Sending email to real customers from the Watchtower digest cron (gate the cron behind a `WATCHTOWER_ENABLED=false` env var until user confirms)
- Deploying anything that would change the public storefront's behavior (this batch is all internal/admin/portal — no `coherencedaddy-landing` changes)

**Hard constraints (CLAUDE.md, non-negotiable):**
- One writer per branch — coordinate so two agents never edit the same branch simultaneously
- Stage specific files; never `git add -A`
- Cast `req.params.*` as `string` in Express routes
- Run typecheck before merge
- Update structure diagram on structural changes (this is one)
- Document changes in `docs/`

---

## Open questions to resolve before final merge

1. **Migration numbering collision** — workers may have picked the same number. Verify and renumber.
2. **Stripe webhook routing** — Worker B added a `handleLlmsTxtCheckout` skeleton. Worker A may have added portal-related Stripe webhooks. **Make sure both register cleanly** in the master Stripe webhook router (likely `server/src/routes/stripe-webhook.ts` or similar — search for it). Test with `stripe listen --forward-to localhost:PORT/api/stripe/webhook`.
3. **Resend domain warm-up** — magic-link auth dies if 5% of emails go to spam. Verify the sending subdomain is warmed for transactional. Send a test magic link to a Gmail and a Proton inbox before announcing.
4. **`app.coherencedaddy.com` DNS + Vercel project** — does it exist yet? If not, create it as a new Vercel project under `shieldnestorg`. Reference: `coherencedaddy-landing/CLAUDE.md` for the existing subdomain pattern.
5. **`PORTAL_SESSION_SECRET` value** — must be ≥32 chars random. Generate with `openssl rand -base64 48`. Add to Vercel env (production only) and VPS env file. Never commit.

---

## Follow-up sessions to spawn after this batch lands

In priority order (reference roadmap §4):
1. **Portal frontend Next.js app** — `app.coherencedaddy.com` UI (~6 routes). Spawn after Worker A backend lands and is smoke-tested.
2. **100 Agents dashboard MVP** — narrow scope: activity feed + approval queue for the 3 agent types whose backend services already exist (`creditscore-content-agent`, `creditscore-schema-agent`, `creditscore-competitor-agent`). 14 founding-cohort customers cannot use what they bought without this.
3. **Schema.org JSON-LD as a service** — $39/mo addon (90-day window).

---

## Files committed in the dispatcher chat

- `docs/products/geo-tactics-roadmap.md` (commit `27d13878` on branch `claude/distracted-kirch-39a1d0`)
- `docs/handoffs/2026-05-09-geo-tactics-execution.md` (this file — commit it before closing)

---

## Quick orientation commands for the orchestrator

```bash
# See the worktrees the dispatched agents are using
git worktree list

# See all the new branches
git branch | grep -E 'feat/(customer-portal|llms-txt|watchtower)'

# See latest migration number on master
ls server/migrations/ | sort -r | head -5

# Verify clean state of master
git fetch && git log master..origin/master --oneline

# Typecheck gate (must pass before any merge)
npx tsc --noEmit --project server/tsconfig.json && (cd ui && npx tsc --noEmit)
```

---

## If anything goes sideways

- **A worker's typecheck doesn't pass:** read its report, fix the type error in your integration branch, do NOT silence with `as any`.
- **Two workers wrote to the same file:** integration branch handles the merge. Most likely conflict zone: the route registration file (whatever index file mounts routes). Apply both, verify each route still mounts, typecheck, done.
- **Migration collision:** renumber the later migration (lowest-disruption rule). Update any cross-references.
- **VPS redeploy fails:** rollback by `git reset --hard <previous-sha>` on VPS, restart service. Do NOT panic-push to master to "fix forward."
- **A migration breaks production:** if it's additive (new tables, new columns with defaults), it should be safe. If a worker tried to alter or drop, **stop and re-confirm with the user before applying** — the user explicitly excluded data deletion from CEO authorization.

---

## End-of-handoff signal

Once you've:
- ✅ Integrated all three worker branches
- ✅ Updated the structure diagram
- ✅ Typechecks pass on server + ui
- ✅ Pushed to master (or PRs are merged)
- ✅ VPS redeployed + smoke-tested
- ✅ Watchtower cron gated behind `WATCHTOWER_ENABLED=false` until customer-ready

Write a closing report to the user with: branches merged, migrations applied, env vars set, smoke-test results, what's still TODO before announcing to customers (frontend portal app, 100 Agents dashboard).

Good luck. The roadmap doc is the spec; this handoff is the runbook.
