// ---------------------------------------------------------------------------
// Compose-time platform-requirement guard on POST /socials/posts — the real
// trust boundary (the UI's own copy of this same @paperclipai/shared check is
// only a courtesy; this route must independently reject a bad post before it
// ever reaches the relayer/Zernio). See packages/shared/src/socials-compose.ts.
//
// The DB is stubbed per-test (see socials-posts-rbac.test.ts for the same
// pattern) — only the account lookup needs to be real; the guard short-
// circuits before any insert when it fails.
// ---------------------------------------------------------------------------

import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { socialsRoutes } from "../routes/socials.js";
import { errorHandler } from "../middleware/index.js";
import { useLocalServer } from "./helpers/supertest-server.js";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const POST_ID = "22222222-2222-4222-8222-222222222222";
const USER_ID = "user_abc123";

const storageStub = {} as never;
const boardAdmin = { type: "board", userId: USER_ID, source: "session", isInstanceAdmin: true };

function createApp(db: unknown, storage: unknown = storageStub) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = boardAdmin;
    next();
  });
  app.use("/api/socials", socialsRoutes(db as never, storage as never));
  app.use(errorHandler);
  return app;
}

/** Stub supporting the create path for a given account platform. */
function createDbFor(platform: string) {
  const captured: { values?: Record<string, unknown> } = {};
  const db = {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => [{ id: ACCOUNT_ID, status: "active", platform }] }) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        captured.values = v;
        return { returning: async () => [{ id: POST_ID, ...v }] };
      },
    }),
  };
  return { db, captured };
}

const local = useLocalServer();

describe("POST /socials/posts — platform-requirement guard", () => {
  it("rejects an Instagram post with no media, in plain English", async () => {
    const { db } = createDbFor("instagram");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "no photo attached" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/instagram/i);
    expect(res.body.error).toMatch(/photo or video/i);
  });

  it("accepts an Instagram post once media is attached", async () => {
    const { db, captured } = createDbFor("instagram");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "look at this", mediaUrls: ["companyId/socials/compose/2026/07/03/abc-photo.jpg"] });
    expect(res.status).toBe(201);
    expect(captured.values?.mediaUrls).toHaveLength(1);
  });

  it("rejects a TikTok post whose only attachment is a photo, not a video", async () => {
    const { db } = createDbFor("tiktok");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "dance", mediaUrls: ["companyId/socials/compose/2026/07/03/abc-photo.jpg"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/video/i);
  });

  it("accepts a TikTok post whose attachment is recognized as a video", async () => {
    const { db, captured } = createDbFor("tiktok");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "dance", mediaUrls: ["companyId/socials/compose/2026/07/03/abc-clip.mp4"] });
    expect(res.status).toBe(201);
    expect(captured.values?.mediaUrls).toHaveLength(1);
  });

  it("rejects a TikTok post whose attachment is really a photo renamed with a .mp4 extension", async () => {
    // The objectKey's extension comes from the client-supplied originalname —
    // untrustworthy on its own. The guard must trust the magic-byte sniff
    // POST /media stored (surfaced here via storageService.headObject's
    // contentType), not just isVideoRef's filename regex.
    const { db } = createDbFor("tiktok");
    const storage = { headObject: async () => ({ exists: true, contentType: "image/jpeg" }) };
    const app = createApp(db, storage);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({
        socialAccountId: ACCOUNT_ID,
        text: "dance",
        mediaUrls: ["companyId/socials/compose/2026/07/03/abc-clip.mp4"],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/video/i);
  });

  it("rejects a Bluesky caption over the 300-character limit", async () => {
    const { db } = createDbFor("bluesky");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "x".repeat(301) });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/300/);
  });

  it("still allows a Bluesky text-only post (media never required there)", async () => {
    const { db, captured } = createDbFor("bluesky");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({ socialAccountId: ACCOUNT_ID, text: "just words" });
    expect(res.status).toBe(201);
    expect(captured.values?.mediaUrls).toEqual([]);
  });

  it("rejects more than 4 media attachments regardless of platform", async () => {
    const { db } = createDbFor("bluesky");
    const app = createApp(db);
    const res = await request(local.via(app))
      .post("/api/socials/posts")
      .send({
        socialAccountId: ACCOUNT_ID,
        text: "too much",
        mediaUrls: ["a.jpg", "b.jpg", "c.jpg", "d.jpg", "e.jpg"],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most 4/i);
  });
});
