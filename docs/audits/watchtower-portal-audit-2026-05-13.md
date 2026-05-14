# Watchtower / app.coherencedaddy.com — Multi-Persona Audit

**Date:** 2026-05-13
**Scope:** `app.coherencedaddy.com` (customer portal SPA, separate repo `app-coherencedaddy-portal`) + backend (`api.coherencedaddy.com`, this repo)
**Trigger:** Watchtower is live and being used by customers; we need the portal to feel like a real product, not a stripped login + entitlements card. Other CD products should appear as natural upsells inside it.

---

## TL;DR

The portal today is a **login + entitlements + Stripe billing link**. That's it. Watchtower customers receive a **weekly digest email** as their primary product experience — the portal contributes almost nothing to their daily mental model of the product. Meanwhile, admin has **zero Watchtower-specific surface**: no usage stats, no per-engine cost, no audit trail, no "view as customer."

Five gaps drive the work below:

1. **User flow:** no Watchtower dashboard inside the portal — customers can't see their runs, edit prompts, or trigger ad-hoc scans.
2. **Admin flow:** no Watchtower admin page anywhere; ops is blind.
3. **Audit flow:** Watchtower subscription events and admin route accesses aren't logged to `activity_log`.
4. **Marketing flow:** no contextual cross-sell; CreditScore + AEO bundles are invisible to the highest-intent buyer cohort we have.
5. **ADHD/ease-of-use:** no onboarding tour, no empty states, no "what does this mean" tooltips, no keyboard help.

---

## Persona walk-throughs

### Persona 1 — The Customer (new Watchtower buyer)

**Current path:**
1. Lands on `coherencedaddy.com/tools/watchtower`, signs up, pays $29/mo via Stripe checkout
2. Lands on `app.coherencedaddy.com/dashboard` after success redirect
3. Sees an "Active Entitlements" card listing "Watchtower" + a "Cross-sell shelf"
4. **Nothing else.** No insight, no preview of what the product will produce, no preview of when next run happens
5. 6 days later, receives weekly digest email with per-engine mention counts and excerpts
6. Clicks "view run" → lands on a JSON-ish read-only endpoint at `api.coherencedaddy.com/api/watchtower/runs/:id` (raw)

**What breaks:**
- Step 4 is a cliff. Customer paid $29 and the immediate product experience is "your email will arrive in 6 days."
- Step 6 lands on a raw JSON-style page; there is no real UI for run results.
- No way to edit prompts post-signup, no way to trigger a fresh run, no way to see historical trend across runs.
- First-time buyer has no idea how good the product *is* until next Monday.

**What we'd want:**
- `/app/watchtower` page in the portal with: this-week summary card, engine breakdown, latest run results (collapsible per prompt), prompt manager, "run now" button (rate-limited, gated to one free preview run on first signup so they see real output day-one).
- Empty-state preview for first-time customers showing a SAMPLE run with sample data + a "trigger your first real run" CTA.

### Persona 2 — The Admin (us)

**Current path:**
1. Logs into team-dashboard admin at `dashboard.shieldnest.io` (or local)
2. Goes to look at how Watchtower is doing → **there is no page**
3. Can pull DB queries against `watchtower_subscriptions` / `watchtower_runs` / `watchtower_results` manually
4. Can manually trigger one customer's run via `POST /api/watchtower/runs/:id/trigger-test` with `X-Internal-Token` header

**What breaks:**
- No view of "all Watchtower customers" → can't tell who's churning, who's just signed up, who's getting no mentions.
- No per-engine cost tracking → don't know if Grok or Claude is eating margin.
- No error/failure rate view → don't know if Perplexity is silently 500ing for 30% of runs.
- No impersonation → can't reproduce what a customer is seeing without manually copying a session cookie.

**What we'd want:**
- `WatchtowerAdmin.tsx` page in `ui/src/pages/` with:
  - **Customers table:** email, plan, MRR, status, last run, mention count delta over last 4 weeks
  - **Per-customer drill-down:** prompts, run timeline, per-engine result counts, errors
  - **Aggregate view:** cost per engine last 7/30 days (derived from `watchtower_results.latency_ms` + per-engine token estimates; or hooked to a future cost-tracking table), error rates per engine, total runs, total mentions detected
  - **Impersonate:** "view as <customer>" button → opens the portal with a 1-hour admin session token

### Persona 3 — The Auditor (compliance / forensic)

