# Stigmergy Bridge — Running Followups

> **Cluster:** Plans · **Tags:** stigmergy, agent-memory, obsidian, qdrant, knowledge-extractor, followups · **Related:** [Skills Pipeline Integration](skills-pipeline-integration.md), [Docs Index](../README.md)

Tracks remaining work after the initial stigmergy bridge shipped in
[PR #57](https://github.com/ShieldnestORG/team-dashboard/pull/57) on 2026-05-11.

The bridge connects two substrates:
- **team-dashboard `agent_memory`** — live operational trail for dashboard agents
  (Atlas, Rizz, Recall, Nexus, …)
- **Obsidian/Qdrant brain** — settled knowledge for Claude-in-Code

Shipped in #57:
- Comment knowledge extractor service + cron (`memory:extract-comments`, every 5 min)
- Contradiction decay on `(subject, predicate)` conflicts
- Brain backfill: team-dashboard `docs/` symlinked + indexed (~2000 chunks)
- Workstation scheduled task: `team-dashboard-operational-state` (weekly)

---

## Immediate followups (next PR or two)

### 1. Issue-resolution reinforcement hook
**Where:** [`server/src/services/issues.ts`](../../server/src/services/issues.ts) — `updateIssue`, after the transaction returns
**What:** When `status` transitions to `done`, bump `confidence` by `+0.1` (capped at 1.0) on every `agent_memory` row where `source LIKE 'issue:<id>:%'`. Fire-and-forget after the transaction commits so a memory write error can't roll back the issue update.
**Why:** Completes the stigmergy loop — the "ant returned with food" signal. Currently the extractor reinforces only via re-extraction; explicit success reinforcement is a stronger and faster signal.
**Size:** ~15 lines + 1 helper function.

### 2. Tests for the comment-knowledge-extractor
**Where:** `server/src/__tests__/comment-knowledge-extractor.test.ts`
**Pattern:** Mirror [`relationship-extractor.test.ts`](../../server/src/__tests__/relationship-extractor.test.ts).
**Cover:**
- `parseTriples` happy path + denylist drops + invalid-predicate drops
- `looksLikeNonEntity` matrix
- Contradiction decay: insert pre-existing triple, then upsert with same `(subject, predicate)` but different `object` → confirm old row's confidence decreased by 0.15 and new row exists
- Exact-match upsert: confidence → MAX(existing, new)
- Processed-ledger skip behavior

---

## Verification followups (do before relying on the pipeline)

### 3. Backfill old issue comments
**What:** The extractor's SELECT window is `last 7 days`. Months of comment history exist with extractable knowledge. Run a one-shot script with a wider window (e.g. last 180 days) to seed the memory pool.
**Risk:** Ollama cost + potential schema mistakes in older comments. Run in batches of 50 with manual review of the first batch's output.
**Size:** ~30 lines, can be a CLI script under `scripts/`.

### 4. Auto-load brain sync plist
**Where:** `~/local-brain/com.local-brain.sync.plist`
**Currently:** `RunAtLoad=false`, `StartInterval=600` — meaning the workstation's incremental sync runs every 10 min ONLY if the plist is loaded into launchd, and it isn't by default.
**What:** Document the choice (manual vs. auto), and if auto: `cp ... ~/Library/LaunchAgents/ && launchctl load …` per the plist header.
**Why:** The weekly operational-state digest writes a markdown file to the vault; if sync isn't loaded, the file won't be searchable in Qdrant until the next manual `sync` skill invocation.

---

## Future enhancements (real new work, not cleanup)

### 5. `recall:graduate-triples` cron — server-side brain writes
**What:** Promote high-confidence triples (`confidence ≥ 0.85` + N evidence pieces) from `agent_memory` directly *into* a markdown file in the Obsidian brain — written from the server, not the workstation scheduled task. Replaces option-B (workstation-only) with option-A (full server-side bridge).
**Blocker:** Requires the team-dashboard server (or a sidecar) to have filesystem write access to the user's Obsidian vault path. Only viable if:
- The server runs on the same host as the brain (currently: dashboard on VPS4, brain on workstation — not co-located), or
- The brain moves to VPS1 alongside Ollama, or
- A push mechanism (webhook → local agent on workstation) is added.
**Decision:** Wait until the workstation scheduled task in PR #57 proves valuable. Only build this if the manual digest cycle becomes a bottleneck.

### 6. Operator UI surface for agent_memory
**Where:** Likely a new tab on `/agents` or a new `/recall` admin route
**What:** Browseable view of what Recall (and other agents) currently believe. Filter by predicate, sort by confidence, click through to the source issue+comment that generated each triple. Surface contradictions explicitly ("3 rows for `/api/portal lives_at *` — 2 active, 1 decayed").
**Why:** Currently the data is invisible to humans except via direct DB queries. As the trail grows this becomes the #1 way to spot extractor bugs.
**Size:** A real feature — UI page + maybe one new GET route. Estimate: half-day.

### 7. Cross-namespace recall
**Where:** [`server/src/services/agent-memory.ts`](../../server/src/services/agent-memory.ts) — `recall()`
**Currently:** `recall(agentName, query)` searches only one agent's namespace.
**What:** Add a `recall.acrossAgents(query, agentNames?)` variant so any agent picking up an issue can search the shared Recall memory + their own.
**Why:** Right now Atlas's recall doesn't see Recall's triples. The whole point of the comment-extraction substrate is the SHARED pool, so the API should expose that explicitly.

### 8. Quorum / pattern detection
**What:** Detect when N agents independently extract triples about the same `subject` within a window (e.g. 3 different agents all comment about VPS4 in the same day) and emit a `pattern_detected` signal — either an alert or an auto-issue.
**Why:** The bee waggle-dance analogue. Right now we have the deposit mechanism but no collective intelligence. This is what makes stigmergy more than just shared state.
**Size:** Moderate — needs a windowing cron + a new "patterns" surface.

### 9. Brain → agent_memory fallback recall
**Where:** [`server/src/services/agent-memory.ts`](../../server/src/services/agent-memory.ts) — `recall()`
**What:** When `recall()` returns nothing above threshold, fall through to a Qdrant HTTP call against the local brain. Same embedding model (BGE-M3) means similarity scores compose.
**Blocker:** Same as #5 — requires server to reach the brain (currently on workstation only).
**Decision:** Tied to #5. Either both ship together or neither does.

---

## Index of related files

- Server: [`comment-knowledge-extractor.ts`](../../server/src/services/comment-knowledge-extractor.ts), [`agent-memory.ts`](../../server/src/services/agent-memory.ts), [`knowledge-graph-crons.ts`](../../server/src/services/knowledge-graph-crons.ts)
- Workstation: `~/.claude/scheduled-tasks/team-dashboard-operational-state/SKILL.md`
- Brain: `Projects Brain/Projects/Team-Dashboard/` (README, .brain.yml, `docs/` symlink, `operational-state.md` after first digest)
- Docs: [`cron-inventory.md`](../operations/cron-inventory.md), [`key-files.md`](../operations/key-files.md), [`company-structure.mmd`](../architecture/company-structure.mmd)

When picking one of these up, edit this file: mark the item done with a date,
or update its scope / move it. Don't let stale entries accumulate.
