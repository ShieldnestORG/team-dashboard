// ---------------------------------------------------------------------------
// Zernio publisher media-URL guard tests (defense-in-depth).
//
// Zernio fetches media URLs SERVER-SIDE. Beyond rejecting non-http(s) shapes
// (relative paths, file://), the guard also rejects http(s) URLs whose host is
// obviously internal/non-public (localhost, loopback, RFC1918, link-local,
// *.internal / *.local) so they fail fast HERE with a clear local error instead
// of confusingly at Zernio (or as an SSRF-adjacent footgun). Legitimate public
// hosts — R2 `.r2.dev`, the public reels-stream URL, ordinary public CDNs —
// must still pass.
//
// We assert PASS by observing that fetch IS called (the request was built), and
// REJECT by observing fetch is NOT called and the result carries the guard's
// error string. No DB, no real network — fetch is mocked.
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { zernioPublisher } from "../services/platform-publishers/zernio.js";
import type { PublishTextOptions } from "../services/platform-publishers/types.js";

const ZID = "acct_guard";
const KEY_ENV = `ZERNIO_KEY_${ZID}`;
const originalKey = process.env[KEY_ENV];

function baseOpts(overrides: Partial<PublishTextOptions> = {}): PublishTextOptions {
  return {
    text: "hello world",
    socialAccountId: "sa-1",
    oauthRef: `zernio:${ZID}`,
    postId: "post-guard",
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

describe("zernioPublisher media-URL guard", () => {
  beforeEach(() => {
    process.env[KEY_ENV] = "placeholder-test-key";
    vi.restoreAllMocks();
  });
  afterEach(() => {
    if (originalKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = originalKey;
    vi.restoreAllMocks();
  });

  const passCases: Array<[string, string]> = [
    ["public R2 .r2.dev URL", "https://pub-abc123.r2.dev/clip.mp4"],
    [
      "public reels-stream URL",
      "https://api.coherencedaddy.com/api/reels/abc/stream",
    ],
    ["ordinary public https image", "https://cdn.example.com/photo.jpg"],
  ];

  for (const [label, url] of passCases) {
    it(`passes: ${label}`, async () => {
      const fetchSpy = mockOkFetch();
      const res = await zernioPublisher.publishText!(
        baseOpts({ mediaUrls: [url] }),
      );
      expect(res.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      // The URL survived the guard into the request body unchanged.
      const init = fetchSpy.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string) as Record<string, unknown>;
      expect(body.mediaItems).toEqual([
        { type: expect.any(String), url },
      ]);
    });
  }

  const rejectCases: Array<[string, string]> = [
    ["localhost", "https://localhost:8000/x.jpg"],
    ["loopback 127.0.0.1", "https://127.0.0.1/x.jpg"],
    ["RFC1918 192.168.1.10", "https://192.168.1.10/x.jpg"],
    ["RFC1918 10.1.2.3", "http://10.1.2.3/x.jpg"],
    ["*.internal", "https://foo.internal/x.jpg"],
    ["*.local", "https://bar.local/x.jpg"],
    ["relative path", "/local/path/x.jpg"],
  ];

  for (const [label, url] of rejectCases) {
    it(`rejects: ${label}`, async () => {
      const fetchSpy = mockOkFetch();
      const res = await zernioPublisher.publishText!(
        baseOpts({ mediaUrls: [url] }),
      );
      expect(res.success).toBe(false);
      expect(res.error).toContain("not a public http(s) URL Zernio can fetch");
      expect(res.error).toContain(url);
      // Failed fast locally — never hit the network.
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  }
});
