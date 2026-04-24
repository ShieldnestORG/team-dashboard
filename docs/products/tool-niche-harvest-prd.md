# PRD: Tool Niche Harvest (Initiative D)

**Status:** Planning — unshipped. Background priority.
**Parent plan:** `coherencedaddy-landing/docs/plans/2026-04-24-directory-expansion.md`
**Target repos:** team-dashboard (backlog table + import script). No runtime impact — this is backlog hygiene.

---

## What It Is

A one-time harvest pass over the research outputs that produced the phase-1 utility microsites (`dailycompound.app`, `visawait.app`, `tokencount.dev`) to capture the **surplus niches that were considered but not built**. Those surplus candidates sit in Firecrawl SERP scans and Ollama scoring runs from `scripts/utility-network/research-niches.ts`.

Harvest them into a tracked backlog so future tool-authoring sessions pick from a scored list instead of re-running discovery.

---

## Customer Promise

Internal initiative — no direct customer. Speeds up utility-network phase-2 tool selection from "needs a new research run" to "pick the next item off the scored list."

---

## Why This Initiative

- Phase-1 research surfaced far more viable niches than the 3 sites we ended up building for. That work isn't tracked anywhere queryable.
- Every new utility site today starts with a fresh Firecrawl run — wasteful given we already paid for prior scans.
- Utility-network phase 2 is planned (per `docs/products/utility-network/README.md`) — this directly feeds it.

---

## Scope

**In scope:**
- Locate the research artifacts from `research-niches.ts` runs (logs, scored output files, any persistent state).
- Normalize into a `tool_niche_backlog` table.
- Tag each niche with difficulty + estimated RPM tier + utility-site / tool-page suitability.
- Ship a simple admin view for picking the next niche.

**Out of scope:**
- New research runs (phase 1's outputs only).
- Automated tool-authoring (still manual per the utility-network playbook).
- Attribution (which niche produced which eventual revenue).

---

## Data Flow

```
research-niches.ts historical outputs (filesystem / scripts logs)
        ↓
one-shot import script: scripts/import-tool-niche-backlog.ts
  parses output files, scored entries
        ↓
tool_niche_backlog table populated
        ↓
admin view in team-dashboard: /tools-backlog
  sortable by score, difficulty, RPM tier, status
        ↓
when a niche is picked up for build: status → in_progress
when shipped: status → shipped, linked to the new site/tool slug
```

---

## Schema

### `tool_niche_backlog`

| Column | Type | Notes |
|---|---|---|
| `id` | serial PK | |
| `niche` | text | Short slug (e.g. `compound-interest-daily`, `h1b-lottery-odds`) |
| `description` | text | One-sentence summary |
| `source_query` | text | The SERP query / research input that surfaced this |
| `target_format` | text | `utility-site` / `tool-page` / `calculator` / `article` |
| `difficulty` | text | `low` / `medium` / `high` (build complexity) |
| `estimated_rpm_tier` | text | `low` / `medium` / `high` — from research-niches.ts scoring |
| `search_volume_estimate` | int | Nullable; if research captured it |
| `score` | numeric(4,2) | Original research-niches.ts composite score |
| `status` | text | `backlog` / `in_progress` / `shipped` / `skipped` |
| `shipped_artifact` | text | Nullable; the site slug or tool-page path if shipped |
| `notes` | text | Admin free-form |
| `imported_at` / `updated_at` | timestamptz | |

No foreign keys — this is a standalone idea-tracking table.

---

## Implementation

**Single script + single admin view. That's it.**

1. **`scripts/import-tool-niche-backlog.ts`** (team-dashboard): locates research-niches.ts output files, parses them, inserts into `tool_niche_backlog`. Run once.
2. **`ui/src/pages/ToolsBacklog.tsx`**: plain table with filters on target_format / difficulty / status. Click a row to edit notes / change status.

No crons. No agents. No outbound. No user-facing surface.

---

## Rollout Milestones

**M1 — Find artifacts + migrate (1 day)**
- Schema migration.
- Locate research-niches.ts output files. (If they don't exist as persisted artifacts — the script may have run and printed to stdout only — scope expands to replay the research queries once more and capture output this time. Treat as a gotcha; investigate before estimating.)
- Import script populates table.

**M2 — Admin view (1 day)**
- `ToolsBacklog.tsx` page shipped.
- Link from Dashboard homepage: "Tools backlog: {N} niches".

**M3 — First harvest pick (ad-hoc)**
- Pick one niche, ship a tool or utility site, update status to `shipped`. Proves the loop works.

---

## Success Metrics

- **Backlog populated with ≥30 niches** within a week.
- **Phase-2 utility site #1 sourced from backlog** (not a fresh research run) within a month.
- **Avg time-to-pick < 2 min** in the admin view.

---

## Risks + Open Decisions

- **Artifacts may not exist.** `research-niches.ts` may have logged to stdout only. If so, this initiative's scope expands to "re-run research + capture outputs this time." Check first before committing.
- **Score decay.** SERP volumes and competition shift month-over-month. Scores older than ~6 months should be flagged for re-scoring before a pick. Add a `score_as_of` timestamp — small enhancement to the schema.
- **Temptation to over-engineer.** This is a backlog table, not a product. Keep it spartan — no agent assignments, no automation. The value is in having the list, not processing it.

---

## Dependencies

- `scripts/utility-network/research-niches.ts` — source of truth for scoring logic.
- `docs/products/utility-network/README.md` — owns the build playbook that consumes the backlog.

---

## Post-Ship Documentation Updates

When M2 completes:
- `docs/products/utility-network/README.md` — add "next niches sourced from `tool_niche_backlog`" note.
- `TODO.md` (both repos) — close Initiative D checkboxes.

No mermaid or org-structure updates needed — this is too small to warrant diagram changes.
