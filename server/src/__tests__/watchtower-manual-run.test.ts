// ---------------------------------------------------------------------------
// Watchtower manual "Run now" tests — rate-limit caps + trigger persistence.
//
// Covers `checkManualRunCaps` (audit V2 blocker #3): the per-subscription
// 24h / 30d caps and the global hourly cap, plus the rule that cron/test
// runs never consume a customer's manual-run quota. Also asserts that
// `runSubscription` persists the `trigger` column. All tests use embedded
// Postgres + a mocked engine adapter (no live LLM calls).
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  watchtowerResults,
  watchtowerRuns,
  watchtowerSubscriptions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  checkManualRunCaps,
  MANUAL_RUN_GLOBAL_HOURLY_CAP,
  MANUAL_RUN_MONTHLY_CAP,
  runSubscription,
} from "../services/watchtower-monitor.js";
import type { EngineAdapter } from "../services/watchtower-engines/index.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres watchtower manual-run tests: ${support.reason ?? "unsupported"}`,
  );
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function mockAdapter(): EngineAdapter {
  return {
    id: "claude",
    enabled: () => true,
    query: async () => ({ text: "no mention here", latencyMs: 5, ok: true }),
  };
}

/** Insert a bare run row directly (bypassing the engine fan-out). */
async function insertRun(
  db: ReturnType<typeof createDb>,
  subscriptionId: string,
  trigger: "cron" | "manual" | "test",
  runAt: Date,
): Promise<void> {
  await db.insert(watchtowerRuns).values({
    subscriptionId,
    trigger,
    runAt,
    engines: ["claude"],
    totalPrompts: 1,
    mentionCount: 0,
  });
}

describeDb("checkManualRunCaps", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null =
    null;
  const now = new Date("2026-06-01T12:00:00.000Z");

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-manual-run-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerSubscriptions);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function makeSub(): Promise<string> {
    const id = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id,
      brandName: "Brand",
      prompts: ["one prompt"],
      status: "active",
      frequency: "weekly",
      promptCap: 25,
    });
    return id;
  }

  it("allows a manual run when the subscription has no prior manual runs", async () => {
    const sub = await makeSub();
    const result = await checkManualRunCaps(db, sub, now);
    expect(result.ok).toBe(true);
  });

  it("rejects with manual_run_daily_cap after one manual run inside 24h", async () => {
    const sub = await makeSub();
    await insertRun(db, sub, "manual", new Date(now.getTime() - 2 * HOUR));

    const result = await checkManualRunCaps(db, sub, now);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("manual_run_daily_cap");
      expect(result.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it("does not count cron or test runs toward the caps", async () => {
    const sub = await makeSub();
    // A cron run and a test run inside the last 24h — neither is "manual".
    await insertRun(db, sub, "cron", new Date(now.getTime() - 1 * HOUR));
    await insertRun(db, sub, "test", new Date(now.getTime() - 1 * HOUR));

    const result = await checkManualRunCaps(db, sub, now);
    expect(result.ok).toBe(true);
  });

  it("rejects with manual_run_monthly_cap once the 30d quota is used up", async () => {
    const sub = await makeSub();
    // MANUAL_RUN_MONTHLY_CAP manual runs, all older than 24h (so the daily
    // window is clear) but inside the 30d window.
    for (let i = 0; i < MANUAL_RUN_MONTHLY_CAP; i += 1) {
      await insertRun(db, sub, "manual", new Date(now.getTime() - (2 + i) * DAY));
    }

    const result = await checkManualRunCaps(db, sub, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("manual_run_monthly_cap");
  });

  it("ignores manual runs older than 30d", async () => {
    const sub = await makeSub();
    for (let i = 0; i < MANUAL_RUN_MONTHLY_CAP + 2; i += 1) {
      await insertRun(db, sub, "manual", new Date(now.getTime() - (31 + i) * DAY));
    }

    const result = await checkManualRunCaps(db, sub, now);
    expect(result.ok).toBe(true);
  });

  it("rejects with manual_runs_global_cap when other subscriptions saturate the hourly window", async () => {
    const target = await makeSub();
    const noisy = await makeSub();
    // Saturate the global hourly window using a *different* subscription so
    // the target's own per-subscription caps stay clear.
    for (let i = 0; i < MANUAL_RUN_GLOBAL_HOURLY_CAP; i += 1) {
      await insertRun(db, noisy, "manual", new Date(now.getTime() - 10 * 60 * 1000));
    }

    const result = await checkManualRunCaps(db, target, now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("manual_runs_global_cap");
  });
});

describeDb("runSubscription trigger persistence", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null =
    null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-manual-trigger-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerSubscriptions);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("records trigger='manual' when run via the manual path and defaults to 'cron'", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["one prompt"],
      status: "active",
      frequency: "weekly",
      promptCap: 25,
    });

    await runSubscription(db, subId, { engines: [mockAdapter()], trigger: "manual" });
    await runSubscription(db, subId, { engines: [mockAdapter()] });

    const runs = await db.select().from(watchtowerRuns);
    expect(runs).toHaveLength(2);
    const triggers = runs.map((r) => r.trigger).sort();
    expect(triggers).toEqual(["cron", "manual"]);
  });
});
