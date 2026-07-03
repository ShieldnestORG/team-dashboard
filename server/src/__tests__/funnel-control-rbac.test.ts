// ---------------------------------------------------------------------------
// RBAC + gate tests for the funnel-control routes (migration 0146).
//
// Covers: the per-account funnels_enabled gate (PATCH /accounts/:id/funnels),
// the per-funnel toggle (PATCH /zernio/automations/:automationId), the 409
// create-guard on POST /zernio/automations, and the checked-in funnel catalog
// (GET /funnels/catalog).
//
// The DB is stubbed per-test (guards short-circuit before any query; happy
// paths use a tiny table-dispatching chainable echo), so this runs without
// Postgres. The Zernio call layer is vi.mock'd — live automations EXIST in
// production (ROOM, SOFT, CACHÉ, ...), so these tests must NEVER hit the real
// Zernio API. A global-fetch tripwire enforces that.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { socialAccounts, zernioCommentAutomations } from "@paperclipai/db";
import { socialsRoutes } from "../routes/socials.js";
import { errorHandler } from "../middleware/index.js";
import { setZernioCommentAutomationActive } from "../services/platform-publishers/zernio.js";

vi.mock("../services/platform-publishers/zernio.js", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../services/platform-publishers/zernio.js")
  >();
  return {
    ...actual,
    // The two functions that would reach Zernio's live API from these routes.
    setZernioCommentAutomationActive: vi.fn(),
    createZernioCommentAutomation: vi.fn(async () => {
      throw new Error("createZernioCommentAutomation must not be reached in these tests");
    }),
  };
});

// Tripwire: any code path that slips past the mocks and tries the network
// fails loudly instead of touching the live Zernio automations.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network disabled in funnel-control tests");
  });
});
afterAll(() => {
  vi.stubGlobal("fetch", realFetch);
});

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_abc123"; // better-auth ids are non-uuid text
const ZID = "acct_zernio_1";
const AUTOMATION_ID = "za_room_1";

const storageStub = {} as never;

function createApp(actor: Record<string, unknown>, db: unknown) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api/socials", socialsRoutes(db as never, storageStub));
  app.use(errorHandler);
  return app;
}

const boardAdmin = { type: "board", userId: USER_ID, source: "session", isInstanceAdmin: true };
const boardMember = { type: "board", userId: USER_ID, source: "session", isInstanceAdmin: false };
const unauthenticated = { type: "none", source: "none" };

const mirrorRow = {
  id: "33333333-3333-4333-8333-333333333333",
  zernioAutomationId: AUTOMATION_ID,
  zernioAccountId: ZID,
  name: "ROOM — two-step",
  trigger: "comment",
  keywords: ["ROOM"],
  matchMode: "contains",
  dmMessage: "hey — check your DMs",
  buttons: [],
  commentReply: null,
  linkTracking: true,
  clickTag: "ig-room",
  isActive: true,
};

/**
 * Chainable stub whose select().from(table) dispatches on the drizzle table
 * object identity. The where() result is BOTH awaitable (thenable — the mirror
 * list in the account-disable path has no .limit()) and .limit()-able.
 */
