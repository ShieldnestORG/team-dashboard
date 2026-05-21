import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Bluesky scrape — SDK primary + Crawlee fallback wiring tests.
//
// Mocks both `@atproto/api` (SDK primary path) and `crawlee` (dynamic-import
// fallback path) so the suite never touches the network or spins up a real
// browser. End-to-end behaviour belongs in a manual smoke script.
// ---------------------------------------------------------------------------

const getAuthorFeedMock = vi.fn<
  (params: { actor: string; limit?: number; filter?: string }) => Promise<{
    data: {
      feed: Array<{
        post: {
          uri: string;
          indexedAt?: string;
          author?: { handle?: string };
          record?: { text?: string; createdAt?: string };
        };
      }>;
    };
  }>
>();

vi.mock("@atproto/api", () => {
  class AtpAgent {
    app = {
      bsky: {
        feed: {
          getAuthorFeed: (params: { actor: string; limit?: number; filter?: string }) =>
            getAuthorFeedMock(params),
        },
      },
    };
    constructor(_opts: { service: string }) {
      /* no-op */
    }
  }
  return { AtpAgent };
});

// Crawlee mock — a minimal PlaywrightCrawler stub. The service calls
// `new PlaywrightCrawler(opts)`, then `crawler.run([url])`, then
// `crawler.teardown()`. We grab the requestHandler from opts and invoke it
// with a stub `page` whose `evaluate` returns whatever the test has queued.
const crawleeEvaluateResultMock = vi.fn<() => Promise<unknown>>();

vi.mock("crawlee", () => {
  class PlaywrightCrawler {
    private requestHandler: (ctx: { page: unknown; request: { url: string } }) => Promise<void>;
    constructor(opts: {
      requestHandler: (ctx: { page: unknown; request: { url: string } }) => Promise<void>;
    }) {
      this.requestHandler = opts.requestHandler;
    }
    async run(urls: string[]): Promise<void> {
      const page = {
        waitForLoadState: async () => undefined,
        waitForSelector: async () => undefined,
        evaluate: (
          _fn: unknown,
          _arg: unknown,
        ): Promise<unknown> => crawleeEvaluateResultMock(),
      };
      for (const url of urls) {
        await this.requestHandler({ page, request: { url } });
      }
    }
    async teardown(): Promise<void> {
      /* no-op */
    }
  }
  return { PlaywrightCrawler };
});

// Import after mocks are registered so the service captures the mocked deps.
import {
  fetchBlueskyPosts,
  blueskyCrawleeFallbackEnabled,
} from "../services/socials/bluesky-scrape.js";

describe("bluesky-scrape — fetchBlueskyPosts", () => {
  const ORIGINAL_FALLBACK_FLAG = process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK;

  beforeEach(() => {
    getAuthorFeedMock.mockReset();
    crawleeEvaluateResultMock.mockReset();
    delete process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK;
  });

  afterEach(() => {
    if (ORIGINAL_FALLBACK_FLAG === undefined) {
      delete process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK;
    } else {
      process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK = ORIGINAL_FALLBACK_FLAG;
    }
    vi.restoreAllMocks();
  });

  it("returns posts from the SDK happy path", async () => {
    getAuthorFeedMock.mockResolvedValue({
      data: {
        feed: [
          {
            post: {
              uri: "at://did:plc:abc/app.bsky.feed.post/aaa",
              indexedAt: "2026-05-20T10:00:00Z",
              author: { handle: "coherencedaddy.bsky.social" },
              record: { text: "hello world", createdAt: "2026-05-20T09:59:00Z" },
            },
          },
          {
            post: {
              uri: "at://did:plc:abc/app.bsky.feed.post/bbb",
              indexedAt: "2026-05-21T10:00:00Z",
              author: { handle: "coherencedaddy.bsky.social" },
              record: { text: "second post", createdAt: "2026-05-21T09:59:00Z" },
            },
          },
        ],
      },
    });

    const posts = await fetchBlueskyPosts("coherencedaddy.bsky.social", { maxPosts: 5 });

    expect(getAuthorFeedMock).toHaveBeenCalledWith({
      actor: "coherencedaddy.bsky.social",
      limit: 5,
      filter: "posts_and_author_threads",
    });
    expect(posts).toHaveLength(2);
    expect(posts[0]).toEqual({
      uri: "at://did:plc:abc/app.bsky.feed.post/aaa",
      text: "hello world",
      createdAt: "2026-05-20T09:59:00Z",
      authorHandle: "coherencedaddy.bsky.social",
    });
    expect(crawleeEvaluateResultMock).not.toHaveBeenCalled();
  });

  it("returns [] when the SDK throws AND the Crawlee fallback flag is off", async () => {
    getAuthorFeedMock.mockRejectedValue(new Error("rate limited"));
    // Flag explicitly OFF
    expect(blueskyCrawleeFallbackEnabled()).toBe(false);

    const posts = await fetchBlueskyPosts("coherencedaddy.bsky.social");

    expect(getAuthorFeedMock).toHaveBeenCalledOnce();
    expect(crawleeEvaluateResultMock).not.toHaveBeenCalled();
    expect(posts).toEqual([]);
  });

  it("falls through to Crawlee when SDK throws AND the flag is on", async () => {
    getAuthorFeedMock.mockRejectedValue(new Error("upstream 502"));
    process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK = "true";
    expect(blueskyCrawleeFallbackEnabled()).toBe(true);

    crawleeEvaluateResultMock.mockResolvedValue([
      {
        uri: "at://coherencedaddy.bsky.social/app.bsky.feed.post/xxx",
        text: "from crawlee",
        createdAt: "2026-05-21T12:00:00Z",
        authorHandle: "coherencedaddy.bsky.social",
      },
    ]);

    const posts = await fetchBlueskyPosts("coherencedaddy.bsky.social", { maxPosts: 10 });

    expect(getAuthorFeedMock).toHaveBeenCalledOnce();
    expect(crawleeEvaluateResultMock).toHaveBeenCalledOnce();
    expect(posts).toHaveLength(1);
    expect(posts[0].uri).toBe("at://coherencedaddy.bsky.social/app.bsky.feed.post/xxx");
    expect(posts[0].text).toBe("from crawlee");
  });

  it("returns [] when SDK throws, flag is on, but Crawlee also returns no posts", async () => {
    getAuthorFeedMock.mockRejectedValue(new Error("upstream 502"));
    process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK = "true";
    crawleeEvaluateResultMock.mockResolvedValue([]);

    const posts = await fetchBlueskyPosts("coherencedaddy.bsky.social");

    expect(getAuthorFeedMock).toHaveBeenCalledOnce();
    expect(crawleeEvaluateResultMock).toHaveBeenCalledOnce();
    expect(posts).toEqual([]);
  });
});
