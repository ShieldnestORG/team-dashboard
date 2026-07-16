// ---------------------------------------------------------------------------
// university-agents-admin GET /agents/cost-summary — route-order regression.
//
// The handler MUST be registered before GET /agents/:id: Express matches in
// registration order, so a later registration binds :id="cost-summary" and
// the UUID member lookup 404s/500s instead of returning the rollup. The db
// stub dispatches on table identity — a members query returns no rows — so a
// shadowed cost-summary request is distinguishable (404) from the real
// handler (200 with the full payload).
// ---------------------------------------------------------------------------
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { universityMembers } from "@paperclipai/db";
import { universityAgentsAdminRoutes } from "../routes/university-agents-admin.js";
import { useLocalServer } from "./helpers/supertest-server.js";

// Route every request through the shared 127.0.0.1-bound server (never a bare
// Express app) to avoid the macOS port-steal race — see docs/guides/
// test-isolation.md.
const local = useLocalServer();

const BY_MODEL_ROWS = [
  { model: "claude-sonnet-5", total: "1.5000", calls: "42" },
  { model: "ollama:gemma4:31b", total: "0", calls: "7" },
];

// Minimal drizzle stub. `.insert().values()` covers logAdminAccess (which
// swallows failures anyway). `.select().from()` dispatches on the table:
//   - universityMembers → `.where().limit()` resolves to [] (agent not found,
//     which is what the /agents/:id handler would hit if it captured the
//     cost-summary path);
//   - universityAgentUsage → `.where()` is awaited directly by the sumSince
//     totals AND `.groupBy()` is chained by the by-model query, so the
//     `.where()` result is a promise carrying a groupBy method.
const stubDb = {
  insert: () => ({ values: () => Promise.resolve() }),
  select: () => ({
    from: (table: unknown) => {
      if (table === universityMembers) {
        return { where: () => ({ limit: () => Promise.resolve([]) }) };
      }
      return {
        where: () =>
          Object.assign(Promise.resolve([{ total: "1.2345" }]), {
            groupBy: () => Promise.resolve(BY_MODEL_ROWS),
          }),
      };
    },
  }),
} as unknown as Db;

type ActorType = "board" | "agent" | "none";

function makeApp(actor: { type: ActorType; userId?: string }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor;
    next();
  });
  app.use("/api/university-agents-admin", universityAgentsAdminRoutes(stubDb));
  return app;
}

describe("university-agents-admin GET /agents/cost-summary", () => {
  it("returns 200 with the rollup payload — not captured by /agents/:id", async () => {
    const app = makeApp({ type: "board", userId: "board-user" });
    const res = await request(local.via(app)).get(
      "/api/university-agents-admin/agents/cost-summary",
    );

    // A shadowed route would hit the :id handler, whose member lookup finds
    // nothing and 404s — so 200 alone proves the registration order.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      todayUsd: 1.2345,
      weekUsd: 1.2345,
      monthUsd: 1.2345,
      byModel: [
        { model: "claude-sonnet-5", usd: 1.5, calls: 42 },
        { model: "ollama:gemma4:31b", usd: 0, calls: 7 },
      ],
    });
  });

  it("still routes real ids to /agents/:id (unknown agent → 404)", async () => {
    const app = makeApp({ type: "board", userId: "board-user" });
    const res = await request(local.via(app)).get(
      "/api/university-agents-admin/agents/0b7c9d3e-1111-4222-8333-444455556666",
    );
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Agent not found" });
  });

  it("rejects non-board actors (401)", async () => {
    const app = makeApp({ type: "agent" });
    const res = await request(local.via(app)).get(
      "/api/university-agents-admin/agents/cost-summary",
    );
    expect(res.status).toBe(401);
  });
});
