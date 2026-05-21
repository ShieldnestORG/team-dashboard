import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// audit-deep — deep audit tier (Playwright-rendered) tests.
//
// The real crawler is mocked here; end-to-end Playwright runs belong in a
// manual smoke. These tests cover:
//   1. happy path → result populated from mocked crawler captures
//   2. env-flag off → service returns failureReason and never imports crawlee
//   3. crawler.run throws → service returns structured failure (no exception)
// ---------------------------------------------------------------------------

// Each test customizes runtime behavior by setting fields on this fixture
// before importing the service.
interface CrawlerFixture {
  // What requestHandler should be passed when crawler.run is called. We
  // simulate the page by invoking it with a fake `page` whose listeners we
  // can drive synchronously.
  pages: Array<{
    url: string;
    consoleErrors: string[];
    pageErrors: string[];
    probe: { brokenImageCount: number; internalLinks: string[]; loadTimeMs: number };
    screenshot?: Buffer | null;
  }>;
  // If set, crawler.run rejects with this error.
  runThrows?: Error;
}

const fixture: CrawlerFixture = { pages: [] };

vi.mock("crawlee", () => {
  class FakePlaywrightCrawler {
    private requestHandler: (ctx: {
      page: FakePage;
      request: { url: string };
      enqueueLinks: () => Promise<void>;
    }) => Promise<void>;
    private failedRequestHandler?: (ctx: {
      error: Error;
      request: { url: string };
    }) => void;
    private queued: string[] = [];

    constructor(opts: {
      requestHandler: (ctx: {
        page: FakePage;
        request: { url: string };
        enqueueLinks: () => Promise<void>;
      }) => Promise<void>;
      failedRequestHandler?: (ctx: { error: Error; request: { url: string } }) => void;
    }) {
      this.requestHandler = opts.requestHandler;
      this.failedRequestHandler = opts.failedRequestHandler;
    }

    async addRequests(urls: string[]): Promise<void> {
      this.queued.push(...urls);
    }

    async run(initial: string[]): Promise<void> {
      if (fixture.runThrows) throw fixture.runThrows;
      const toProcess = [...initial];
      while (toProcess.length > 0) {
        const url = toProcess.shift()!;
        const pageFixture = fixture.pages.find((p) => p.url === url);
        if (!pageFixture) {
          if (this.failedRequestHandler) {
            this.failedRequestHandler({
              error: new Error(`no fixture for ${url}`),
              request: { url },
            });
          }
          continue;
        }
        const page = new FakePage(pageFixture);
        await this.requestHandler({
          page,
          request: { url },
          enqueueLinks: async () => {},
        });
        // pick up addRequests calls made during this handler
        if (this.queued.length > 0) {
          toProcess.push(...this.queued);
          this.queued = [];
        }
      }
    }

    async teardown(): Promise<void> {
      // no-op
    }
  }

  return { PlaywrightCrawler: FakePlaywrightCrawler };
});

// FakePage simulates the surface of playwright.Page that audit-deep uses:
// on/off for console + pageerror events, waitForLoadState, evaluate, screenshot.
class FakePage {
  private fixture: CrawlerFixture["pages"][number];
  private consoleListeners: Array<(msg: { type: () => string; text: () => string }) => void> = [];
  private pageErrorListeners: Array<(err: Error) => void> = [];

  constructor(fix: CrawlerFixture["pages"][number]) {
    this.fixture = fix;
  }

  on(event: "console" | "pageerror", listener: (...args: never[]) => void): void {
    if (event === "console") {
      this.consoleListeners.push(
        listener as (msg: { type: () => string; text: () => string }) => void,
      );
    } else if (event === "pageerror") {
      this.pageErrorListeners.push(listener as (err: Error) => void);
    }
  }

  off(_event: "console" | "pageerror", _listener: unknown): void {
    // no-op for tests
  }

