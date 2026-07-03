// ---------------------------------------------------------------------------
// university-admin auth gate — fail-closed tests.
//
// The /api/university-admin surface performs billing mutations, so it is
// gated by TWO layers (see routes/university-admin.ts):
//   1. req.actor.type === "board"           → else 401
//   2. caller email ∈ UNIVERSITY_SESSION_ADMINS (fail closed on empty) → else 403
//
// These cases exercise the two short-circuit branches that never touch the
// database, so no embedded Postgres is required: a request WITHOUT a board
// actor is 401, and a board actor with an empty/unset allow-list is 403 on
// both read and destructive routes.
// ---------------------------------------------------------------------------
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@paperclipai/db";
import { universityAdminRoutes } from "../routes/university-admin.js";
import { useLocalServer } from "./helpers/supertest-server.js";

// Route every request through the shared 127.0.0.1-bound server (never a bare
// Express app) to avoid the macOS port-steal race — see docs/guides/
// test-isolation.md.
const local = useLocalServer();

// Minimal stub — only logAdminAccess touches it (after the response is sent,
// swallowing any error), and the guard's short-circuits return before any
// query. `.insert().values()` resolves so nothing throws.
const stubDb = {
  insert: () => ({ values: () => Promise.resolve() }),
} as unknown as Db;

type ActorType = "board" | "agent" | "none";

function makeApp(actor: { type: ActorType; userId?: string } | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.actor = actor ?? { type: "none" };
    next();
  });
  app.use("/api/university-admin", universityAdminRoutes(stubDb));
  return app;
}

const ORIGINAL = process.env.UNIVERSITY_SESSION_ADMINS;

describe("university-admin auth gate (fail-closed)", () => {
  beforeEach(() => {
    delete process.env.UNIVERSITY_SESSION_ADMINS;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.UNIVERSITY_SESSION_ADMINS;
    else process.env.UNIVERSITY_SESSION_ADMINS = ORIGINAL;
  });

  it("rejects a request with no board actor (401)", async () => {
    const app = makeApp({ type: "none" });
    const res = await request(local.via(app)).get("/api/university-admin/members");
    expect(res.status).toBe(401);
  });

  it("rejects a non-board (agent) actor (401)", async () => {
    const app = makeApp({ type: "agent" });
    const res = await request(local.via(app)).get("/api/university-admin/members");
    expect(res.status).toBe(401);
  });

  it("fails closed for a board actor when the admin allow-list is empty (403)", async () => {
    // UNIVERSITY_SESSION_ADMINS unset ⇒ nobody is an admin.
    const app = makeApp({ type: "board", userId: "some-user-id" });
    const res = await request(local.via(app)).get("/api/university-admin/members");
    expect(res.status).toBe(403);
  });

  it("fails closed on a destructive action when the allow-list is empty (403)", async () => {
    const app = makeApp({ type: "board", userId: "some-user-id" });
    const res = await request(local.via(app))
      .post("/api/university-admin/members/abc/cancel")
      .send({ reason: "test" });
    expect(res.status).toBe(403);
  });

  it("fails closed for a board actor missing a userId (401)", async () => {
    process.env.UNIVERSITY_SESSION_ADMINS = "admin@example.com";
    const app = makeApp({ type: "board" }); // no userId
    const res = await request(local.via(app)).get("/api/university-admin/members");
    expect(res.status).toBe(401);
  });
});
