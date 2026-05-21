// ---------------------------------------------------------------------------
// Launch monitor — Crawlee-powered deep-fetch sources.
//
// The existing launch-monitor polls HN (Algolia), Reddit (json), and dev.to
// (API key) via plain fetch. This module adds an opt-in Playwright path for
// platforms with no usable API: today, Product Hunt's discussion pages.
//
// Lazy dynamic-import of `crawlee` (PlaywrightCrawler) mirrors the pattern in
// `crawlee-fallback.ts` exactly — absence/failure of the lib never blocks
// server boot or non-fallback code paths. The shipped surface here is service
// only; the launch-monitor cron is not wired against it in this PR. A
// follow-up PR will consume `fetchProductHuntComments()` from the poller.
//
// Gated behind `LAUNCH_MONITOR_CRAWLEE_ENABLED=true` — off by default.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";

const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_COMMENTS = 100;
const COMMENT_BODY_MAX_BYTES = 4_000;

export function launchMonitorCrawleeEnabled(): boolean {
  return process.env.LAUNCH_MONITOR_CRAWLEE_ENABLED === "true";
}

// Lazy-loaded module reference — only one dep (`crawlee`) needed for this
// path because Product Hunt comments are extracted as structured records, not
// converted to markdown. First call pays the import cost; subsequent calls
// reuse the cached reference.
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
      "launch-monitor-crawlee: failed to load crawlee — Crawlee sources disabled for this process",
    );
    return null;
  }
}

export interface ProductHuntComment {
  author: string;
  bodyText: string;
  postedAt: string | null;
  postUrl: string;
}

export interface FetchProductHuntOptions {
  maxComments?: number;
  timeoutMs?: number;
}

function normalizeProductHuntUrl(productSlugOrUrl: string): string {
  const trimmed = productSlugOrUrl.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  // Bare slug like "team-dashboard" → canonical post URL.
  const slug = trimmed.replace(/^\/+|\/+$/g, "");
  return `https://www.producthunt.com/posts/${encodeURIComponent(slug)}`;
}

// ---------------------------------------------------------------------------
// fetchProductHuntComments — opens a Product Hunt post page in a headless
// Chromium, scrapes the public comment list, and returns the structured rows.
// Returns [] on any failure so callers can treat it as a drop-in source.
// ---------------------------------------------------------------------------

export async function fetchProductHuntComments(
  productSlugOrUrl: string,
  opts: FetchProductHuntOptions = {},
): Promise<ProductHuntComment[]> {
  if (!launchMonitorCrawleeEnabled()) {
    logger.warn(
      "launch-monitor-crawlee: LAUNCH_MONITOR_CRAWLEE_ENABLED is not 'true' — returning empty result",
    );
    return [];
  }

  const modules = await loadModules();
  if (!modules) return [];

  const { PlaywrightCrawler } = modules;
  const maxComments = Math.max(1, opts.maxComments ?? DEFAULT_MAX_COMMENTS);
  const timeoutMs = Math.max(1_000, opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
  const postUrl = normalizeProductHuntUrl(productSlugOrUrl);

  let comments: ProductHuntComment[] = [];
  let scrapeError: unknown = null;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    navigationTimeoutSecs: Math.ceil(timeoutMs / 1_000),
    headless: true,
    launchContext: {
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    async requestHandler({ page, request }) {
      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });
      // Comment nodes on Product Hunt have a stable test-id; if PH changes
      // markup this selector becomes the canary. Failures fall through to
      // an empty result (logged below).
      const raw = await page.evaluate(() => {
        const nodes = Array.from(
          document.querySelectorAll<HTMLElement>('[data-test^="comment-"]'),
        );
        return nodes.map((node) => {
          const author =
            node
              .querySelector<HTMLElement>('[data-test^="user-name-"], a[href^="/@"]')
              ?.textContent?.trim() ?? "";
          const bodyText =
            node
              .querySelector<HTMLElement>('[data-test="comment-body"], .styles_body__')
              ?.textContent?.trim() ?? "";
          const postedAt =
            node.querySelector<HTMLTimeElement>("time")?.getAttribute("datetime") ?? null;
          return { author, bodyText, postedAt };
        });
      });

      const finalUrl = request.loadedUrl ?? request.url;
      const filtered: ProductHuntComment[] = [];
      for (const row of raw) {
        if (filtered.length >= maxComments) break;
        const author = (row.author || "").trim();
        const bodyText = (row.bodyText || "").trim().slice(0, COMMENT_BODY_MAX_BYTES);
        if (!author && !bodyText) continue;
        filtered.push({
          author,
          bodyText,
          postedAt: row.postedAt,
          postUrl: finalUrl,
        });
      }
      comments = filtered;
    },
    failedRequestHandler({ error, request }) {
      scrapeError = error;
      logger.warn(
        { url: request.url, err: error },
        "launch-monitor-crawlee: request failed",
      );
    },
  });

  try {
    await crawler.run([postUrl]);
  } catch (err) {
    logger.warn({ err, postUrl }, "launch-monitor-crawlee: crawler.run threw");
    return [];
  } finally {
    // Always tear down so Playwright browsers don't leak across invocations.
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "launch-monitor-crawlee: teardown threw");
    }
  }

  if (scrapeError) return [];
  return comments;
}
