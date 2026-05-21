// ---------------------------------------------------------------------------
// Sitemap deep-crawl — walks N same-origin pages of a target site and
// returns markdown per page. Built for competitor/partner intel where the
// homepage is rarely the page with signal (/pricing, /about, /blog/*,
// /changelog, /careers are).
//
// Uses Crawlee's PlaywrightCrawler + enqueueLinks to expand outward from
// a start URL up to `maxPages` and `maxDepth`. crawlee + turndown load
// lazily (mirrors `crawlee-fallback.ts`) so absence/failure of the libs
// never blocks server boot or non-crawl code paths.
//
// Gated behind `SITEMAP_CRAWL_ENABLED=true` — off by default. Browsers
// must be available (Playwright already a server dep). Standalone for
// this PR: no consumers wired in yet — a follow-up PR will plumb this
// into partner-onboarding + intel.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";

const DEFAULT_MAX_PAGES = 20;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_TIMEOUT_MS = 45_000;
const MAX_MARKDOWN_BYTES = 50_000;

export interface SitemapCrawlOptions {
  maxPages?: number;
  maxDepth?: number;
  sameOriginOnly?: boolean;
  timeoutMs?: number;
}

export interface SitemapCrawlPage {
  url: string;
  title: string | null;
  markdown: string;
  depth: number;
}

export interface SitemapCrawlResult {
  startUrl: string;
  pages: SitemapCrawlPage[];
  failedUrls: string[];
  truncated: boolean;
}

export function sitemapCrawlEnabled(): boolean {
  return process.env.SITEMAP_CRAWL_ENABLED === "true";
}

// Lazy-load Crawlee + Turndown — same pattern as `crawlee-fallback.ts`.
// First call pays the import cost; subsequent calls reuse cached refs.
interface LoadedModules {
  PlaywrightCrawler: typeof import("crawlee").PlaywrightCrawler;
  RobotsTxtFile: typeof import("crawlee").RobotsTxtFile;
  Turndown: new () => { turndown(html: string): string };
}

let cachedModules: LoadedModules | null = null;
let loadFailed = false;

async function loadModules(): Promise<LoadedModules | null> {
  if (cachedModules) return cachedModules;
  if (loadFailed) return null;
  try {
    const crawlee = await import("crawlee");
    const turndownModule = (await import("turndown")) as unknown as {
      default: new () => { turndown(html: string): string };
    };
    cachedModules = {
      PlaywrightCrawler: crawlee.PlaywrightCrawler,
      RobotsTxtFile: crawlee.RobotsTxtFile,
      Turndown: turndownModule.default,
    };
    return cachedModules;
  } catch (err) {
    loadFailed = true;
    logger.warn(
      { err },
      "Sitemap crawl: failed to load crawlee/turndown — sitemap crawl disabled for this process",
    );
    return null;
  }
}

function emptyResult(startUrl: string): SitemapCrawlResult {
  return { startUrl, pages: [], failedUrls: [], truncated: false };
}

// ---------------------------------------------------------------------------
// crawlSitemap — walks N same-origin pages outward from startUrl and
// returns markdown for each. Failures are captured per-URL in `failedUrls`
// rather than thrown, so partial results are still useful to callers.
// ---------------------------------------------------------------------------

export async function crawlSitemap(
  startUrl: string,
  opts: SitemapCrawlOptions = {},
): Promise<SitemapCrawlResult> {
  if (!sitemapCrawlEnabled()) {
    logger.warn(
      { startUrl },
      "Sitemap crawl: SITEMAP_CRAWL_ENABLED is not set — returning empty result",
    );
    return emptyResult(startUrl);
  }

  const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  const sameOriginOnly = opts.sameOriginOnly ?? true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const modules = await loadModules();
  if (!modules) return emptyResult(startUrl);

  const { PlaywrightCrawler, RobotsTxtFile, Turndown } = modules;

  // Robots.txt — log + skip on fetch failure. Passed to enqueueLinks so
  // disallowed URLs get filtered automatically at enqueue time.
  let robotsTxt: import("crawlee").RobotsTxtFile | null = null;
  try {
    robotsTxt = await RobotsTxtFile.find(startUrl);
  } catch (err) {
    logger.warn(
      { err, startUrl },
      "Sitemap crawl: failed to fetch robots.txt — proceeding without robots filter",
    );
  }

  // Skip the start URL outright if robots.txt disallows it.
  if (robotsTxt && !robotsTxt.isAllowed(startUrl)) {
    logger.warn(
      { startUrl },
      "Sitemap crawl: start URL disallowed by robots.txt — returning empty result",
    );
    return emptyResult(startUrl);
  }

  const pages: SitemapCrawlPage[] = [];
  const failedUrls: string[] = [];

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: maxPages,
    requestHandlerTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    navigationTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    headless: true,
    launchContext: {
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    async requestHandler({ page, request, enqueueLinks }) {
      // Depth tracking — start URL is depth 0; enqueued links get depth+1.
      const depth = (request.userData?.depth as number | undefined) ?? 0;

      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      const html = await page.content();
      const title = await page.title().catch(() => null);

      const turndown = new Turndown();
      const markdown = turndown.turndown(html).slice(0, MAX_MARKDOWN_BYTES);

      pages.push({
        url: request.loadedUrl ?? request.url,
        title: title || null,
        markdown,
        depth,
      });

      // Only enqueue more links if we have depth budget remaining. The
      // PlaywrightCrawler's `maxRequestsPerCrawl` enforces the page cap
      // independently — extras above maxPages are skipped at enqueue.
      if (depth < maxDepth) {
        await enqueueLinks({
          strategy: sameOriginOnly ? "same-origin" : "all",
          userData: { depth: depth + 1 },
          ...(robotsTxt ? { robotsTxtFile: robotsTxt } : {}),
        });
      }
    },
    failedRequestHandler({ error, request }) {
      failedUrls.push(request.url);
      logger.warn(
        { url: request.url, err: error },
        "Sitemap crawl: request failed",
      );
    },
  });

  try {
    await crawler.run([{ url: startUrl, userData: { depth: 0 } }]);
  } catch (err) {
    logger.warn({ err, startUrl }, "Sitemap crawl: crawler.run threw");
    return { startUrl, pages, failedUrls, truncated: false };
  } finally {
    // Always tear down so Playwright browsers don't leak across invocations.
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "Sitemap crawl: teardown threw");
    }
  }

  // `truncated` = we hit the maxPages ceiling. If pages.length === maxPages
  // we treat the frontier as cut short; callers can rerun with a higher cap.
  const truncated = pages.length >= maxPages;

  return { startUrl, pages, failedUrls, truncated };
}
