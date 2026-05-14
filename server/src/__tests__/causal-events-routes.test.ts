// Smoke tests for the /causal-events and /event-constraints routers.
//
// We stub the drizzle `db` object with vi.fn-shaped chainables and assert that
// requests round-trip through serialize() correctly. Full SQL semantics are
// already covered by the cron test + integration tests on the deployed env.

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { errorHandler } from "../middleware/index.js";

// Minimal fake activity_log row.
const sampleEventRow = {
  id: "00000000-0000-0000-0000-000000000001",
  companyId: "co-1",
  actorType: "system",
  actorId: "watchtower",
  action: "event",
  entityType: "watchtower",
  entityId: "sub-1",
  agentId: null,
  runId: null,
  details: { foo: "bar" },
  eventKind: "watchtower.run.started",
  causedBy: null as string[] | null,
  createdAt: new Date("2026-05-12T12:00:00Z"),
};

function makeCausalEventsDb({
  list,
  byId,
  ancestors,
  descendants,
}: {
  list?: typeof sampleEventRow[];
  byId?: typeof sampleEventRow | null;
  ancestors?: typeof sampleEventRow[];
  descendants?: typeof sampleEventRow[];
}) {
  // The route does a list select (where + orderBy + limit). It also does:
  //   - select for /:id (limit 1)
  //   - select where inArray (ancestors)
  //   - select where sql`... && ... ::uuid[]` (descendants)
  const calls: string[] = [];

  const chain: any = {
    selectDistinct: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => [{ kind: "watchtower.run.started" }, { kind: "watchtower.query.sent" }]),
      })),
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn((..._args: unknown[]) => {
          calls.push("where");
          // The route chains where().orderBy().limit() for the list, where().limit() for byId,
          // and where() directly for ancestors/descendants. Return an object that supports all.
          return {
            orderBy: vi.fn(() => ({
              limit: vi.fn(async () => list ?? []),
            })),
            limit: vi.fn(async () => (byId ? [byId] : [])),
            then: (resolve: (v: unknown[]) => unknown) => {
              // Ancestors / descendants path: caller awaits the where() directly.
              // We alternate ancestors then descendants.
              const next = calls.length === 2 ? ancestors ?? [] : descendants ?? [];
              return Promise.resolve(resolve(next));
            },
          };
        }),
      })),
    })),
  };

  return chain;
}

function makeApp(router: express.Router, mountAt: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "u-1",
      companyIds: ["co-1"],
      source: "session",
      isInstanceAdmin: true,
    };
    next();
  });
  app.use(mountAt, router);
  app.use(errorHandler);
  return app;
}

// Import routers once at module scope. Using vi.resetModules() between tests
// would re-load `../errors.js` and produce a fresh HttpError class identity,
// breaking `instanceof HttpError` checks in the (cached) errorHandler.
import { causalEventsRoutes } from "../routes/causal-events.js";
import { eventConstraintsRoutes } from "../routes/event-constraints.js";

