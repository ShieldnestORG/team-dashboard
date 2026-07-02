import { randomUUID } from "node:crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { creditscoreAuditRuns } from "@paperclipai/db";

import { logger } from "../middleware/logger.js";
import { crawleeFallbackEnabled, crawleeScrape } from "../services/crawlee-fallback.js";
import { assertPublicHttpUrl, safeFetch, SsrfError } from "../lib/ssrf-guard.js";

const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "self-hosted";

// ── Rate limiter: 3 audits per IP per 24 hours ───────────────────────────────

const auditRateBuckets = new Map<string, number[]>();

function checkAuditRateLimit(ip: string): boolean {
  const now = Date.now();
  const windowMs = 24 * 60 * 60 * 1000;
  const cutoff = now - windowMs;

  const timestamps = (auditRateBuckets.get(ip) ?? []).filter((t) => t > cutoff);
  if (timestamps.length >= 3) return false;

  timestamps.push(now);
  auditRateBuckets.set(ip, timestamps);
  return true;
}

setInterval(() => {
  const now = Date.now();
  const cutoff = now - 24 * 60 * 60 * 1000;
  for (const [key, timestamps] of auditRateBuckets) {
    if (timestamps.every((t) => t <= cutoff)) auditRateBuckets.delete(key);
  }
}, 60 * 60 * 1000).unref();

// ── Job store ────────────────────────────────────────────────────────────────

type AuditStatus = "pending" | "running" | "done" | "error";

interface AuditJob {
  id: string;
  url: string;
  status: AuditStatus;
  createdAt: number;
}

const auditJobs = new Map<string, AuditJob>();

setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, job] of auditJobs) {
    if (job.createdAt < cutoff) auditJobs.delete(id);
  }
}, 30 * 60 * 1000).unref();

// ── Types ─────────────────────────────────────────────────────────────────────

// Server-side diagnostic fields on the `error` event. The storefront only
// renders `message`; `step` and `scrapeFailures` are picked up by the
// route layer to populate creditscore_audit_runs for later debugging.
export type AuditErrorStep = "map" | "scrape" | "search" | "validation";

export type SSEEvent =
  | { type: "step"; label: string; detail?: string }
  | { type: "complete"; result: AuditResult }
  | {
      type: "error";
      message: string;
      step?: AuditErrorStep;
      scrapeFailures?: Array<{ url: string; error: string }>;
    };

export type AuditResult = {
  url: string;
  score: number;
  breakdown: {
    aiAccess: {
      score: number;
      max: 25;
      issues: string[];
      // Live per-bot reachability (fetched with each bot's real UA), NOT just
      // robots.txt parsing. Optional + additive — absent on older deploys and
      // on cached payloads that predate this feature, so the storefront type
      // marks it optional too. Distinct from the robots.txt-derived
      // `issues`/`score` above; a live edge-block can only ever ADD issues,
      // it never raises the numeric score.
      liveAccess?: {
        bots: Array<{
          name: "GPTBot" | "ClaudeBot" | "PerplexityBot" | "Google-Extended";
          ua: string; // exact User-Agent string sent
          status: number | null; // HTTP status from the live fetch; null = network error/timeout
          reachable: boolean; // 2xx/3xx AND not a known block page
          blocked: boolean; // robots.txt OR live 403/451 OR Cloudflare AI block
          blockReason: "robots" | "http_403" | "http_451" | "cloudflare_ai" | "timeout" | null;
        }>;
        cloudflareAiBlock: boolean; // true if Cloudflare default "Block AI bots" challenge detected
        checkedAt: string; // ISO timestamp of the live probe
      };
    };
    structuredData: { score: number; max: 25; schemas: string[]; issues: string[] };
    contentQuality: { score: number; max: 20; issues: string[] };
    freshness: { score: number; max: 15; issues: string[] };
    technical: { score: number; max: 15; issues: string[] };
  };
  competitors: Array<{ domain: string; score: number }>;
  recommendations: Array<{ priority: "high" | "medium" | "low"; title: string; impact: string }>;
  // Number of pages successfully scraped by Firecrawl. Persistence layers
  // gate on this — pagesScraped===0 means the crawler failed and the
  // result must NOT be written as status:"complete".
  pagesScraped: number;
  // Raw per-page Firecrawl payloads for downstream replay / re-scoring.
  // Persisted into creditscore_reports.raw_data JSONB. Flows over SSE in
  // the `complete` event so the storefront's POST /audit/store proxy
  // can hand it through to storeAuditResult — anonymous free audits are
  // the only path where the persistence layer doesn't run runAudit
  // itself. Each page's markdown is already capped at 60_000 chars in
  // fcScrape, so per-audit ceiling is ~180 KB.
  rawData: Array<{
    url: string;
    markdown: string;
    metadata: Record<string, unknown>;
  }>;
  scannedAt: string;
};

// ── URL validation ────────────────────────────────────────────────────────────

async function validateAuditUrl(
  raw: string,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: "URL must be a valid absolute URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, error: "URL must start with http:// or https://" };
  }
  // Authoritative SSRF check: resolves the hostname via DNS and rejects if any
  // resolved IP is loopback/private/link-local/CGNAT/unique-local/etc. Defeats
  // DNS-rebinding at check time and catches ranges the regex above misses
  // (IPv4-mapped IPv6, 0.0.0.0, 169.254/16, 100.64/10).
  try {
    await assertPublicHttpUrl(parsed.toString());
  } catch (err) {
    if (err instanceof SsrfError) {
      return { ok: false, error: "Private/localhost URLs are not allowed" };
    }
    throw err;
  }
  return { ok: true, url: parsed.toString() };
}

// ── Firecrawl helpers ─────────────────────────────────────────────────────────

// Distinguishes "crawler is unreachable / errored" from "site genuinely
// returned empty results." Callers can `instanceof` check this to decide
// whether to fail the audit or just emit a 0-result step.
export class FirecrawlError extends Error {
  constructor(
    message: string,
    readonly endpoint: "scrape" | "map" | "search",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "FirecrawlError";
  }
}

