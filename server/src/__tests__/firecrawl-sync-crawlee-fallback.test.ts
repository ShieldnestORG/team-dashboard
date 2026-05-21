import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Firecrawl sync — Crawlee fallback wiring tests.
//
// Verifies that when the primary Firecrawl /v1/scrape call fails, the sync
// path consults the Crawlee fallback (gated by CRAWLEE_FALLBACK_ENABLED) and
// uses its markdown when available. The actual Playwright crawl is mocked
// here — end-to-end browser testing belongs in a manual smoke script.
// ---------------------------------------------------------------------------

const crawleeScrapeMock = vi.fn<(url: string) => Promise<string | null>>();
const crawleeFallbackEnabledMock = vi.fn<() => boolean>();

vi.mock("../services/crawlee-fallback.js", () => ({
  crawleeScrape: (url: string) => crawleeScrapeMock(url),
  crawleeFallbackEnabled: () => crawleeFallbackEnabledMock(),
}));

vi.mock("../services/intel-embeddings.js", () => ({
  getEmbedding: async () => [] as number[],
}));

import type { Db } from "@paperclipai/db";
import { syncTopIntelCompanies } from "../services/firecrawl-sync.ts";

// ---------------------------------------------------------------------------
// Minimal db stub — captures every INSERT and lets pickTopCompanies see one
// company row. The service uses `db.execute(sql)`; nothing else.
// ---------------------------------------------------------------------------

interface DbCall {
  query: string;
}

function flattenSql(sqlObj: { queryChunks?: unknown[] } | unknown): string {
  const chunks = (sqlObj as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks
    .map((c) => {
      if (c && typeof c === "object" && "value" in c) {
        const v = (c as { value: unknown }).value;
        return Array.isArray(v) ? v.join("") : String(v ?? "");
      }
      return String(c);
    })
    .join("");
}

function createDbStub(companies: Array<{ slug: string; name: string; website: string }>): {
  db: Db;
  inserts: DbCall[];
} {
  const inserts: DbCall[] = [];
  const db = {
    execute: async (sqlObj: unknown) => {
      const query = flattenSql(sqlObj);
      if (query.includes("FROM intel_companies")) {
        return companies as unknown as Record<string, unknown>[];
      }
      if (query.includes("INSERT INTO intel_reports")) {
        inserts.push({ query });
        return [];
      }
      return [];
    },
  } as unknown as Db;
  return { db, inserts };
}

describe("firecrawl-sync — Crawlee fallback wiring", () => {
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
    globalThis.fetch = vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue("# Acme\n\nFallback markdown from Crawlee.");

    const { db, inserts } = createDbStub([
      { slug: "acme", name: "Acme", website: "https://acme.test" },
    ]);

    const result = await syncTopIntelCompanies(db, { limit: 1 });

    expect(crawleeScrapeMock).toHaveBeenCalledWith("https://acme.test");
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(inserts.length).toBe(1);
  });

  it("does NOT call Crawlee when the fallback flag is off", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(false);
    crawleeScrapeMock.mockResolvedValue("should-not-be-used");

    const { db, inserts } = createDbStub([
      { slug: "beta", name: "Beta", website: "https://beta.test" },
    ]);

    const result = await syncTopIntelCompanies(db, { limit: 1 });

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(inserts.length).toBe(0);
  });

  it("does NOT call Crawlee when Firecrawl itself succeeds", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: true, data: { markdown: "# Primary path" } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    ) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue("unused");

    const { db, inserts } = createDbStub([
      { slug: "gamma", name: "Gamma", website: "https://gamma.test" },
    ]);

    const result = await syncTopIntelCompanies(db, { limit: 1 });

    expect(crawleeScrapeMock).not.toHaveBeenCalled();
    expect(result.succeeded).toBe(1);
    expect(inserts.length).toBe(1);
  });

  it("reports failure when both Firecrawl and Crawlee return null", async () => {
    globalThis.fetch = vi.fn(async () => new Response("Service Unavailable", { status: 503 })) as unknown as typeof fetch;
    crawleeFallbackEnabledMock.mockReturnValue(true);
    crawleeScrapeMock.mockResolvedValue(null);

    const { db, inserts } = createDbStub([
      { slug: "delta", name: "Delta", website: "https://delta.test" },
    ]);

    const result = await syncTopIntelCompanies(db, { limit: 1 });

    expect(crawleeScrapeMock).toHaveBeenCalledOnce();
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);
    expect(inserts.length).toBe(0);
  });
});
