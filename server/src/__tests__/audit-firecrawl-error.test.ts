import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const crawleeScrapeMock = vi.fn<(url: string) => Promise<string | null>>();
const crawleeFallbackEnabledMock = vi.fn<() => boolean>();

vi.mock("../services/crawlee-fallback.js", () => ({
  crawleeScrape: (url: string) => crawleeScrapeMock(url),
  crawleeFallbackEnabled: () => crawleeFallbackEnabledMock(),
}));

import { runAudit, type SSEEvent } from "../routes/audit.ts";

// ---------------------------------------------------------------------------
// runAudit — when Firecrawl is unreachable, emit `error` and never `complete`.
// Regression test for the P0 where every audit silently saved score:30 with
// hardcoded alt1/alt2/alt3 competitors when the crawler was down.
// ---------------------------------------------------------------------------

describe("runAudit when Firecrawl is unreachable", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    crawleeScrapeMock.mockReset();
    crawleeFallbackEnabledMock.mockReset();
    // Default: fallback flag off so existing failure-mode tests don't change.
    crawleeFallbackEnabledMock.mockReturnValue(false);
    // Skip the 2s real-time backoff on retry attempts — every test
    // that doesn't explicitly want to assert backoff timing gets to run fast.
    vi.stubEnv("SCRAPE_RETRY_BACKOFF_MS", "0");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits an error event with step='map' and the crawler-down message when /v1/map fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        throw new Error("ECONNREFUSED 168.231.127.180:3002");
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    const errorEvents = events.filter((e) => e.type === "error");
    const completeEvents = events.filter((e) => e.type === "complete");

    expect(completeEvents).toHaveLength(0);
    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]).toMatchObject({
      type: "error",
      step: "map",
      // User-facing copy unchanged for the real Firecrawl-outage case.
      message: expect.stringContaining("Crawler temporarily unavailable"),
    });
  });

  it("emits an error event with step='scrape' and the site-specific message when /v1/map succeeds but every /v1/scrape fails", async () => {
    // 2026-05-23 roguedefender.com regression: map worked but the site
    // itself is unreachable. Previously emitted "Crawler temporarily
    // unavailable" which misled users into retrying instead of
    // checking their own site.
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    expect(events.some((e) => e.type === "complete")).toBe(false);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent?.type === "error") {
      expect(errorEvent.step).toBe("scrape");
      expect(errorEvent.message).toMatch(/Couldn't fetch your site/);
      expect(errorEvent.message).not.toMatch(/Crawler temporarily unavailable/);
      // scrapeFailures carries the per-URL diagnostic so
      // creditscore_audit_runs (migration 0119) can persist it.
      expect(errorEvent.scrapeFailures).toBeDefined();
      expect(errorEvent.scrapeFailures!.length).toBeGreaterThan(0);
      expect(errorEvent.scrapeFailures![0]).toMatchObject({
        url: expect.stringContaining("example.com"),
        error: expect.stringContaining("HTTP 503"),
      });
    }
  });

  it("does NOT emit hardcoded alt1/alt2/alt3 competitors when /v1/search fails", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: [] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response(
          JSON.stringify({
            success: true,
            data: { markdown: "# Hello\n\nWorld content here.", links: [], metadata: {} },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/search")) {
        throw new Error("search service down");
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    const completeEvent = events.find((e) => e.type === "complete");
    expect(completeEvent).toBeDefined();
    if (completeEvent && completeEvent.type === "complete") {
      const fakeDomains = completeEvent.result.competitors.map((c) => c.domain);
      expect(fakeDomains).not.toContainEqual(expect.stringMatching(/^alt[123]\./));
      expect(completeEvent.result.competitors).toEqual([]);
    }
  });

  // -------------------------------------------------------------------------
  // Crawlee fallback wiring — when Firecrawl /v1/scrape fails, Crawlee should
  // be consulted so the audit still completes (mirroring the Phase 1 pattern
  // already in firecrawl-sync). Today's outage exposed that audit.ts had no
  // such fallback; these tests pin the new behaviour.
  // -------------------------------------------------------------------------

  it("uses Crawlee fallback when /v1/scrape 503s and CRAWLEE_FALLBACK_ENABLED=true", async () => {
    vi.stubEnv("CRAWLEE_FALLBACK_ENABLED", "true");
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(
      "# Acme\n\n## About\n\nFallback markdown via Crawlee with enough words to clear thresholds. " +
        "Word ".repeat(600),
    );

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nAllow: /\n", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      if (url.includes("/v1/search")) {
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    expect(crawleeScrapeMock).toHaveBeenCalled();
    const completeEvents = events.filter((e) => e.type === "complete");
    const errorEvents = events.filter((e) => e.type === "error");
    expect(errorEvents).toHaveLength(0);
    expect(completeEvents).toHaveLength(1);
    if (completeEvents[0] && completeEvents[0].type === "complete") {
      expect(completeEvents[0].result.pagesScraped).toBeGreaterThan(0);
    }
  });

  it("still emits an error when /v1/scrape fails AND Crawlee fallback returns null", async () => {
    vi.stubEnv("CRAWLEE_FALLBACK_ENABLED", "true");
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(null);

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    expect(crawleeScrapeMock).toHaveBeenCalled();
    expect(events.some((e) => e.type === "complete")).toBe(false);
    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent).toBeDefined();
    if (errorEvent && errorEvent.type === "error") {
      // Map worked, scrape (both primary and fallback) failed — this is
      // the site-specific failure path, not the crawler-down path.
      expect(errorEvent.step).toBe("scrape");
      expect(errorEvent.message).toMatch(/Couldn't fetch your site/);
    }
  });

  it("does NOT call Crawlee when CRAWLEE_FALLBACK_ENABLED is unset", async () => {
    // crawleeFallbackEnabledMock defaults to false in beforeEach.
    crawleeScrapeMock.mockResolvedValue("should-not-be-used");

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) {
        return new Response("", { status: 200 });
      }
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response("Service Unavailable", { status: 503 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === "complete")).toBe(false);
    expect(events.some((e) => e.type === "error")).toBe(true);
  });

  // ────────────────────────────────────────────────────────────────────
  // Retry-with-backoff behaviour (added 2026-05-23)
  // ────────────────────────────────────────────────────────────────────

  it("retries once on transient HTTP 408 and succeeds when the retry returns 200", async () => {
    // Per-page scrape call counter so we can return 408 on first attempt
    // and 200 on the retry.
    const scrapeCallsByUrl = new Map<string, number>();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) return new Response("", { status: 200 });
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/search")) {
        return new Response(JSON.stringify({ success: true, data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/v1/scrape")) {
        const body = init?.body ? JSON.parse(init.body as string) : {};
        const target = body.url as string;
        const n = (scrapeCallsByUrl.get(target) ?? 0) + 1;
        scrapeCallsByUrl.set(target, n);
        if (n === 1) return new Response("Request Timeout", { status: 408 });
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: "# Hello\n\n" + "real content ".repeat(50),
              links: [],
              metadata: {},
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    // Every page got two scrape calls: the failing first + the successful retry.
    for (const [, count] of scrapeCallsByUrl) {
      expect(count).toBe(2);
    }
    expect(events.some((e) => e.type === "error")).toBe(false);
    const complete = events.find((e) => e.type === "complete");
    expect(complete).toBeDefined();
    if (complete?.type === "complete") {
      expect(complete.result.pagesScraped).toBeGreaterThan(0);
    }
  });

  it("does NOT retry permanent failures (HTTP 403) — single attempt then Crawlee fallback or error", async () => {
    // crawleeFallbackEnabled is false by default in beforeEach, so 403
    // means: one attempt per page, no retry, no Crawlee, hard error.
    const scrapeCalls = vi.fn();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) return new Response("", { status: 200 });
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        scrapeCalls();
        return new Response("Forbidden", { status: 403 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    // The map mock only returns 1 URL, so pagesToScrape = [home, /about] (2).
    // The key assertion: no doubling for retry. With a transient error this
    // would be 4 (2 pages × 2 attempts); with 403 it stays at 2.
    expect(scrapeCalls).toHaveBeenCalledTimes(2);
    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") {
      expect(error.step).toBe("scrape");
    }
  });

  it("surfaces the timeout-specific error message when every scrape failure is a timeout", async () => {
    // All scrapes return HTTP 408. After retry exhausts (also 408), the
    // route should pick the "took too long to respond" message rather
    // than the generic "couldn't fetch."
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/robots.txt")) return new Response("", { status: 200 });
      if (url.includes("/v1/map")) {
        return new Response(
          JSON.stringify({ success: true, links: ["https://example.com/about"] }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      if (url.includes("/v1/scrape")) {
        return new Response("Request Timeout", { status: 408 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;

    const events: SSEEvent[] = [];
    await runAudit("https://example.com", (e) => events.push(e), () => false);

    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    if (error?.type === "error") {
      expect(error.step).toBe("scrape");
      expect(error.message).toMatch(/took too long to respond/);
      expect(error.message).not.toMatch(/Couldn't fetch your site\./);
      expect(error.scrapeFailures?.every((f) => f.error.includes("HTTP 408"))).toBe(true);
    }
  });
});
