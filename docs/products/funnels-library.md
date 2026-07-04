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

### The full lifecycle a non-technical user sees (2026-07-03)

`live` isn't the end of the story — a comment→DM funnel does nothing until a
post actually tells people to comment the keyword. The library UI walks every
draft/ready/live funnel through five numbered steps so it's always obvious
what happens next, and renders the one available action as a labeled button
right on the current step:

1. **Draft** — AI wrote it, waiting for approval. *Action: Approve.*
2. **Ready** — approved, waiting to be turned on. *Action: Turn on.*
3. **Turned on** — the robot is watching comments right now. *Action: Post
   the hook.*
4. **Hook posted** — a post is telling people to comment the keyword.
   (No action — waiting for comments.)
5. **Collecting leads** — people are commenting and getting the DM.

Steps 4-5 are derived from data, not a stored status: step 4 requires at
least one `social_posts` row linked to the funnel (queued or posted, see
below); step 5 additionally requires at least one captured lead whose
keyword matches the funnel (reusing the same `GET /leads` query the
per-automation drill-down already uses, scoped to the funnel's account and
filtered client-side by keyword). `rejected`/`retired` funnels are exits from
this lifecycle and don't render the stepper.

### "Post the hook" — the missing piece

Arming a funnel only turns on the *listener*. Nobody comments the keyword
until a real post asks them to — that's what `post_hooks[]` (3 AI-written
caption ideas per funnel) are for, and until now nothing used them after
arming. Fixed 2026-07-03:

- **Ready and live** funnels get a "Post the hook" button that opens a small
  picker over the funnel's `post_hooks` (plus "write my own"), then hands
  off to Compose using the exact same seam as Content Hub's "Send to
  Compose" (`prefillText` + the account pre-selected by matching
  handle+platform) — plus a `prefillFunnelId` that Compose forwards to
  `POST /posts` as `payload.funnelId`.
- `POST /posts` validates that `funnelId`: syntactic uuid check
  (`isValidFunnelIdFormat`), then confirms the funnel exists and belongs to
  this company. An invalid/foreign id is silently dropped from the payload —
  it never rejects the post itself, matching this route's existing tolerant
  parsing.
- `GET /funnels/:id/posts` (board-readable, no new migration — `payload`
  jsonb already exists on `social_posts`) returns every post linked to a
  funnel (`payload->>'funnelId' = id`), newest first. The library row
  queries this for every `ready`/`live` funnel (not just when expanded) and
  shows a `StatusBadge` per linked post in the expanded detail.
- A **live** funnel with zero queued-or-posted hook posts shows an amber
  callout right on the collapsed row: *"Nothing is telling people to comment
  KEYWORD yet — post the hook."* — the whole point of the stepper is that
  this is visible without opening anything.

### Killing the empty-DM "ready" trap

Catalog-imported rows (`mapCatalogEntryToFunnelInsert`) always land with
`dmMessage: ""` — a catalog entry mapped to `ready`/`built` was technically
"ready" in the DB while `canArm` would still reject it (empty DM). That
inflated the coverage target without anything actually being armable.
Decided 2026-07-03: blank-DM funnels are now excluded from `readyCount` (the
number that has to hit `READY_TARGET`) even though they still show up in
`counts.ready` for the raw status tooltip — see `tallyFunnelCoverage()` in
`funnels-service.ts`. They also get a **"Needs DM text"** amber badge and
Edit becomes their emphasized action; **Approve** is now blocked
server-side too (`approveFunnel` → 409 `"Add the DM message first"`) and
disabled client-side with a tooltip before the click. The same
before-the-click treatment applies to **Turn on** — `canArm`'s existing
DM/keyword/funnels-off checks are now surfaced as a disabled-button tooltip
instead of only failing after the confirm dialog.

### Account funnels-off, handled inline

