// ---------------------------------------------------------------------------
// Coherent Ones University — comment-poller cursor (INTEGRATION SEAM).
//
// The commentTick (engine.ts) needs a DURABLE "last comment seen" cursor so a
// restart never re-scans — and never re-replies to — threaded member comments it
// already processed (the same guarantee initWatermark() gives the feed poller).
//
// Tier 2 (built in parallel) OWNS the durable per-agent cursor table
// `university_agent_watermark`, which will hold a 'comment' kind row. To avoid a
// migration/table collision, Tier 3 deliberately does NOT create its own table.
// Instead the cursor lives behind this tiny seam with an IN-MEMORY fallback.
//
// INTEGRATION: swap the two function bodies below to read/write the Tier 2
// durable `university_agent_watermark` ('comment' kind) row. The signatures
// already take `db` and are async, so the swap needs NO caller changes — only
// these two bodies. The in-memory fallback keeps the single runner correct
// within a process lifetime (the engine re-derives the cursor from the comments
// table at startup via initCommentWatermark), and simply resets on restart until
// Tier 2's durable store is wired in.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";

// In-memory fallback cursor. Module-scoped so it survives across ticks within a
// single process (the runner is a singleton behind the advisory lock). Advanced
// monotonically; only ever moves forward. Reset on process restart — the engine
// seeds it from the newest existing comment at boot so a restart resumes from
// there rather than re-scanning the whole comment backlog.
let inMemoryCommentWatermark = new Date(0);

/** Current comment-poller cursor: only comments strictly newer are candidates. */
export async function getCommentWatermark(_db: Db): Promise<Date> {
  // INTEGRATION: replace with a SELECT of the Tier 2 university_agent_watermark
  // 'comment' cursor.
  return inMemoryCommentWatermark;
}

/** Advance the comment-poller cursor (monotonic — never moves backward). */
export async function setCommentWatermark(_db: Db, at: Date): Promise<void> {
  // INTEGRATION: replace with an UPSERT of the Tier 2 university_agent_watermark
  // 'comment' cursor (keep the monotonic forward-only guard).
  if (at.getTime() > inMemoryCommentWatermark.getTime()) {
    inMemoryCommentWatermark = at;
  }
}

/**
 * Test-only reset of the in-memory fallback cursor. Lets a test start from a
 * known epoch so a fresh comment is always a candidate. Never called in prod.
 */
export function __resetCommentWatermarkForTest(): void {
  inMemoryCommentWatermark = new Date(0);
}
