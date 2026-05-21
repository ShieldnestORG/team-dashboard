import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// sitemap-crawl tests — verifies the env-gated deep-crawl service.
//
// Crawlee + Playwright are mocked so no actual browser launches. The mock
// PlaywrightCrawler invokes the user's `requestHandler` with stub `page`,
// `request`, and `enqueueLinks` arguments, mimicking how Crawlee feeds
// pages to the handler during `crawler.run([startUrl])`.
// ---------------------------------------------------------------------------

// `pages` is the queue of URLs the mock crawler will serve to the handler.
// Each test populates it before calling `crawlSitemap`.
const mockState: {
  pages: string[];
  enqueuedFromHandler: string[];
  maxRequestsPerCrawl: number;
} = {
  pages: [],
  enqueuedFromHandler: [],
  maxRequestsPerCrawl: 20,
};

vi.mock("crawlee", () => {
  class MockPlaywrightCrawler {
    private requestHandler: (ctx: {
      page: { waitForLoadState: () => Promise<void>; content: () => Promise<string>; title: () => Promise<string> };
      request: { url: string; loadedUrl: string; userData: { depth?: number } };
      enqueueLinks: (opts?: { userData?: { depth?: number } }) => Promise<void>;
    }) => Promise<void>;

    constructor(opts: {
      maxRequestsPerCrawl?: number;
      requestHandler: (ctx: never) => Promise<void>;
    }) {
      mockState.maxRequestsPerCrawl = opts.maxRequestsPerCrawl ?? 20;
      // Cast through unknown since the real Crawlee context is much wider
      // than what we stub; the test handler only touches the subset above.
      this.requestHandler = opts.requestHandler as unknown as typeof this.requestHandler;
    }

    async run(startEntries: Array<{ url: string; userData: { depth: number } }>): Promise<void> {
      // Seed the queue from the start entries, then process each page in
      // FIFO order up to the maxRequestsPerCrawl cap.
      const queue: Array<{ url: string; depth: number }> = startEntries.map((e) => ({
        url: e.url,
        depth: e.userData.depth,
      }));
      // Append any extra URLs the test pre-seeded via `mockState.pages`
      // beyond the start URL, simulating links the crawler would discover.
      for (let i = 1; i < mockState.pages.length; i++) {
        queue.push({ url: mockState.pages[i]!, depth: 1 });
      }

      let processed = 0;
      while (queue.length > 0 && processed < mockState.maxRequestsPerCrawl) {
        const next = queue.shift()!;
        processed++;
        await this.requestHandler({
          page: {
            waitForLoadState: async () => undefined,
            content: async () => `<html><body><h1>Page at ${next.url}</h1></body></html>`,
            title: async () => `Title for ${next.url}`,
          },
          request: {
            url: next.url,
            loadedUrl: next.url,
            userData: { depth: next.depth },
          },
          enqueueLinks: async (opts?: { userData?: { depth?: number } }) => {
            mockState.enqueuedFromHandler.push(next.url);
            void opts; // suppress unused-var lint
          },
        });
      }
    }

    async teardown(): Promise<void> {
      // no-op for tests
    }
  }

  return {
    PlaywrightCrawler: MockPlaywrightCrawler,
    RobotsTxtFile: {
      // Default stub — always allow, no sitemap fetch.
      find: async () => ({
        isAllowed: () => true,
        getSitemaps: () => [],
      }),
    },
  };
});

vi.mock("turndown", () => {
  class MockTurndown {
    turndown(html: string): string {
      // Strip tags to get a minimal markdown-ish output.
      return html.replace(/<[^>]+>/g, " ").trim();
    }
  }
  return { default: MockTurndown };
});

// Import AFTER mocks so the lazy-loader inside sitemap-crawl picks them up.
import { crawlSitemap } from "../services/sitemap-crawl.ts";

describe("crawlSitemap", () => {
  beforeEach(() => {
    mockState.pages = [];
    mockState.enqueuedFromHandler = [];
    mockState.maxRequestsPerCrawl = 20;
  });

  afterEach(() => {
    delete process.env.SITEMAP_CRAWL_ENABLED;
  });

  it("returns an empty result when SITEMAP_CRAWL_ENABLED is unset", async () => {
    // Even with pages in the mock queue, the env-gate must short-circuit
    // before any crawler/module load happens.
    mockState.pages = ["https://acme.test", "https://acme.test/pricing"];

    const result = await crawlSitemap("https://acme.test");

    expect(result.startUrl).toBe("https://acme.test");
    expect(result.pages).toEqual([]);
    expect(result.failedUrls).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("returns N pages when the mocked crawler yields N URLs (happy path)", async () => {
    process.env.SITEMAP_CRAWL_ENABLED = "true";
    mockState.pages = [
      "https://acme.test",
      "https://acme.test/pricing",
      "https://acme.test/about",
    ];

    const result = await crawlSitemap("https://acme.test");

    expect(result.pages.length).toBe(3);
    expect(result.pages[0]?.url).toBe("https://acme.test");
    expect(result.pages[0]?.depth).toBe(0);
    expect(result.pages[1]?.depth).toBe(1);
    expect(result.pages[0]?.title).toBe("Title for https://acme.test");
    // Markdown was produced by the mocked Turndown (tag-stripped content).
    expect(result.pages[0]?.markdown).toContain("Page at https://acme.test");
    expect(result.failedUrls).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  it("caps result at maxPages and reports truncated=true when frontier exceeds the cap", async () => {
    process.env.SITEMAP_CRAWL_ENABLED = "true";
    // Mock crawler would yield 50 pages, but maxPages=5 must cut it short.
    mockState.pages = Array.from({ length: 50 }, (_, i) => `https://acme.test/page-${i}`);

    const result = await crawlSitemap("https://acme.test/page-0", { maxPages: 5 });

    expect(result.pages.length).toBe(5);
    expect(result.truncated).toBe(true);
  });
});
