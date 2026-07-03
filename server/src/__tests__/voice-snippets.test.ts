// ---------------------------------------------------------------------------
// Voice-snippet endpoint tests (Content Hub, CONTRACT-3).
//
// The ElevenLabs client is mocked (fetchImpl injection — these tests MUST pass
// with no ELEVENLABS_VOICE_KEY minted and no network), storage is a stub, and
// the DB is a tiny stateful in-memory fake: enough for the cache-first select,
// the assets insert, and the ON CONFLICT DO NOTHING insert + re-select. Runs
// without Postgres, mirroring socials-posts-rbac.test.ts.
// ---------------------------------------------------------------------------

import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assets } from "@paperclipai/db";
import { voiceSnippetsRouter } from "../routes/voice-snippets.js";
import { errorHandler } from "../middleware/index.js";
import { closeIpv4Servers, ipv4Request } from "./helpers/ipv4-agent.js";
import type { StorageService } from "../storage/types.js";

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const USER_ID = "user_abc123"; // better-auth ids are non-uuid text

const boardMember = {
  type: "board",
  userId: USER_ID,
  source: "session",
  isInstanceAdmin: false,
  companyIds: [COMPANY_ID],
};
const unauthenticated = { type: "none", source: "none" };

/** Stateful in-memory stand-ins for the two tables the route touches. */
function createDbStub() {
  const state = {
    snippets: [] as Array<Record<string, unknown>>,
    assetsCreated: 0,
  };
  const db = {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => ({
          // Match the real eq(cacheKey, <value>) condition: drizzle's SQL
          // object carries the bound value in its Param chunk (the only
          // chunk whose `value` is a plain string).
          limit: async () => {
            const chunks =
              (cond as { queryChunks?: Array<{ value?: unknown }> })?.queryChunks ?? [];
            const param = chunks.find((chunk) => typeof chunk?.value === "string");
            if (!param) return state.snippets.slice(0, 1);
            return state.snippets.filter((s) => s.cacheKey === param.value).slice(0, 1);
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (v: Record<string, unknown>) => {
        if (table === assets) {
          state.assetsCreated += 1;
          const row = { id: `asset-${state.assetsCreated}`, companyId: COMPANY_ID, ...v };
          return { returning: async () => [row] };
        }
        // voice_snippets: ON CONFLICT (cache_key) DO NOTHING semantics.
        return {
          onConflictDoNothing: async () => {
            if (!state.snippets.some((s) => s.cacheKey === v.cacheKey)) {
              state.snippets.push({ id: `vs-${state.snippets.length + 1}`, ...v });
            }
            return [];
          },
        };
      },
    }),
  };
  return { db, state };
}

function createStorageStub() {
  const putFile = vi.fn(async (input: { body: Buffer; contentType: string; originalFilename: string | null }) => ({
    provider: "local" as const,
    objectKey: `voice-snippets/${input.originalFilename}`,
    contentType: input.contentType,
    byteSize: input.body.length,
    sha256: "stub-sha",
    originalFilename: input.originalFilename,
  }));
  return { storage: { putFile } as unknown as StorageService, putFile };
}

const AUDIO_BYTES = Buffer.from("fake-mp3-bytes-0123456789");

/** fetch mock: TTS POSTs return audio; /v2/voices returns the given ids. */
function createFetchMock(voiceIds: string[] = []) {
  return vi.fn(async (url: RequestInfo | URL) => {
    const href = String(url);
    if (href.includes("/v2/voices")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ voices: voiceIds.map((id) => ({ voice_id: id })) }),
      } as unknown as Response;
    }
    // Tiny tick so concurrent POSTs overlap before the first insert lands.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () => AUDIO_BYTES.buffer.slice(
        AUDIO_BYTES.byteOffset,
        AUDIO_BYTES.byteOffset + AUDIO_BYTES.byteLength,
      ),
    } as unknown as Response;
  });
}

function createApp(
  actor: Record<string, unknown>,
  db: unknown,
  storage: StorageService,
  fetchImpl: typeof fetch,
) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = actor;
    next();
  });
  app.use("/api/voice-snippets", voiceSnippetsRouter(db as never, storage, fetchImpl));
  app.use(errorHandler);
  return app;
}

const ALL_VOICE_IDS = [
  "n45mfBjBoGc0McY8O2Aw", // mark
  "BeKZH03brdNaVyYtd97H", // brianna
  "cw0sQ4mVjT9BbISUtO51", // mami
  "zmcVlqmyk3Jpn5AVYcAL", // remy
  "CKfuQaJKfvUG2Wtrda3Y", // solene
];