**Current path:**
1. "Did anyone admin-touch customer X's Watchtower subscription in the last 30 days?" → no answer. Stripe events are in Stripe; admin actions aren't logged anywhere.
2. "When was customer X's plan changed and by whom?" → unknown.
3. "Who accessed the admin Watchtower routes?" → unknown.

**What breaks:**
- `activity_log` exists but Watchtower webhook + admin paths don't write to it.
- No middleware logs admin-route access at all (covered for `/api/portal/agents/*/approve` and `/api/portal/agents/*/reject`, but not for Watchtower or other admin routes).

**What we'd want:**
- Webhook handlers in `watchtower-stripe-handler.ts` should write `activity_log` entries for: `watchtower.subscription.created`, `.plan_changed`, `.cancelled`, `.refunded`.
- Admin-route middleware that captures: route, actor (admin user), entityType, entityId, timestamp, request body diff.
- "Audit log" tab on the Watchtower admin page showing the timeline for the selected customer.

### Persona 4 — The Marketing Specialist (revenue)

**Current path:**
- A Watchtower buyer (high-intent persona — operator/analyst who already cares about AEO) gets no upsell beyond a generic "Cross-sell shelf" that may or may not be relevant.
- No contextual triggers: a customer with weekly mention_count = 0 across all engines isn't shown "your AEO score might explain this — try CreditScore for $19" inline.
- AEO Growth ($499/mo) and AEO Scale ($1,299/mo) bundles are invisible inside the portal.
- No funnel attribution: when a Watchtower customer DOES later buy CreditScore, we don't know that "saw upsell card in portal on day 12" was the touch.

**What breaks:**
- We're leaving the natural funnel (mention monitor → ranking audit → ranking improvement → bundle) on the table.

**What we'd want:**
- `GET /api/portal/upsell-cards` endpoint that returns dynamic cards based on:
  - User's current entitlements (don't show what they already own)
  - Watchtower run outcomes (low mention_count → CreditScore CTA; high → AEO Growth bundle CTA)
  - User's tenure (day 1 — soft cross-sell; day 14+ — proactive bundle pitch)
- Portal renders these in a contextual shelf, NOT a static list.
- Each card has a `source=portal-upsell-card&campaign=<id>` UTM so downstream conversion attributes correctly.

### Persona 5 — The ADHD / Easy-Use User

**Current path:**
- Portal dashboard is minimal but information-dense for a tab-thrasher: no progressive disclosure, no first-time tour, no "where do I start?"
- Weekly digest email is text-heavy.
- No keyboard shortcuts, no `?` help dialog.

**What breaks:**
- A neurodivergent first-time user lands, sees an entitlements card, doesn't immediately know what to do, bounces.
- No "this is what you'll see on Monday" preview to anchor expectations.

**What we'd want:**
- 4-step **product tour** on first login (Joyride or Driver.js, persisted in localStorage + DB):
  1. "Welcome to Watchtower. Here's your dashboard."
  2. "Your prompts are what we ask the 5 engines every Monday. Edit them here."
  3. "Each run produces per-engine results. Here's a sample."
  4. "Your weekly email will summarize all of this. Adjust delivery in settings."
- **Empty states with sample data** ("here's what your dashboard will look like on Monday").
- **Tooltips on jargon** (AEO, mention_count, engine).
- **`?` keyboard shortcut** opens a help dialog: shortcuts + glossary + "talk to support."
- **High-contrast focus rings, generous whitespace, max-width content lanes** (no edge-to-edge tables).

---

## Build plan

Five parallel streams. Each is independently shippable. Streams A/B/E touch the portal SPA repo (`/Users/exe/Downloads/Claude/app-coherencedaddy-portal`); Streams C/D touch this repo (`team-dashboard`).

### Stream A — Portal Watchtower dashboard (CUSTOMER core)
Repo: `app-coherencedaddy-portal`. New page: `/app/watchtower` (or `/watchtower`).
- This-week summary card (mentions, sentiment, engines)
- Engine breakdown (5 engines × bar/count)
- Latest run with collapsible per-prompt drill-down
- Prompt manager (edit / add / remove up to plan limit, calls new `PATCH /api/watchtower/subscriptions/:id/prompts`)
- "Run now" button (rate-limited, 1 free trigger on signup so they see real output day-one)
- Empty-state with sample data for pre-first-run users
- Mobile-responsive (the user said dashboards should feel calm, not a wall of tables)

