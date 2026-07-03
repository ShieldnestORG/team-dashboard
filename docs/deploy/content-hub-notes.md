# Content Hub — deploy notes

Branch `feat/marketing-content-hub`. Started during the 2026-07-02 review-fix
pass; the Wave-4 integration agent extends this file with env vars, migration
notes, and the marketing-onboarding runbook.

## Decisions from the review-fix pass

- **Marketing-only users land on the Content Hub, not the Dashboard.** The
  build plan's Wave-3 sketch listed Dashboard + Inbox in the marketing
  sidebar, but the server gate (deliberately) blocks every data read those
  pages make (`/api/companies/:id/dashboard`, approvals, heartbeats, issues) —
  showing them produced a first screen full of 403s. Resolution: the UI route
  allowlist is now `{socials, content-hub}`, the board index redirects
  marketing users to `/content-hub`, and the Dashboard/Inbox/New Issue/Search
  affordances are hidden for them. If Mark wants marketing users to have a
  Dashboard later, extend the server allowlist first (mirror every added
  prefix in `server/src/__tests__/marketing-role.test.ts`), then re-add the
  routes.
- **Voice-snippet cost guard:** `POST /api/voice-snippets` now caps paid
  generations (cache misses) at 200 per user per UTC day → plain-English 429.
  Override with `VOICE_SNIPPETS_DAILY_LIMIT` in the environment if Eagan's
  team legitimately needs more. Cached lines never count.

## Deferred review findings

- **Per-company marketing-role gate (minor, security).** The gate restricts a
  user only when EVERY active membership has `membership_role='marketing'`.
  One non-marketing membership (e.g. an admin adds the marketing user to a
  second company with the default `member` role) voids ALL restrictions —
  including costs/secrets reads on the marketing company, because plain
  membership passes `assertCompanyAccess`. Shipped mitigation: the gate logs a
  loud warning (once per user per process) when it sees a mixed-role user, and
  the middleware header documents the escalation. The real fix — restricting
  per company (gate the companies where the membership role IS `marketing`)
  — needs a path→company resolver across the API surface and is deferred as a
  follow-up. Until then: **never grant a marketing user a non-marketing
  membership; mint every additional membership (CD + TOK) with
  `membershipRole='marketing'`** (the Wave-4 onboarding runbook must repeat
  this rule).