function createDb(rowsByTable: Map<unknown, unknown[]>) {
  const awaitableRows = (rows: unknown[]) => ({
    limit: async () => rows,
    // eslint-disable-next-line unicorn/no-thenable
    then: (onFulfilled: (v: unknown[]) => unknown) => onFulfilled(rows),
  });
  return {
    select: () => ({
      from: (table: unknown) => ({
        where: () => awaitableRows(rowsByTable.get(table) ?? []),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  };
}

describe("funnel-control routes — auth, gates, kill path, catalog", () => {
  it("rejects an unauthenticated funnel toggle with 401", async () => {
    const app = createApp(unauthenticated, {});
    const res = await request(app)
      .patch(`/api/socials/zernio/automations/${AUTOMATION_ID}`)
      .send({ zernioAccountId: ZID, isActive: false });
    expect(res.status).toBe(401);
  });

  it("rejects an unauthenticated account funnel-gate change with 401", async () => {
    const app = createApp(unauthenticated, {});
    const res = await request(app)
      .patch(`/api/socials/accounts/${ACCOUNT_ID}/funnels`)
      .send({ enabled: false });
    expect(res.status).toBe(401);
  });

  it("a non-admin employee cannot toggle a funnel (403)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(app)
      .patch(`/api/socials/zernio/automations/${AUTOMATION_ID}`)
      .send({ zernioAccountId: ZID, isActive: false });
    expect(res.status).toBe(403);
  });

  it("a non-admin employee cannot change the account funnel gate (403)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(app)
      .patch(`/api/socials/accounts/${ACCOUNT_ID}/funnels`)
      .send({ enabled: true });
    expect(res.status).toBe(403);
  });

  it("creating an automation on a funnels-disabled account is blocked with 409", async () => {
    const db = createDb(
      new Map([[socialAccounts, [{ id: ACCOUNT_ID, funnelsEnabled: false }]]]),
    );
    const app = createApp(boardAdmin, db);
    const res = await request(app).post("/api/socials/zernio/automations").send({
      zernioAccountId: ZID,
      name: "ROOM",
      keywords: ["ROOM"],
      dmMessage: "hey",
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("funnels are disabled for this account — enable funnels first");
  });

  it("re-activating an automation on a funnels-disabled account is blocked with 409", async () => {
    const db = createDb(
      new Map<unknown, unknown[]>([
        [zernioCommentAutomations, [mirrorRow]],
        [socialAccounts, [{ id: ACCOUNT_ID, zernioAccountId: ZID, funnelsEnabled: false }]],
      ]),
    );
    const app = createApp(boardAdmin, db);
    const res = await request(app)
      .patch(`/api/socials/zernio/automations/${AUTOMATION_ID}`)
      .send({ zernioAccountId: ZID, isActive: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("funnels are disabled for this account — enable funnels first");
    expect(setZernioCommentAutomationActive).not.toHaveBeenCalled();
  });

  it("disabling account funnels kills its live Zernio automations (200 + killed[])", async () => {
    vi.mocked(setZernioCommentAutomationActive).mockResolvedValueOnce({
      mechanism: "delete",
      zernioAutomationId: AUTOMATION_ID,
    });
    const db = createDb(
      new Map<unknown, unknown[]>([
        [socialAccounts, [{ id: ACCOUNT_ID, zernioAccountId: ZID, funnelsEnabled: true }]],
        [zernioCommentAutomations, [mirrorRow]],
      ]),
    );
    const app = createApp(boardAdmin, db);
    const res = await request(app)
      .patch(`/api/socials/accounts/${ACCOUNT_ID}/funnels`)
      .send({ enabled: false });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.funnelsEnabled).toBe(false);
    expect(res.body.killed).toEqual([
      {
        zernioAutomationId: AUTOMATION_ID,
        name: mirrorRow.name,
        mechanism: "delete",
        ok: true,
      },
    ]);
    expect(setZernioCommentAutomationActive).toHaveBeenCalledWith(ZID, AUTOMATION_ID, false);
  });

  it("enabling account funnels flips the gate and kills nothing (killed=[])", async () => {
    const db = createDb(
      new Map<unknown, unknown[]>([
        [socialAccounts, [{ id: ACCOUNT_ID, zernioAccountId: ZID, funnelsEnabled: false }]],
        [zernioCommentAutomations, [mirrorRow]],
      ]),
    );
    const app = createApp(boardAdmin, db);
    const res = await request(app)
      .patch(`/api/socials/accounts/${ACCOUNT_ID}/funnels`)
      .send({ enabled: true });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, funnelsEnabled: true, killed: [] });
  });

  it("serves the checked-in funnel catalog to any board actor (200, no admin needed)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(app).get("/api/socials/funnels/catalog");
    expect(res.status).toBe(200);
    expect(res.body.snapshotDate).toBe("2026-07-02");
    expect(res.body.source).toBe("Ig_Auditor/funnels.json");
    expect(Array.isArray(res.body.funnels)).toBe(true);
    expect(res.body.funnels.length).toBe(22);
  });
});
