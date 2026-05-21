// ---------------------------------------------------------------------------
// Synthetic uptime monitor — full-browser canary checks.
//
// Renders each URL with Playwright via Crawlee and records what only a real
// browser can see: JS console errors, uncaught page errors, broken images
// that 404 even though the page itself returns 200, total load time, and
// the final HTTP status. Existing `vps-monitor.ts` only does basic HTTP HEAD
// checks and would not catch any of these regressions.
//
// Gated behind `SYNTHETIC_MONITOR_ENABLED=true` — off by default. Crawlee
// and Playwright load lazily, matching the pattern in `crawlee-fallback.ts`,
// so absence of the libs never crashes the process.
//
// Stand-alone for this PR: no cron wiring, no DB writes. A follow-up will
// schedule it and decide on persistence.
// ---------------------------------------------------------------------------

import { logger } from "../middleware/logger.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 2;
const MAX_CONCURRENCY = 5;
const MAX_ERROR_SAMPLES = 10;

export interface SyntheticCheckResult {
  url: string;
  ok: boolean;
  httpStatus: number | null;
  loadTimeMs: number;
  consoleErrorCount: number;
  pageErrorCount: number;
  brokenImageCount: number;
  consoleErrors: string[];
  pageErrors: string[];
  checkedAt: string;
}

export function syntheticMonitorEnabled(): boolean {
  return process.env.SYNTHETIC_MONITOR_ENABLED === "true";
}

// Lazy-loaded Crawlee — mirrors `crawlee-fallback.ts`. Playwright comes in
// transitively via Crawlee, no separate import needed. Cached after first
// load; a load failure poisons subsequent attempts so we don't repeatedly
// pay the disk-IO cost on a misconfigured host.
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
    cachedModules = { PlaywrightCrawler: crawlee.PlaywrightCrawler };
    return cachedModules;
  } catch (err) {
    loadFailed = true;
    logger.warn(
      { err },
      "Synthetic monitor: failed to load crawlee — checks disabled for this process",
    );
    return null;
  }
}

function disabledResult(url: string, reason: string): SyntheticCheckResult {
  return {
    url,
    ok: false,
    httpStatus: null,
    loadTimeMs: 0,
    consoleErrorCount: 0,
    pageErrorCount: 0,
    brokenImageCount: 0,
    consoleErrors: [reason],
    pageErrors: [],
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// runSyntheticCheck — single-URL Playwright render + signal collection.
// Never throws: any unexpected error becomes an `ok: false` result so batch
// callers can keep going.
// ---------------------------------------------------------------------------

export async function runSyntheticCheck(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<SyntheticCheckResult> {
  if (!syntheticMonitorEnabled()) {
    return disabledResult(url, "disabled");
  }

  const modules = await loadModules();
  if (!modules) {
    return disabledResult(url, "synthetic monitor: crawlee not loadable");
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { PlaywrightCrawler } = modules;

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let brokenImageCount = 0;
  let httpStatus: number | null = null;
  let loadTimeMs = 0;
  let handlerRan = false;

  const startedAt = Date.now();

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
    async requestHandler({ page, response }) {
      handlerRan = true;
      httpStatus = response?.status() ?? null;

      // Console error capture — only `error` level, drop debug/info/warn noise
      // that some apps log even on healthy pages.
      page.on("console", (msg) => {
        if (msg.type() === "error" && consoleErrors.length < MAX_ERROR_SAMPLES) {
          consoleErrors.push(msg.text());
        }
      });

      // Uncaught JS exceptions during page execution.
      page.on("pageerror", (err: Error) => {
        if (pageErrors.length < MAX_ERROR_SAMPLES) {
          pageErrors.push(err.message);
        }
      });

      await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs });

      // Broken-image enumeration — `naturalWidth === 0` after load means the
      // <img> failed even if its parent doc was 200. Runs in-page to keep
      // the round-trip to one evaluate() call.
      try {
        brokenImageCount = await page.evaluate(() => {
          const imgs = Array.from(document.querySelectorAll("img"));
          return imgs.filter((img) => {
            const el = img as HTMLImageElement;
            return el.complete && el.naturalWidth === 0;
          }).length;
        });
      } catch (err) {
        logger.warn({ err, url }, "Synthetic monitor: image evaluation failed");
      }

      loadTimeMs = Date.now() - startedAt;
    },
    failedRequestHandler({ error, request }) {
      const message = error instanceof Error ? error.message : String(error);
      pageErrors.push(`request failed: ${message}`);
      logger.warn(
        { url: request.url, err: error },
        "Synthetic monitor: request failed",
      );
    },
  });

  try {
    await crawler.run([url]);
  } catch (err) {
    logger.warn({ err, url }, "Synthetic monitor: crawler.run threw");
    pageErrors.push(`crawler error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "Synthetic monitor: teardown threw");
    }
  }

  // If the handler never fired, the crawler couldn't even reach the page —
  // record elapsed time so callers can see how long they waited.
  if (!handlerRan && loadTimeMs === 0) {
    loadTimeMs = Date.now() - startedAt;
  }

  const statusOk = httpStatus !== null && httpStatus >= 200 && httpStatus < 400;
  const ok =
    consoleErrors.length === 0 &&
    pageErrors.length === 0 &&
    statusOk &&
    brokenImageCount === 0;

  return {
    url,
    ok,
    httpStatus,
    loadTimeMs,
    consoleErrorCount: consoleErrors.length,
    pageErrorCount: pageErrors.length,
    brokenImageCount,
    consoleErrors: consoleErrors.slice(0, MAX_ERROR_SAMPLES),
    pageErrors: pageErrors.slice(0, MAX_ERROR_SAMPLES),
    checkedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// runSyntheticBatch — fan out across a URL list with capped concurrency.
// Ordering of results matches input order so downstream alerting can pair
// each result back to its canary by index.
// ---------------------------------------------------------------------------

export async function runSyntheticBatch(
  urls: string[],
  opts: { timeoutMs?: number; concurrency?: number } = {},
): Promise<SyntheticCheckResult[]> {
  if (urls.length === 0) return [];

  const requested = opts.concurrency ?? DEFAULT_CONCURRENCY;
  const concurrency = Math.max(1, Math.min(requested, MAX_CONCURRENCY));

  const results = new Array<SyntheticCheckResult>(urls.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = nextIndex++;
      if (i >= urls.length) return;
      const url = urls[i];
      if (url === undefined) return;
      results[i] = await runSyntheticCheck(url, { timeoutMs: opts.timeoutMs });
    }
  }

  const workerCount = Math.min(concurrency, urls.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);

  return results;
}
