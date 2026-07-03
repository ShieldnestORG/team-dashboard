# Funnel Library

> **Cluster:** socials · **Tags:** funnels, zernio, comment-automation, dm-funnel, ai-draft, funnel-library
> **Related:** [Socials Hub](socials-hub.md), [Cron Inventory](../operations/cron-inventory.md)

A standing library of comment→DM "funnel" drafts per Zernio-capable social
account. Goal: every account with a `zernio_account_id` always has **at
least 5 funnels "ready to go"** (approved, not yet live) so there's always
something for a human to arm on Zernio without waiting on drafting.

## What is a funnel?

Comment the keyword → get a two-step DM → land on a page. Concretely:

1. Someone comments the KEYWORD on a post.
2. Zernio's comment-automation sends DM #1 — a link-free opener that asks
   them to reply/confirm.
3. When they reply (in-window), DM #2 carries the tracked link/button.

Each library row also carries 3 caption "post hooks" — captions that end on
the keyword CTA, for posts meant to drive comments into the funnel.

## Lifecycle

```
draft --(admin approve)--> ready --(admin arm)--> live --(admin retire)--> retired
  \--(admin reject)--> rejected                     ^
   ready --(admin reject)--------------------------/
```

| Status | Meaning |
|---|---|
| `draft` | Not yet reviewed — AI-drafted or admin-authored, awaiting a human. |
| `ready` | Approved and waiting. Not running on Instagram yet. |
| `live` | Running on Instagram right now (a real Zernio comment automation exists). |
| `rejected` | An admin decided not to pursue it. |
| `retired` | Was `ready` or `live`, shelved/killed. If it was `live`, the Zernio automation was deleted first. |

**Arm** is the only action that touches Zernio: it calls the same
`createZernioCommentAutomation` the existing `POST /zernio/automations`
route uses, requires `status='ready'` AND the account's `funnels_enabled`
gate to be on, and on a Zernio failure leaves the row `ready` (never marks
something live that Zernio rejected). **Retire** reverses it — `DELETE` on
Zernio (tolerating an already-gone 404, same as the account-level kill
path), then `status -> retired`.

Writes are admin-only (`requireAdmin` — owner + instance admins). Marketing
employees see the same page but every action is read-only.

## Data model

`funnels` (migration `0149_funnels.sql`, schema
`packages/db/src/schema/funnels.ts`):

```
id, company_id (fk companies)
catalog_id            -- funnel-catalog.json entry id this row was seeded from, or NULL
name, account_handle   -- "@handle" without the leading @
social_account_id      -- fk social_accounts, resolved by handle lookup
keywords[]              -- 1-2 short ALL-CAPS words
match_mode              -- 'exact' | 'contains'
dm_message              -- <=640 chars (Zernio button_template limit)
destination_url
post_hooks[]             -- up to 3 caption hooks
style                   -- 'standard' | 'controversial' | 'weird'
tos_risk, notes
status                  -- 'draft' | 'ready' | 'live' | 'rejected' | 'retired'
created_by              -- board user id, or 'ai:<model>' for AI drafts
approved_by_user_id
zernio_automation_id    -- set while status = 'live'
created_at, updated_at
```

## Catalog import

The pre-existing read-only strategy catalog
(`server/src/content-templates/funnel-catalog.json`, served at
`GET /socials/funnels/catalog`) is lazily upserted into `funnels` on first
read of any funnel-library endpoint (`ensureFunnelCatalogImported` in
`funnels-service.ts`), keyed on `catalog_id` (unique, insert-only —
re-importing never overwrites a row an admin has since acted on).

Catalog status → funnel status:

| Catalog `status` | Funnel `status` |
|---|---|
| `live` | `live` |
| `ready`, `built` | `ready` |
| `planned`, `idea` | `draft` |
| `blocked-on-account` | `draft` (note appended) |
| `wont-build` | `rejected` |
| anything else | `draft` (note: "Unmapped catalog status") — fail loud, never silently dropped |

Multi-account catalog entries (e.g. `"accounts": ["all brand"]`) get
`account_handle = 'multi-account'` and don't count toward any real account's
coverage.

## AI drafting

`POST /funnels/generate` (admin) and the daily cron below both call
`generateFunnelDraftsForAccount()`, which:

1. Builds a strict-JSON prompt via `callLlmChat` (the shared Ollama↔Claude
   router — never a provider SDK directly) with: the account handle, known
   destination URLs harvested from the catalog for that account (free tools
   like `coherencedaddy.com/tools/*`, `jointhecoherent.com`), the 2-step DM
   mechanic, the three style definitions, and existing funnel names/keywords
   for that account (avoid duplicates).
