// ---------------------------------------------------------------------------
// PATCH /queue/:id/schedule — Approve and Change time. A time already past must
// not be written as-is (the queue would post it at once, and a batch of stale
// approvals would all go out together); a clash with another video is refused.
// Mirrors youtube-queue-edit.test.ts: useLocalServer, a board actor, mocked db.
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
// Real slot rules; only the DB read of other videos' times is stubbed.
const takenPublishTimes = vi.fn<(db: unknown, now: Date, excludeId?: string) => Promise<Date[]>>();
vi.mock("../services/youtube/publish-slots.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/youtube/publish-slots.js")>()),
  takenPublishTimes: (...args: [unknown, Date, string?]) => takenPublishTimes(...args),
}));

const { youtubeRoutes } = await import("../routes/youtube.js");

// update().set().where().returning() records each `set` and reports one row changed.
function makeDb() {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updates.push(set);
            return [{ id: "q1" }];
          },
        }),
      }),
    }),
    __updates: updates,
  };
  return db;
}

const local = useLocalServer();
function makeApp(db: ReturnType<typeof makeDb>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = { type: "board", userId: "user-1", source: "session" };
    next();
  });
  app.use("/api/youtube", youtubeRoutes(db as never));
  return app;
}

const schedule = (app: express.Express, id: string, publishTime: string) =>
  request(local.via(app)).patch(`/api/youtube/queue/${id}/schedule`).send({ publishTime });

describe("PATCH /queue/:id/schedule", () => {
  it("moves an approval whose time has passed to a future free slot", async () => {
    takenPublishTimes.mockResolvedValueOnce([]);
    const db = makeDb();
    const res = await schedule(makeApp(db), "q1", "2026-10-10T14:00:00.000Z");
    expect(res.status).toBe(200);
    expect(res.body.moved).toBe(true);
    const written = db.__updates[0]?.publishTime as Date;
    expect(written.getTime()).toBeGreaterThan(Date.now());
    expect(res.body.publishTime).toBe(written.toISOString());
    expect(db.__updates[0]?.status).toBe("scheduled");
  });

  it("leaves the row being scheduled out of the taken times", async () => {
    takenPublishTimes.mockResolvedValueOnce([]);
    await schedule(makeApp(makeDb()), "q1", "2026-10-10T14:00:00.000Z");
    expect(takenPublishTimes.mock.lastCall?.[2]).toBe("q1");
  });

  it("keeps a free future time as asked", async () => {
    const asked = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    takenPublishTimes.mockResolvedValueOnce([new Date(asked.getTime() + 2 * 60 * 60 * 1000)]);
    const db = makeDb();
    const res = await schedule(makeApp(db), "q1", asked.toISOString());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ publishTime: asked.toISOString(), moved: false });
    expect((db.__updates[0]?.publishTime as Date).toISOString()).toBe(asked.toISOString());
  });

  it("409 and no write when the time clashes with another queued video", async () => {
    const other = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    takenPublishTimes.mockResolvedValueOnce([other]);
    const db = makeDb();
    const res = await schedule(makeApp(db), "q1", new Date(other.getTime() + 10 * 60 * 1000).toISOString());
    expect(res.status).toBe(409);
    expect(res.body.error).toContain(other.toISOString());
    expect(db.__updates).toHaveLength(0);
  });
});