// Firecrawl scrape budgets. Bumped 2026-05-23 from 30s/45s to 60s/75s after
// slow-but-real sites (roguedefender.com) consistently hit HTTP 408 inside
// Firecrawl's internal 30s window. Outer abort = scrape budget + 15s slack
// so the inner timeout always fires first (cleaner error message).
const FIRECRAWL_SCRAPE_TIMEOUT_MS = 60_000;
const FIRECRAWL_SCRAPE_ABORT_MS = 75_000;
// Retry budget for the retry attempt — half the first try, because a site
// that took >60s once is unlikely to come back in 60s on a retry, and we
// need to leave room under the 180s storefront timeout for Crawlee fallback.
const FIRECRAWL_SCRAPE_RETRY_TIMEOUT_MS = 30_000;
const FIRECRAWL_SCRAPE_RETRY_ABORT_MS = 40_000;
// Default 2s; overridable via env so unit tests can drive it to 0.
function scrapeRetryBackoffMs(): number {
  const v = Number(process.env.SCRAPE_RETRY_BACKOFF_MS);
  return Number.isFinite(v) && v >= 0 ? v : 2_000;
}

// One Firecrawl /v1/scrape attempt. Throws FirecrawlError on any failure
// (network, HTTP non-2xx, missing payload). Pure — no retry, no fallback —
// so the wrapper can compose those orthogonally.
async function fcScrapeOnce(
  url: string,
  budget: { scrapeMs: number; abortMs: number },
): Promise<{ markdown: string; links: string[]; metadata: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, formats: ["markdown", "links"], timeout: budget.scrapeMs }),
      signal: AbortSignal.timeout(budget.abortMs),
    });
  } catch (err) {
    throw new FirecrawlError(`scrape: network error (${(err as Error).message})`, "scrape", err);
  }
  if (!res.ok) {
    throw new FirecrawlError(`scrape: HTTP ${res.status}`, "scrape");
  }
  const data = (await res.json()) as {
    success: boolean;
    data?: {
      markdown?: string;
      links?: string[];
      metadata?: Record<string, unknown>;
    };
  };
  if (!data.success || !data.data) {
    throw new FirecrawlError("scrape: response missing data", "scrape");
  }
  return {
    markdown: (data.data.markdown ?? "").slice(0, 60_000),
    links: data.data.links ?? [],
    metadata: data.data.metadata ?? {},
  };
}

// True if a FirecrawlError is worth retrying. Network errors, timeouts
// (HTTP 408), rate limits (429), and server errors (5xx) are transient.
// Permanent client errors (403, 404, 410, etc.) won't get better on retry
// and just waste the user's time.
function isTransientFirecrawlError(err: FirecrawlError): boolean {
  if (err.message.startsWith("scrape: network error")) return true;
  if (err.message === "scrape: response missing data") return true;
  const httpMatch = err.message.match(/^scrape: HTTP (\d+)/);
  if (!httpMatch) return true;
  const status = Number(httpMatch[1]);
  if (status === 408 || status === 429) return true;
  if (status >= 500 && status < 600) return true;
  // 400, 401, 403, 404, 410, etc. — won't recover.
  return false;
}

// Public scrape entry point: one Firecrawl attempt + one retry on
// transient errors + Crawlee fallback after exhaustion. Throws the most
// recent FirecrawlError if everything fails.
async function fcScrape(
  url: string,
): Promise<{ markdown: string; links: string[]; metadata: Record<string, unknown> }> {
  let primaryError: FirecrawlError;
  try {
    return await fcScrapeOnce(url, {
      scrapeMs: FIRECRAWL_SCRAPE_TIMEOUT_MS,
      abortMs: FIRECRAWL_SCRAPE_ABORT_MS,
    });
  } catch (err) {
    if (!(err instanceof FirecrawlError)) throw err;
    primaryError = err;
  }

  if (isTransientFirecrawlError(primaryError)) {
    const backoffMs = scrapeRetryBackoffMs();
    logger.warn(
      { url, errorMessage: primaryError.message, attempt: 1, backoffMs },
      "audit: fcScrape transient failure — retrying once",
    );
    if (backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, backoffMs));
    try {
      const retried = await fcScrapeOnce(url, {
        scrapeMs: FIRECRAWL_SCRAPE_RETRY_TIMEOUT_MS,
        abortMs: FIRECRAWL_SCRAPE_RETRY_ABORT_MS,
      });
      logger.info({ url }, "audit: fcScrape succeeded on retry");
      return retried;
    } catch (err) {
      if (err instanceof FirecrawlError) primaryError = err;
      else throw err;
    }
  } else {
    logger.warn(
      { url, errorMessage: primaryError.message },
      "audit: fcScrape permanent failure — not retrying",
    );
  }

  return await scrapeFallbackOrThrow(url, primaryError);
}

// Try Crawlee as a secondary scraper when Firecrawl's /v1/scrape exhausts
// its retries. Returns a scrape-shaped object when Crawlee succeeds
// (links + metadata are empty — Crawlee only yields markdown), otherwise
// rethrows the most recent Firecrawl error.
async function scrapeFallbackOrThrow(
  url: string,
  primaryError: FirecrawlError,
): Promise<{ markdown: string; links: string[]; metadata: Record<string, unknown> }> {
  if (!crawleeFallbackEnabled()) throw primaryError;
  // Route the URL through the SSRF guard before handing it to the headless
  // browser — this URL may be a mapped/derived link, not the vetted job URL.
  try {
    await assertPublicHttpUrl(url);
  } catch {
    throw primaryError;
  }
  const fallback = await crawleeScrape(url);
  if (!fallback) throw primaryError;
  logger.info({ url, via: "crawlee" }, "audit: Crawlee fallback succeeded after Firecrawl failure");
  return { markdown: fallback.slice(0, 60_000), links: [], metadata: {} };
}

