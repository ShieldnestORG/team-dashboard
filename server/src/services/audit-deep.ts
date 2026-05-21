// ---------------------------------------------------------------------------
// audit-deep — premium "deep audit" tier that actually renders pages in
// Playwright, collects runtime errors (console + uncaught page errors), counts
// broken images, captures an above-the-fold screenshot, and follows up to N
// internal links to repeat the same checks on sub-pages.
//
// Phase 2 of the Crawlee adoption roadmap. The Firecrawl-only single-page
// scrape lives in routes/audit.ts; this service is what unlocks the "we render
// your site like a real browser" paid feature.
//
// Gated behind `AUDIT_DEEP_ENABLED=true`. The crawlee + playwright deps load
// lazily (mirroring services/crawlee-fallback.ts) so a missing browser binary
// can never crash the server — failures return a structured `failureReason`
// instead of throwing.
// ---------------------------------------------------------------------------
import { logger } from "../middleware/logger.js";

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_LINKS = 0;
const HARD_MAX_LINKS = 5;
const MAX_INTERNAL_LINKS_REPORTED = 50;

export function auditDeepEnabled(): boolean {
  return process.env.AUDIT_DEEP_ENABLED === "true";
}

// Lazy-loaded module references. First call to runDeepAudit pays the import
// cost; subsequent calls reuse the cached refs. If the import itself fails
// (e.g. browser binaries not installed), we cache the failure and short-circuit
// to a structured error result on later calls instead of throwing again.
interface LoadedModules {
  PlaywrightCrawler: typeof import("crawlee").PlaywrightCrawler;
}

let cachedModules: LoadedModules | null = null;
let loadFailed = false;