  async waitForLoadState(_state: string, _opts?: unknown): Promise<void> {
    // Fire any synthetic console + page errors at this point so that
    // listeners attached in requestHandler see them.
    for (const err of this.fixture.consoleErrors) {
      for (const l of this.consoleListeners) {
        l({ type: () => "error", text: () => err });
      }
    }
    for (const err of this.fixture.pageErrors) {
      for (const l of this.pageErrorListeners) {
        l(new Error(err));
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async evaluate<T>(_fn: (...args: any[]) => T): Promise<T> {
    return this.fixture.probe as unknown as T;
  }

  async screenshot(_opts?: unknown): Promise<Buffer> {
    return this.fixture.screenshot ?? Buffer.from("fake-png-bytes");
  }
}

describe("audit-deep service", () => {
  beforeEach(() => {
    // Reset module cache so loadModules picks up our mock + so cached
    // success/failure state from previous tests doesn't leak.
    vi.resetModules();
    fixture.pages = [];
    fixture.runThrows = undefined;
    delete process.env.AUDIT_DEEP_ENABLED;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("happy path: populates result from crawler captures + follows internal links", async () => {
    process.env.AUDIT_DEEP_ENABLED = "true";
    fixture.pages = [
      {
        url: "https://example.test/",
        consoleErrors: ["TypeError: foo is not a function"],
        pageErrors: ["Uncaught ReferenceError: bar"],
        probe: {
          brokenImageCount: 2,
          internalLinks: [
            "https://example.test/about",
            "https://example.test/pricing",
          ],
          loadTimeMs: 1234,
        },
      },
      {
        url: "https://example.test/about",
        consoleErrors: [],
        pageErrors: [],
        probe: { brokenImageCount: 0, internalLinks: [], loadTimeMs: 500 },
      },
      {
        url: "https://example.test/pricing",
        consoleErrors: ["404 GET /missing.png"],
        pageErrors: [],
        probe: { brokenImageCount: 1, internalLinks: [], loadTimeMs: 700 },
      },
    ];

    const { runDeepAudit } = await import("../services/audit-deep.ts");
    const result = await runDeepAudit("https://example.test/", { maxLinks: 2 });

    expect(result.failureReason).toBeUndefined();
    expect(result.url).toBe("https://example.test/");
    expect(result.consoleErrors).toEqual(["TypeError: foo is not a function"]);
    expect(result.pageErrors).toEqual(["Uncaught ReferenceError: bar"]);
    expect(result.brokenImageCount).toBe(2);
    expect(result.loadTimeMs).toBe(1234);
    expect(result.internalLinks).toEqual([
      "https://example.test/about",
      "https://example.test/pricing",
    ]);
    expect(result.screenshotBase64).not.toBeNull();
    expect(result.subPages).toHaveLength(2);
    expect(result.subPages[0]?.url).toBe("https://example.test/about");
    expect(result.subPages[1]?.url).toBe("https://example.test/pricing");
    expect(result.subPages[1]?.consoleErrors).toEqual(["404 GET /missing.png"]);
    expect(result.subPages[1]?.brokenImageCount).toBe(1);
  });

  it("env-flag off: returns failureReason and never invokes the crawler", async () => {
    // AUDIT_DEEP_ENABLED is unset (deleted in beforeEach).
    fixture.pages = [
      {
        url: "https://example.test/",
        consoleErrors: [],
        pageErrors: [],
        probe: { brokenImageCount: 0, internalLinks: [], loadTimeMs: 0 },
      },
    ];

    const { runDeepAudit, auditDeepEnabled } = await import("../services/audit-deep.ts");
    expect(auditDeepEnabled()).toBe(false);

    const result = await runDeepAudit("https://example.test/");

    expect(result.failureReason).toBe("deep audit disabled");
    expect(result.consoleErrors).toEqual([]);
    expect(result.pageErrors).toEqual([]);
    expect(result.subPages).toEqual([]);
  });

  it("failure path: crawler.run throws → structured failure, no exception", async () => {
    process.env.AUDIT_DEEP_ENABLED = "true";
    fixture.runThrows = new Error("playwright browser binary missing");

    const { runDeepAudit } = await import("../services/audit-deep.ts");
    const result = await runDeepAudit("https://example.test/", { maxLinks: 0 });

    expect(result.failureReason).toBeDefined();
    expect(result.failureReason).toContain("playwright browser binary missing");
    expect(result.url).toBe("https://example.test/");
    expect(result.consoleErrors).toEqual([]);
    expect(result.subPages).toEqual([]);
  });
});
