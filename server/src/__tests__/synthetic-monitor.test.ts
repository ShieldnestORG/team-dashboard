import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Synthetic monitor — env gating + Crawlee wiring tests.
//
// The crawlee module is mocked: we control what events the simulated page
// emits (console.error, pageerror) and what status response.status() returns,
// then verify the service's result shape and ok-flag logic. Real Playwright
// execution belongs in a manual smoke script.
// ---------------------------------------------------------------------------

interface MockConsoleEvent {
  type: "log" | "error" | "warn" | "info" | "debug";
  text: string;
}

interface CrawlScenario {
  status?: number | null;
  consoleEvents?: MockConsoleEvent[];
  pageErrors?: string[];
  brokenImageCount?: number;
  throwOnRun?: boolean;
  skipHandler?: boolean;
}

const scenariosByUrl = new Map<string, CrawlScenario>();
const teardownCalls: number[] = [];

// Default scenario used when a URL isn't explicitly registered.
const DEFAULT_SCENARIO: CrawlScenario = {
  status: 200,
  consoleEvents: [],
  pageErrors: [],
  brokenImageCount: 0,
};

class MockPlaywrightCrawler {
  private requestHandler: (ctx: {
    page: {
      on: (event: string, cb: (arg: unknown) => void) => void;
      waitForLoadState: (state: string, opts?: { timeout?: number }) => Promise<void>;
      evaluate: <T>(fn: () => T) => Promise<T>;
    };
    response: { status: () => number } | null;
  }) => Promise<void>;
  private failedRequestHandler: (ctx: {
    error: Error;
    request: { url: string };
  }) => void;

  constructor(opts: {
    requestHandler: MockPlaywrightCrawler["requestHandler"];
    failedRequestHandler: MockPlaywrightCrawler["failedRequestHandler"];
  }) {
    this.requestHandler = opts.requestHandler;
    this.failedRequestHandler = opts.failedRequestHandler;
  }

  async run(urls: string[]): Promise<void> {
    for (const url of urls) {
      const scenario = scenariosByUrl.get(url) ?? DEFAULT_SCENARIO;

      if (scenario.throwOnRun) {
        throw new Error(`mock crawler.run threw for ${url}`);
      }
      if (scenario.skipHandler) {
        this.failedRequestHandler({
          error: new Error("simulated network failure"),
          request: { url },
        });
        continue;
      }

      const consoleHandlers: Array<(arg: unknown) => void> = [];
      const pageErrorHandlers: Array<(arg: unknown) => void> = [];

      const page = {
        on: (event: string, cb: (arg: unknown) => void) => {
          if (event === "console") consoleHandlers.push(cb);
          else if (event === "pageerror") pageErrorHandlers.push(cb);
        },
        waitForLoadState: async (_state: string, _opts?: { timeout?: number }) => {
          // Fire the configured console/pageerror events during load.
          for (const evt of scenario.consoleEvents ?? []) {
            for (const cb of consoleHandlers) {
              cb({ type: () => evt.type, text: () => evt.text });
            }
          }
          for (const msg of scenario.pageErrors ?? []) {
            for (const cb of pageErrorHandlers) {
              cb(new Error(msg));
            }
          }
        },
        evaluate: async <T>(_fn: () => T): Promise<T> => {
          return (scenario.brokenImageCount ?? 0) as unknown as T;
        },
      };

      const response =
        scenario.status === null || scenario.status === undefined
          ? null
          : { status: () => scenario.status as number };

      await this.requestHandler({ page, response });
    }
  }

  async teardown(): Promise<void> {
    teardownCalls.push(Date.now());
  }
}

vi.mock("crawlee", () => ({
  PlaywrightCrawler: MockPlaywrightCrawler,
}));

// Silence logger warnings during tests.
vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: () => {},
    info: () => {},
    error: () => {},
  },
}));

import { runSyntheticBatch, runSyntheticCheck } from "../services/synthetic-monitor.ts";

