# Tokns as a first-class project (TOK)

> **Cluster:** ops-deploy · **Tags:** tokns, tok, company-prefix, project-rail, sidebar-config, redirects · **Related:** [OWNERSHIP](OWNERSHIP.md), [companies spec](companies/companies-spec.md), [HANDOFF §3](../../team-dashboard/HANDOFF-marketing-content-hub.md)

**Status:** Decision record + onboarding runbook (2026-07-02, marketing Content Hub build, Wave 2/B).

## Decisions

### 1. Issue prefix is `TOK`, not `TOKNS`

`tokns` is a board route root (`/CD/tokns` is a page path, listed in
`ui/src/lib/company-routes.ts` `BOARD_ROUTE_MANIFEST`). An issue prefix of
`TOKNS` would collide with route-root classification and produce
double-prefix bugs (`/TOKNS/tokns` vs `/tokns` ambiguity in
`extractCompanyPrefixFromPath` while companies are loading).

`TOK` is exactly what the server auto-derives from the company name "Tokns"
(`server/src/services/companies.ts` `deriveIssuePrefixBase`: uppercase, strip
non-A-Z, first 3 chars → `TOK`), so it needs **zero** schema or service
changes. The handoff's `/TOKNS/...` example is unsafe as written; use
`/TOK/...`.

### 2. The company row is DATA, not code

No seed script and no migration. `POST /api/companies` and the branding
PATCH already exist; a migration for one row would be speculative code. Mark
(instance admin — company creation is gated `isInstanceAdmin`,
`server/src/routes/companies.ts` `router.post("/")`) creates the row through
the onboarding wizard (runbook below).

### 3. Tokns + TX Ecosystem pages MOVED under TOK, with redirects

Both pages (`ui/src/pages/Tokns.tsx`, `ui/src/pages/TxEcosystem.tsx`) are
company-agnostic (no `companyId`/`useCompany` usage) — this is a
presentation-only move. The routes still exist under every prefix, but a
gate in `ui/src/App.tsx` (`TokProductRoute`) redirects any non-TOK prefix to
the TOK-prefixed path:

- `/CD/tokns` → `/TOK/tokns`
- `/CD/tx-ecosystem` → `/TOK/tx-ecosystem`
- bare `/tokns` → Layout auto-corrects to the active prefix (e.g.
  `/CD/tokns`) → redirects to `/TOK/tokns`

The redirect only fires when a company with prefix `TOK` actually exists. On
a fresh instance without the Tokns company, the pages render in place under
whatever prefix was used (no redirect into an invalid-prefix 404). Under
`/TOK` the active prefix matches, so there is no redirect loop.

TX brand tags woven through the shared socials tooling stay where they are —
they are tags, not pages.

### 4. Per-company sidebars

`ui/src/config/company-sidebars.tsx` (`getSidebarConfig(issuePrefix)`) keys
the sidebar on the company's issue prefix:

- **Default (CD and any unknown prefix):** today's full CD layout, minus the
  Tokns / TX Ecosystem entries under PRODUCTS (they moved to TOK).
- **`TOK`:** minimal — Dashboard, Inbox, Products (Tokns, TX Ecosystem),
  Content & Socials. Marketing works cross-company from CD anyway; the TOK
  sidebar deliberately omits Work/Org/Ops sections. Deep links (e.g.
  `/TOK/company/settings`) still work — routes are not removed, just not
  listed.

Dashboard, Inbox, New Issue, and plugin slots are structural (rendered by
`Sidebar.tsx` for every company). The Content Hub item and marketing-role
filtering land on top of this config in Wave 3 (see the `WAVE-3` marker in
the config file).

## Runbook: create the Tokns company

1. **Sign in as instance admin** (only instance admins can create
   companies).
2. Click the **"+"** button at the bottom of the left project rail — this
   opens the onboarding wizard.
3. **Step 1:** name the company exactly **`Tokns`** (goal optional) and
   click Next. The company row is created immediately at this step and the
   prefix auto-derives to **TOK**.
4. **The starter-agent step is skippable:** close the wizard (X button)
   after step 1 completes. Steps 2–4 (agent + starter task) only create
   additional rows; the company already exists.
5. **Branding:** switch to the Tokns company → Settings
   (`/TOK/company/settings`) → set the brand color and logo. (API
   equivalent: `PATCH /api/companies/:companyId/branding` with
   `{ brandColor, logoAssetId }`.)
6. Verify: the rail now shows CD + Tokns; clicking Tokns switches the
   sidebar to the TOK layout; `/CD/tokns` redirects to `/TOK/tokns`.

## Memberships (who sees the Tokns project)

The project rail is **membership-filtered for non-admins**
(`server/src/routes/companies.ts` `GET /` filters by the actor's
`companyIds`; instance admins and local dev mode see everything). A
marketing user therefore needs a membership in **BOTH** CD and TOK to see
both projects — mint **two invites** per marketing user (the invite flow
supports this; the Wave 4 deploy runbook covers the exact steps, including
the marketing `membershipRole` and the 10-minute invite TTL).

Note: in local dev (`local_trusted` mode) everyone is an implicit admin, so
membership filtering is invisible — verify it in authenticated mode.
