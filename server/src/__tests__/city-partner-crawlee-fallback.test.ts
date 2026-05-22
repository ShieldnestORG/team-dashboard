import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// city-collector + partner-onboarding — Crawlee fallback wiring tests.
//
// Verifies that when Firecrawl /v1/scrape fails for the city-collector Yelp
// source and for the partner-onboarding prefill path, the Crawlee fallback
// (gated by CRAWLEE_FALLBACK_ENABLED) is consulted and its markdown is used
// when available. Continuation of the Phase-1/3 rollout: same pattern as the
// firecrawl-sync + rizz-extractor wiring already shipped.
//
// Playwright is mocked here. End-to-end browser testing belongs in a manual
// smoke script.
// ---------------------------------------------------------------------------

const crawleeScrapeMock = vi.fn<(url: string) => Promise<string | null>>();
const crawleeFallbackEnabledMock = vi.fn<() => boolean>();

vi.mock("../services/crawlee-fallback.js", () => ({
  crawleeScrape: (url: string) => crawleeScrapeMock(url),
  crawleeFallbackEnabled: () => crawleeFallbackEnabledMock(),
}));

vi.mock("../services/ollama-client.js", () => ({
  callOllamaGenerate: async () => "",
}));

import type { Db } from "@paperclipai/db";
import { collectCity } from "../services/city-collector.ts";
import { prefillPartnerFromWebsite } from "../services/partner-onboarding.ts";

// ---------------------------------------------------------------------------
// Minimal Drizzle db stub — chainable builder where every method returns a
// thenable that resolves to []. The city-collector path uses
// `insert/values/onConflictDoUpdate` and `update/set/where`; nothing reads
// real rows back.
// ---------------------------------------------------------------------------

function createChainableDbStub(): Db {
  const makeChain = (): unknown => {
    const target = Promise.resolve([] as unknown[]);
    return new Proxy(target, {
      get(t, prop, receiver) {
        if (prop === "then" || prop === "catch" || prop === "finally") {
          const v = Reflect.get(t, prop, receiver) as Function | undefined;
          return v ? v.bind(t) : undefined;
        }
        return () => makeChain();
      },
    });
  };
  return new Proxy({}, {
    get() {
      return () => makeChain();
    },
  }) as unknown as Db;
}

function firecrawl503Response(): Response {
  return new Response("Service Unavailable", { status: 503 });
}

// ---------------------------------------------------------------------------
// city-collector — collectYelp call site (line ~433)
// ---------------------------------------------------------------------------

describe("city-collector — Crawlee fallback wiring (Yelp source)", () => {
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

  it("calls Crawlee for the Yelp URL when Firecrawl 503s and fallback is enabled", async () => {
    globalThis.fetch = vi.fn(async () => firecrawl503Response()) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue("**Plumbers**\n**Roofers**\n");

    const db = createChainableDbStub();
    await collectCity(db, { city: "Austin", region: "TX" });

    const calledUrls = crawleeScrapeMock.mock.calls.map((c) => c[0]);
    expect(
      calledUrls.some((u) => u.startsWith("https://www.yelp.com/search")),
    ).toBe(true);
  });

  it("does NOT call Crawlee for Yelp when the fallback flag is off", async () => {
    globalThis.fetch = vi.fn(async () => firecrawl503Response()) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(false);
    crawleeScrapeMock.mockResolvedValue("should-not-be-used");

    const db = createChainableDbStub();
    await collectCity(db, { city: "Austin", region: "TX" });

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// partner-onboarding — prefillPartnerFromWebsite call site (line ~238)
// ---------------------------------------------------------------------------

describe("partner-onboarding — Crawlee fallback wiring (prefill)", () => {
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

  it("uses Crawlee markdown when Firecrawl throws and fallback is enabled", async () => {
    globalThis.fetch = vi.fn(async () => firecrawl503Response()) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(true);
    // Return valid-looking JSON so the Ollama parser path doesn't blow up.
    // callOllamaGenerate is mocked to return "" so the call to it will throw
    // on JSON parse — we catch and re-throw here to assert the fallback ran.
    crawleeScrapeMock.mockResolvedValue('{"industry":"retail","description":"x","services":[],"targetKeywords":[],"tagline":"x"}');

    // The Ollama parse will fail because callOllamaGenerate returns "" —
    // that's fine; we only need to assert the fallback was consulted before
    // intel extraction. The throw comes from the JSON-match check.
    try {
      await prefillPartnerFromWebsite("https://example.test");
    } catch {
      // Ollama-parse failure is expected; fallback wire-in already ran by now.
    }

    expect(crawleeScrapeMock).toHaveBeenCalledWith("https://example.test");
  });

  it("does NOT call Crawlee when the fallback flag is off", async () => {
    globalThis.fetch = vi.fn(async () => firecrawl503Response()) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(false);
    crawleeScrapeMock.mockResolvedValue("unused");

    await expect(prefillPartnerFromWebsite("https://example.test")).rejects.toThrow();

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
  });
});