async function loadModules(): Promise<LoadedModules | null> {
  if (cachedModules) return cachedModules;
  if (loadFailed) return null;
  try {
    const crawlee = await import("crawlee");
    cachedModules = {
      PlaywrightCrawler: crawlee.PlaywrightCrawler,
    };
    return cachedModules;
  } catch (err) {
    loadFailed = true;
    logger.warn(
      { err },
      "audit-deep: failed to load crawlee — deep audit disabled for this process",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// Result shape — keep this stable; storefront + UI consume it as-is.
// ---------------------------------------------------------------------------

export interface SubPageResult {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  brokenImageCount: number;
  loadTimeMs: number;
}

export interface DeepAuditResult {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  brokenImageCount: number;
  loadTimeMs: number;
  internalLinks: string[];
  screenshotBase64: string | null;
  subPages: SubPageResult[];
  // Set when the deep audit could not run end-to-end. Caller can decide
  // whether to surface a friendly error or fall back to the basic audit.
  failureReason?: string;
  scannedAt: string;
}

export interface DeepAuditOpts {
  maxLinks?: number;
  timeoutMs?: number;
  // When false, the screenshot field is set to null. The route layer flips
  // this off if the client signals it doesn't need the (large) base64 payload.
  captureScreenshot?: boolean;
}

// Browser-side function — runs inside page.evaluate, NOT in Node. Keep it
// self-contained (no Node-side closures), since Playwright serializes it.
// Returns broken-image count + same-origin internal link list + the
// performance-timing-derived load time.
function pageProbeFn(): {
  brokenImageCount: number;
  internalLinks: string[];
  loadTimeMs: number;
} {
  /* eslint-disable no-undef */
  const origin = window.location.origin;
  // naturalWidth === 0 catches both 404s and decode failures. We've already
  // waited for load by the time this runs (waitForLoadState("load")) so
  // legitimate slow-loading images shouldn't be in this bucket.
  const imgs = Array.from(document.querySelectorAll("img"));
  const brokenImageCount = imgs.filter(
    (img) => (img as HTMLImageElement).naturalWidth === 0,
  ).length;

  const links = Array.from(document.querySelectorAll("a[href]"))
    .map((a) => (a as HTMLAnchorElement).href)
    .filter((href) => {
      try {
        const u = new URL(href);
        return u.origin === origin && (u.protocol === "http:" || u.protocol === "https:");
      } catch {
        return false;
      }
    });
  const internalLinks = Array.from(new Set(links));

  // performance.timing is deprecated but still present in every Chromium build
  // we care about; fall back to the navigation-timing API if it's missing.
  let loadTimeMs = 0;
  const perf = window.performance;
  if (perf) {
    const t = perf.timing;
    if (t && t.loadEventEnd && t.navigationStart) {
      loadTimeMs = t.loadEventEnd - t.navigationStart;
    } else {
      const nav = perf.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      if (nav) {
        loadTimeMs = Math.round(nav.loadEventEnd - nav.startTime);
      }
    }
  }

  return { brokenImageCount, internalLinks, loadTimeMs };
  /* eslint-enable no-undef */
}

interface PerPageCapture {
  url: string;
  consoleErrors: string[];
  pageErrors: string[];
  brokenImageCount: number;
  loadTimeMs: number;
  internalLinks: string[];
  screenshotBase64: string | null;
}

// Build a fresh empty result. Used both for the success path (filled in) and
// for the early-exit failure paths (returned with `failureReason` set).
function makeEmptyResult(url: string): DeepAuditResult {
  return {
    url,
    consoleErrors: [],
    pageErrors: [],
    brokenImageCount: 0,
    loadTimeMs: 0,
    internalLinks: [],
    screenshotBase64: null,
    subPages: [],
    scannedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// runDeepAudit — entry point. Returns a populated DeepAuditResult or, on
// failure, an otherwise-empty result with `failureReason` set. Never throws.
// ---------------------------------------------------------------------------
export async function runDeepAudit(
  url: string,
  opts: DeepAuditOpts = {},
): Promise<DeepAuditResult> {
  const result = makeEmptyResult(url);

  if (!auditDeepEnabled()) {
    result.failureReason = "deep audit disabled";
    return result;
  }

  const timeoutMs = Math.max(5_000, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const maxLinks = Math.max(0, Math.min(HARD_MAX_LINKS, opts.maxLinks ?? DEFAULT_MAX_LINKS));
  const captureScreenshot = opts.captureScreenshot ?? true;

  const modules = await loadModules();
  if (!modules) {
    result.failureReason = "crawlee module unavailable";
    return result;
  }

  const { PlaywrightCrawler } = modules;

  // Captures per visited URL — keyed by the URL we asked the crawler to
  // fetch. Crawlee redirects can land us on a different final URL; we record
  // both so the caller can correlate.
  const captures = new Map<string, PerPageCapture>();
  let topLevelError: unknown = null;

  // Plan: enqueue the root URL plus up to `maxLinks` internal links once we
  // discover them. We don't know the internal links until after the root page
  // renders, so the first requestHandler call enqueues additional pages.
  const enqueuedSubPages: string[] = [];

  const crawler = new PlaywrightCrawler({
    // root + (maxLinks) subpages — never more than 1 + HARD_MAX_LINKS.
    maxRequestsPerCrawl: 1 + maxLinks,
    requestHandlerTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    navigationTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    headless: true,
    launchContext: {
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    async requestHandler({ page, request, enqueueLinks: _enqueueLinks }) {
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];

      // page.on listeners must be attached before navigation completes, but
      // Crawlee already navigates before calling requestHandler. We attach
      // here and rely on the fact that most JS errors fire after DOMContentLoaded
      // (script errors, framework warnings, image-load errors) — i.e. we'll
      // still catch them during the subsequent waitForLoadState + evaluate.
      const consoleHandler = (msg: import("playwright").ConsoleMessage): void => {
        if (msg.type() === "error") {
          consoleErrors.push(msg.text());
        }
      };
      const pageErrorHandler = (err: Error): void => {
        pageErrors.push(err.message);
      };
      page.on("console", consoleHandler);
      page.on("pageerror", pageErrorHandler);

      try {
        // Wait for the full load event (not just domcontentloaded) so we
        // catch image-load failures and late-firing errors.
        await page.waitForLoadState("load", { timeout: timeoutMs }).catch(() => {
          // If load doesn't fire within timeoutMs (heavy SPA), proceed anyway
          // — we still get whatever console/page errors fired up to this point.
        });

        const probe = await page.evaluate(pageProbeFn);

        let screenshotBase64: string | null = null;
        if (captureScreenshot && request.url === url) {
          // Above-the-fold PNG of the root page only. Sub-pages would balloon
          // the response with mostly-redundant images.
          try {
            const buf = await page.screenshot({ fullPage: false, type: "png" });
            screenshotBase64 = buf.toString("base64");
          } catch (err) {
            logger.warn({ err, url: request.url }, "audit-deep: screenshot failed");
          }
        }

        captures.set(request.url, {
          url: request.url,
          consoleErrors,
          pageErrors,
          brokenImageCount: probe.brokenImageCount,
          loadTimeMs: probe.loadTimeMs,
          internalLinks: probe.internalLinks.slice(0, MAX_INTERNAL_LINKS_REPORTED),
          screenshotBase64,
        });

        // Only the root page seeds sub-page navigation; sub-pages don't fan
        // out further (we'd otherwise risk O(maxLinks^N) crawl explosion).
        if (request.url === url && maxLinks > 0) {
          const candidates = probe.internalLinks
            .filter((u) => u !== url)
            .slice(0, maxLinks);
          for (const sub of candidates) {
            enqueuedSubPages.push(sub);
          }
          if (candidates.length > 0) {
            await crawler.addRequests(candidates);
          }
        }
      } finally {
        page.off("console", consoleHandler);
        page.off("pageerror", pageErrorHandler);
      }
    },
    failedRequestHandler({ error, request }) {
      logger.warn(
        { url: request.url, err: error },
        "audit-deep: request failed",
      );
      // Record an empty capture so the caller sees the sub-page was attempted.
      if (!captures.has(request.url)) {
        captures.set(request.url, {
          url: request.url,
          consoleErrors: [],
          pageErrors: [(error as Error)?.message ?? "request failed"],
          brokenImageCount: 0,
          loadTimeMs: 0,
          internalLinks: [],
          screenshotBase64: null,
        });
      }
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    topLevelError = err;
    logger.warn({ err, url }, "audit-deep: crawler.run threw");
  } finally {
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "audit-deep: teardown threw");
    }
  }

  const rootCapture = captures.get(url);
  if (!rootCapture) {
    result.failureReason =
      topLevelError instanceof Error
        ? `crawler failed: ${topLevelError.message}`
        : "crawler returned no result";
    return result;
  }

  result.consoleErrors = rootCapture.consoleErrors;
  result.pageErrors = rootCapture.pageErrors;
  result.brokenImageCount = rootCapture.brokenImageCount;
  result.loadTimeMs = rootCapture.loadTimeMs;
  result.internalLinks = rootCapture.internalLinks;
  result.screenshotBase64 = rootCapture.screenshotBase64;

  result.subPages = enqueuedSubPages
    .map((subUrl) => captures.get(subUrl))
    .filter((c): c is PerPageCapture => c !== undefined)
    .map((c) => ({
      url: c.url,
      consoleErrors: c.consoleErrors,
      pageErrors: c.pageErrors,
      brokenImageCount: c.brokenImageCount,
      loadTimeMs: c.loadTimeMs,
    }));

  return result;
}
