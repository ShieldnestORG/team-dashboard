import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// launch-monitor-crawlee-sources — service-level tests.
//
// `crawlee`'s PlaywrightCrawler is mocked directly here (no real browser).
// The mock invokes the registered `requestHandler` with a fake page whose
// `page.evaluate(fn)` returns a controlled list of comment rows. This lets
// each test pin the exact number of rows the service receives, so we can
// verify the env gate, happy path, and maxComments cap deterministically.
// ---------------------------------------------------------------------------

interface FakeCommentRow {
  author: string;
  bodyText: string;
  postedAt: string | null;
}

let fakeRows: FakeCommentRow[] = [];
let lastCrawlerInstance: { teardown: () => Promise<void> } | null = null;

class FakePlaywrightCrawler {
  // The Crawlee constructor accepts an options object — we only need the
  // requestHandler to drive the test.
  private readonly requestHandler: (ctx: {
    page: { waitForLoadState: () => Promise<void>; evaluate: (fn: () => unknown) => Promise<unknown> };
    request: { url: string; loadedUrl: string };
  }) => Promise<void>;

  constructor(opts: { requestHandler: FakePlaywrightCrawler["requestHandler"] }) {
    this.requestHandler = opts.requestHandler;
    lastCrawlerInstance = this;
  }

  async run(urls: string[]): Promise<void> {
    const url = urls[0]!;
    await this.requestHandler({
      page: {
        waitForLoadState: async () => undefined,
        // The real service passes a closure to page.evaluate that runs in the
        // browser. In the mock we ignore the closure and return our fixture.
        evaluate: async () => fakeRows,
      },
      request: { url, loadedUrl: url },
    });
  }

  async teardown(): Promise<void> {
    // no-op
  }
}

vi.mock("crawlee", () => ({
  PlaywrightCrawler: FakePlaywrightCrawler,
}));

// Import after vi.mock so the service picks up the fake.
import {
  fetchProductHuntComments,
  launchMonitorCrawleeEnabled,
} from "../services/launch-monitor-crawlee-sources.ts";

describe("launch-monitor-crawlee-sources", () => {
  const ORIGINAL_ENV = process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED;

  beforeEach(() => {
    fakeRows = [];
    lastCrawlerInstance = null;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED;
    } else {
      process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED = ORIGINAL_ENV;
    }
    vi.restoreAllMocks();
  });

  it("returns [] and never invokes Crawlee when env flag is off", async () => {
    delete process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED;
    expect(launchMonitorCrawleeEnabled()).toBe(false);

    fakeRows = [
      { author: "alice", bodyText: "great launch!", postedAt: "2026-05-21T00:00:00Z" },
    ];

    const out = await fetchProductHuntComments("team-dashboard");

    expect(out).toEqual([]);
    expect(lastCrawlerInstance).toBeNull();
  });

  it("returns all 5 mocked comments on the happy path", async () => {
    process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED = "true";

    fakeRows = Array.from({ length: 5 }, (_, i) => ({
      author: `user${i}`,
      bodyText: `comment body ${i}`,
      postedAt: `2026-05-21T0${i}:00:00Z`,
    }));

    const out = await fetchProductHuntComments("team-dashboard");

    expect(out.length).toBe(5);
    expect(out[0]).toEqual({
      author: "user0",
      bodyText: "comment body 0",
      postedAt: "2026-05-21T00:00:00Z",
      postUrl: "https://www.producthunt.com/posts/team-dashboard",
    });
    expect(out[4].author).toBe("user4");
    expect(lastCrawlerInstance).not.toBeNull();
  });

  it("caps the result length at maxComments even when more rows are scraped", async () => {
    process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED = "true";

    fakeRows = Array.from({ length: 50 }, (_, i) => ({
      author: `user${i}`,
      bodyText: `comment body ${i}`,
      postedAt: null,
    }));

    const out = await fetchProductHuntComments("team-dashboard", { maxComments: 7 });

    expect(out.length).toBe(7);
    expect(out[0].author).toBe("user0");
    expect(out[6].author).toBe("user6");
  });
});
