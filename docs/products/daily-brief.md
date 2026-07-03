# Daily AI Brief + Inspiration Board

A daily AI loop that reads the last 7 days of performance across every
channel and tells the team what worked, what's underused, and what to make
next — plus a board where the team pastes links to good posts they saved
(mostly Instagram) for the AI to mine for ideas.

## Why

Performance data already lives in five separate places (Zernio analytics, X
analytics, captured leads, University email events, Watchtower) and nobody
reads all five every morning. The Daily Brief is one page that does that
reading for the team and writes a plain-English summary. The Inspiration
board closes the loop the other direction: instead of a good post living and
dying in someone's saved-posts tab, it becomes an input the AI actually
looks at.

## Surfaces

| Route | Sidebar entry | Gate |
|---|---|---|
| `/daily-brief` | **Daily Brief** (icon `Sparkles`) | Board read for everyone (incl. marketing role); "Run now" is admin-only |
| `/inspiration` | **Inspiration** (icon `Lightbulb`) | Any marketing/board user can add; delete/archive is creator-or-admin |

Both live in the **Content & Socials** sidebar group (`ui/src/config/company-sidebars.tsx`).

## Data model (migration `0150_daily_brief_inspiration.sql`)

- **`inspiration_items`** — `id, company_id, url, note, added_by_user_id, status ('new'|'reviewed'|'archived'), ai_comment, created_at`. A row starts `new`; the daily-brief cron reviews every `new` row once a day, writes `ai_comment`, and flips it to `reviewed`. A human can `archive` a row directly.
- **`daily_briefs`** — `id, company_id, brief_date, sections (jsonb), model, created_at`, unique on `(company_id, brief_date)`. `sections` is the LLM's parsed output (see shape below); on a parse failure it instead holds `{ fallback: { rawText, parseError } }` so nothing is silently lost.

Drizzle schema: `packages/db/src/schema/daily_brief.ts` (exports `inspirationItems`, `dailyBriefs`).

## Routes (`/api/socials/*` — reuses the existing marketing-role-gate allowlist)

- `GET /inspiration` / `POST /inspiration { url, note? }` — any marketing user; `url` must be http(s) (`validateInspirationUrl`).
- `DELETE /inspiration/:id` / `POST /inspiration/:id/archive` — creator (`added_by_user_id`) or admin only.
- `GET /briefs` — list of `{ briefDate, model, createdAt }`, most recent first.
- `GET /briefs/latest`, `GET /briefs/:date` (`YYYY-MM-DD`) — 404 when none exists yet.
- `POST /briefs/run-now` — `requireAdmin` (same pattern as every other admin-gated Zernio/socials route, `routes/socials.ts:201-240`). Runs the same tick the cron runs, synchronously, and returns its result.

## The cron: `socials:daily-brief`

Registered in `server/src/services/social-crons.ts`, schedule `15 7 * * *`
(07:15 daily, right after `socials:zernio-analytics` at 06:40 so the same
day's Zernio snapshots are already fresh). Implementation:
`server/src/services/socials/daily-brief.ts`.

Per run:

1. **Gather** the last 7 days, top-N capped per source (never inlines raw HTML or an unbounded jsonb blob):
   - Zernio: last 15 `zernio_post_analytics` rows + the latest snapshot per metric (`best-time`, `posting-frequency`, `follower-stats`, `content-decay`) via the existing `latestZernioSnapshots` reader.
   - X (Twitter): top 10 `x_tweet_analytics` rows by engagement, **kept in its own section** — Zernio and X numbers are never blended into one claim, matching the existing hard line in `zernio-analytics.ts`.
   - Captured leads: `social_leads` counts grouped by `(zernio_account_id, keyword)`, top 15 groups (funnel performance signal).
   - University email engagement: reuses `getUniversityEmailStats(db, since)` from `university-email-events.ts` — counts only, no PII beyond what that reader already returns.
   - Watchtower (LLM answer-engine brand mentions): **always a stub today**. `watchtower_subscriptions` is a customer-facing product keyed on a portal `account_id`, not on this team's own company — there is no cheap, correctly-scoped read for "our own brand's" mentions yet, so the brief always says so rather than guessing at scoping that doesn't exist. Revisit if/when an internal subscription is wired.
   - Every `inspiration_items` row with `status = 'new'` (capped at 15/run).
2. **One `callLlmChat` call** (`services/llm-client.ts` — the same Ollama↔Claude router every other content feature uses) with a strict-JSON system prompt.
3. **Defensive parse** (`parseBriefResponse`) — never throws. Valid JSON (even inside a stray ` ```json ` fence) is normalized field-by-field with safe defaults for wrong types; anything else produces `{ fallback: { rawText (capped 4000 chars), parseError } }`.
4. **Upsert** into `daily_briefs` on `(company_id, brief_date)`.
5. **Mark every inspiration item that was sent to the LLM as `reviewed`**, using its matched `inspirationReview[].comment` (matched by exact `url`) or a generic fallback comment when the parse failed or the model didn't return an entry for it — items must not pile up forever waiting on a perfect match.

### Brief JSON shape

```jsonc
{
  "whatWorked": ["..."],
  "underutilized": ["..."],          // accounts/platforms below posting cadence or with decaying engagement
  "contentSuggestions": { "@handle": ["idea 1", "idea 2", "idea 3"] },
  "funnelSuggestions": ["..."],
  "inspirationReview": [{ "url": "...", "comment": "..." }],
  "llmVisibility": "one short paragraph — Watchtower summary, or 'not wired up yet'",
  "summary": ["5 short plain-English bullets — read first"]
}
```

## UI

- **Daily Brief** (`ui/src/pages/DailyBrief.tsx`): summary bullets on top, then What Worked / Underused cards, content + funnel suggestion cards, inspiration review, LLM-visibility card. A date `<select>` (populated from `GET /briefs`) switches between historical briefs; empty state explains when the first brief lands. "Run now" button is admin-only. `HelpTip`: *"Every morning the AI reads yesterday's numbers across every account and writes this page. Green = keep doing, amber = underused."*
- **Inspiration** (`ui/src/pages/Inspiration.tsx`): paste-a-link form (url + optional note) + list showing status badge and the AI's comment once reviewed. `HelpTip`: *"Saw a great post? Paste its link here. The AI reviews the list every morning and mines it for content and funnel ideas."*

Both reuse the existing `HelpTip`, `EmptyState`, `PageSkeleton`, and card/table styling from the rest of the socials surfaces.

## Tests

`server/src/__tests__/daily-brief.test.ts` — pure-function tests for `parseBriefResponse` (strict JSON, fenced JSON, invalid JSON, non-object top level, wrong-typed field coercion, raw-text capping) and `validateInspirationUrl` (http/https only, trims whitespace, rejects non-string/empty/other schemes).
