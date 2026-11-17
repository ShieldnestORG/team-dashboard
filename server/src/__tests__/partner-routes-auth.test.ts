import express from "express";
import { drizzle } from "drizzle-orm/pg-proxy";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorHandler } from "../middleware/index.js";
import { partnerRoutes } from "../routes/partner.js";
import { partnerSiteRoutes } from "../routes/partner-site.js";
import { useLocalServer } from "./helpers/supertest-server.js";

// Regression for the 2026-11-16 leak: GET /api/partners answered 200 with no
// login and returned every partner's dashboardToken, contact details and
// Stripe ids; the /:slug/site/* management routes (deploy, AI generation,
// publish, config writes) had no auth check at all.

const mocks = vi.hoisted(() => ({
  prefill: vi.fn(),
  deploy: vi.fn(),
  publish: vi.fn(),
  publishAll: vi.fn(),
  generate: vi.fn(),
}));

vi.mock("../services/partner-onboarding.js", () => ({
  runPartnerOnboarding: vi.fn(),
  prefillPartnerFromWebsite: mocks.prefill,
}));
vi.mock("../services/stripe-checkout.js", () => ({ createCheckoutSession: vi.fn() }));
vi.mock("../services/stripe-client.js", () => ({ stripeConfigured: () => false }));
vi.mock("../services/email-templates.js", () => ({ sendTransactional: vi.fn() }));
vi.mock("../services/partner-deployment.js", () => ({ deployPartnerMicrosite: mocks.deploy }));
vi.mock("../services/partner-site-publisher.js", () => ({
  publishPartnerContent: mocks.publish,
  publishAllDraftContent: mocks.publishAll,
}));
vi.mock("../services/partner-site-content.js", () => ({ generatePartnerBlogPost: mocks.generate }));

// Chainable stand-in for the drizzle db: every builder call returns the same
// chain, awaiting it yields `rows`, and each call is recorded so tests can
// assert the db was never reached, or inspect what .set() received.
function fakeDb(rows: unknown[] = []) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const chain: any = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(rows);
      return (...args: unknown[]) => {
        calls.push({ method: String(prop), args });
        return chain;
      };
    },
  });
  return { db: chain, calls };
}

type ActorType = "board" | "agent" | "none";

function createApp(actorType: ActorType, db: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor =
      actorType === "board"
        ? { type: "board", userId: "user-1", companyIds: [], source: "session", isInstanceAdmin: false }
        : actorType === "agent"
          ? { type: "agent", agentId: "agent-1", companyId: "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4", source: "agent_key" }
          : { type: "none", source: "none" };
    next();
  });
  app.use("/api/partners", partnerRoutes(db as any));
  app.use("/api/partners/:slug/site", partnerSiteRoutes(db as any));
  app.use(errorHandler);
  return app;
}

const local = useLocalServer();

const PARTNER_READS = [
  "/api/partners",
  "/api/partners/acme",
  "/api/partners/acme/clicks",
  "/api/partners/acme/metrics",
  "/api/partners/directory",
];

const SITE_ROUTES: Array<["get" | "put" | "post", string]> = [
  ["get", "/api/partners/acme/site/config"],
  ["put", "/api/partners/acme/site/config"],
  ["post", "/api/partners/acme/site/deploy"],
  ["get", "/api/partners/acme/site/content"],
  ["post", "/api/partners/acme/site/content"],
  ["put", "/api/partners/acme/site/content/c-1"],
  ["post", "/api/partners/acme/site/content/c-1/publish"],
  ["post", "/api/partners/acme/site/generate-content"],
  ["post", "/api/partners/acme/site/publish-drafts"],
  ["post", "/api/partners/acme/site/baseline"],
  ["get", "/api/partners/acme/site/baseline"],
];