### Stream B — Portal onboarding tour + ADHD-friendly UX (CUSTOMER ease-of-use)
Repo: `app-coherencedaddy-portal`.
- 4-step product tour using `driver.js` (lightweight, no React-context-required) OR `react-joyride`. Persist `tour_completed_at` on `customer_account` row.
- `?` keyboard shortcut → shortcuts/help dialog
- Tooltip glossary for AEO terms (Radix Popover, no library)
- Empty states with sample-data CTAs
- Generous whitespace, max-width lanes (Tailwind `max-w-5xl mx-auto`), high focus rings

### Stream C — Admin Watchtower dashboard (ADMIN core)
Repo: `team-dashboard`. New page: `ui/src/pages/WatchtowerAdmin.tsx`. New route group: `server/src/routes/watchtower-admin.ts`.
- Customer list table (email, plan, MRR, status, last run, mention delta)
- Per-customer drill-down: prompts, run timeline, per-engine result counts, errors
- Aggregate dashboard: cost per engine 7/30 days, error rate per engine, total runs, total mentions
- "Impersonate" button → portal opens with `?admin_session=<jwt>` (signed by `INTERNAL_API_TOKEN`)
- All admin routes go through new `requireAdmin` + `logAdminAccess` middleware

### Stream D — Audit trail wiring (AUDIT core)
Repo: `team-dashboard`. Backend only.
- Add `logActivity` calls inside `server/src/services/watchtower-stripe-handler.ts` for every subscription lifecycle event
- New middleware `server/src/middleware/log-admin-access.ts` that writes to `activity_log` on every admin-route hit
- Apply middleware to `watchtower-admin.ts`, `system-crons.ts`, `intel-billing.ts`, and any other admin-only route group
- Add "Audit log" tab to Stream C's `WatchtowerAdmin.tsx`

### Stream E — Marketing/cross-sell engine (REVENUE)
Repo: `team-dashboard` (backend) + `app-coherencedaddy-portal` (frontend).
- New endpoint `GET /api/portal/upsell-cards` that returns prioritized cards based on:
  - User's current entitlements (suppress already-owned products)
  - Watchtower run signals (low mention_count → CreditScore $19 audit CTA; high mention_count → AEO Growth $499/mo bundle CTA)
  - Tenure (day 1 = soft; day 14+ = aggressive bundle pitch)
- Frontend: render cards in a contextual shelf on `/app/watchtower` and `/app/dashboard`
- All card CTAs UTM-tagged: `?utm_source=portal-upsell&utm_campaign=<card-id>&utm_medium=<context>`
- Log card impressions + clicks to `activity_log` for funnel attribution

---

## Acceptance criteria (all 5 streams)

- Customer can see their Watchtower runs inside the portal without an email.
- Customer first-time experience includes a tour and sample data so day-one isn't a cliff.
- Admin can see all Watchtower customers, their costs, their errors, and the audit log of admin actions.
- Watchtower subscription events appear in `activity_log` within 1s of webhook firing.
- Cross-sell cards render contextually and attribute correctly.
- Lighthouse a11y score ≥ 90 on portal Watchtower dashboard.
- Mobile-responsive at 375px width.

---

## Out of scope (deferred)

- Real-time cost ingestion (per-API-call cost from OpenAI/Anthropic/Grok billing APIs) — deferred to a separate spec.
- Customer-side cron schedule customization (let user choose Monday vs Friday) — deferred.
- White-label / agency multi-brand support — deferred (likely tied to 100 Agents launch).
- Native mobile app — not on the roadmap.

---

## V2 — Adversarial revisions

Independent reviewer flagged the V1 plan. Material corrections below; Phase-1 ship list at the end.

### Blocker fixes