describe("/api/causal-events router", () => {
  it("GET /api/causal-events lists events", async () => {
    const db = makeCausalEventsDb({ list: [sampleEventRow] });
    const app = makeApp(causalEventsRoutes(db), "/api/causal-events");

    const res = await request(app).get("/api/causal-events?kind=watchtower&limit=10");
    expect(res.status).toBe(200);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      id: sampleEventRow.id,
      kind: "watchtower.run.started",
      entityId: "sub-1",
    });
  });

  it("GET /api/causal-events/:id returns 400 for non-uuid", async () => {
    const db = makeCausalEventsDb({});
    const app = makeApp(causalEventsRoutes(db), "/api/causal-events");

    const res = await request(app).get("/api/causal-events/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("GET /api/causal-events/:id returns 404 when missing", async () => {
    const db = makeCausalEventsDb({ byId: null });
    const app = makeApp(causalEventsRoutes(db), "/api/causal-events");

    const res = await request(app).get(
      "/api/causal-events/00000000-0000-0000-0000-000000000099",
    );
    expect(res.status).toBe(404);
  });

  it("GET /api/causal-events/:id walks ancestors + descendants", async () => {
    const db = makeCausalEventsDb({
      byId: { ...sampleEventRow, causedBy: ["00000000-0000-0000-0000-000000000077"] },
      ancestors: [],
      descendants: [],
    });
    const app = makeApp(causalEventsRoutes(db), "/api/causal-events");

    const res = await request(app).get(`/api/causal-events/${sampleEventRow.id}`);
    expect(res.status).toBe(200);
    expect(res.body.event.id).toBe(sampleEventRow.id);
    expect(Array.isArray(res.body.ancestors)).toBe(true);
    expect(Array.isArray(res.body.descendants)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// /api/event-constraints CRUD smoke
// -----------------------------------------------------------------------------

const sampleConstraintRow = {
  id: "10000000-0000-0000-0000-000000000001",
  companyId: null as string | null,
  kind: "watchtower:query-completes",
  pattern: { of: "watchtower.query.sent", require: "watchtower.query.response" },
  maxLagMs: 60_000,
  enabled: true,
  lastCheckedAt: null as Date | null,
  lastViolationAt: null as Date | null,
  violationCount: 0,
  createdAt: new Date("2026-05-12T12:00:00Z"),
  updatedAt: new Date("2026-05-12T12:00:00Z"),
};

function makeConstraintsDb({
  list = [],
  inserted,
  updated,
  deleted,
}: {
  list?: typeof sampleConstraintRow[];
  inserted?: typeof sampleConstraintRow;
  updated?: typeof sampleConstraintRow;
  deleted?: typeof sampleConstraintRow;
}) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () => list),
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => (inserted ? [inserted] : [])),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn(async () => (updated ? [updated] : [])),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => (deleted ? [deleted] : [])),
      })),
    })),
  } as any;
}

describe("/api/event-constraints router", () => {
  it("GET / lists constraints", async () => {
    const db = makeConstraintsDb({ list: [sampleConstraintRow] });
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app).get("/api/event-constraints");
    expect(res.status).toBe(200);
    expect(res.body.constraints).toHaveLength(1);
    expect(res.body.constraints[0]).toMatchObject({
      kind: "watchtower:query-completes",
      maxLagMs: 60_000,
      enabled: true,
    });
  });

  it("POST / creates a constraint", async () => {
    const db = makeConstraintsDb({ inserted: sampleConstraintRow });
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app)
      .post("/api/event-constraints")
      .send({
        kind: "watchtower:query-completes",
        pattern: { of: "watchtower.query.sent", require: "watchtower.query.response" },
        maxLagMs: 60000,
      });
    expect(res.status).toBe(201);
    expect(res.body.constraint.kind).toBe("watchtower:query-completes");
  });

  it("POST / rejects invalid pattern", async () => {
    const db = makeConstraintsDb({});
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app)
      .post("/api/event-constraints")
      .send({ kind: "x", pattern: { of: "" } });
    expect(res.status).toBe(400);
  });

  it("PATCH /:id updates", async () => {
    const db = makeConstraintsDb({
      updated: { ...sampleConstraintRow, enabled: false },
    });
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app)
      .patch(`/api/event-constraints/${sampleConstraintRow.id}`)
      .send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.constraint.enabled).toBe(false);
  });

  it("DELETE /:id removes", async () => {
    const db = makeConstraintsDb({ deleted: sampleConstraintRow });
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app).delete(`/api/event-constraints/${sampleConstraintRow.id}`);
    expect(res.status).toBe(204);
  });

  it("DELETE /:id 404 when missing", async () => {
    const db = makeConstraintsDb({});
    const app = makeApp(eventConstraintsRoutes(db), "/api/event-constraints");

    const res = await request(app).delete(
      "/api/event-constraints/10000000-0000-0000-0000-000000000099",
    );
    expect(res.status).toBe(404);
  });
});
