// ---------------------------------------------------------------------------
// PATCH /queue/:id — edit a queued video's title / description before approving.
// Mirrors the harness in youtube-video-stream.test.ts: useLocalServer, a board
// actor, and a mocked youtubeRoutes' db so the two updates can be asserted.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { useLocalServer } from "./helpers/supertest-server.js";

vi.mock("../services/youtube/production.js", () => ({ runProductionPipeline: vi.fn() }));
vi.mock("../services/youtube/publish-queue.js", () => ({
  processPublishQueue: vi.fn(),
  forcePublish: vi.fn(),
  PUBLISHABLE_QUEUE_STATUSES: ["pending_review", "scheduled", "paused"],
}));
vi.mock("../services/youtube/analytics.js", () => ({ collectAnalytics: vi.fn(), generateOptimizationInsights: vi.fn() }));
vi.mock("../services/youtube/content-strategy.js", () => ({ generateContentStrategy: vi.fn() }));
vi.mock("../services/youtube/tts.js", () => ({ getTTSProviderStatus: () => [] }));
vi.mock("../services/visual-backends/index.js", () => ({ getBackendSummary: () => [] }));
vi.mock("../middleware/log-admin-access.js", () => ({
  logAdminAccess: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const { youtubeRoutes } = await import("../routes/youtube.js");

type Row = { id: string; status: string; title: string; metadata: Record<string, unknown> };

// A minimal db mock: select().from().where().limit() returns the first row (or
// []), and every update().set().where() records its `set` payload in call order
// (queue update first, then the linked SEO update). The route's type is Db, so
// the mock is passed as `never` exactly like the stream test does.
function makeDb(rows: Row[]) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => (rows.length ? [rows[0]] : []),
        }),
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => {
          updates.push(set);
          return [];
        },
      }),
    }),
    __updates: updates,
  };
  return db;
}

const local = useLocalServer();
function makeApp(actorType: "board" | "none", db: ReturnType<typeof makeDb>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = { type: actorType, userId: "user-1", source: "session" };
    next();
  });
  app.use("/api/youtube", youtubeRoutes(db as never));
  return app;
}

const patch = (app: express.Express, id: string, body: unknown) =>
  request(local.via(app)).patch(`/api/youtube/queue/${id}`).send(body as object);

describe("PATCH /queue/:id", () => {
  it("200 on a pending_review row with both fields, keeps other metadata keys", async () => {
    const db = makeDb([
      {
        id: "q1",
        status: "pending_review",
        title: "Old Title",
        metadata: { seoId: "seo1", description: "Old desc", tags: ["a"], videoPath: "/v.mp4" },
      },
    ]);
    const app = makeApp("board", db);

    const res = await patch(app, "q1", { title: "  New Title  ", description: "New desc" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, title: "New Title", description: "New desc" });

    // First update: ytPublishQueue — title set, description set, other keys survive.
    const queueUpdate = db.__updates[0];
    expect(queueUpdate.title).toBe("New Title");
    const md = queueUpdate.metadata as Record<string, unknown>;
    expect(md.description).toBe("New desc");
    expect(md.tags).toEqual(["a"]);
    expect(md.videoPath).toBe("/v.mp4");
    expect(md.seoId).toBe("seo1");

    // Second update: the linked ytSeoData row — both fields.
    const seoUpdate = db.__updates[1];
    expect(seoUpdate.title).toBe("New Title");
    expect(seoUpdate.description).toBe("New desc");
  });

  it("400 for an empty title", async () => {
    const app = makeApp("board", makeDb([]));
    const res = await patch(app, "q1", { title: "   " });
    expect(res.status).toBe(400);
  });

  it("400 for a 101-character title", async () => {
    const app = makeApp("board", makeDb([]));
    const res = await patch(app, "q1", { title: "a".repeat(101) });
    expect(res.status).toBe(400);
  });

  it("400 for a 5001-character description (new byte-based sentence)", async () => {
    const app = makeApp("board", makeDb([
      { id: "q1", status: "pending_review", title: "Old Title", metadata: { description: "Old desc", tags: [] } },
    ]));
    const res = await patch(app, "q1", { description: "a".repeat(5001) });
    expect(res.status).toBe(400);
    // 5001 ASCII chars + the blank line ("\n\n") = 5003 bytes, 3 over YouTube's 5000.
    expect(res.body.error).toBe("Description is too long for YouTube by 3 bytes");
  });

  it("400 for an empty body", async () => {
    const app = makeApp("board", makeDb([]));
    const res = await patch(app, "q1", {});
    expect(res.status).toBe(400);
  });

  it("400 for < in a title, and nothing is written", async () => {
    const db = makeDb([{ id: "q1", status: "pending_review", title: "Old", metadata: { description: "d", tags: [] } }]);
    const res = await patch(makeApp("board", db), "q1", { title: "a < b" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Title and description cannot contain < or >");
    expect(db.__updates).toHaveLength(0);
  });

  it("the row's tags count toward the description limit", async () => {
    // 4,998 letters + the blank line = 5,000 bytes: fits with no tags, 4 bytes over with "#tag".
    const row = (tags: string[]) => ({ id: "q1", status: "pending_review", title: "Old", metadata: { description: "d", tags } });
    const description = "a".repeat(4998);
    expect((await patch(makeApp("board", makeDb([row([])])), "q1", { description })).status).toBe(200);
    const res = await patch(makeApp("board", makeDb([row(["tag"])])), "q1", { description });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Description is too long for YouTube by 4 bytes");
  });

  it("a title-only edit is not refused for the description it did not touch", async () => {
    const db = makeDb([{ id: "q1", status: "pending_review", title: "Old", metadata: { description: "a > b", tags: [] } }]);
    const res = await patch(makeApp("board", db), "q1", { title: "New" });
    expect(res.status).toBe(200);
    expect(db.__updates[0].title).toBe("New");
  });

  it("409 for a published row", async () => {
    const app = makeApp("board", makeDb([{ id: "q1", status: "published", title: "T", metadata: {} }]));
    const res = await patch(app, "q1", { title: "New" });
    expect(res.status).toBe(409);
  });

  it("401 for an anonymous actor", async () => {
    const app = makeApp("none", makeDb([]));
    const res = await patch(app, "q1", { title: "New" });
    expect(res.status).toBe(401);
  });
});
