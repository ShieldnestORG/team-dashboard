# PRD: DevTools Live-Signal Intel (Initiative I)

**Status:** Planning — unshipped. Positioning shift, not a new vertical.
**Parent plan:** [docs/products/topic-takeover-roadmap.md](./topic-takeover-roadmap.md)
**Target repos:** team-dashboard (signal definitions + sort), `directory.coherencedaddy.com` (renderer tweak).

---

## What It Is

A repositioning of CD's existing **devtools** vertical from "another startup
list" into the **only DevTools intel directory with live signals** —
GitHub commits/stars/issues velocity, Twitter follower deltas, RSS post
cadence, npm/PyPI download trends, hiring activity.

The competitive landscape: YC's startup directory, Wellfound, Failory's
listicles. All static. CD wins by making "live" the differentiator.

---

## Customer Promise

> "Discover DevTools startups *before* they trend. Live signals, not stale
> listings."

---

## Why This Initiative

- **The directory already exists.** This is mostly a UI + sort + content
  initiative — not new infra.
- **Differentiation requires storytelling.** Without a clear "live signals
  vs static lists" frame, CD looks like another listicle.
- **Bridge product to CreditScore.** DevTools founders are
  technically-fluent and over-index on AEO/SEO awareness. They convert.

---

## Scope

**In scope:**
- New computed fields: `signal_velocity_30d`, `momentum_score`,
  `breakout_flag` on `intel_companies` for the devtools vertical.
- Sort/filter UI: "Trending this week", "Breakout candidates",
  "Quietly shipping" buckets.
- Weekly "DevTools Pulse" email digest (newsletter integration).
- Console.dev + Show HN positioning.

**Out of scope:**
- New scraping infra. Reuse Echo + existing crons.
- A separate "DevTools" microsite. The vertical lives inside the main
  intel directory.

---

## Schema

Reuse `intel_companies`. Add computed columns (refreshed by cron):

| Column | Type | Notes |
|---|---|---|
| `signal_velocity_30d` | numeric(6,2) | Composite: GitHub commit delta + Twitter follower delta + npm download delta, normalized |
| `momentum_score` | numeric(4,2) | 0–100, exponentially weighted toward last 7d |
| `breakout_flag` | boolean | `momentum_score > 80` AND `signal_velocity_30d > p90` |
| `signals_as_of` | timestamptz | |

No new tables.

---

## New Crons

| Cron | Schedule | Purpose |
|---|---|---|
| `devtools-momentum` | Every 4 hours | Recompute velocity + momentum + breakout for vertical=devtools rows |
| `devtools-pulse-digest` | Mondays 8am ET | Email top 10 momentum + 3 breakout candidates to newsletter |

---

## Renderer

`/devtools` (existing) gets new chrome:
- Default sort changes to `momentum_score desc`.
- Three filter pills: "🔥 Trending", "🚀 Breakouts", "🤫 Quietly shipping".
- Per-row signal sparkline (last 30d).
- Hover card: "Why is this trending?" — surfaces which signal moved.

---

## Content Hooks (Initiative G crossover)

- Weekly blog: "DevTools Pulse — week of YYYY-MM-DD." Becomes a
  recurring SEO surface.
- Per-breakout-flag-flip: auto-draft a "Why X is breaking out" post stub
  for editorial review.

---

## Rollout Milestones

**M1 — Compute layer (3 days)**
- New columns + momentum cron.
- Verify against 5 known breakouts (e.g. recent YC + Hacker News risers).

**M2 — UI (3 days)**
- Sort + filter + sparkline chrome.
- "Why trending" hover.

**M3 — Distribution (ongoing)**
- DevTools Pulse newsletter live.
- Show HN: "I track DevTools startups by live GitHub/Twitter signals."
- Console.dev outreach (Tier 3e backlinks).

---

## Success Metrics (60 days)

- ≥15% week-over-week traffic growth on `/devtools`.
- ≥3 breakout calls validated (i.e. a breakout flag preceded a public
  funding round or HN front-page moment).
- ≥1,000 DevTools Pulse subscribers.
- Top 10 Google for `"trending devtools startups"`.

---

## Risks + Open Decisions

- **Momentum gaming.** Founders could buy Twitter followers to game
  signals. Mitigate by composite score + GitHub-weighted (harder to fake).
- **False breakouts.** Marketing-driven spikes that don't sustain. Add a
  7d-vs-30d ratio check before flagging breakout.
- **Editorial load.** Weekly Pulse + breakout posts = real ongoing work.
  Decide upfront whether it's automated-with-review or fully manual.

---

## Dependencies

- **Upstream:** existing devtools vertical in `intel_companies`, Echo
  enrichment.
- **Downstream:** Initiative G (content cluster crossover via DevTools
  Pulse), CreditScore funnel.