describe("synthetic-monitor", () => {
  const originalEnabled = process.env.SYNTHETIC_MONITOR_ENABLED;

  beforeEach(() => {
    scenariosByUrl.clear();
    teardownCalls.length = 0;
  });

  afterEach(() => {
    if (originalEnabled === undefined) {
      delete process.env.SYNTHETIC_MONITOR_ENABLED;
    } else {
      process.env.SYNTHETIC_MONITOR_ENABLED = originalEnabled;
    }
  });

  it("returns a disabled result when SYNTHETIC_MONITOR_ENABLED is unset", async () => {
    delete process.env.SYNTHETIC_MONITOR_ENABLED;

    const result = await runSyntheticCheck("https://example.test");

    expect(result.ok).toBe(false);
    expect(result.url).toBe("https://example.test");
    expect(result.httpStatus).toBeNull();
    expect(result.consoleErrors).toEqual(["disabled"]);
    expect(result.pageErrors).toEqual([]);
    expect(result.consoleErrorCount).toBe(0);
    expect(result.pageErrorCount).toBe(0);
    expect(result.brokenImageCount).toBe(0);
    expect(teardownCalls.length).toBe(0); // mock crawler never instantiated
    expect(typeof result.checkedAt).toBe("string");
  });

  it("happy single-URL path returns ok=true with mocked Crawlee", async () => {
    process.env.SYNTHETIC_MONITOR_ENABLED = "true";
    scenariosByUrl.set("https://healthy.test", {
      status: 200,
      consoleEvents: [
        // info-level message should be ignored
        { type: "info", text: "Booting analytics" },
      ],
      pageErrors: [],
      brokenImageCount: 0,
    });

    const result = await runSyntheticCheck("https://healthy.test");

    expect(result.ok).toBe(true);
    expect(result.url).toBe("https://healthy.test");
    expect(result.httpStatus).toBe(200);
    expect(result.consoleErrorCount).toBe(0);
    expect(result.pageErrorCount).toBe(0);
    expect(result.brokenImageCount).toBe(0);
    expect(result.consoleErrors).toEqual([]);
    expect(result.pageErrors).toEqual([]);
    expect(teardownCalls.length).toBe(1);
  });

  it("batch with mixed results preserves order and flags only the bad URL", async () => {
    process.env.SYNTHETIC_MONITOR_ENABLED = "true";

    scenariosByUrl.set("https://good.test", {
      status: 200,
      consoleEvents: [],
      pageErrors: [],
      brokenImageCount: 0,
    });

    scenariosByUrl.set("https://noisy.test", {
      status: 200,
      consoleEvents: [
        { type: "error", text: "TypeError: cannot read property foo of undefined" },
        { type: "error", text: "Uncaught ReferenceError: bar is not defined" },
        { type: "warn", text: "This warning must be ignored" }, // not counted
      ],
      pageErrors: [],
      brokenImageCount: 0,
    });

    const results = await runSyntheticBatch(
      ["https://good.test", "https://noisy.test"],
      { concurrency: 2 },
    );

    expect(results.length).toBe(2);

    // Ordering preserved
    expect(results[0]?.url).toBe("https://good.test");
    expect(results[1]?.url).toBe("https://noisy.test");

    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.consoleErrorCount).toBe(0);

    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.consoleErrorCount).toBe(2);
    expect(results[1]?.consoleErrors).toEqual([
      "TypeError: cannot read property foo of undefined",
      "Uncaught ReferenceError: bar is not defined",
    ]);
    expect(results[1]?.httpStatus).toBe(200);
    expect(teardownCalls.length).toBe(2);
  });

  it("flags non-2xx HTTP status as not ok", async () => {
    process.env.SYNTHETIC_MONITOR_ENABLED = "true";
    scenariosByUrl.set("https://server-error.test", {
      status: 503,
      consoleEvents: [],
      pageErrors: [],
      brokenImageCount: 0,
    });

    const result = await runSyntheticCheck("https://server-error.test");

    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(503);
  });

  it("flags broken images as not ok", async () => {
    process.env.SYNTHETIC_MONITOR_ENABLED = "true";
    scenariosByUrl.set("https://broken-imgs.test", {
      status: 200,
      consoleEvents: [],
      pageErrors: [],
      brokenImageCount: 3,
    });

    const result = await runSyntheticCheck("https://broken-imgs.test");

    expect(result.ok).toBe(false);
    expect(result.brokenImageCount).toBe(3);
  });

  it("clamps batch concurrency to MAX_CONCURRENCY (5) without dropping URLs", async () => {
    process.env.SYNTHETIC_MONITOR_ENABLED = "true";

    const urls = ["https://a.test", "https://b.test", "https://c.test"];
    for (const url of urls) {
      scenariosByUrl.set(url, { status: 200, consoleEvents: [], pageErrors: [], brokenImageCount: 0 });
    }

    const results = await runSyntheticBatch(urls, { concurrency: 99 });

    expect(results.length).toBe(3);
    expect(results.map((r) => r.url)).toEqual(urls);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
