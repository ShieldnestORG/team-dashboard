// ---------------------------------------------------------------------------
// Zernio publisher x-request-id stability tests.
//
// These verify the idempotent-retry contract: when the relayer retries a row
// whose 2xx response was lost, Zernio must receive the SAME x-request-id so it
// can de-dupe. The id is derived from the stable social_posts.id (forwarded as
// PublishTextOptions.postId), NOT regenerated per attempt. When postId is
// absent the publisher falls back to a per-call randomUUID().
//
// No DB, no real network — fetch is mocked. ZERNIO_KEY_* is a placeholder.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zernioPublisher } from "../services/platform-publishers/zernio.js";
import type { PublishTextOptions } from "../services/platform-publishers/types.js";

const ZID = "acct_123";
const KEY_ENV = `ZERNIO_KEY_${ZID}`;
const originalKey = process.env[KEY_ENV];

function baseOpts(overrides: Partial<PublishTextOptions> = {}): PublishTextOptions {
  return {
    text: "hello world",
    socialAccountId: "sa-1",
    oauthRef: `zernio:${ZID}`,
    ...overrides,
  };
}

function mockOkFetch() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ id: "zpost_1" }),
  } as Response);
}

function requestIdOf(call: unknown[]): string {
  const init = call[1] as RequestInit;
  const headers = init.headers as Record<string, string>;
  return headers["x-request-id"];
}

describe("zernioPublisher x-request-id stability", () => {
  beforeEach(() => {
    process.env[KEY_ENV] = "placeholder-test-key";
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = originalKey;
    vi.restoreAllMocks();
  });

  it("uses postId as x-request-id, identical across retries of the same row", async () => {
    const fetchSpy = mockOkFetch();
    const postId = "post-uuid-abc";

    await zernioPublisher.publishText!(baseOpts({ postId }));
    await zernioPublisher.publishText!(baseOpts({ postId }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const id1 = requestIdOf(fetchSpy.mock.calls[0]);
    const id2 = requestIdOf(fetchSpy.mock.calls[1]);
    expect(id1).toBe(postId);
    expect(id2).toBe(postId);
    expect(id1).toBe(id2);
  });

  it("falls back to a generated id when postId is absent", async () => {
    const fetchSpy = mockOkFetch();

    await zernioPublisher.publishText!(baseOpts({ postId: undefined }));

    const id = requestIdOf(fetchSpy.mock.calls[0]);
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
  });

  it("generates distinct ids per call when no postId is supplied", async () => {
    const fetchSpy = mockOkFetch();

    await zernioPublisher.publishText!(baseOpts({ postId: undefined }));
    await zernioPublisher.publishText!(baseOpts({ postId: undefined }));

    const id1 = requestIdOf(fetchSpy.mock.calls[0]);
    const id2 = requestIdOf(fetchSpy.mock.calls[1]);
    expect(id1).not.toBe(id2);
  });

  it("keeps the rest of the request intact (parity): body + auth + content-type", async () => {
    const fetchSpy = mockOkFetch();
    const postId = "post-uuid-parity";

    await zernioPublisher.publishText!(
      baseOpts({
        postId,
        text: "caption here",
        mediaUrls: ["https://cdn.example.com/v.mp4"],
      }),
    );

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/posts$/);
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer placeholder-test-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["x-request-id"]).toBe(postId);

    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.content).toBe("caption here");
    expect(body.publishNow).toBe(true);
    expect(body.platforms).toEqual([{ platform: "instagram", accountId: ZID }]);
    expect(body.mediaItems).toEqual([
      { type: "video", url: "https://cdn.example.com/v.mp4" },
    ]);
  });
});