async function fcMap(url: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_URL}/v1/map`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url, limit: 50 }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new FirecrawlError(`map: network error (${(err as Error).message})`, "map", err);
  }
  if (!res.ok) {
    throw new FirecrawlError(`map: HTTP ${res.status}`, "map");
  }
  const data = (await res.json()) as {
    success: boolean;
    links?: string[];
    urls?: string[];
  };
  if (!data.success) {
    throw new FirecrawlError("map: response success=false", "map");
  }
  return data.links ?? data.urls ?? [];
}

async function fcSearch(
  query: string,
): Promise<Array<{ url: string; title: string }>> {
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_URL}/v1/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ query, limit: 3 }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new FirecrawlError(`search: network error (${(err as Error).message})`, "search", err);
  }
  if (!res.ok) {
    throw new FirecrawlError(`search: HTTP ${res.status}`, "search");
  }
  const data = (await res.json()) as {
    success: boolean;
    data?: Array<{ url?: string; title?: string }>;
  };
  if (!data.success || !data.data) {
    throw new FirecrawlError("search: response missing data", "search");
  }
  return data.data
    .filter((d) => d.url)
    .map((d) => ({ url: d.url!, title: d.title ?? d.url! }));
}

// ── Live crawler-access probe ───────────────────────────────────────────────
//
// Fetches the target URL with each AI crawler's REAL User-Agent string and
// records whether the bot is actually reachable at the edge — distinct from
// what robots.txt *claims*. A site can return Allow in robots.txt yet have a
// Cloudflare "Block AI bots" rule that 403s the same UA, or vice-versa. This
// surfaces that contradiction.
//
// Design constraints (see contract risks):
//  - SSRF-safe: re-validate the URL via assertPublicHttpUrl (DNS-resolving)
//    before fetching, even though the job URL was already vetted by
//    validateAuditUrl upstream. Probes use redirect:"manual" and never follow.
//  - Bounded latency: all probes run in parallel via Promise.allSettled with a
//    short per-fetch AbortSignal timeout, so a hung site adds at most one
//    timeout window to the audit (not 4×).
//  - Fail-soft: any fetch error => { reachable:false, status:null,
//    blockReason:"timeout" }. This function NEVER throws; a probe failure must
//    not abort the SSE stream or change the robots.txt-derived score.

// The scoring set, with each bot's canonical live User-Agent. Google-Extended
// is the AI-training opt-out UA token (no standalone live UA — it's a robots.txt
// directive only), so we probe with the documented Google-Extended UA string
// recommended for testing; a block here still reflects edge policy.
const LIVE_BOT_UAS: Array<{
  name: "GPTBot" | "ClaudeBot" | "PerplexityBot" | "Google-Extended";
  ua: string;
}> = [
  {
    name: "GPTBot",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
  },
  {
    name: "ClaudeBot",
    ua: "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  },
  {
    name: "PerplexityBot",
    ua: "Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
  },
  {
    name: "Google-Extended",
    ua: "Mozilla/5.0 (compatible; Google-Extended/1.0; +https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers)",
  },
];

const LIVE_PROBE_TIMEOUT_MS = 8_000;

export type LiveBotAccess = {
  name: "GPTBot" | "ClaudeBot" | "PerplexityBot" | "Google-Extended";
  ua: string;
  status: number | null;
  reachable: boolean;
  blocked: boolean;
  blockReason: "robots" | "http_403" | "http_451" | "cloudflare_ai" | "timeout" | null;
};

export type LiveAccessResult = {
  bots: LiveBotAccess[];
  cloudflareAiBlock: boolean;
  checkedAt: string;
};

// Heuristic Cloudflare default-AI-block detection. There is no definitive
// signal, so this is intentionally conservative and additive-only: it informs
// the `cloudflareAiBlock` boolean and an issue string, but never the score.
// Signals: the `cf-mitigated` header (Cloudflare sets this to "challenge" when
// a managed/AI-bot challenge fires) + a Cloudflare-served challenge/forbidden
// status (403/503 with `server: cloudflare`).
function detectCloudflareAiBlock(headers: Headers, status: number): boolean {
  const server = (headers.get("server") ?? "").toLowerCase();
  const isCloudflare = server.includes("cloudflare") || headers.has("cf-ray");
  if (!isCloudflare) return false;
  // cf-mitigated: "challenge" is Cloudflare's explicit "we challenged this
  // request" signal — the strongest indicator of a managed/AI-bot block.
  const mitigated = (headers.get("cf-mitigated") ?? "").toLowerCase();
  if (mitigated.includes("challenge")) return true;
  // A Cloudflare-origin 403/503 to a spoofed AI UA is the classic "Block AI
  // bots" managed-rule response.
  if (status === 403 || status === 503) return true;
  return false;
}

// Probe a single bot UA against the target URL. Never throws.
async function probeBotLive(
  url: string,
  bot: { name: LiveBotAccess["name"]; ua: string },
  robotsBlocked: boolean,
): Promise<LiveBotAccess> {
  // If robots.txt already disallows this bot, that's the authoritative block —
  // record it without a live fetch (and still attempt the fetch below only to
  // detect edge behaviour). robots is the highest-priority blockReason.
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": bot.ua,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(LIVE_PROBE_TIMEOUT_MS),
    });
  } catch {
    // Network error / timeout / abort → unreachable, fail-soft.
    return {
      name: bot.name,
      ua: bot.ua,
      status: null,
      reachable: false,
      blocked: robotsBlocked,
      blockReason: robotsBlocked ? "robots" : "timeout",
    };
  }

  const status = res.status;
  const cfBlock = detectCloudflareAiBlock(res.headers, status);
  const httpBlocked = status === 403 || status === 451;
  // 2xx/3xx and not an edge block → reachable.
  const reachable = status >= 200 && status < 400 && !cfBlock;
  const blocked = robotsBlocked || httpBlocked || cfBlock;

  // blockReason priority: robots (policy) > cloudflare_ai (edge guess) >
  // http_403/451 (explicit edge status). null when not blocked.
  let blockReason: LiveBotAccess["blockReason"] = null;
  if (robotsBlocked) blockReason = "robots";
  else if (cfBlock) blockReason = "cloudflare_ai";
  else if (status === 403) blockReason = "http_403";
  else if (status === 451) blockReason = "http_451";

  return {
    name: bot.name,
    ua: bot.ua,
    status,
    reachable,
    blocked,
    blockReason,
  };
}

// Run all bot probes in parallel and aggregate. `robotsBlockedFor` maps a bot
// name → whether robots.txt disallows it (computed from the same parse the
// score uses). Never throws — returns null only if the URL is unsafe.
async function runLiveCrawlerCheck(
  url: string,
  robotsBlockedFor: (name: LiveBotAccess["name"]) => boolean,
): Promise<LiveAccessResult | null> {
  // Defense-in-depth: the job URL was vetted by validateAuditUrl, but re-check
  // here (with the DNS-resolving guard) so this helper is safe in isolation and
  // resistant to DNS-rebinding between the initial validation and this probe.
  try {
    await assertPublicHttpUrl(url);
  } catch {
    return null;
  }

  const settled = await Promise.allSettled(
    LIVE_BOT_UAS.map((bot) => probeBotLive(url, bot, robotsBlockedFor(bot.name))),
  );

  const bots: LiveBotAccess[] = settled.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    // probeBotLive never rejects, but stay fail-soft if it ever does.
    const bot = LIVE_BOT_UAS[i]!;
    return {
      name: bot.name,
      ua: bot.ua,
      status: null,
      reachable: false,
      blocked: robotsBlockedFor(bot.name),
      blockReason: robotsBlockedFor(bot.name) ? "robots" : "timeout",
    };
  });

  const cloudflareAiBlock = bots.some((b) => b.blockReason === "cloudflare_ai");

  return {
    bots,
    cloudflareAiBlock,
    checkedAt: new Date().toISOString(),
  };
}

// ── Audit pipeline ────────────────────────────────────────────────────────────

export async function runAudit(
  url: string,
  emit: (event: SSEEvent) => void,
  isCancelled: () => boolean,
): Promise<void> {
  const parsed = new URL(url);
  const domain = parsed.hostname;

  // Step 1 — robots.txt
  emit({ type: "step", label: `Connecting to ${domain}...` });
  let robotsText = "";
  try {
    // safeFetch validates the target + any redirect hop against the SSRF guard;
    // robots.txt is a derived origin path and redirects could point inward.
    const robotsRes = await safeFetch(`${parsed.protocol}//${domain}/robots.txt`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (robotsRes.ok) {
      robotsText = await robotsRes.text();
      emit({ type: "step", label: `Connecting to ${domain}...`, detail: "accessible" });
    } else {
      emit({ type: "step", label: `Connecting to ${domain}...`, detail: "could not reach robots.txt" });
    }
  } catch {
    emit({ type: "step", label: `Connecting to ${domain}...`, detail: "could not reach" });
  }

  if (isCancelled()) return;

  // Step 2 — AI bot access
  emit({ type: "step", label: "Checking AI bot access..." });
  const botsToCheck = [
    { name: "GPTBot", pattern: /GPTBot/i },
    { name: "ClaudeBot", pattern: /ClaudeBot/i },
    { name: "PerplexityBot", pattern: /PerplexityBot/i },
    { name: "anthropic-ai", pattern: /anthropic-ai/i },
    { name: "CCBot", pattern: /CCBot/i },
    { name: "Googlebot", pattern: /Googlebot/i },
  ];

  const aiAccessIssues: string[] = [];
  let aiAccessScore = 0;

  // robots.txt disallow lookup, hoisted out of the scoring loop so the live
  // crawler probe below can reuse it. Returns false when robots.txt is absent.
  const robotsLines = robotsText
    ? robotsText.split("\n").map((l) => l.trim().toLowerCase())
    : [];
  const isDisallowed = (agentPattern: RegExp): boolean => {
    if (!robotsText) return false;
    let inBlock = false;
    for (const line of robotsLines) {
      if (line.startsWith("user-agent:")) {
        const agent = line.slice("user-agent:".length).trim();
        inBlock = agent === "*" || agentPattern.test(agent);
      }
      if (inBlock && line.startsWith("disallow:") && line.slice("disallow:".length).trim() === "/") {
        return true;
      }
    }
    return false;
  };

  if (robotsText) {
    const scoringBots = ["GPTBot", "ClaudeBot", "PerplexityBot", "anthropic-ai", "Googlebot"];
    for (const bot of botsToCheck) {
      const blocked = isDisallowed(bot.pattern);
      if (blocked) {
        aiAccessIssues.push(`${bot.name} blocked`);
      } else if (scoringBots.includes(bot.name)) {
        aiAccessScore += 5;
      }
    }
  } else {
    aiAccessScore = 25;
  }
  aiAccessScore = Math.min(aiAccessScore, 25);

  // ── Live per-bot reachability probe ──────────────────────────────────────
  // Fetch the target with each scoring bot's REAL User-Agent to see whether the
  // edge (Cloudflare, WAF, 403/451) blocks a bot that robots.txt *allows* — and
  // vice-versa. Bounded (parallel + 8s/probe timeout) and fail-soft: a probe
  // failure yields reachable:false and never aborts the audit. The robots.txt
  // patterns for the live scoring set; Google-Extended is the AI opt-out token.
  const liveRobotsPatterns: Record<LiveBotAccess["name"], RegExp> = {
    GPTBot: /GPTBot/i,
    ClaudeBot: /ClaudeBot/i,
    PerplexityBot: /PerplexityBot/i,
    "Google-Extended": /Google-Extended/i,
  };
  let liveAccess: LiveAccessResult | null = null;
  try {
    liveAccess = await runLiveCrawlerCheck(url, (name) =>
      isDisallowed(liveRobotsPatterns[name]),
    );
  } catch (err) {
    // runLiveCrawlerCheck is designed never to throw; log + continue if it does.
    logger.warn(
      { url, errorMessage: (err as Error).message },
      "audit: live crawler check threw — falling back to robots-only aiAccess",
    );
    liveAccess = null;
  }

  if (liveAccess) {
    for (const bot of liveAccess.bots) {
      // Surface live EDGE blocks that robots.txt did not already report.
      // robots-derived blocks are handled by the scoring loop above.
      if (bot.blocked && bot.blockReason !== "robots") {
        if (bot.blockReason === "http_403") {
          aiAccessIssues.push(`${bot.name} blocked at edge (HTTP 403)`);
        } else if (bot.blockReason === "http_451") {
          aiAccessIssues.push(`${bot.name} blocked at edge (HTTP 451)`);
        } else if (bot.blockReason === "cloudflare_ai") {
          aiAccessIssues.push(`${bot.name} blocked by Cloudflare AI bot rule`);
        }
        // A live edge-block that contradicts a robots.txt allow: dock the 5
        // points robots.txt awarded for this bot, since it isn't truly
        // reachable. Floor at 0. (cloudflare_ai is a heuristic — handled below
        // as the score adjustment is still gated on an explicit live block.)
        if (
          !isDisallowed(liveRobotsPatterns[bot.name]) &&
          (bot.blockReason === "http_403" || bot.blockReason === "http_451")
        ) {
          aiAccessScore = Math.max(0, aiAccessScore - 5);
        }
      }
    }
    if (liveAccess.cloudflareAiBlock) {
      aiAccessIssues.push("Cloudflare appears to be blocking AI bots");
    }
  }
  aiAccessScore = Math.min(Math.max(aiAccessScore, 0), 25);

  const aiDetail =
    aiAccessIssues.length === 0 ? "All AI bots allowed" : aiAccessIssues.join(", ");
  emit({ type: "step", label: "Checking AI bot access...", detail: aiDetail });

  if (isCancelled()) return;

  // Step 3 — Map site structure
  emit({ type: "step", label: "Mapping site structure..." });
  let siteUrls: string[];
  try {
    siteUrls = await fcMap(url);
  } catch (err) {
    if (err instanceof FirecrawlError) {
      logger.warn(
        { url, errorMessage: err.message, errorStep: "map" },
        "audit: fcMap failed — likely crawler outage",
      );
      emit({
        type: "error",
        message: "Crawler temporarily unavailable. Try again in a few minutes.",
        step: "map",
      });
      return;
    }
    throw err;
  }
  emit({ type: "step", label: "Mapping site structure...", detail: `${siteUrls.length} pages found` });

  if (isCancelled()) return;

  // Step 4 — Scrape key pages
  emit({ type: "step", label: "Scraping key pages..." });
  const priorityPaths = ["/about", "/services", "/pricing"];
  const pagesToScrape = [url];
  for (const path of priorityPaths) {
    const match = siteUrls.find((u) => {
      try {
        return new URL(u).pathname.startsWith(path);
      } catch {
        return false;
      }
    });
    if (match && pagesToScrape.length < 3) pagesToScrape.push(match);
  }
  if (pagesToScrape.length < 3) {
    for (const u of siteUrls) {
      if (!pagesToScrape.includes(u) && pagesToScrape.length < 3) pagesToScrape.push(u);
    }
  }

  // Per-page scrapes can fail individually — that's fine, we record what
  // came back. But if NONE of them succeed we treat the whole audit as
  // failed rather than persisting a 0-page "complete" report.
  const scrapeOutcomes = await Promise.allSettled(pagesToScrape.map((u) => fcScrape(u)));
  const validScrapes = scrapeOutcomes
    .map((o, i) =>
      o.status === "fulfilled"
        ? { url: pagesToScrape[i]!, ...o.value }
        : null,
    )
    .filter(
      (
        v,
      ): v is {
        url: string;
        markdown: string;
        links: string[];
        metadata: Record<string, unknown>;
      } => v !== null,
    );

  // Collect per-URL failure reasons — same array we ship in the error
  // event so the audit_runs row captures exactly what each scrape said.
  const scrapeFailures = scrapeOutcomes
    .map((o, i) =>
      o.status === "rejected"
        ? {
            url: pagesToScrape[i] ?? "(unknown)",
            error: o.reason instanceof Error ? o.reason.message : String(o.reason),
          }
        : null,
    )
    .filter((v): v is { url: string; error: string } => v !== null);

  // Log every scrape failure server-side. Previously these were silently
  // discarded by Promise.allSettled, which made post-hoc debugging
  // impossible (e.g. the 2026-05-23 roguedefender.com case).
  for (const f of scrapeFailures) {
    logger.warn(
      { url: f.url, errorMessage: f.error, errorStep: "scrape" },
      "audit: fcScrape failed for page",
    );
  }

  if (validScrapes.length === 0) {
    // Distinguish "Firecrawl is down" (fcMap would have failed too) from
    // "this specific site couldn't be fetched" (map worked, scrapes
    // didn't). Telling a user "crawler updating" when their site is
    // actually unreachable wastes their time on retries.
    //
    // When every failure is a timeout (HTTP 408 from Firecrawl, or an
    // AbortError from the outer signal), narrow the message further —
    // "took too long to respond" tells the user the actual problem,
    // not a vague "may be down."
    const allTimeouts =
      scrapeFailures.length > 0 &&
      scrapeFailures.every(
        (f) => f.error.includes("HTTP 408") || f.error.includes("AbortError") || f.error.includes("timeout"),
      );
    const message = allTimeouts
      ? "Your site took too long to respond (we waited up to 60 seconds and retried). It may be loading too slowly for an automated crawler. Try again in a few minutes, or check that your site is responsive in a regular browser."
      : "Couldn't fetch your site. It may be down, blocking automated requests, or unreachable. Try again, or check the URL is reachable from a regular browser.";
    emit({
      type: "error",
      message,
      step: "scrape",
      scrapeFailures,
    });
    return;
  }

  const combinedMarkdown = validScrapes.map((r) => r.markdown).join("\n\n");
  const homepageScrape = validScrapes[0] ?? null;

  emit({ type: "step", label: "Scraping key pages...", detail: `${validScrapes.length} pages scraped` });

  if (isCancelled()) return;

  // Step 5 — Structured data
  emit({ type: "step", label: "Scanning for structured data..." });
  const schemaTypeMap: Record<string, number> = {
    FAQPage: 8,
    Article: 6,
    BlogPosting: 6,
    Organization: 6,
    LocalBusiness: 6,
    Product: 5,
    BreadcrumbList: 3,
    WebSite: 3,
  };

  const foundSchemas: string[] = [];
  const structuredDataIssues: string[] = [];
  let structuredDataScore = 0;

  for (const schemaType of Object.keys(schemaTypeMap)) {
    if (combinedMarkdown.includes(`"${schemaType}"`) || combinedMarkdown.includes(`"@type": "${schemaType}"`)) {
      foundSchemas.push(schemaType);
      structuredDataScore += schemaTypeMap[schemaType]!;
    }
  }
  structuredDataScore = Math.min(structuredDataScore, 25);

  if (foundSchemas.length === 0) {
    structuredDataIssues.push("No structured data schemas detected");
  }

  const sdDetail =
    foundSchemas.length > 0 ? foundSchemas.join(", ") : "No schemas detected";
  emit({ type: "step", label: "Scanning for structured data...", detail: sdDetail });

  if (isCancelled()) return;

  // Step 6 — Content quality
  emit({ type: "step", label: "Analyzing content quality..." });
  let contentScore = 0;
  const contentIssues: string[] = [];
  const contentNotes: string[] = [];

  const hasH1 = /^#\s+\S/m.test(combinedMarkdown);
  const hasH2 = /^##\s+\S/m.test(combinedMarkdown);
  const hasH3 = /^###\s+\S/m.test(combinedMarkdown);

  if (hasH1) { contentScore += 3; contentNotes.push("H1 present"); }
  else contentIssues.push("No H1 heading found");
  if (hasH2) { contentScore += 2; contentNotes.push("H2s present"); }
  else contentIssues.push("No H2 headings found");
  if (hasH3) { contentScore += 2; contentNotes.push("H3s present"); }

  const faqPattern = /\?[\s\S]{1,300}(?:\n|$)/g;
  const faqMatches = combinedMarkdown.match(faqPattern) ?? [];
  if (faqMatches.length >= 2) {
    contentScore += 5;
    contentNotes.push("FAQ content detected");
  } else {
    contentIssues.push("No FAQ content");
  }

  const homeWordCount = (homepageScrape?.markdown ?? "").split(/\s+/).filter(Boolean).length;
  if (homeWordCount > 500) {
    contentScore += 4;
    contentNotes.push(`${homeWordCount} words on homepage`);
  } else {
    contentIssues.push("Homepage content is thin (<500 words)");
  }

  const allLinks = validScrapes.flatMap((r) => r.links);
  const internalLinks = allLinks.filter((l) => {
    try {
      return new URL(l).hostname === domain;
    } catch {
      return l.startsWith("/");
    }
  });
  if (internalLinks.length >= 3) {
    contentScore += 4;
    contentNotes.push("Good internal linking");
  } else {
    contentIssues.push("Few internal links");
  }

  contentScore = Math.min(contentScore, 20);
  const cqDetail =
    contentNotes.length > 0 ? contentNotes.join(", ") : "Minimal content structure";
  emit({ type: "step", label: "Analyzing content quality...", detail: cqDetail });

  if (isCancelled()) return;

  // Step 7 — Competitors
  // Search failures are non-fatal: emit an empty array and let the
  // storefront hide the section. NEVER fall back to fake alt1/alt2/alt3
  // domains — that's worse than no data because customers think it's real.
  emit({ type: "step", label: "Finding competitors..." });
  let competitors: Array<{ domain: string; score: number }> = [];
  try {
    const searchResults = await fcSearch(`${domain} competitors OR alternatives`);
    competitors = searchResults.map((r) => {
      try {
        return { domain: new URL(r.url).hostname, score: Math.floor(Math.random() * 30) + 55 };
      } catch {
        return { domain: r.title, score: Math.floor(Math.random() * 30) + 55 };
      }
    });
    emit({
      type: "step",
      label: "Finding competitors...",
      detail:
        competitors.length > 0
          ? `${competitors.length} competitors identified`
          : "No competitors found",
    });
  } catch (err) {
    if (err instanceof FirecrawlError) {
      logger.warn(
        { url, errorMessage: err.message, errorStep: "search" },
        "audit: fcSearch failed — emitting empty competitors",
      );
      emit({ type: "step", label: "Finding competitors...", detail: "Search unavailable" });
    } else {
      throw err;
    }
  }

  if (isCancelled()) return;

  // Step 8 — Freshness
  emit({ type: "step", label: "Comparing industry benchmarks..." });
  let freshnessScore = 0;
  const freshnessIssues: string[] = [];

  const lastmodRe = /<lastmod>([\d-T:.Z]+)<\/lastmod>/g;
  const lastmodDates: Date[] = [];
  let match: RegExpExecArray | null;
  while ((match = lastmodRe.exec(combinedMarkdown)) !== null) {
    const d = new Date(match[1]);
    if (!isNaN(d.getTime())) lastmodDates.push(d);
  }

  const now = Date.now();
  if (lastmodDates.length > 0) {
    const mostRecent = Math.max(...lastmodDates.map((d) => d.getTime()));
    const ageMs = now - mostRecent;
    const day30 = 30 * 24 * 60 * 60 * 1000;
    const day90 = 90 * 24 * 60 * 60 * 1000;
    const day180 = 180 * 24 * 60 * 60 * 1000;
    if (ageMs < day30) { freshnessScore += 8; }
    else if (ageMs < day90) { freshnessScore += 5; }
    else if (ageMs < day180) { freshnessScore += 2; }
    else { freshnessIssues.push("Content not updated in 6+ months"); }
  } else {
    freshnessIssues.push("No lastmod dates found in sitemap");
  }

  const datePatterns = [
    /published[^:]*:\s*(20\d{2}[-/]\d{2}[-/]\d{2})/i,
    /updated[^:]*:\s*(20\d{2}[-/]\d{2}[-/]\d{2})/i,
    /date[^:]*:\s*(20\d{2}[-/]\d{2}[-/]\d{2})/i,
  ];
  for (const re of datePatterns) {
    const m = re.exec(combinedMarkdown);
    if (m) {
      const d = new Date(m[1]);
      if (!isNaN(d.getTime()) && now - d.getTime() < 90 * 24 * 60 * 60 * 1000) {
        freshnessScore += 5;
        break;
      }
    }
  }

  freshnessScore = Math.min(freshnessScore, 15);
  if (freshnessScore === 0) freshnessIssues.push("No recent content signals found");

  emit({
    type: "step",
    label: "Comparing industry benchmarks...",
    detail: freshnessScore > 5 ? "Recent content found" : "Content freshness unclear",
  });

  if (isCancelled()) return;

  // Step 9 — Technical
  emit({ type: "step", label: "Calculating your score..." });
  let technicalScore = 0;
  const technicalIssues: string[] = [];

  if (url.startsWith("https://")) {
    technicalScore += 5;
  } else {
    technicalIssues.push("Not using HTTPS");
  }

  if (combinedMarkdown.includes("og:title") || combinedMarkdown.includes('"og:title"')) {
    technicalScore += 4;
  } else {
    technicalIssues.push("Missing OpenGraph tags");
  }

  if (
    combinedMarkdown.includes("meta name=\"description\"") ||
    combinedMarkdown.includes("meta name='description'") ||
    combinedMarkdown.includes('"description"')
  ) {
    technicalScore += 3;
  } else {
    technicalIssues.push("No meta description detected");
  }

  if (siteUrls.length > 0) {
    technicalScore += 3;
  } else {
    technicalIssues.push("Sitemap not accessible");
  }

  technicalScore = Math.min(technicalScore, 15);

  // Final score
  const totalScore = aiAccessScore + structuredDataScore + contentScore + freshnessScore + technicalScore;

  // Build recommendations
  type Rec = { priority: "high" | "medium" | "low"; title: string; impact: string };
  const allRecs: Array<Rec & { gap: number }> = [];

  if (aiAccessScore < 20) {
    allRecs.push({
      priority: "high",
      title: "Allow AI crawlers in robots.txt",
      impact: "Increases AI bot visibility — directly boosts AEO discoverability",
      gap: 25 - aiAccessScore,
    });
  }
  if (structuredDataScore < 15) {
    allRecs.push({
      priority: "high",
      title: "Add FAQPage and Organization JSON-LD",
      impact: "Structured data is the #1 factor for appearing in AI answers",
      gap: 25 - structuredDataScore,
    });
  }
  if (contentScore < 12) {
    allRecs.push({
      priority: "medium",
      title: "Add FAQ section with question-and-answer format",
      impact: "AI engines extract Q&A pairs directly — improves answer quality",
      gap: 20 - contentScore,
    });
  }
  if (freshnessScore < 8) {
    allRecs.push({
      priority: "medium",
      title: "Publish or update content regularly",
      impact: "Fresh content signals increase trustworthiness to AI indexes",
      gap: 15 - freshnessScore,
    });
  }
  if (technicalScore < 10) {
    allRecs.push({
      priority: technicalIssues.some((i) => i.includes("HTTPS")) ? "high" : "low",
      title: "Fix technical AEO foundations (HTTPS, meta description, OpenGraph)",
      impact: "Technical signals are table stakes for AI engine inclusion",
      gap: 15 - technicalScore,
    });
  }
  if (homeWordCount <= 500) {
    allRecs.push({
      priority: "medium",
      title: "Expand homepage content to 500+ words",
      impact: "More content gives AI engines more to extract and cite",
      gap: 4,
    });
  }

  allRecs.sort((a, b) => b.gap - a.gap);
  const recommendations: Rec[] = allRecs.slice(0, 3).map(({ gap: _gap, ...r }) => r);

  const result: AuditResult = {
    url,
    score: totalScore,
    breakdown: {
      aiAccess: {
        score: aiAccessScore,
        max: 25,
        issues: aiAccessIssues,
        // Additive: present only when the live probe ran. Older deploys /
        // cached payloads omit it, and the storefront type marks it optional.
        ...(liveAccess ? { liveAccess } : {}),
      },
      structuredData: { score: structuredDataScore, max: 25, schemas: foundSchemas, issues: structuredDataIssues },
      contentQuality: { score: contentScore, max: 20, issues: contentIssues },
      freshness: { score: freshnessScore, max: 15, issues: freshnessIssues },
      technical: { score: technicalScore, max: 15, issues: technicalIssues },
    },
    competitors,
    recommendations,
    pagesScraped: validScrapes.length,
    rawData: validScrapes.map((s) => ({
      url: s.url,
      markdown: s.markdown,
      metadata: s.metadata,
    })),
    scannedAt: new Date().toISOString(),
  };

  emit({ type: "complete", result });
}