If an account's `funnels_enabled` is off, **Turn on** is disabled with
"Funnels are switched off for this account" right there in the row/stepper,
and an admin sees an inline **"Enable funnels for @handle"** button (with
its own confirm dialog) that calls the existing
`PATCH /accounts/:id/funnels` — no need to leave the funnel row to find the
Accounts table.

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
| GET | `/api/socials/funnels/:id/posts` | Posts linked to this funnel (`payload.funnelId`), newest first — board-readable |

`POST /socials/posts` additionally accepts an optional `payload.funnelId` —
validated (uuid format, funnel exists + belongs to this company) and
silently dropped otherwise; see "Post the hook" above.

## UI

`ui/src/pages/Funnels.tsx` — "Funnel library" section, directly under the KPI
tiles. The card header's help tip is the plain-English "how a funnel works"
explainer (post → DM → landing page → lead) plus the draft/ready/live
one-liner. Per-account coverage chips (`@handle 3/5 ready`, green at ≥5,
amber below — blank-DM rows excluded from the count) sit above a table of
funnels grouped by account with style/status badges, a "Needs DM text" amber
badge, and a live-with-no-hook-post amber callout. Expanding a row shows the
5-step lifecycle stepper (with the current step's action button inline) plus
DM message/post hooks/notes/ToS risk/linked hook posts. Admin actions are
labeled buttons (icon + text): Approve, Reject, Edit, Post the hook, Turn on
(confirm dialog: "This goes live on Instagram immediately"), Retire — each
guard (blank DM, blank keyword, account funnels-off) surfaces as a
disabled-button tooltip before the click, not just a post-click error.
Non-admins see the same view read-only. KPI tile: "Accounts at 5+ ready".

## Files

### Backend
- `packages/db/src/schema/funnels.ts`
- `packages/db/src/migrations/0149_funnels.sql`
- `server/src/services/socials/funnels-service.ts` — catalog import, AI
  drafting + defensive parser, status-transition guards, `tallyFunnelCoverage`
  (blank-DM exclusion), `hasDmMessage`/`isValidFunnelIdFormat` guards,
  arm/retire orchestration, the top-up cron
- `server/src/routes/socials.ts` — `/api/socials/funnels/*` incl.
  `GET /funnels/:id/posts`; `POST /posts`' `payload.funnelId` validation
- `server/src/services/social-crons.ts` — `socials:funnel-topup` registration
- `server/src/__tests__/funnels-service.test.ts` — parser + guard +
  coverage-tally unit tests

### Frontend
- `ui/src/api/socials.ts` — `LibraryFunnel`, `FunnelCoverageRow`,
  `FunnelHookPost` types + the `socialsApi.*LibraryFunnel*` / `funnelCoverage`
  / `generateLibraryFunnels` / `funnelPosts` methods
- `ui/src/pages/Funnels.tsx` — Funnel Library section, lifecycle stepper,
  "Post the hook" picker, inline "Enable funnels" action
- `ui/src/pages/socials/SocialsCompose.tsx` — forwards `prefillFunnelId` as
  `payload.funnelId` on submit
- `ui/src/lib/queryKeys.ts` — `queryKeys.funnels.library` / `.coverage` /
  `.hookPosts`

## Verification

1. `npx tsc --noEmit --project server/tsconfig.json` and `cd ui && npx tsc --noEmit` — zero errors.
2. `npx vitest run server/src/__tests__/funnels-service.test.ts` — parser + guard + coverage-tally tests pass.
3. `GET /api/socials/funnels/coverage` — one row per `zernio_account_id`-bearing account, catalog-seeded on first call, blank-DM `ready` rows excluded from `readyCount`.
4. UI **Funnels → Funnel library** — coverage chips render, lifecycle stepper shows the right step + action per funnel, admin actions gated correctly for a non-admin session.
5. "Post the hook" on a live funnel → Compose pre-filled and account pre-selected → queue it → the funnel's expanded detail shows the new post's `StatusBadge` and the amber callout clears.
