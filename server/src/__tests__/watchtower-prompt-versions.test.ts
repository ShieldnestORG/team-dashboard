// ---------------------------------------------------------------------------
// Watchtower prompt-versions tests — migration 0115 / V2 blocker #4.
//
// Covers:
//   * getActivePromptVersionId returns the newest row for a sub
//   * runSubscription pins prompt_version_id to the active version
//   * PATCH /subscriptions/:id/prompts happy path (insert version + update)
//   * PATCH validation: empty array / blank string / >500 chars / dedupe
//   * PATCH cap enforcement
//   * "Backfill" semantics: a sub with no version row gets one inserted by
//     the SQL we run inline (mirroring the migration tail).
//
// All gated on embedded postgres support via describeDb.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import {
  createDb,
  watchtowerPromptVersions,
  watchtowerResults,
  watchtowerRuns,
  watchtowerSubscriptions,
} from "@paperclipai/db";
import { sql } from "drizzle-orm";
import { eq } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  getActivePromptVersionId,
  runSubscription,
} from "../services/watchtower-monitor.js";
import { watchtowerRoutes } from "../routes/watchtower.js";
import type { EngineAdapter } from "../services/watchtower-engines/index.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres prompt-versions tests: ${support.reason ?? "unsupported"}`,
  );
}

function mockAdapter(): EngineAdapter {
  return {
    id: "claude",
    enabled: () => true,
    query: async () => ({ text: "no mention here", latencyMs: 1, ok: true }),
  };
}

describeDb("watchtower prompt versions", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const local = useLocalServer();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-prompts-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerPromptVersions);
    await db.delete(watchtowerSubscriptions);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  // -------------------------------------------------------------------------
  // getActivePromptVersionId
  // -------------------------------------------------------------------------

  it("getActivePromptVersionId returns null when no versions exist", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["a"],
    });

    expect(await getActivePromptVersionId(db, subId)).toBeNull();
  });

  it("getActivePromptVersionId returns the most recent version id", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["a"],
    });

    const [v1] = await db
      .insert(watchtowerPromptVersions)
      .values({ subscriptionId: subId, prompts: ["a"] })
      .returning({ id: watchtowerPromptVersions.id });

    // small sleep so created_at differs deterministically
    await new Promise((r) => setTimeout(r, 10));

    const [v2] = await db
      .insert(watchtowerPromptVersions)
      .values({ subscriptionId: subId, prompts: ["a", "b"] })
      .returning({ id: watchtowerPromptVersions.id });

    expect(v1?.id).toBeDefined();
    expect(v2?.id).toBeDefined();
    expect(await getActivePromptVersionId(db, subId)).toBe(v2!.id);
  });

  // -------------------------------------------------------------------------
  // runSubscription pins prompt_version_id
  // -------------------------------------------------------------------------

  it("runSubscription pins the run row to the active prompt_version_id", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["one"],
      promptCap: 25,
    });
    const [v] = await db
      .insert(watchtowerPromptVersions)
      .values({ subscriptionId: subId, prompts: ["one"] })
      .returning({ id: watchtowerPromptVersions.id });

    await runSubscription(db, subId, { engines: [mockAdapter()] });

    const runs = await db
      .select()
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.subscriptionId, subId));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.promptVersionId).toBe(v!.id);
  });

  it("runSubscription leaves prompt_version_id NULL when no version exists (legacy)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["one"],
      promptCap: 25,
    });

    await runSubscription(db, subId, { engines: [mockAdapter()] });

    const runs = await db
      .select()
      .from(watchtowerRuns)
      .where(eq(watchtowerRuns.subscriptionId, subId));
    expect(runs[0]!.promptVersionId).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Migration-tail backfill semantics
  // -------------------------------------------------------------------------

  it("backfill inserts exactly one version per subscription, idempotent", async () => {
    const subA = randomUUID();
    const subB = randomUUID();
    await db.insert(watchtowerSubscriptions).values([
      { id: subA, brandName: "A", prompts: ["a1", "a2"] },
      { id: subB, brandName: "B", prompts: ["b1"] },
    ]);

    // Mirror the migration tail. Running twice must still leave exactly one row each.
    const backfill = sql`
      INSERT INTO watchtower_prompt_versions (subscription_id, prompts)
      SELECT s.id, s.prompts FROM watchtower_subscriptions s
      WHERE NOT EXISTS (
        SELECT 1 FROM watchtower_prompt_versions v WHERE v.subscription_id = s.id
      )
    `;
    await db.execute(backfill);
    await db.execute(backfill);

    const versionsA = await db
      .select()
      .from(watchtowerPromptVersions)
      .where(eq(watchtowerPromptVersions.subscriptionId, subA));
    const versionsB = await db
      .select()
      .from(watchtowerPromptVersions)
      .where(eq(watchtowerPromptVersions.subscriptionId, subB));
    expect(versionsA).toHaveLength(1);
    expect(versionsB).toHaveLength(1);
    expect(versionsA[0]!.prompts).toEqual(["a1", "a2"]);
  });

  // -------------------------------------------------------------------------
  // PATCH /subscriptions/:id/prompts
  // -------------------------------------------------------------------------

  function createApp() {
    const app = express();
    app.use(express.json());
    // Inject a board actor so authorize check passes.
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        userId: "test-board-user",
        companyIds: [],
        source: "session",
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api/watchtower", watchtowerRoutes(db));
    return app;
  }

  it("PATCH /prompts inserts a new version row and updates the subscription", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["old"],
      promptCap: 25,
    });
    await db
      .insert(watchtowerPromptVersions)
      .values({ subscriptionId: subId, prompts: ["old"] });

    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${subId}/prompts`)
      .send({ prompts: ["new one", "new two"] });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.promptCount).toBe(2);
    expect(typeof res.body.versionId).toBe("string");

    const versions = await db
      .select()
      .from(watchtowerPromptVersions)
      .where(eq(watchtowerPromptVersions.subscriptionId, subId));
    expect(versions).toHaveLength(2);

    const [sub] = await db
      .select()
      .from(watchtowerSubscriptions)
      .where(eq(watchtowerSubscriptions.id, subId));
    expect(sub!.prompts).toEqual(["new one", "new two"]);
  });

  it("PATCH /prompts deduplicates exact-match entries", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["x"],
      promptCap: 25,
    });

    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${subId}/prompts`)
      .send({ prompts: ["dup", "dup", "other"] });

    expect(res.status).toBe(200);
    expect(res.body.promptCount).toBe(2);
  });

  it("PATCH /prompts rejects empty array (422)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "B",
      prompts: ["x"],
      promptCap: 25,
    });

    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${subId}/prompts`)
      .send({ prompts: [] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_prompts");
  });

  it("PATCH /prompts rejects a prompt over 500 chars (422)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "B",
      prompts: ["x"],
      promptCap: 25,
    });

    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${subId}/prompts`)
      .send({ prompts: ["a".repeat(501)] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_prompts");
  });

  it("PATCH /prompts rejects more prompts than the plan cap (422)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "B",
      prompts: ["x"],
      promptCap: 3,
    });

    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${subId}/prompts`)
      .send({ prompts: ["a", "b", "c", "d"] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("prompts_over_cap");
  });

  it("PATCH /prompts returns 404 for unknown subscription", async () => {
    const res = await request(local.via(createApp()))
      .patch(`/api/watchtower/subscriptions/${randomUUID()}/prompts`)
      .send({ prompts: ["a"] });
    expect(res.status).toBe(404);
  });
});
