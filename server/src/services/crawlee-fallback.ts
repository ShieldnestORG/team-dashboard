// ---------------------------------------------------------------------------
// Crawlee fallback — secondary scraper that activates when Firecrawl fails.
//
// Firecrawl is the primary URL → markdown service. When it returns null
// (5xx, network error, JS-only page it couldn't render), callers can ask
// this module for a Playwright-rendered fallback. The crawlee + turndown
// deps load lazily so absence/failure of the libs never blocks server boot
// or non-fallback code paths.
//
// Gated behind `CRAWLEE_FALLBACK_ENABLED=true` — off by default. Browsers
// must be available (Playwright already a server dep). Adopt incrementally:
// flip the flag, watch logs for `via: "crawlee"`, then point more callers at
// this module.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_MARKDOWN_BYTES = 50_000;

export function crawleeFallbackEnabled(): boolean {
  return process.env.CRAWLEE_FALLBACK_ENABLED === "true";
}

// Lazy-loaded conversion to avoid pulling Crawlee + Playwright + Turndown
// into every code path that imports this module. The first call pays the
// import cost; subsequent calls reuse the cached module references.
interface LoadedModules {
  PlaywrightCrawler: typeof import("crawlee").PlaywrightCrawler;
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
      Turndown: turndownModule.default,
    };
    return cachedModules;
  } catch (err) {
    loadFailed = true;
    logger.warn(
      { err },
      "Crawlee fallback: failed to load crawlee/turndown — fallback disabled for this process",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// crawleeScrape — single-URL Playwright fetch → markdown. Returns null on
// any failure so callers can treat it as a drop-in for firecrawlScrape.
// ---------------------------------------------------------------------------

export async function crawleeScrape(url: string): Promise<string | null> {
  if (!crawleeFallbackEnabled()) return null;

  const modules = await loadModules();
  if (!modules) return null;

  const { PlaywrightCrawler, Turndown } = modules;

  let markdown: string | null = null;
  let scrapeError: unknown = null;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: Math.ceil(REQUEST_TIMEOUT_MS / 1_000),
    navigationTimeoutSecs: Math.ceil(REQUEST_TIMEOUT_MS / 1_000),
    headless: true,
    launchContext: {
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    async requestHandler({ page }) {
      await page.waitForLoadState("domcontentloaded", { timeout: REQUEST_TIMEOUT_MS });
      const html = await page.content();
      const turndown = new Turndown();
      markdown = turndown.turndown(html).slice(0, MAX_MARKDOWN_BYTES);
    },
    failedRequestHandler({ error, request }) {
      scrapeError = error;
      logger.warn(
        { url: request.url, err: error },
        "Crawlee fallback: request failed",
      );
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    logger.warn({ err, url }, "Crawlee fallback: crawler.run threw");
    return null;
  } finally {
    // Always tear down the crawler so Playwright browsers don't leak across
    // invocations. Errors here are logged but don't block the return value.
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "Crawlee fallback: teardown threw");
    }
  }

  if (scrapeError) return null;
  return markdown;
}
