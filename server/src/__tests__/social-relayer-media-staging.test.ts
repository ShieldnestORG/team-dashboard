// ---------------------------------------------------------------------------
// social-relayer media-staging tests.
//
// The relayer resolves a post's media to PUBLIC URLs before dispatch:
//  - already-public URLs pass through unchanged (NO staging)
//  - internal storage objectKeys are fetched via storageService + staged to R2,
//    the resolved public URL is what reaches the publisher
//  - FAIL LOUD: if staging is needed but R2 is unconfigured (or fetch/stage
//    throws), the post is marked failed and the publisher is NEVER called
//
// No DB, no real R2, no real network. The publisher registry, the R2 helper and
// the platform-cap check are all mocked; db + storageService are fakes.
// ---------------------------------------------------------------------------

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";

// social-relayer captures COMPANY_ID at module-load time (matching the repo's
// socials.ts convention), so the env must be set BEFORE the dynamic import below.
process.env.TEAM_DASHBOARD_COMPANY_ID = "company-1";

const publishTextMock = vi.fn(async () => ({ success: true, platformPostId: "zp1" }));

vi.mock("../services/platform-publishers/index.js", () => ({
  getPublisher: () => ({
    name: "instagram",
    isConfigured: () => true,
    publish: async () => ({ success: false }),
    publishText: publishTextMock,
  }),
}));

vi.mock("../services/socials/platform-caps.js", () => ({
  canPublish: async () => ({ allowed: true, used: 0, cap: 100 }),
}));

const stageBufferToR2Mock = vi.fn(async () => "https://pub-test.r2.dev/staged/deadbeef.mp4");
const isR2StagingConfiguredMock = vi.fn(() => true);

vi.mock("../storage/r2-staging.js", () => ({
  // Real-ish: only http(s) public hosts are "already public"; objectKeys are not.
  isAlreadyPublicUrl: (u: string) => /^https?:\/\//i.test(u) && !u.includes("://localhost"),
  isR2StagingConfigured: () => isR2StagingConfiguredMock(),
  stageBufferToR2: (...args: unknown[]) => stageBufferToR2Mock(...(args as [])),
}));

let runSocialRelayerTick: typeof import("../services/social-relayer.js").runSocialRelayerTick;

type Row = Record<string, unknown>;

/**
 * Fake Db: first execute() returns the due rows; the relayer's `media_urls`
 * persistence + status updates are recorded so we can assert idempotent persist.
 */
function makeDb(dueRows: Row[]) {
  const calls: string[] = [];
  let firstSelectDone = false;
  const execute = vi.fn(async (q: unknown) => {
    const text = JSON.stringify(q);
    calls.push(text);
    // The first SELECT (due rows) — detect by the join on social_accounts.
    if (!firstSelectDone && /social_posts/.test(text) && /social_accounts/.test(text)) {
      firstSelectDone = true;
      return dueRows as unknown;
    }
    return [] as unknown;
  });
  return { db: { execute } as never, execute, calls };
}

function makeStorage(bytes = Buffer.from("video-bytes")) {
  const getObject = vi.fn(async () => ({
    stream: Readable.from(bytes),
    contentType: "video/mp4",
  }));
  return { storageService: { getObject } as never, getObject };
}

function dueRow(overrides: Partial<Row> = {}): Row {
  return {
    id: "post-1",
    socialAccountId: "sa-1",
    text: "caption",
    mediaUrls: [],
    altTexts: [],
    replyToUrl: null,
    attempts: 0,
    maxAttempts: 3,
    payload: {},
    platform: "instagram",
    oauthRef: "zernio:acct_1",
    accountStatus: "active",
    ...overrides,
  };
}

describe("social-relayer media staging", () => {
  beforeAll(async () => {
    ({ runSocialRelayerTick } = await import("../services/social-relayer.js"));
  });
  beforeEach(() => {
    publishTextMock.mockClear();
    stageBufferToR2Mock.mockClear();
    isR2StagingConfiguredMock.mockReturnValue(true);
  });
  afterEach(() => {
    /* env is set once at module load; nothing per-test to restore */
  });

  it("passes an already-public URL through unchanged (no staging)", async () => {
    const { db } = makeDb([dueRow({ mediaUrls: ["https://cdn.example.com/a.jpg"] })]);
    const { storageService, getObject } = makeStorage();

    const res = await runSocialRelayerTick(db, storageService);

    expect(res.posted).toBe(1);
    expect(stageBufferToR2Mock).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    const opts = publishTextMock.mock.calls[0]![0] as { mediaUrls: string[] };
    expect(opts.mediaUrls).toEqual(["https://cdn.example.com/a.jpg"]);
  });

  it("stages an internal objectKey to R2 and dispatches the public URL", async () => {
    const objectKey = "company-1/socials/2026/06/17/uuid-clip.mp4";
    const { db, calls } = makeDb([dueRow({ mediaUrls: [objectKey] })]);
    const { storageService, getObject } = makeStorage();

    const res = await runSocialRelayerTick(db, storageService);

    expect(res.posted).toBe(1);
    expect(getObject).toHaveBeenCalledWith("company-1", objectKey);
    expect(stageBufferToR2Mock).toHaveBeenCalledTimes(1);
    const opts = publishTextMock.mock.calls[0]![0] as { mediaUrls: string[] };
    expect(opts.mediaUrls).toEqual(["https://pub-test.r2.dev/staged/deadbeef.mp4"]);
    // Persisted back to the row (idempotent retry) — an UPDATE of media_urls ran.
    expect(calls.some((c) => /media_urls/.test(c))).toBe(true);
  });

  it("FAILS LOUD (post failed, publisher not called) when R2 is unconfigured", async () => {
    isR2StagingConfiguredMock.mockReturnValue(false);
    const objectKey = "company-1/socials/2026/06/17/uuid-clip.mp4";
    const { db } = makeDb([dueRow({ mediaUrls: [objectKey] })]);
    const { storageService } = makeStorage();

    const res = await runSocialRelayerTick(db, storageService);

    expect(res.failed).toBe(1);
    expect(res.posted).toBe(0);
    expect(publishTextMock).not.toHaveBeenCalled();
    expect(stageBufferToR2Mock).not.toHaveBeenCalled();
  });
});
