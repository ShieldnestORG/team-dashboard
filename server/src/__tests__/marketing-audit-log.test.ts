// ---------------------------------------------------------------------------
// Audit-log attachment on the marketing surfaces (Eagan-access hardening).
//
// socials.ts and voice-snippets.ts now mount `logAdminAccess(db)` at router
// level, BEFORE the board gate, so every call made with a board API key (or
// an anonymous probe) leaves an admin_access_log row with actor identity.
// These tests exercise the REAL routers (not a mirror app) against embedded
// Postgres, on endpoints that never touch the network:
//   - GET  /api/socials/caption-styles   (static data, no Zernio/ElevenLabs)
//   - POST /api/voice-snippets           (unknown voiceKey → 400 before any
//                                         ElevenLabs call)
// A global-fetch tripwire enforces the no-network invariant, mirroring
// funnel-control-rbac.test.ts.
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
import { socialsRoutes } from "../routes/socials.js";
import { voiceSnippetsRouter } from "../routes/voice-snippets.js";
import { errorHandler } from "../middleware/index.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const COMPANY_ID = "44444444-4444-4444-8444-444444444444";
const storageStub = {} as never;

// Tripwire: neither endpoint under test may reach the network.
const realFetch = globalThis.fetch;
beforeAll(() => {
  vi.stubGlobal("fetch", async () => {
    throw new Error("network disabled in marketing-audit-log tests");
  });
});
afterAll(() => {
  vi.stubGlobal("fetch", realFetch);
});

// ---------------------------------------------------------------------------
// Stub-DB attachment test — runs everywhere (no Postgres). Proves the
// routers actually mount logAdminAccess by capturing the insert the
// middleware fires after the response. The embedded-pg suite below then
// verifies the full row shape end-to-end where pg is available.
// ---------------------------------------------------------------------------

describe("marketing surfaces mount logAdminAccess (stub db)", () => {
  const local = useLocalServer();

  function captureApp() {
    const captured: Array<Record<string, unknown>> = [];
    const db = {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          captured.push(row);
          return Promise.resolve();
        },
      }),
    } as never;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = {
        type: "board",
        userId: "11111111-1111-4111-8111-111111111111",
        source: "board_key",
        keyId: "22222222-2222-4222-8222-222222222222",
        isInstanceAdmin: false,
        companyIds: [COMPANY_ID],
      };
      next();
    });
    app.use("/api/socials", socialsRoutes(db, storageStub));
    app.use("/api/voice-snippets", voiceSnippetsRouter(db, storageStub));
    app.use(errorHandler);
    return { app, captured };
  }

  async function waitFor(captured: unknown[], timeoutMs = 2000) {
    const start = Date.now();
    while (captured.length === 0 && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(captured.length).toBeGreaterThan(0);
  }

  it("socials router logs a board-key GET", async () => {
    const { app, captured } = captureApp();
    const res = await request(local.via(app)).get("/api/socials/caption-styles");
    expect(res.status).toBe(200);
    await waitFor(captured);
    expect(captured[0]).toMatchObject({
      method: "GET",
      path: "/api/socials/caption-styles",
      statusCode: 200,
      actorType: "board",
      actorId: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("voice-snippets router logs a POST (bad voiceKey → 400, no network)", async () => {
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;
    const { app, captured } = captureApp();
    const res = await request(local.via(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "nope", text: "hi" });
    expect(res.status).toBe(400);
    await waitFor(captured);
    expect(captured[0]).toMatchObject({
      method: "POST",
      path: "/api/voice-snippets",
      statusCode: 400,
      actorType: "board",
    });
  });
});

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres marketing-audit-log tests: ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("marketing surfaces write admin_access_log rows", () => {
  let testDb: EmbeddedPostgresTestDatabase;
  let db: ReturnType<typeof createDb>;
  const local = useLocalServer();

  beforeAll(async () => {
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;
    testDb = await startEmbeddedPostgresTestDatabase("marketing-audit-");
    db = createDb(testDb.connectionString);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  function appWith(actor: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: unknown }).actor = actor;
      next();
    });
    app.use("/api/socials", socialsRoutes(db, storageStub));
    app.use("/api/voice-snippets", voiceSnippetsRouter(db, storageStub));
    app.use(errorHandler);
    return app;
  }

  /** Poll briefly for the newest row — the insert is fire-and-forget. */
  async function waitForLatestRow(afterCount: number, timeoutMs = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const rows = await db
        .select()
        .from(adminAccessLog)
        .orderBy(desc(adminAccessLog.createdAt));
      if (rows.length > afterCount) return rows[0]!;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("admin_access_log row never appeared");
  }

  async function countRows(): Promise<number> {
    return (await db.select().from(adminAccessLog)).length;
  }

  it("board-key GET /api/socials/caption-styles writes a row with actor identity", async () => {
    const before = await countRows();
    const userId = randomUUID();
    const app = appWith({
      type: "board",
      userId,
      source: "board_key",
      keyId: randomUUID(),
      isInstanceAdmin: false,
      companyIds: [COMPANY_ID],
    });

    const res = await request(local.via(app)).get("/api/socials/caption-styles");
    expect(res.status).toBe(200);

    const row = await waitForLatestRow(before);
    expect(row.method).toBe("GET");
    expect(row.path).toBe("/api/socials/caption-styles");
    expect(row.statusCode).toBe(200);
    expect(row.actorType).toBe("board");
    expect(row.actorId).toBe(userId);
  });

  it("anonymous probe on /api/socials is 401 AND still logged", async () => {
    const before = await countRows();
    const app = appWith({ type: "none", source: "none" });

    const res = await request(local.via(app)).get("/api/socials/funnels");
    expect(res.status).toBe(401);

    const row = await waitForLatestRow(before);
    expect(row.actorType).toBe("none");
    expect(row.statusCode).toBe(401);
    expect(row.actorId).toBeNull();
  });

  it("POST /api/voice-snippets writes a row with body SHAPE, never the text", async () => {
    const before = await countRows();
    const userId = randomUUID();
    const app = appWith({
      type: "board",
      userId,
      source: "board_key",
      keyId: randomUUID(),
      isInstanceAdmin: false,
      companyIds: [COMPANY_ID],
    });

    const secretLine = "Comment GLOW and I will send you the link.";
    const res = await request(local.via(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "not-a-real-voice", text: secretLine });
    // Unknown voiceKey → 400 before any ElevenLabs call (tripwire enforces).
    expect(res.status).toBe(400);

    const row = await waitForLatestRow(before);
    expect(row.method).toBe("POST");
    expect(row.path).toBe("/api/voice-snippets");
    expect(row.statusCode).toBe(400);
    expect(row.actorType).toBe("board");
    expect(row.actorId).toBe(userId);
    expect(row.requestSummary).toMatchObject({
      body_shape: { voiceKey: "string", text: "string" },
    });
    // Redaction invariant: the spoken line never lands in the log.
    expect(JSON.stringify(row.requestSummary)).not.toContain(secretLine);
  });
});