1. **Impersonation security (was: JWT in URL).** Replace with: admin clicks "View as <customer>" → backend mints a **single-use, 5-minute, DB-tracked nonce**, redirects to `https://app.coherencedaddy.com/admin/impersonate?nonce=<n>`. Portal calls `POST /api/portal/admin-impersonate` with the nonce, which exchanges it for a short-lived (60-min) httpOnly admin-impersonation cookie (separate name from `cd_portal_session` so it can't be confused). Nonce burned on first exchange. All page chrome shows a red "VIEWING AS <customer>" banner. Logout button clears only the impersonation cookie.

2. **Impersonation audit event.** New `activity_log` event type: `admin.impersonate.start` and `admin.impersonate.end` with `{admin_actor_id, impersonated_customer_id, session_id, duration_s, pages_viewed[]}`. Surfaced in the customer's own GDPR data export so "did anyone log in as me?" is auditable end-to-end.

3. **Run-now cost ceiling.** Spec:
   - Per-customer cap: 1 manual run / 24h on $29 plan (higher tiers TBD).
   - Per-customer absolute cap: 5 manual runs / month (DB-tracked).
   - Global cap: 50 manual runs / hour across all customers (Redis-cached counter; reject with `429 manual_runs_global_cap` after).
   - Enforced at `POST /api/watchtower/subscriptions/:id/runs/manual` (NEW route, not the internal trigger-test).
   - Hard prompt-count limit per run (already capped at plan tier).

4. **Prompt-version comparability.** New `watchtower_prompt_versions` table: `{id, subscription_id, prompts (jsonb), created_at, created_by_actor_id}`. Each `watchtower_runs` row pins to `prompt_version_id`. UI rule: if a user views "delta over 4 weeks" and a prompt changed in the window, show inline notice "Prompts changed on <date> — comparison reset." Cross-sell engine (Stream E) MUST NOT fire result-based triggers across a version boundary.

5. **Cross-sell ethics rewrite.** Stream E triggers are now:
   - **Tenure-based only** (day 1: soft CD ecosystem intro; day 14: "ready for the next step?"; day 30: bundle pitch).
   - **Entitlement-suppression** (never show what they already own).
   - **NEVER triggered on null results from their own subscription.** A customer with 0 mentions does NOT see "your AEO is bad, buy CreditScore." Instead they see "Watchtower is still warming up — runs improve as engines re-index. Here's how Watchtower works." (educational, not commercial.)
   - Result-derived triggers (if any) are framed as **opportunities**, not deficiencies: "your sentiment is positive across 5 engines — protect that with Directory Listings" not "your sentiment is low, fix it with X."

6. **Audit-log split.** Two tables, two purposes:
   - `activity_log` (existing) — **compliance**, customer-visible in GDPR export, includes Watchtower webhook events + impersonation events + admin material actions (subscription changes, refunds).
   - `admin_access_log` (NEW) — **ops telemetry**, admin-internal, includes every authenticated admin route hit. 90-day retention, excludes GETs on read-only listings (configurable). NOT in customer GDPR export.

7. **Mobile spec.** Stream A's mobile layout (<768px / `md:` breakpoint):
   - Customer table → stacked cards (one per customer row, prompts/engines hidden behind "Tap to expand")
   - 5-engine breakdown grid → 2-col on `sm:`, 1-col stacked on `xs:` with engine name + count + sentiment chip
   - Run drill-down → full-width modal/sheet (not split-pane)
   - Acceptance: tested at 375×667 (iPhone SE / Pro), no horizontal scroll, all CTAs reachable with thumb.

### Persona additions

- **Affiliate Partner** — explicitly deferred for v1. UTM-tagged cross-sell cards (Stream E) preserve attribution; affiliate dashboard already exists in `affiliates.coherencedaddy.com` and reads from `activity_log` events anyway.
- **Support Rep** — out of scope until support headcount is hired. Plan stubs `role` column on admin user table (`admin | support_readonly | billing_only`) so the future role boundary doesn't require a migration.
- **Agency / multi-tenant** — v1 is single-account-per-Stripe-customer. Multi-tenant is tied to 100 Agents launch; flag any code that hard-codes "one subscription per email."

### Tour replay

- `tour_completed_at` on `customer_account` BUT also `?tour=replay` query param on any page restarts the tour. Help-menu (`?` dialog) includes a "Replay product tour" entry.

### A11y bar raised

- Lighthouse ≥ 95 (not 90).
- Sentiment NEVER color-only — always icon + text label.
- `prefers-reduced-motion` honored: tour skips animations, page transitions instant.
- All tooltips Tab-reachable; no hover-only state.
- Screen-reader-only labels on icon-only buttons.

### Stream F — Weekly digest email (NEW)

Reviewer flagged: the audit names the email as "the product experience" then proposes nothing for it. Add minimal improvements:

- Add UTM-tagged CTA at email footer: "View this run in your dashboard" → portal `/watchtower?run=<id>`
- Add prompt-version notice inline if the run used a different prompt version than the previous run
- "Manage subscription / pause / cancel" link (currently absent; high churn signal if buried)
- Plain-text version review (current HTML-only is bad for deliverability + a11y)

### Deferred (explicitly)

- Free-tier preview-run gating (the 1-free-trigger-on-signup logic from V1): deferred to a follow-up after abuse-detection metrics are in.
- GDPR data export endpoint: known gap, deferred (separate priv-eng spec).
- Account deletion flow: known gap, deferred.
- Status-page link in portal chrome: trivial follow-up.
- Aggregate cost view (per-engine $ spend): blocked on real per-call cost data; deferred.
- Driver.js tour library: deferred to a Phase-2 ship; Phase 1 uses sample-data empty states + tooltips as a lighter alternative.

---

## Phase-1 Ship list (THIS session)

Ordered by leverage. Streams below are what gets built and tested on localhost now.

### Phase 1 — A1 (portal): Watchtower customer dashboard (minimal)
Repo: `app-coherencedaddy-portal` on its existing `feat/watchtower-portal-card` branch.
- New route: `/watchtower` (single canonical path; no `/app/watchtower` alias).
- Page sections:
  - Hero "this week" card: total mentions, engines-that-found-you count, last-run timestamp, next-run countdown.
  - Engine breakdown: 5 cards (ChatGPT, Claude, Perplexity, Gemini, Grok), each with mention count + sentiment chip + "saw your brand: yes/no" badge.
  - Latest run: per-prompt collapsible with excerpts.
  - Prompts panel: read-only list of current prompts + "Edit prompts" CTA (button only; full editor is Phase 2).
  - Empty state: sample data with "Your first run is <date>" banner.
- Mobile-responsive at 375px.
- No tour library yet; Radix Tooltips on jargon (AEO, sentiment, mention).
- Reuses portal's existing tokens (`#FF6B4A` coral primary + `#0E0E10` background).

### Phase 1 — C1 (team-dashboard): Watchtower admin dashboard (minimal)
Repo: `team-dashboard` on current branch `claude/suspicious-babbage-b3764d`.
- New page: `ui/src/pages/WatchtowerAdmin.tsx`
- New backend route group: `server/src/routes/watchtower-admin.ts`
- Sections:
  - Customers table (email, plan, status, last run, last mention_count, signup date)
  - Click a row → drill-down panel: prompts, last 4 runs, per-engine result counts, errors
  - Aggregate cards: total customers, MRR, runs/week, engines-with-errors-last-7d
  - Empty/zero states everywhere
- Read-only for v1 (no edits, no refunds, no impersonation yet — those are Phase 2).
- Route protected by `requireBoardAuth` middleware (existing pattern in `intel-billing.ts`).

### Phase 1 — D1 (team-dashboard): Watchtower audit-log wiring
Repo: `team-dashboard`.
- Add `logActivity` calls inside `server/src/services/watchtower-stripe-handler.ts` for:
  - `watchtower.subscription.created`
  - `watchtower.subscription.plan_changed`
  - `watchtower.subscription.cancelled`
  - `watchtower.subscription.payment_failed`
- Surface these in the C1 admin drill-down panel.
- Defer admin-access middleware (Stream D blocker — needs separate table design).

### Phase 1 — E1 (team-dashboard backend + portal frontend): Cross-sell endpoint v1
Repo: `team-dashboard` backend + `app-coherencedaddy-portal` frontend.
- New endpoint: `GET /api/portal/upsell-cards`
  - Returns prioritized cards array, **tenure-based + entitlement-suppressed only** (no result-derived triggers in v1).
  - UTM-tagged hrefs: `?utm_source=portal-upsell&utm_campaign=<card-id>&utm_medium=<context>`.
- Portal renders cards in a shelf on `/watchtower` (NOT `/dashboard` — dedupe rule: cards appear on Watchtower page, dashboard keeps the existing `WatchtowerCrossSell` static shelf).

### Out of Phase 1 (explicitly deferred to Phase 2/3)

- Driver.js / react-joyride tour
- Prompt editor (the actual edit form)
- "Run now" button + cost ceiling middleware + rate limiter
- Prompt-version table + comparability inline notices
- Impersonation flow
- `admin_access_log` table + middleware
- Weekly digest email improvements (Stream F)
- A11y polish to Lighthouse 95
- All "Deferred (explicitly)" items above
