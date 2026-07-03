// ---------------------------------------------------------------------------
// admin_access_log tests.
//
// Five gates:
//   1. redactRequestSummary — pure unit, no DB. Locks in "no values, only
//      shapes" invariant (the whole table's compliance posture depends on it).
//   2. happy path (auth'd POST writes a row) — embedded-pg gated.
//   3. DB insert failure does NOT throw the request — middleware swallows.
//   4. skipGet: true skips GETs but logs POSTs.
//   5. Unauth (req.actor.type === 'none') still writes a row with
//      actor_type='none' and the route's status code.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { adminAccessLog, createDb } from "@paperclipai/db";
import { desc } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  logAdminAccess,
  redactRequestSummary,
} from "../middleware/log-admin-access.js";
import { useLocalServer } from "./helpers/supertest-server.js";

// ---------------------------------------------------------------------------
// 1. Pure helper — runs in any env.
// ---------------------------------------------------------------------------

describe("redactRequestSummary", () => {
  it("records query keys + value KINDS, never query values", () => {
    const out = redactRequestSummary({
      query: { apiKey: "sk-live-supersecret", limit: "50" },
      body: undefined,
    });
    expect(out.query_keys).toEqual({ apiKey: "string", limit: "string" });
    // No values anywhere in the output.
    expect(JSON.stringify(out)).not.toContain("sk-live-supersecret");
    expect(JSON.stringify(out)).not.toContain("50");
  });

  it("records body shape (keys → kinds), never body values", () => {
    const out = redactRequestSummary({
      body: {
        token: "stripe_pk_live_xyz",
        config: { nested: true },
        items: [1, 2, 3],
        nothing: null,
      },
    });
    expect(out.body_shape).toEqual({
      token: "string",
      config: "object",
      items: "array[3]",
      nothing: "null",
    });
    expect(JSON.stringify(out)).not.toContain("stripe_pk_live_xyz");
  });

  it("handles array body without recording elements", () => {
    const out = redactRequestSummary({ body: ["a", "b", "c"] });
    expect(out.body_shape).toBe("array[3]");
    expect(JSON.stringify(out)).not.toContain("\"a\"");
  });

  it("returns an empty object for empty input", () => {
    expect(redactRequestSummary({})).toEqual({});
    expect(redactRequestSummary({ query: {}, body: {} })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// DB-backed tests.
// ---------------------------------------------------------------------------

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres admin-access-log tests: ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("admin-access-log middleware (e2e)", () => {
  let testDb: EmbeddedPostgresTestDatabase;
  let db: ReturnType<typeof createDb>;
  const local = useLocalServer();

  beforeAll(async () => {
    testDb = await startEmbeddedPostgresTestDatabase("admin-access-log-");
    db = createDb(testDb.connectionString);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  /** Build an Express app that simulates a board-authenticated request. */
  function appWith({
    actor,
    skipGet,
  }: {
    actor: Express.Request["actor"];
    skipGet?: boolean;
  }) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use(logAdminAccess(db, { skipGet }));
    app.post("/customers/:subscriptionId", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    app.get("/customers", (_req, res) => {
      res.status(200).json({ ok: true });
    });
    return app;
  }

  /** Poll briefly for the access-log row, since the insert is fire-and-forget. */
  async function waitForLatestRow(timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await db
        .select()
        .from(adminAccessLog)
        .orderBy(desc(adminAccessLog.createdAt))
        .limit(1);
      if (rows.length > 0) return rows[0]!;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("admin_access_log row never appeared");
  }

  async function countRows(): Promise<number> {
    const rows = await db.select().from(adminAccessLog);
    return rows.length;
  }

  it("authenticated POST writes a row with method/path/status/duration", async () => {
    const beforeCount = await countRows();
    const userId = randomUUID();
    const subId = randomUUID();
    const app = appWith({
      actor: { type: "board", userId, isInstanceAdmin: true, source: "session" },
    });

    const res = await request(local.via(app))
      .post(`/customers/${subId}`)
      .send({ note: "x" });
    expect(res.status).toBe(200);

    const row = await waitForLatestRow();
    expect(row.method).toBe("POST");
    expect(row.path).toBe(`/customers/${subId}`);
    expect(row.statusCode).toBe(200);
    expect(row.actorType).toBe("board");
    expect(row.actorId).toBe(userId);
    expect(row.actorLabel).toBe(userId);
    expect(row.entityType).toBe("subscription");
    expect(row.entityId).toBe(subId);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.requestSummary).toMatchObject({
      body_shape: { note: "string" },
    });
    // Confirm we actually added a row (not a flaky leftover).
    expect(await countRows()).toBe(beforeCount + 1);
  });

  it("DB insert failure does NOT throw the request", async () => {
    // Mock the insert to reject; the request handler should still return 200.
    const insertSpy = vi.spyOn(db, "insert").mockImplementationOnce(() => {
      return {
        values: () => Promise.reject(new Error("simulated db failure")),
      } as unknown as ReturnType<typeof db.insert>;
    });

    const app = appWith({
      actor: {
        type: "board",
        userId: randomUUID(),
        isInstanceAdmin: true,
        source: "session",
      },
    });

    const res = await request(local.via(app))
      .post(`/customers/${randomUUID()}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    // Give the rejected promise a tick to be caught by our .catch.
    await new Promise((r) => setTimeout(r, 20));
    insertSpy.mockRestore();
  });

  it("skipGet:true skips GETs but still logs POSTs", async () => {
    const userId = randomUUID();
    const app = appWith({
      actor: { type: "board", userId, isInstanceAdmin: true, source: "session" },
      skipGet: true,
    });

    const beforeCount = await countRows();
    const getRes = await request(local.via(app)).get("/customers");
    expect(getRes.status).toBe(200);
    // Wait a beat — the insert (if any) is fire-and-forget.
    await new Promise((r) => setTimeout(r, 100));
    expect(await countRows()).toBe(beforeCount);

    const postRes = await request(local.via(app))
      .post(`/customers/${randomUUID()}`)
      .send({});
    expect(postRes.status).toBe(200);
    await waitForLatestRow();
    expect(await countRows()).toBe(beforeCount + 1);
  });

  it("unauth request (actor.type='none') still writes a row", async () => {
    const beforeCount = await countRows();
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "none", source: "none" };
      next();
    });
    app.use(logAdminAccess(db));
    // Simulate the board-only guard that 401s before any handler runs.
    app.use((req, res, next) => {
      if (req.actor?.type !== "board") {
        res.status(401).json({ error: "Admin only" });
        return;
      }
      next();
    });
    app.post("/customers", (_req, res) => res.status(200).json({ ok: true }));

    const res = await request(local.via(app)).post("/customers").send({});
    expect(res.status).toBe(401);

    const row = await waitForLatestRow();
    expect(row.actorType).toBe("none");
    expect(row.statusCode).toBe(401);
    expect(row.actorId).toBeNull();
    expect(await countRows()).toBe(beforeCount + 1);
  });

  // -------------------------------------------------------------------------
  // Per-route attachment coverage — the broaden batch (PR following #75)
  // attaches `audit = logAdminAccess(db)` as a per-route handler instead of a
  // router-level `router.use()`. These two tests lock that pattern in for the
  // riskiest new surfaces: access.ts (instance-admin promote / member
  // permissions) and creditscore.ts (comp-grant / promo-code creation).
  // We mount minimal Express apps that mirror the exact handler chain used in
  // those route files — `router.post(path, audit, handler)` — and assert that
  // a row is written with the correct method/path/actor.
  // -------------------------------------------------------------------------

  it("access.ts pattern: per-route audit on /admin/users/:userId/promote-instance-admin writes a row", async () => {
    const beforeCount = await countRows();
    const userId = randomUUID();
    const targetUserId = randomUUID();
    const audit = logAdminAccess(db);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId, isInstanceAdmin: true, source: "session" };
      next();
    });
    // Mirrors access.ts: `router.post(path, audit, async (req, res) => { ... })`.
    app.post("/admin/users/:userId/promote-instance-admin", audit, (_req, res) => {
      res.status(201).json({ ok: true });
    });

    const res = await request(local.via(app))
      .post(`/admin/users/${targetUserId}/promote-instance-admin`)
      .send({});
    expect(res.status).toBe(201);

    const row = await waitForLatestRow();
    expect(row.method).toBe("POST");
    expect(row.path).toBe(`/admin/users/${targetUserId}/promote-instance-admin`);
    expect(row.statusCode).toBe(201);
    expect(row.actorType).toBe("board");
    expect(row.actorId).toBe(userId);
    expect(await countRows()).toBe(beforeCount + 1);
  });

  it("creditscore.ts pattern: per-route audit on /comp-grant captures body shape but never values", async () => {
    const beforeCount = await countRows();
    const userId = randomUUID();
    const audit = logAdminAccess(db);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = { type: "board", userId, isInstanceAdmin: true, source: "session" };
      next();
    });
    // Mirrors creditscore.ts: `router.post("/comp-grant", audit, async (req, res) => { ... })`.
    app.post("/comp-grant", audit, (_req, res) => {
      res.status(200).json({ ok: true });
    });

    const secretEmail = "secretive-customer@example.com";
    const res = await request(local.via(app))
      .post("/comp-grant")
      .send({
        tier: "pro",
        url: "https://example.com",
        email: secretEmail,
        compReason: "early adopter discount",
      });
    expect(res.status).toBe(200);

    const row = await waitForLatestRow();
    expect(row.method).toBe("POST");
    expect(row.path).toBe("/comp-grant");
    expect(row.actorType).toBe("board");
    // Body shape recorded as keys → kinds, never raw values.
    expect(row.requestSummary).toMatchObject({
      body_shape: {
        tier: "string",
        url: "string",
        email: "string",
        compReason: "string",
      },
    });
    // Crucial: the actual email/url string never appears in the stored row.
    expect(JSON.stringify(row.requestSummary)).not.toContain(secretEmail);
    expect(JSON.stringify(row.requestSummary)).not.toContain("https://example.com");
    expect(await countRows()).toBe(beforeCount + 1);
  });
});