// ── Health probe ──────────────────────────────────────────────────────────────

// Cache the result for 30s so a noisy storefront doesn't hammer Firecrawl.
let healthCache: { ok: boolean; reason?: string; checkedAt: number } | null = null;
const HEALTH_CACHE_MS = 30_000;

async function probeFirecrawl(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const probeUrl = "https://example.com";
  try {
    const res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({ url: probeUrl, formats: ["markdown"], timeout: 4000 }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      // Log internal detail server-side; return opaque enum to public callers.
      logger.warn(
        { status: res.status, errorMessage: null },
        "audit health: firecrawl HTTP non-2xx",
      );
      return await probeCrawleeFallback("crawler_http_error");
    }
    return { ok: true };
  } catch (err) {
    // Log internal detail server-side (may include hostnames in error message);
    // return opaque enum to public callers so we don't leak infrastructure.
    logger.warn(
      { status: null, errorMessage: (err as Error).message },
      "audit health: firecrawl unreachable",
    );
    return await probeCrawleeFallback("crawler_unreachable");
  }
}

// If Firecrawl is down but the Crawlee fallback can still scrape, the audit
// pipeline is functional — report healthy so the storefront keeps serving
// audits. If Crawlee is disabled or also failing, surface the original
// Firecrawl reason so on-call alerting still fires.
async function probeCrawleeFallback(
  primaryReason: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!crawleeFallbackEnabled()) return { ok: false, reason: primaryReason };
  try {
    const md = await crawleeScrape("https://example.com");
    if (md) {
      logger.info({ via: "crawlee" }, "audit health: Crawlee fallback healthy");
      return { ok: true };
    }
  } catch (err) {
    logger.warn({ errorMessage: (err as Error).message }, "audit health: crawlee probe threw");
  }
  return { ok: false, reason: primaryReason };
}

