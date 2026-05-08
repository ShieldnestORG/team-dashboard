import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("emits an error event and never emits complete when /v1/map fails", async () => {
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
      message: expect.stringContaining("Crawler temporarily unavailable"),
    });
  });

  it("emits an error event when /v1/map succeeds but every /v1/scrape fails", async () => {
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
    expect(events.some((e) => e.type === "error")).toBe(true);
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
});
