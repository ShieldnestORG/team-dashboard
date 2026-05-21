// ---------------------------------------------------------------------------
// Bluesky scraping — @atproto/api primary + Crawlee fallback.
//
// Primary path: `@atproto/api`'s AtpAgent → `app.bsky.feed.getAuthorFeed`.
// Public profiles need no login, so this is just an unauthenticated XRPC call
// against `https://api.bsky.app`. Fast, cheap, the right answer most of the
// time.
//
// Fallback path: when the SDK call throws (rate-limited, transient 5xx, etc.)
// AND `SOCIALS_BLUESKY_CRAWLEE_FALLBACK=true`, fetch the public web view at
// `https://bsky.app/profile/<handle>` via Crawlee + PlaywrightCrawler and
// parse posts out of the rendered DOM. Crawlee is dynamic-imported in the
// same lazy-load pattern as `crawlee-fallback.ts` so absence/failure of the
// dep never blocks server boot or the primary path.
//
// The service NEVER throws — on total failure it returns `[]`. Callers can
// distinguish "no posts" from "scrape failed" only via the warnings in logs.
//
// Service-only for now: not wired into the Socials Hub cron or UI. A consumer
// PR will follow.
// ---------------------------------------------------------------------------

import { AtpAgent } from "@atproto/api";
import { logger } from "../../middleware/logger.js";

// Public AppView used for unauthenticated reads. AtpAgent will hit
// `xrpc/app.bsky.feed.getAuthorFeed` on this host.
const PUBLIC_APPVIEW = "https://api.bsky.app";
const CRAWLEE_TIMEOUT_MS = 45_000;
const DEFAULT_MAX_POSTS = 25;

export interface BlueskyPost {
  uri: string;
  text: string;
  createdAt: string;
  authorHandle: string;
}

export interface FetchBlueskyPostsOpts {
  maxPosts?: number;
}

export function blueskyCrawleeFallbackEnabled(): boolean {
  return process.env.SOCIALS_BLUESKY_CRAWLEE_FALLBACK === "true";
}

// ---------------------------------------------------------------------------
// Lazy-loaded Crawlee — mirrors crawlee-fallback.ts. The first call pays the
// import cost; subsequent calls reuse the cached references. If the dep is
// missing or fails to load once, we don't retry.
// ---------------------------------------------------------------------------
interface LoadedCrawleeModules {
  PlaywrightCrawler: typeof import("crawlee").PlaywrightCrawler;
}

let cachedCrawleeModules: LoadedCrawleeModules | null = null;
let crawleeLoadFailed = false;

async function loadCrawleeModules(): Promise<LoadedCrawleeModules | null> {
  if (cachedCrawleeModules) return cachedCrawleeModules;
  if (crawleeLoadFailed) return null;
  try {
    const crawlee = await import("crawlee");
    cachedCrawleeModules = { PlaywrightCrawler: crawlee.PlaywrightCrawler };
    return cachedCrawleeModules;
  } catch (err) {
    crawleeLoadFailed = true;
    logger.warn(
      { err },
      "Bluesky scrape: failed to load crawlee — Crawlee fallback disabled for this process",
    );
    return null;
  }
}

// ---------------------------------------------------------------------------
// SDK path — unauthenticated read of a public profile's author feed.
// Throws on failure so the caller can decide whether to try Crawlee.
// ---------------------------------------------------------------------------
async function fetchViaSdk(handle: string, maxPosts: number): Promise<BlueskyPost[]> {
  const agent = new AtpAgent({ service: PUBLIC_APPVIEW });
  const res = await agent.app.bsky.feed.getAuthorFeed({
    actor: handle,
    limit: Math.min(Math.max(maxPosts, 1), 100),
    filter: "posts_and_author_threads",
  });

  const feed = res.data.feed ?? [];
  const posts: BlueskyPost[] = [];
  for (const item of feed) {
    const post = item.post;
    if (!post) continue;
    const record = post.record as { text?: unknown; createdAt?: unknown } | undefined;
    const text = typeof record?.text === "string" ? record.text : "";
    const createdAt =
      typeof record?.createdAt === "string" ? record.createdAt : post.indexedAt ?? "";
    const authorHandle = post.author?.handle ?? handle;
    posts.push({
      uri: post.uri,
      text,
      createdAt,
      authorHandle,
    });
    if (posts.length >= maxPosts) break;
  }
  return posts;
}

