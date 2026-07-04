// ---------------------------------------------------------------------------
// RBAC + draft→approve tests for the socials post routes.
//
// Two-tier publishing: an authenticated non-admin employee creates DRAFTS
// (status 'pending_approval', which the relayer never drains); an instance
// admin either publishes directly (status 'scheduled') or approves a draft into
// the queue. Unauthenticated requests are rejected — previously NONE of these
// routes checked the actor at all.
//
// The DB is stubbed per-test (the guards short-circuit before any query; the
// happy paths only need a tiny chainable echo), so this runs without Postgres.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { socialsRoutes } from "../routes/socials.js";
import { errorHandler } from "../middleware/index.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user_abc123"; // better-auth ids are non-uuid text

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

/** Stub supporting the create path: account lookup + an insert that echoes. */
function createDbForCreate() {
  // Keep the FIRST insert only: the route's post insert. The router-level
  // logAdminAccess middleware fires a second, fire-and-forget insert (the
  // admin_access_log row) after the response is sent — it must not clobber
  // the captured post row these assertions inspect.
  const captured: { values?: Record<string, unknown> } = {};
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ id: ACCOUNT_ID, status: "active" }] }) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values ??= v;
        return { returning: async () => [{ id: POST_ID, ...v }] };
      },
    }),
  };
  return { db, captured };
}

const local = useLocalServer();

describe("socials post routes — auth + draft/approve RBAC", () => {
  it("rejects an unauthenticated create with 401", async () => {
    const app = createApp(unauthenticated, {});
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "hello" });
    expect(res.status).toBe(401);
  });

  it("a non-admin employee's post is created as a pending_approval DRAFT, attributed", async () => {
    const { db, captured } = createDbForCreate();
    const app = createApp(boardMember, db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "draft me" });

    expect(res.status).toBe(201);
    expect(res.body.pendingApproval).toBe(true);
    expect(res.body.post.status).toBe("pending_approval");
    expect(captured.values?.status).toBe("pending_approval");
    expect(captured.values?.createdByUserId).toBe(USER_ID);
  });

  it("an admin's post is created as scheduled (publishes directly)", async () => {
    const { db, captured } = createDbForCreate();
    const app = createApp(boardAdmin, db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "ship it" });

    expect(res.status).toBe(201);
    expect(res.body.pendingApproval).toBe(false);
    expect(res.body.post.status).toBe("scheduled");
    expect(captured.values?.status).toBe("scheduled");
  });

  it("a non-admin cannot approve a draft (403)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(local.via(app)).post(`/api/socials/posts/${POST_ID}/approve`).send({});
    expect(res.status).toBe(403);
  });

  it("an admin approves a pending draft → status becomes scheduled", async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => ({ limit: async () => [{ status: "pending_approval" }] }) }),
        }),
      }),
      update: () => ({
        set: (patch: Record<string, unknown>) => ({
          where: () => ({ returning: async () => [{ id: POST_ID, ...patch }] }),
        }),
      }),
    };
    const app = createApp(boardAdmin, db);
    const res = await request(local.via(app)).post(`/api/socials/posts/${POST_ID}/approve`).send({});

    expect(res.status).toBe(200);
    expect(res.body.post.status).toBe("scheduled");
  });

  it("a non-admin cannot bypass approval via enqueue-from-content (403)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(local.via(app))
      .post("/api/socials/posts/enqueue-from-content")
      .send({ contentItemId: "c1" });
    expect(res.status).toBe(403);
  });

  it("a non-admin cannot force-drain the queue via relay-now (403)", async () => {
    const app = createApp(boardMember, {});
    const res = await request(local.via(app)).post("/api/socials/posts/relay-now").send({});
    expect(res.status).toBe(403);
  });
});