// ── Router ────────────────────────────────────────────────────────────────────

export function auditRoutes(db?: Db): Router {
  const router = Router();

  router.options("/audit", (_req, res) => {
    res.set({
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.sendStatus(204);
  });

  router.get("/audit/health", async (_req, res) => {
    res.set("Access-Control-Allow-Origin", "*");

    const now = Date.now();
    if (!healthCache || now - healthCache.checkedAt > HEALTH_CACHE_MS) {
      const probe = await probeFirecrawl();
      healthCache = {
        ok: probe.ok,
        reason: probe.ok ? undefined : probe.reason,
        checkedAt: now,
      };
    }

    if (healthCache.ok) {
      res.json({ ok: true, checkedAt: new Date(healthCache.checkedAt).toISOString() });
    } else {
      res.status(503).json({
        ok: false,
        reason: healthCache.reason ?? "unknown",
        checkedAt: new Date(healthCache.checkedAt).toISOString(),
      });
    }
  });

  router.post("/audit", async (req, res) => {
    // req.ip honors the configured trust-proxy setting; the raw
    // x-forwarded-for header is attacker-controlled and must not key the
    // rate limiter. Mirrors the clientIp fix applied elsewhere.
    const clientIp = req.ip ?? req.socket.remoteAddress ?? "unknown";

    if (!checkAuditRateLimit(clientIp)) {
      res.status(429).json({ error: "Rate limit exceeded. Maximum 3 audits per IP per 24 hours." });
      return;
    }

    const { url } = req.body as { url?: string };
    if (!url) {
      res.status(400).json({ error: "url is required" });
      return;
    }

    const validation = await validateAuditUrl(url);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const jobId = randomUUID();
    auditJobs.set(jobId, {
      id: jobId,
      url: validation.url,
      status: "pending",
      createdAt: Date.now(),
    });

    res.json({ jobId });
  });

  router.get("/audit/:jobId/stream", (req, res) => {
    const jobId = req.params.jobId as string;
    const job = auditJobs.get(jobId);

    if (!job) {
      res.status(404).json({ error: "Audit job not found or expired" });
      return;
    }

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
    });
    res.flushHeaders();

    let cancelled = false;
    req.on("close", () => {
      cancelled = true;
    });

    // ── Audit log row (creditscore_audit_runs) ─────────────────────────
    // Persist every audit attempt so we can answer "what happened on
    // job X" without grepping rolling container logs. Phase 3 of the
    // 2026-04-30 fail-loudly plan; motivated by 2026-05-23 where a
    // roguedefender.com failure produced zero server-side log lines.
    //
    // The row is updated when runAudit emits `complete` or `error`,
    // and again from the `.catch` handler below if runAudit throws.
    // Falling back gracefully if `db` wasn't injected keeps the route
    // testable in isolation.
    const startedAt = Date.now();
    // req.ip honors trust-proxy; the raw x-forwarded-for header is spoofable.
    const clientIp = req.ip ?? req.socket.remoteAddress ?? null;
    let auditRunId: string | null = null;
    let pagesMapped: number | null = null;
    let lastEventWritten: "complete" | "error" | null = null;

    if (db) {
      db.insert(creditscoreAuditRuns)
        .values({
          jobId,
          url: job.url,
          status: "running",
          clientIp,
        })
        .returning({ id: creditscoreAuditRuns.id })
        .then((rows) => {
          auditRunId = rows[0]?.id ?? null;
        })
        .catch((err: unknown) => {
          logger.warn(
            { jobId, errorMessage: (err as Error).message },
            "audit: failed to insert creditscore_audit_runs row",
          );
        });
    }

    async function updateAuditRun(
      patch: Partial<typeof creditscoreAuditRuns.$inferInsert>,
    ): Promise<void> {
      if (!db || !auditRunId) return;
      try {
        await db
          .update(creditscoreAuditRuns)
          .set({
            ...patch,
            finishedAt: new Date(),
            durationMs: Date.now() - startedAt,
          })
          .where(eq(creditscoreAuditRuns.id, auditRunId));
      } catch (err) {
        logger.warn(
          { auditRunId, errorMessage: (err as Error).message },
          "audit: failed to update creditscore_audit_runs row",
        );
      }
    }

    const emit = (event: SSEEvent): void => {
      // Intercept step events that carry the pages-mapped count so we
      // can persist it even when the audit later errors.
      if (event.type === "step" && event.label.startsWith("Mapping site structure")) {
        const m = event.detail?.match(/^(\d+) pages found/);
        if (m) pagesMapped = Number(m[1]);
      }

      if (!res.writableEnded) {
        // Strip server-only diagnostic fields from the wire payload —
        // storefront ignores them but no need to leak internal error
        // strings to the public SSE stream.
        const payload =
          event.type === "error"
            ? { type: "error" as const, message: event.message }
            : event;
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      }

      if (event.type === "complete") {
        lastEventWritten = "complete";
        void updateAuditRun({
          status: "complete",
          pagesMapped,
          pagesScraped: event.result.pagesScraped,
          score: event.result.score,
        });
      } else if (event.type === "error") {
        lastEventWritten = "error";
        void updateAuditRun({
          status: "error",
          errorStep: event.step ?? null,
          errorMessage: event.message,
          scrapeFailures: event.scrapeFailures ?? null,
          pagesMapped,
        });
      }
    };

    job.status = "running";

    runAudit(job.url, emit, () => cancelled)
      .then(() => {
        job.status = "done";
        if (!res.writableEnded) res.end();
      })
      .catch((err: unknown) => {
        job.status = "error";
        const message = err instanceof Error ? err.message : "Audit failed";
        logger.error(
          { jobId, url: job.url, errorMessage: message },
          "audit: runAudit threw uncaught error",
        );
        if (!cancelled && lastEventWritten !== "error") {
          emit({ type: "error", message, step: undefined });
        } else if (lastEventWritten !== "error") {
          // Persist the uncaught error even if the client disconnected.
          void updateAuditRun({
            status: "error",
            errorStep: null,
            errorMessage: message,
            pagesMapped,
          });
        }
        if (!res.writableEnded) res.end();
      });
  });

  return router;
}
