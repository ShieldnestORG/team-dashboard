// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner DURABLE state test.
//
// Proves the fix for the duplicate-post bug: the ambient posting ledger + daily
// budget + 72h line anti-repeat now survive a process restart. Each test throws
// away the in-memory AgentRunnerState instance and creates a NEW one (simulating
// a redeploy) against the SAME embedded Postgres, then asserts the counters and
// the anti-repeat are still enforced from the DB.
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, matching the
// other university integration suites.
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, afterAll, describe, expect, it } from "vitest";
import { createDb, universityAgentDailyBudget, universityAgentLineUsage, universityAgentWatermark } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "../../__tests__/helpers/embedded-postgres-no-pgvector.js";
import {
  AgentRunnerState,
  AmbientPostRejected,
  type AmbientPostLimits,
} from "./state.js";

const support = await getEmbeddedPostgresTestSupport();
const pgvectorOnlyBlocker =
  !support.supported && /pgvector|vector/i.test(support.reason ?? "");
const dbMode: "fullChain" | "noPgvector" | "skip" = support.supported
  ? "fullChain"
  : pgvectorOnlyBlocker
    ? "noPgvector"
    : "skip";
const describeDb = dbMode === "skip" ? describe.skip : describe;

if (dbMode === "skip") {
  console.warn(
    `Skipping agent-runner durable-state test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

const PERSONA = "beginner";
const LIMITS: AmbientPostLimits = {
  postsPerDay: 22,
  consecutivePerAgent: 2,
  lineAntiRepeatMs: 72 * 60 * 60 * 1000,
};
const NOW = new Date("2026-06-30T12:00:00.000Z");

describeDb("agent-runner durable state (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("agent-state-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase("agent-state-novec-");
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityAgentLineUsage);
    await db.delete(universityAgentDailyBudget);
    await db.delete(universityAgentWatermark);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  // Simulate one scripted ambient post exactly as the engine does: the ledger
  // write runs inside the post's transaction. Returns nothing; throws
  // AmbientPostRejected if a cap/dedup blocks it (transaction rolls back).
  async function commitPost(
    state: AgentRunnerState,
    line: string | null,
    now = NOW,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await state.recordAmbientPostTx(tx, PERSONA, line, now, LIMITS);
    });
    state.invalidateDaily(PERSONA, now);
  }

  it("persists the daily post count across a restart", async () => {
    const state1 = new AgentRunnerState(db);
    await commitPost(state1, "line one");
    expect(await state1.agentPostsToday(PERSONA, NOW)).toBe(1);
    expect(await state1.globalAmbientPostCount(NOW)).toBe(1);

    // Restart: brand-new in-memory instance, same DB.
    const state2 = new AgentRunnerState(db);
    expect(await state2.agentPostsToday(PERSONA, NOW)).toBe(1);
    expect(await state2.globalAmbientPostCount(NOW)).toBe(1);
  });

  it("enforces the 72h line anti-repeat from the DB after a restart", async () => {
    const state1 = new AgentRunnerState(db);
    await commitPost(state1, "line one");

    // Restart: the anti-repeat must be enforced from the durable ledger.
    const state2 = new AgentRunnerState(db);
    const ms = await state2.msSinceLineUsed(PERSONA, "line one", NOW);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeLessThan(LIMITS.lineAntiRepeatMs);
    // A different line is still fresh.
    expect(
      Number.isFinite(await state2.msSinceLineUsed(PERSONA, "line two", NOW)),
    ).toBe(false);
  });

  it("prevents an ambient duplicate post of the same line across a restart", async () => {
    const state1 = new AgentRunnerState(db);
    await commitPost(state1, "line one");

    // Restart, then try to re-post the SAME line within 72h — the atomic
    // under-lock dedup rejects it and rolls the transaction back.
    const state2 = new AgentRunnerState(db);
    await expect(commitPost(state2, "line one")).rejects.toBeInstanceOf(
      AmbientPostRejected,
    );
    // The rolled-back attempt left the count untouched.
    expect(await state2.agentPostsToday(PERSONA, NOW)).toBe(1);
    expect(await state2.globalAmbientPostCount(NOW)).toBe(1);
  });

  it("persists the consecutive-post cap across a restart", async () => {
    const state1 = new AgentRunnerState(db);
    await commitPost(state1, "line one");
    await commitPost(state1, "line two");
    expect(await state1.agentConsecutivePosts(PERSONA, NOW)).toBe(2);

    // Restart: the streak survives, so a 3rd consecutive post is rejected under
    // the lock even though the in-memory counter is fresh-zero.
    const state2 = new AgentRunnerState(db);
    expect(await state2.agentConsecutivePosts(PERSONA, NOW)).toBe(2);
    await expect(commitPost(state2, "line three")).rejects.toBeInstanceOf(
      AmbientPostRejected,
    );
    expect(await state2.agentPostsToday(PERSONA, NOW)).toBe(2);
  });

  it("an interleaved comment breaks the streak durably", async () => {
    const state1 = new AgentRunnerState(db);
    await commitPost(state1, "line one");
    await state1.recordAmbientComment(PERSONA, NOW);

    // Restart: the comment reset the consecutive streak to 0 and bumped the
    // durable comment count — both survive.
    const state2 = new AgentRunnerState(db);
    expect(await state2.agentConsecutivePosts(PERSONA, NOW)).toBe(0);
    expect(await state2.globalAmbientCommentCount(NOW)).toBe(1);
    expect(await state2.agentPostsToday(PERSONA, NOW)).toBe(1);
  });

  it("stores a general cursor (a 'comment' watermark for Tier 3) durably", async () => {
    const seen = new Date("2026-06-30T09:30:00.000Z");
    const state1 = new AgentRunnerState(db);
    await state1.setCursor("greeter", "comment", {
      lastSeenAt: seen,
      lastId: "post-123",
    });

    // Restart: Tier 3's comment poller reads the durable cursor back.
    const state2 = new AgentRunnerState(db);
    const cursor = await state2.getCursor("greeter", "comment");
    expect(cursor?.lastId).toBe("post-123");
    expect(cursor?.lastSeenAt?.toISOString()).toBe(seen.toISOString());
    // A different kind for the same persona is independent.
    expect(await state2.getCursor("greeter", "ambient")).toBeNull();
  });
});