// ---------------------------------------------------------------------------
// Crawlee path — render the public bsky.app profile and pull posts from the
// DOM. Returns `[]` on any failure so the caller can treat it as a drop-in
// for the SDK path. Only runs when explicitly opted-in via env flag.
// ---------------------------------------------------------------------------
async function fetchViaCrawlee(handle: string, maxPosts: number): Promise<BlueskyPost[]> {
  if (!blueskyCrawleeFallbackEnabled()) return [];

  const modules = await loadCrawleeModules();
  if (!modules) return [];

  const { PlaywrightCrawler } = modules;
  const profileUrl = `https://bsky.app/profile/${encodeURIComponent(handle)}`;

  let scraped: BlueskyPost[] = [];
  let scrapeError: unknown = null;

  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    requestHandlerTimeoutSecs: Math.ceil(CRAWLEE_TIMEOUT_MS / 1_000),
    navigationTimeoutSecs: Math.ceil(CRAWLEE_TIMEOUT_MS / 1_000),
    headless: true,
    launchContext: {
      launchOptions: {
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      },
    },
    async requestHandler({ page }) {
      await page.waitForLoadState("domcontentloaded", { timeout: CRAWLEE_TIMEOUT_MS });

      // Wait briefly for at least one post link to render. bsky.app links
      // posts at `/profile/<handle>/post/<rkey>`. If nothing appears within
      // the window, we return what we have (likely empty).
      try {
        await page.waitForSelector('a[href*="/post/"]', { timeout: 10_000 });
      } catch {
        /* fall through — empty result */
      }

      scraped = await page.evaluate(
        ({ targetHandle, cap }: { targetHandle: string; cap: number }) => {
          const out: Array<{
            uri: string;
            text: string;
            createdAt: string;
            authorHandle: string;
          }> = [];
          const anchors = Array.from(
            document.querySelectorAll<HTMLAnchorElement>('a[href*="/post/"]'),
          );
          const seen = new Set<string>();
          for (const a of anchors) {
            const href = a.getAttribute("href") || "";
            const m = href.match(/\/profile\/([^/]+)\/post\/([^/?#]+)/);
            if (!m) continue;
            const authorHandle = decodeURIComponent(m[1]);
            const rkey = m[2];
            // AT URI form: at://<did-or-handle>/app.bsky.feed.post/<rkey>
            const uri = `at://${authorHandle}/app.bsky.feed.post/${rkey}`;
            if (seen.has(uri)) continue;
            seen.add(uri);

            // Climb to the post container and look for a `time` element + text.
            const container =
              a.closest('[data-testid^="postThreadItem"]') ||
              a.closest('[role="article"]') ||
              a.closest("article") ||
              a.parentElement?.parentElement ||
              a.parentElement;
            const timeEl = container?.querySelector("time");
            const createdAt =
              timeEl?.getAttribute("datetime") ?? timeEl?.getAttribute("title") ?? "";
            const textEl =
              container?.querySelector('[data-testid="postText"]') ??
              container?.querySelector('[data-word-wrap="1"]');
            const text = (textEl?.textContent ?? "").trim();

            out.push({ uri, text, createdAt, authorHandle: authorHandle || targetHandle });
            if (out.length >= cap) break;
          }
          return out;
        },
        { targetHandle: handle, cap: maxPosts },
      );
    },
    failedRequestHandler({ error, request }) {
      scrapeError = error;
      logger.warn(
        { url: request.url, err: error },
        "Bluesky scrape: Crawlee request failed",
      );
    },
  });

  try {
    await crawler.run([profileUrl]);
  } catch (err) {
    logger.warn({ err, handle }, "Bluesky scrape: Crawlee crawler.run threw");
    return [];
  } finally {
    try {
      await crawler.teardown();
    } catch (err) {
      logger.warn({ err }, "Bluesky scrape: Crawlee teardown threw");
    }
  }

  if (scrapeError) return [];
  return scraped;
}

// ---------------------------------------------------------------------------
// fetchBlueskyPosts — public entry point. SDK primary, Crawlee fallback.
// Never throws; on total failure returns `[]`.
// ---------------------------------------------------------------------------
export async function fetchBlueskyPosts(
  handle: string,
  opts: FetchBlueskyPostsOpts = {},
): Promise<BlueskyPost[]> {
  const maxPosts = opts.maxPosts ?? DEFAULT_MAX_POSTS;

  let sdkPosts: BlueskyPost[] | null = null;
  try {
    sdkPosts = await fetchViaSdk(handle, maxPosts);
  } catch (err) {
    logger.warn({ err, handle }, "Bluesky scrape: SDK path failed, considering Crawlee fallback");
  }

  if (sdkPosts && sdkPosts.length > 0) return sdkPosts;

  // SDK returned empty or threw. Only consult Crawlee if the SDK actually
  // failed (null) — an authoritative empty list from the SDK is fine to
  // surface as-is. Crawlee path itself respects the env flag.
  if (sdkPosts === null) {
    const fallbackPosts = await fetchViaCrawlee(handle, maxPosts);
    if (fallbackPosts.length > 0) return fallbackPosts;
  }

  return sdkPosts ?? [];
}
