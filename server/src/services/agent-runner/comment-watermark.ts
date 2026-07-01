// ---------------------------------------------------------------------------
// Coherent Ones University — comment-poller cursor (DURABLE, Tier 2 ↔ Tier 3
// integration seam — WIRED).
//
// The commentTick (engine.ts) needs a DURABLE "last comment seen" cursor so a
// restart never re-scans — and never re-replies to — threaded member comments it
// already processed (the same guarantee initWatermark() gives the feed poller),
// AND so comments that arrive while the runner is down are still answered on the
// next boot rather than skipped.
//
// Tier 2 owns the durable per-agent cursor table `university_agent_watermark`
// (migration 0140), keyed by (agent_persona_key, kind). This seam stores the
// comment-poller cursor there under kind='comment'. The comment poller is a
// SINGLE GLOBAL cursor (it scans ALL members' comments across every post and
// routes each to a responder), not a per-persona cursor — so it lives under a
// reserved sentinel persona key that can never collide with a real persona key
// (real keys are lowercase persona slugs like "wendell").
//
// The cursor is advanced with an atomic, forward-only UPSERT (SQL GREATEST), so
// concurrent/duplicate advances can never move it backward. It persists across
// process restart; engine.initCommentWatermark() only SEEDS it (from the newest
// existing comment) when no durable row exists yet, so a restart resumes from
// the durable cursor instead of re-deriving "newest" and skipping the gap.
// ---------------------------------------------------------------------------

import { and, eq, sql } from "drizzle-orm";
import { universityAgentWatermark, type Db } from "@paperclipai/db";

// Reserved sentinel "persona" key for the single global comment cursor. Real
// persona keys are lowercase slugs, so this double-underscored key never
// collides with a per-agent watermark row.
const RUNNER_SCOPE = "__runner__";
const COMMENT_KIND = "comment";

/** Current comment-poller cursor: only comments strictly newer are candidates.
 *  Returns the Unix epoch when no durable cursor exists yet (so the very first
 *  poll would consider the whole backlog — engine.initCommentWatermark() seeds
 *  the cursor at boot precisely to avoid that). */
export async function getCommentWatermark(db: Db): Promise<Date> {
  const [row] = await db
    .select({ lastSeenAt: universityAgentWatermark.lastSeenAt })
    .from(universityAgentWatermark)
    .where(
      and(
        eq(universityAgentWatermark.agentPersonaKey, RUNNER_SCOPE),
        eq(universityAgentWatermark.kind, COMMENT_KIND),
      ),
    )
    .limit(1);
  return row?.lastSeenAt ?? new Date(0);
}

/** True iff a durable comment cursor row already exists. Used by
 *  initCommentWatermark to seed-if-absent (never overwrite a live cursor). */
export async function hasCommentWatermark(db: Db): Promise<boolean> {
  const [row] = await db
    .select({ persona: universityAgentWatermark.agentPersonaKey })
    .from(universityAgentWatermark)
    .where(
      and(
        eq(universityAgentWatermark.agentPersonaKey, RUNNER_SCOPE),
        eq(universityAgentWatermark.kind, COMMENT_KIND),
      ),
    )
    .limit(1);
  return !!row;
}

/** Advance the comment-poller cursor durably (atomic, forward-only). The
 *  ON CONFLICT SET uses GREATEST(existing, new) so a stale/duplicate advance can
 *  never move the cursor backward — no read-modify-write race. */
export async function setCommentWatermark(db: Db, at: Date): Promise<void> {
  const now = new Date();
  await db
    .insert(universityAgentWatermark)
    .values({
      agentPersonaKey: RUNNER_SCOPE,
      kind: COMMENT_KIND,
      lastSeenAt: at,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        universityAgentWatermark.agentPersonaKey,
        universityAgentWatermark.kind,
      ],
      set: {
        // Forward-only: never move the cursor backward. Reference `excluded`
        // (the proposed-insert `at`, already bound as timestamptz by drizzle via
        // the values() clause) rather than re-binding the Date in raw SQL, which
        // would skip drizzle's column serialization. GREATEST skips NULLs, so a
        // previously-null last_seen_at collapses to `at`.
        lastSeenAt: sql`GREATEST(${universityAgentWatermark.lastSeenAt}, excluded.last_seen_at)`,
        updatedAt: now,
      },
    });
}

/**
 * Test-only reset of the durable comment cursor. Deletes the sentinel row so a
 * test starts from the epoch and a freshly-inserted comment is always a
 * candidate. Never called in prod.
 */
export async function __resetCommentWatermarkForTest(db: Db): Promise<void> {
  await db
    .delete(universityAgentWatermark)
    .where(
      and(
        eq(universityAgentWatermark.agentPersonaKey, RUNNER_SCOPE),
        eq(universityAgentWatermark.kind, COMMENT_KIND),
      ),
    );
}