2. Parses the response defensively (`parseFunnelDrafts`) — strips markdown
   fences implicitly (regex-extracts the first `[...]` block), validates
   every field, drops invalid entries. **Never throws** on bad model output:
   garbage in → `[]` out; a partially-malformed array still yields whatever
   entries pass validation. Unit-tested in
   `server/src/__tests__/funnels-service.test.ts`.
3. Inserts survivors as `status='draft'`, `created_by='ai:<model>'`.

### Styles

| Style | Definition |
|---|---|
| `standard` | Clear value hook — plainly states what the person gets and why it's worth a comment. |
| `controversial` | Spicy, contrarian take that provokes debate — **never** hateful, harassing, defamatory, or health/finance misinformation. |
| `weird` | Absurd, playful bait ("comment SPOON or your Tuesday runs backwards") — obviously nonsense, intriguing, tells the user to comment. |

Every draft must stay Instagram-ToS-safe: keyword-gated only (never
fire-on-any-comment), no destination-masking, no multi-message qualification
loops, no promo-DM drip — the same hard lines documented in
[Socials Hub](socials-hub.md#zernio-engagement-layer-2026-07-01).

## Cron: daily top-up

`socials:funnel-topup` (`server/src/services/social-crons.ts`, daily 05:30):
for every funnels-capable account, if `count(status IN ('draft','ready')) < 5`,
generates the shortfall (capped at 10 drafts/run across every account so one
bad prompt/provider outage can't spam every account). **Never approves or
arms** — drafts always await a human. See
[Cron Inventory](../operations/cron-inventory.md).

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/socials/funnels?accountHandle=&status=` | List (board-readable) |
| GET | `/api/socials/funnels/coverage` | Per funnels-capable account: counts by status + the 5-ready target |
| POST | `/api/socials/funnels` | Create (admin, `status='draft'`) |
| PATCH | `/api/socials/funnels/:id` | Edit (admin; draft/ready only — live/retired rows are immutable) |
| POST | `/api/socials/funnels/:id/approve` | `draft -> ready` (admin) |
| POST | `/api/socials/funnels/:id/reject` | `draft`/`ready -> rejected` (admin) |
| POST | `/api/socials/funnels/:id/arm` | `ready -> live`; creates the real Zernio automation (admin) |
| POST | `/api/socials/funnels/:id/retire` | `ready`/`live -> retired`; deletes the Zernio automation if live (admin) |
| POST | `/api/socials/funnels/generate` | AI-draft `{accountHandle, count?, styles?}` (admin) |
| GET | `/api/socials/funnels/catalog` | Read-only strategy catalog (unchanged, pre-existing) |

## UI

`ui/src/pages/Funnels.tsx` — "Funnel library" section, directly under the KPI
tiles: per-account coverage chips (`@handle 3/5 ready`, green at ≥5, amber
below), funnels grouped by account with style/status badges, an expandable
detail row (DM message, post hooks, notes, ToS risk), and admin actions
(Approve, Reject, Edit, Arm — confirm dialog: "This goes live on Instagram
immediately", Retire, "Generate 5 drafts" per account). Non-admins see the
same view read-only. KPI tile: "Accounts at 5+ ready".

## Files

### Backend
- `packages/db/src/schema/funnels.ts`
- `packages/db/src/migrations/0149_funnels.sql`
- `server/src/services/socials/funnels-service.ts` — catalog import, AI
  drafting + defensive parser, status-transition guards, coverage, arm/retire
  orchestration, the top-up cron
- `server/src/routes/socials.ts` — `/api/socials/funnels/*`
- `server/src/services/social-crons.ts` — `socials:funnel-topup` registration
- `server/src/__tests__/funnels-service.test.ts` — parser + guard unit tests

### Frontend
- `ui/src/api/socials.ts` — `LibraryFunnel`, `FunnelCoverageRow` types + the
  `socialsApi.*LibraryFunnel*` / `funnelCoverage` / `generateLibraryFunnels`
  methods
- `ui/src/pages/Funnels.tsx` — Funnel Library section
- `ui/src/lib/queryKeys.ts` — `queryKeys.funnels.library` / `.coverage`

## Verification

1. `npx tsc --noEmit --project server/tsconfig.json` and `cd ui && npx tsc --noEmit` — zero errors.
2. `npx vitest run server/src/__tests__/funnels-service.test.ts` — parser + guard tests pass.
3. `GET /api/socials/funnels/coverage` — one row per `zernio_account_id`-bearing account, catalog-seeded on first call.
4. UI **Funnels → Funnel library** — coverage chips render, admin actions gated correctly for a non-admin session.
