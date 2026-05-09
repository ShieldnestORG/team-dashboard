/**
 * Unit tests for llms-txt-generator service.
 *
 * Strategy: pure functions are tested directly. The end-to-end runJob is
 * tested against a tiny in-memory mock site (mocked global fetch + drizzle
 * stub), so we verify sitemap discovery, recursion, page parsing, and
 * output assembly without touching Postgres.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOutputs,
  collectUrlsFromSitemap,
  extractSitemapFromRobots,
  extractTagValues,
  groupPagesByPrefix,
  normalizeDomain,
  parsePage,
  resolveSitemap,
  runJob,
} from "../services/llms-txt-generator.ts";

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe("normalizeDomain", () => {
  it("adds https when missing", () => {
    expect(normalizeDomain("example.com")).toBe("https://example.com");
  });
  it("preserves existing scheme", () => {
    expect(normalizeDomain("http://example.com")).toBe("http://example.com");
  });
  it("strips path/query", () => {
    expect(normalizeDomain("https://example.com/foo?bar=1")).toBe("https://example.com");
  });
  it("rejects garbage", () => {
    expect(normalizeDomain("")).toBeNull();
    expect(normalizeDomain("   ")).toBeNull();
  });
});

describe("extractSitemapFromRobots", () => {
  it("finds Sitemap directive (case-insensitive)", () => {
    const text = `User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n`;
    expect(extractSitemapFromRobots(text)).toBe("https://example.com/sitemap.xml");
  });
  it("returns null when no Sitemap directive", () => {
    expect(extractSitemapFromRobots("User-agent: *\nDisallow: /")).toBeNull();
  });
  it("trims trailing whitespace", () => {
    expect(extractSitemapFromRobots("Sitemap: https://example.com/sm.xml   ")).toBe(
      "https://example.com/sm.xml",
    );
  });
});

describe("extractTagValues", () => {
  it("extracts <loc> from a urlset", () => {
    const xml = `<?xml version="1.0"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://example.com/a</loc></url>
  <url><loc>https://example.com/b</loc><lastmod>2026-01-01</lastmod></url>
</urlset>`;
    expect(extractTagValues(xml, "url", "loc")).toEqual([
      "https://example.com/a",
      "https://example.com/b",
    ]);
  });
  it("decodes XML entities", () => {
    const xml = `<urlset><url><loc>https://example.com/a?b=1&amp;c=2</loc></url></urlset>`;
    expect(extractTagValues(xml, "url", "loc")).toEqual(["https://example.com/a?b=1&c=2"]);
  });
});

describe("parsePage", () => {
  it("extracts title, description, h1", () => {
    const html = `<!doctype html><html><head>
      <title>About Us</title>
      <meta name="description" content="We make software.">
    </head><body><h1>About</h1><p>Hello world.</p><script>var x=1</script></body></html>`;
    const out = parsePage("https://example.com/about", html);
    expect(out.title).toBe("About Us");
    expect(out.description).toBe("We make software.");
    expect(out.h1).toBe("About");
    expect(out.bodySnippet).toContain("Hello world");
    // script content stripped
    expect(out.bodySnippet).not.toContain("var x=1");
  });
  it("falls back to h1 if title is missing", () => {
    const html = `<html><body><h1>The Headline</h1></body></html>`;
    const out = parsePage("https://example.com/p", html);
    expect(out.title).toBe("The Headline");
  });
  it("uses URL slug as last-resort title", () => {
    const html = `<html><body></body></html>`;
    const out = parsePage("https://example.com/blog/my-cool-post", html);
    expect(out.title).toBe("my cool post");
  });
});

describe("groupPagesByPrefix", () => {
  it("groups by first path segment, root → 'Pages'", () => {
    const pages = [
      page("https://x.com/"),
      page("https://x.com/blog/one"),
      page("https://x.com/blog/two"),
      page("https://x.com/docs/intro"),
    ];
    const groups = groupPagesByPrefix(pages, "https://x.com");
    expect(Object.keys(groups)).toEqual(["Pages", "Blog", "Docs"]);
    expect(groups["Blog"].length).toBe(2);
  });
});

describe("buildOutputs", () => {
  it("emits the llms.txt header + grouped page list", () => {
    const pages = [
      { ...page("https://x.com/"), description: "Site root.", title: "Home" },
      { ...page("https://x.com/about"), title: "About", description: "About us." },
      { ...page("https://x.com/blog/post-1"), title: "Post One", description: "First post." },
    ];
    const out = buildOutputs("https://x.com", pages);
    expect(out.llmsTxt).toMatch(/^# x\.com\n/);
    expect(out.llmsTxt).toContain("> Site root.");
    expect(out.llmsTxt).toContain("## Pages");
    expect(out.llmsTxt).toContain("## About");
    expect(out.llmsTxt).toContain("## Blog");
    expect(out.llmsTxt).toContain("[Post One](https://x.com/blog/post-1): First post.");

    expect(out.llmsFullTxt).toContain("### Post One");
    expect(out.llmsFullTxt).toContain("URL: https://x.com/blog/post-1");

    const agents = JSON.parse(out.agentsJson);
    expect(agents.name).toBe("x.com");
    expect(agents.version).toBe("0.1");
    expect(agents.endpoints).toEqual([]);
    expect(agents["x-page-count"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Sitemap discovery + recursion (mocked fetch)
// ---------------------------------------------------------------------------

describe("resolveSitemap", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("finds /sitemap.xml when present", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "https://x.com/sitemap.xml") return new Response("ok", { status: 200 });
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await resolveSitemap("https://x.com")).toBe("https://x.com/sitemap.xml");
  });

  it("falls back to /sitemap_index.xml", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "https://x.com/sitemap_index.xml") return new Response("ok", { status: 200 });
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await resolveSitemap("https://x.com")).toBe("https://x.com/sitemap_index.xml");
  });

  it("falls back to robots.txt Sitemap directive", async () => {
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://x.com/robots.txt" && init?.method === "GET") {
        return new Response("Sitemap: https://x.com/custom-sitemap.xml\n", { status: 200 });
      }
      return new Response("no", { status: 404 });
    }) as unknown as typeof fetch;
    expect(await resolveSitemap("https://x.com")).toBe("https://x.com/custom-sitemap.xml");
  });

  it("returns null when nothing found", async () => {
    globalThis.fetch = vi.fn(async () => new Response("no", { status: 404 })) as unknown as typeof fetch;
    expect(await resolveSitemap("https://x.com")).toBeNull();
  });
});

describe("collectUrlsFromSitemap", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("parses a single urlset", async () => {
    const xml = `<urlset>
      <url><loc>https://x.com/a</loc></url>
      <url><loc>https://x.com/b</loc></url>
    </urlset>`;
    globalThis.fetch = vi.fn(async () => new Response(xml, { status: 200 })) as unknown as typeof fetch;
    const urls = await collectUrlsFromSitemap("https://x.com/sitemap.xml", 100);
    expect(urls).toEqual(["https://x.com/a", "https://x.com/b"]);
  });

  it("recurses into a sitemap-index", async () => {
    const indexXml = `<sitemapindex>
      <sitemap><loc>https://x.com/sm-1.xml</loc></sitemap>
      <sitemap><loc>https://x.com/sm-2.xml</loc></sitemap>
    </sitemapindex>`;
    const sm1 = `<urlset><url><loc>https://x.com/a</loc></url></urlset>`;
    const sm2 = `<urlset><url><loc>https://x.com/b</loc></url><url><loc>https://x.com/c</loc></url></urlset>`;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/sitemap.xml")) return new Response(indexXml, { status: 200 });
      if (u.endsWith("/sm-1.xml")) return new Response(sm1, { status: 200 });
      if (u.endsWith("/sm-2.xml")) return new Response(sm2, { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const urls = await collectUrlsFromSitemap("https://x.com/sitemap.xml", 100);
    expect(urls).toEqual(["https://x.com/a", "https://x.com/b", "https://x.com/c"]);
  });

  it("respects the maxPages cap during recursion", async () => {
    const indexXml = `<sitemapindex>
      <sitemap><loc>https://x.com/sm-1.xml</loc></sitemap>
      <sitemap><loc>https://x.com/sm-2.xml</loc></sitemap>
    </sitemapindex>`;
    const sm1 = `<urlset><url><loc>https://x.com/a</loc></url><url><loc>https://x.com/b</loc></url></urlset>`;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith("/sitemap.xml")) return new Response(indexXml, { status: 200 });
      if (u.endsWith("/sm-1.xml")) return new Response(sm1, { status: 200 });
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch;
    const urls = await collectUrlsFromSitemap("https://x.com/sitemap.xml", 1);
    expect(urls.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array on missing sitemap", async () => {
    globalThis.fetch = vi.fn(async () => new Response("404", { status: 404 })) as unknown as typeof fetch;
    expect(await collectUrlsFromSitemap("https://x.com/missing.xml", 100)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// runJob — end-to-end against a tiny mock site
// ---------------------------------------------------------------------------

describe("runJob (end-to-end against in-memory site)", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("crawls a 3-page site and writes output", async () => {
    const pages: Record<string, string> = {
      "https://mock.test/": `<!doctype html><html><head><title>Mock Home</title><meta name="description" content="Mock site root."></head><body><h1>Mock Home</h1></body></html>`,
      "https://mock.test/about": `<!doctype html><html><head><title>About Mock</title></head><body><h1>About</h1><p>About body.</p></body></html>`,
      "https://mock.test/blog/post-1": `<!doctype html><html><head><title>Post 1</title></head><body><h1>Post 1</h1></body></html>`,
    };
    const sitemap = `<urlset>
      <url><loc>https://mock.test/</loc></url>
      <url><loc>https://mock.test/about</loc></url>
      <url><loc>https://mock.test/blog/post-1</loc></url>
    </urlset>`;
    globalThis.fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      if (u === "https://mock.test/sitemap.xml") return new Response(sitemap, { status: 200 });
      if (init?.method === "HEAD") {
        return u === "https://mock.test/sitemap.xml"
          ? new Response("", { status: 200 })
          : new Response("", { status: 404 });
      }
      if (pages[u]) {
        return new Response(pages[u], {
          status: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const captured: { jobs: any[]; outputs: any[] } = { jobs: [{ id: "j1", status: "queued" }], outputs: [] };
    const db = makeDbStub(captured);

    await runJob(db, "j1", "https://mock.test", undefined, 500);

    expect(captured.jobs[0].status).toBe("complete");
    expect(captured.outputs.length).toBe(1);
    const out = captured.outputs[0];
    expect(out.pageCount).toBe(3);
    expect(out.llmsTxt).toContain("# mock.test");
    expect(out.llmsTxt).toContain("[Mock Home](https://mock.test/)");
  });

  it("marks job failed when sitemap is missing", async () => {
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const captured: { jobs: any[]; outputs: any[] } = { jobs: [{ id: "j2", status: "queued" }], outputs: [] };
    const db = makeDbStub(captured);
    await runJob(db, "j2", "https://nosuch.test", undefined, 500);
    expect(captured.jobs[0].status).toBe("failed");
    expect(captured.jobs[0].error).toMatch(/No sitemap discovered/);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function page(url: string) {
  return {
    url,
    title: url,
    description: "",
    h1: "",
    bodySnippet: "",
  };
}

/**
 * Minimal Db stub: implements the .update().set().where() and
 * .insert().values() chains used by runJob, against the captured fixture
 * arrays. Only enough to pass the assertions above.
 */
function makeDbStub(state: { jobs: any[]; outputs: any[] }): any {
  return {
    update(_table: any) {
      let pending: any = null;
      const chain = {
        set(values: any) {
          pending = values;
          return chain;
        },
        where(_cond: any) {
          // Apply to first job (we only ever use one in these tests).
          if (state.jobs[0]) Object.assign(state.jobs[0], pending);
          return Promise.resolve();
        },
      };
      return chain;
    },
    insert(table: any) {
      return {
        values(values: any) {
          // Discriminate by checking which columns are present.
          if ("llmsTxt" in values || "agents_json" in values || "agentsJson" in values) {
            state.outputs.push(values);
            return Promise.resolve();
          }
          state.jobs.push({ id: "x", ...values });
          return {
            returning() {
              return Promise.resolve([{ id: state.jobs[state.jobs.length - 1].id }]);
            },
          };
        },
      };
    },
  };
}
