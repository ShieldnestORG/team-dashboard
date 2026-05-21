import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Rizz extractors — Crawlee fallback wiring tests.
//
// Verifies that when Firecrawl /v1/scrape fails for the rizz TikTok services,
// the Crawlee fallback (gated by CRAWLEE_FALLBACK_ENABLED) is consulted and
// its markdown is used when available. Scope is intentionally narrow: only
// the scrape path on the Firecrawl-backed source classes is exercised —
// the orchestrators' DB writes are not covered here.
//
// The actual Playwright crawl is mocked here; end-to-end browser testing
// belongs in a manual smoke script.
// ---------------------------------------------------------------------------

const crawleeScrapeMock = vi.fn<(url: string) => Promise<string | null>>();
const crawleeFallbackEnabledMock = vi.fn<() => boolean>();

vi.mock("../services/crawlee-fallback.js", () => ({
  crawleeScrape: (url: string) => crawleeScrapeMock(url),
  crawleeFallbackEnabled: () => crawleeFallbackEnabledMock(),
}));

import { FirecrawlTiktokProfileSource } from "../services/rizz-tiktok-extractor.ts";
import { FirecrawlTiktokCommentSource } from "../services/rizz-comment-monitor.ts";

// ---------------------------------------------------------------------------
// Test fixtures — minimal markdown payloads with the right URL shape so the
// parsers find at least one video id and the source returns a non-empty
// result. Content beyond that is irrelevant to fallback wiring.
// ---------------------------------------------------------------------------

const PROFILE_MARKDOWN =
  "# @creator\n" +
  "Engineer building tools for solo founders.\n" +
  "[v1](https://www.tiktok.com/@creator/video/7000000000000000001)\n";

const VIDEO_PAGE_MARKDOWN =
  "Comment surface includes @alpha and @bravo as @-mentions.\n";

function firecrawl503(): typeof fetch {
  return vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
}

function firecrawlOk(markdown: string): typeof fetch {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({ success: true, data: { markdown } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  ) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// rizz-tiktok-extractor — FirecrawlTiktokProfileSource
// ---------------------------------------------------------------------------

describe("rizz-tiktok-extractor — Crawlee fallback wiring", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    crawleeScrapeMock.mockReset();
    crawleeFallbackEnabledMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses Crawlee markdown when Firecrawl returns 503 and fallback is enabled", async () => {
    globalThis.fetch = firecrawl503();
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(PROFILE_MARKDOWN);

    const source = new FirecrawlTiktokProfileSource();
    const result = await source.scrapeProfile("creator");

    expect(crawleeScrapeMock).toHaveBeenCalledWith("https://www.tiktok.com/@creator");
    expect(result).not.toBeNull();
    expect(result!.markdown).toBe(PROFILE_MARKDOWN);
    expect(result!.videos.length).toBeGreaterThan(0);
  });

  it("does NOT call Crawlee when the fallback flag is off", async () => {
    globalThis.fetch = firecrawl503();
    crawleeFallbackEnabledMock.mockReturnValue(false);
    crawleeScrapeMock.mockResolvedValue("should-not-be-used");

    const source = new FirecrawlTiktokProfileSource();
    const result = await source.scrapeProfile("creator");

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("does NOT call Crawlee when Firecrawl itself succeeds", async () => {
    globalThis.fetch = firecrawlOk(PROFILE_MARKDOWN);
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue("unused");

    const source = new FirecrawlTiktokProfileSource();
    const result = await source.scrapeProfile("creator");

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(result).not.toBeNull();
    expect(result!.markdown).toBe(PROFILE_MARKDOWN);
  });
});

// ---------------------------------------------------------------------------
// rizz-comment-monitor — FirecrawlTiktokCommentSource
// ---------------------------------------------------------------------------

describe("rizz-comment-monitor — Crawlee fallback wiring", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    crawleeScrapeMock.mockReset();
    crawleeFallbackEnabledMock.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses Crawlee markdown when Firecrawl returns 503 and fallback is enabled (listRecentVideos)", async () => {
    globalThis.fetch = firecrawl503();
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(PROFILE_MARKDOWN);

    const source = new FirecrawlTiktokCommentSource();
    const videos = await source.listRecentVideos("coherencedaddy", 5);

    expect(crawleeScrapeMock).toHaveBeenCalledWith("https://www.tiktok.com/@coherencedaddy");
    expect(videos.length).toBeGreaterThan(0);
  });

  it("uses Crawlee markdown when Firecrawl returns 503 and fallback is enabled (fetchComments)", async () => {
    globalThis.fetch = firecrawl503();
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(VIDEO_PAGE_MARKDOWN);

    const source = new FirecrawlTiktokCommentSource();
    const videoUrl = "https://www.tiktok.com/@creator/video/7000000000000000001";
    const comments = await source.fetchComments(videoUrl);

    expect(crawleeScrapeMock).toHaveBeenCalledWith(videoUrl);
    expect(comments.length).toBe(1);
    expect(comments[0].body).toBe(VIDEO_PAGE_MARKDOWN);
    expect(comments[0].videoId).toBe("7000000000000000001");
  });

  it("does NOT call Crawlee when the fallback flag is off", async () => {
    globalThis.fetch = firecrawl503();
    crawleeFallbackEnabledMock.mockReturnValue(false);
    crawleeScrapeMock.mockResolvedValue("should-not-be-used");

    const source = new FirecrawlTiktokCommentSource();
    const videos = await source.listRecentVideos("coherencedaddy", 5);
    const comments = await source.fetchComments(
      "https://www.tiktok.com/@creator/video/7000000000000000001",
    );

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(videos).toEqual([]);
    expect(comments).toEqual([]);
  });

  it("does NOT call Crawlee when Firecrawl itself succeeds", async () => {
    globalThis.fetch = firecrawlOk(PROFILE_MARKDOWN);
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue("unused");

    const source = new FirecrawlTiktokCommentSource();
    const videos = await source.listRecentVideos("coherencedaddy", 5);

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(videos.length).toBeGreaterThan(0);
  });
});
