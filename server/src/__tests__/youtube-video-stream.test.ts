// ---------------------------------------------------------------------------
// GET /videos/:filename/stream — inline playback for the review card.
// The owner could not watch a video where they approve it (2026-10-09): the
// only file route was /download (attachment, no HTTP Range, so no seeking and
// no Safari playback). The stream route must answer Range requests with 206.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { useLocalServer } from "./helpers/supertest-server.js";

// YT_DATA_DIR is read when the route module loads, so it is set before the import.
const dataDir = mkdtempSync(join(tmpdir(), "yt-stream-test-"));
mkdirSync(join(dataDir, "videos"));
const BYTES = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 251));
writeFileSync(join(dataDir, "videos", "video_abc.mp4"), BYTES);
writeFileSync(join(dataDir, "secret.mp4"), "outside the videos folder");
process.env.YT_DATA_DIR = dataDir;

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

const local = useLocalServer();
function makeApp(actorType: "board" | "none") {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = { type: actorType, userId: "user-1", source: "session" };
    next();
  });
  app.use("/api/youtube", youtubeRoutes({} as never));
  return app;
}
const app = makeApp("board");
const get = (path: string) => request(local.via(app)).get(path).responseType("blob");

afterAll(() => rmSync(dataDir, { recursive: true, force: true }));

describe("GET /videos/:filename/stream", () => {
  it("serves the whole file inline as video/mp4 and advertises byte ranges", async () => {
    const res = await get("/api/youtube/videos/video_abc.mp4/stream");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^video\/mp4/);
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.headers["content-disposition"] ?? "").not.toMatch(/attachment/);
    expect(Buffer.compare(res.body as Buffer, BYTES)).toBe(0);
  });

  it("answers a Range request with 206 and exactly those bytes (seeking, Safari)", async () => {
    const res = await get("/api/youtube/videos/video_abc.mp4/stream").set("Range", "bytes=10-19");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 10-19/1000");
    expect(Buffer.compare(res.body as Buffer, BYTES.subarray(10, 20))).toBe(0);
  });

  it("answers an open-ended Range with the tail of the file", async () => {
    const res = await get("/api/youtube/videos/video_abc.mp4/stream").set("Range", "bytes=990-");
    expect(res.status).toBe(206);
    expect(res.headers["content-range"]).toBe("bytes 990-999/1000");
    expect((res.body as Buffer).length).toBe(10);
  });

  it("stays admin-only: an anonymous request gets 401, not the file", async () => {
    const res = await request(local.via(makeApp("none"))).get("/api/youtube/videos/video_abc.mp4/stream");
    expect(res.status).toBe(401);
  });

  it("404 for a file that is not there", async () => {
    const res = await get("/api/youtube/videos/video_gone.mp4/stream");
    expect(res.status).toBe(404);
  });

  it.each(["notes.txt", "..%2Fsecret.mp4", "..mp4"])("400 for a name that is not a plain .mp4 file name: %s", async (name) => {
    const res = await get(`/api/youtube/videos/${name}/stream`);
    expect(res.status).toBe(400);
  });

  it("NEGATIVE CONTROL: the old download route ignores Range (why a player could not seek on it)", async () => {
    const res = await get("/api/youtube/videos/video_abc.mp4/download").set("Range", "bytes=10-19");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect((res.body as Buffer).length).toBe(1000);
  });
});