describe("voice-snippet routes", () => {
  const envBefore = {
    voiceKey: process.env.ELEVENLABS_VOICE_KEY,
    companyId: process.env.TEAM_DASHBOARD_COMPANY_ID,
    dailyLimit: process.env.VOICE_SNIPPETS_DAILY_LIMIT,
  };

  beforeEach(() => {
    process.env.ELEVENLABS_VOICE_KEY = "test-voice-key";
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;
  });

  afterEach(async () => {
    if (envBefore.voiceKey === undefined) delete process.env.ELEVENLABS_VOICE_KEY;
    else process.env.ELEVENLABS_VOICE_KEY = envBefore.voiceKey;
    if (envBefore.companyId === undefined) delete process.env.TEAM_DASHBOARD_COMPANY_ID;
    else process.env.TEAM_DASHBOARD_COMPANY_ID = envBefore.companyId;
    if (envBefore.dailyLimit === undefined) delete process.env.VOICE_SNIPPETS_DAILY_LIMIT;
    else process.env.VOICE_SNIPPETS_DAILY_LIMIT = envBefore.dailyLimit;
    await closeIpv4Servers();
  });

  it("rejects an unauthenticated request with 401", async () => {
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const app = createApp(unauthenticated, db, storage, createFetchMock());
    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "hello" });
    expect(res.status).toBe(401);
  });

  it("rejects an unknown voiceKey with 400 and never calls ElevenLabs", async () => {
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);
    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      // A raw ElevenLabs voice_id is NOT a voiceKey — must be rejected.
      .send({ voiceKey: "n45mfBjBoGc0McY8O2Aw", text: "hello" });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects over-cap text with 400", async () => {
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);
    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "x".repeat(1501) });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 with a plain-English error when ELEVENLABS_VOICE_KEY is unset", async () => {
    delete process.env.ELEVENLABS_VOICE_KEY;
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);
    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "hello there" });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/isn't set up yet/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generates on a miss, stores via StorageService, and returns the contract shape", async () => {
    const { db, state } = createDbStub();
    const { storage, putFile } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);

    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Coherence is trainable.", kitId: 1, field: "endcard" });

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(res.body.assetId).toBe("asset-1");
    expect(res.body.contentPath).toBe("/api/assets/asset-1/content");
    expect(res.body.voiceName).toBe("Mark"); // persona label, never the raw ElevenLabs name
    expect(res.body.byteSize).toBe(AUDIO_BYTES.length);
    expect(typeof res.body.durationSec).toBe("number");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putFile).toHaveBeenCalledTimes(1);
    expect(putFile.mock.calls[0]?.[0]).toMatchObject({
      companyId: COMPANY_ID,
      namespace: "assets/voice-snippets",
      contentType: "audio/mpeg",
    });
    // The voice id sent upstream comes from the SERVER registry, not the body.
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("n45mfBjBoGc0McY8O2Aw");
    expect(state.snippets).toHaveLength(1);
    expect(state.snippets[0]?.createdByUserId).toBe(USER_ID);
  });

  it("returns the cached row on a hit without a second ElevenLabs call", async () => {
    const { db } = createDbStub();
    const { storage, putFile } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);

    const first = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "brianna", text: "Small reps, big shifts." });
    expect(first.status).toBe(200);
    expect(first.body.cached).toBe(false);

    const second = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "brianna", text: "Small reps, big shifts." });
    expect(second.status).toBe(200);
    expect(second.body.cached).toBe(true);
    expect(second.body.assetId).toBe(first.body.assetId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putFile).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent duplicate POSTs into one generation", async () => {
    const { db } = createDbStub();
    const { storage, putFile } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);

    const [a, b] = await Promise.all([
      (await ipv4Request(app)).post("/api/voice-snippets").send({ voiceKey: "mark", text: "Double click." }),
      (await ipv4Request(app)).post("/api/voice-snippets").send({ voiceKey: "mark", text: "Double click." }),
    ]);

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.assetId).toBe(b.body.assetId);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(putFile).toHaveBeenCalledTimes(1);
  });

  it("caps paid generations per user per day (429) — cached lines stay free", async () => {
    // Cost-abuse guard: distinct texts always miss the cache, so without a
    // cap any board user could script unbounded paid TTS on Mark's account.
    process.env.VOICE_SNIPPETS_DAILY_LIMIT = "2";
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);

    const first = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Unique line one." });
    expect(first.status).toBe(200);
    const second = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Unique line two." });
    expect(second.status).toBe(200);

    // Third NEW text: over the cap → plain-English 429, no ElevenLabs call.
    const third = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Unique line three." });
    expect(third.status).toBe(429);
    expect(third.body.error).toMatch(/limit/i);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A cache hit is not a paid generation — still served over the cap.
    const cached = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Unique line one." });
    expect(cached.status).toBe(200);
    expect(cached.body.cached).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a failed generation does not consume a daily slot (refund on ElevenLabs error)", async () => {
    // Quota fairness: a transient ElevenLabs 5xx bills nothing, so it must not
    // cost the user one of their limited daily slots.
    process.env.VOICE_SNIPPETS_DAILY_LIMIT = "1";
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    let ttsCalls = 0;
    const fetchMock = vi.fn(async () => {
      ttsCalls += 1;
      if (ttsCalls === 1) {
        // First call: transient upstream failure.
        return { ok: false, status: 503, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () =>
          AUDIO_BYTES.buffer.slice(AUDIO_BYTES.byteOffset, AUDIO_BYTES.byteOffset + AUDIO_BYTES.byteLength),
      } as unknown as Response;
    });
    const app = createApp(boardMember, db, storage, fetchMock as unknown as typeof fetch);

    const failed = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Transient blip." });
    expect(failed.status).toBe(502);

    // The one daily slot was refunded, so this distinct-text line still generates.
    const ok = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "Now it works." });
    expect(ok.status).toBe(200);
    expect(ok.body.cached).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("concurrent distinct-text requests never overshoot the daily cap", async () => {
    // Race safety: two distinct texts both miss the cache, but the synchronous
    // reserve-before-generate cap means exactly one wins the single slot.
    process.env.VOICE_SNIPPETS_DAILY_LIMIT = "1";
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = createFetchMock();
    const app = createApp(boardMember, db, storage, fetchMock);

    const [a, b] = await Promise.all([
      (await ipv4Request(app)).post("/api/voice-snippets").send({ voiceKey: "mark", text: "Distinct A." }),
      (await ipv4Request(app)).post("/api/voice-snippets").send({ voiceKey: "mark", text: "Distinct B." }),
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 429]);
    // Only the winner ever reaches ElevenLabs — no double-spend.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("maps an ElevenLabs failure to a plain 502 without leaking the response", async () => {
    const { db } = createDbStub();
    const { storage } = createStorageStub();
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 401,
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as Response);
    const app = createApp(boardMember, db, storage, fetchMock as unknown as typeof fetch);

    const res = await (await ipv4Request(app))
      .post("/api/voice-snippets")
      .send({ voiceKey: "mark", text: "hello" });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Try again/);
  });

  describe("GET /health", () => {
    it("reports ok when every registry voice is on the account", async () => {
      const { db } = createDbStub();
      const { storage } = createStorageStub();
      const app = createApp(boardMember, db, storage, createFetchMock(ALL_VOICE_IDS));
      const res = await (await ipv4Request(app)).get("/api/voice-snippets/health");
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, missingVoices: [] });
    });

    it("names the missing voices when the key is for the wrong account", async () => {
      const { db } = createDbStub();
      const { storage } = createStorageStub();
      // Scribe-account scenario: none of the 5 voices exist there.
      const app = createApp(boardMember, db, storage, createFetchMock(["someone-elses-voice"]));
      const res = await (await ipv4Request(app)).get("/api/voice-snippets/health");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.missingVoices).toEqual(["mark", "brianna", "mami", "remy", "solene"]);
    });

    it("caches a healthy result for the cooldown window — one upstream call", async () => {
      // /health is board-reachable and each miss is a live ElevenLabs call, so
      // a successful result is cached briefly (mirrors system-health's ping cache).
      const { db } = createDbStub();
      const { storage } = createStorageStub();
      const fetchMock = createFetchMock(ALL_VOICE_IDS);
      const app = createApp(boardMember, db, storage, fetchMock);

      const first = await (await ipv4Request(app)).get("/api/voice-snippets/health");
      expect(first.status).toBe(200);
      expect(first.body).toEqual({ ok: true, missingVoices: [] });

      const second = await (await ipv4Request(app)).get("/api/voice-snippets/health");
      expect(second.status).toBe(200);
      expect(second.body).toEqual({ ok: true, missingVoices: [] });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns 503 when the voice key is unset", async () => {
      delete process.env.ELEVENLABS_VOICE_KEY;
      const { db } = createDbStub();
      const { storage } = createStorageStub();
      const app = createApp(boardMember, db, storage, createFetchMock(ALL_VOICE_IDS));
      const res = await (await ipv4Request(app)).get("/api/voice-snippets/health");
      expect(res.status).toBe(503);
      expect(res.body.ok).toBe(false);
    });
  });
});