describe("partner routes require a board login", () => {
  beforeEach(() => vi.clearAllMocks());

  for (const actor of ["none", "agent"] as const) {
    for (const path of PARTNER_READS) {
      it(`GET ${path} is refused for ${actor} actors and never touches the db`, async () => {
        const { db, calls } = fakeDb([{ slug: "acme", dashboardToken: "secret-token" }]);
        const res = await request(local.via(createApp(actor, db))).get(path);
        expect(res.status).toBe(403);
        expect(JSON.stringify(res.body)).not.toContain("secret-token");
        expect(calls).toHaveLength(0);
      });
    }

    it(`POST /api/partners/prefill is refused for ${actor} actors (no outbound scrape)`, async () => {
      const { db } = fakeDb();
      const res = await request(local.via(createApp(actor, db)))
        .post("/api/partners/prefill")
        .send({ website: "https://example.com" });
      expect(res.status).toBe(403);
      expect(mocks.prefill).not.toHaveBeenCalled();
    });

    for (const [method, path] of SITE_ROUTES) {
      it(`${method.toUpperCase()} ${path} is refused for ${actor} actors`, async () => {
        const { db, calls } = fakeDb([{ id: "p-1", slug: "acme" }]);
        const res = await request(local.via(createApp(actor, db)))[method](path).send({ title: "t", body: "b" });
        expect(res.status).toBe(401);
        expect(calls).toHaveLength(0);
        expect(mocks.deploy).not.toHaveBeenCalled();
        expect(mocks.generate).not.toHaveBeenCalled();
        expect(mocks.publish).not.toHaveBeenCalled();
      });
    }
  }

  it("board actors still list partners", async () => {
    const { db } = fakeDb([]);
    const res = await request(local.via(createApp("board", db))).get("/api/partners");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ partners: [], total: 0 });
  });

  it("board actors reach the site routes", async () => {
    const { db } = fakeDb([]);
    const res = await request(local.via(createApp("board", db))).get("/api/partners/acme/site/config");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Partner not found" });
  });

  it("the token dashboard stays public (token check, not login)", async () => {
    const { db } = fakeDb([]);
    const res = await request(local.via(createApp("none", db))).get("/api/partners/acme/dashboard?token=wrong");
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: "Invalid token" });
  });

  it("PUT /site/content/:id cannot re-home a row to another partner or company", async () => {
    const { db, calls } = fakeDb([{ id: "c-1", title: "new" }]);
    const res = await request(local.via(createApp("board", db)))
      .put("/api/partners/acme/site/content/c-1")
      .send({ title: "new", id: "c-2", partnerId: "other-partner", companyId: "other-co", createdAt: "2020-01-01" });
    expect(res.status).toBe(200);
    const set = calls.find((c) => c.method === "set");
    expect(set).toBeDefined();
    const values = set!.args[0] as Record<string, unknown>;
    expect(values.title).toBe("new");
    for (const key of ["id", "partnerId", "companyId", "createdAt"]) {
      expect(values).not.toHaveProperty(key);
    }
  });

  it("POST /site/content/:id/publish refuses content that is not this partner's", async () => {
    const { db } = fakeDb([]);
    const res = await request(local.via(createApp("board", db))).post("/api/partners/acme/site/content/c-9/publish");
    expect(res.status).toBe(404);
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it("PUT /site/content/:id with no body does not crash", async () => {
    const { db } = fakeDb([{ id: "c-1" }]);
    const res = await request(local.via(createApp("board", db))).put("/api/partners/acme/site/content/c-1");
    expect(res.status).toBe(200);
  });
});

// The fake db above ignores WHERE clauses, so these tests render the real SQL
// through drizzle's pg-proxy driver and check the row lookup is scoped to the
// partner in the URL (content id alone would let one partner's URL edit or
// publish another partner's content).
describe("partner site content routes scope rows to the URL's partner", () => {
  function sqlDb() {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const db = drizzle(async (sql, params) => {
      queries.push({ sql, params });
      return { rows: [] };
    });
    return { db, queries };
  }

  for (const [method, path] of [
    ["put", "/api/partners/acme/site/content/c-1"],
    ["post", "/api/partners/acme/site/content/c-1/publish"],
  ] as const) {
    it(`${method.toUpperCase()} ${path} filters by the partner slug`, async () => {
      const { db, queries } = sqlDb();
      const res = await request(local.via(createApp("board", db)))[method](path).send({ title: "t" });
      expect(res.status).toBe(404);
      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toMatch(/"partner_site_content"\."partner_id" in \(select "id" from "partner_companies"/);
      expect(queries[0].params).toContain("acme");
      expect(queries[0].params).toContain("c-1");
      expect(mocks.publish).not.toHaveBeenCalled();
    });
  }
});
