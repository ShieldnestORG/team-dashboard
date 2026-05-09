// ---------------------------------------------------------------------------
// llms.txt + agents.json generator service
//
// One-shot generator: given a customer domain, discover its sitemap, crawl
// up to N pages, summarize each, emit `llms.txt` + `llms-full.txt` +
// `agents.json` per the GEO-tactics roadmap row "(a) email + portal
// download" surface.
//
// Runs async (fire-and-forget) on the local node — no external queue
// infrastructure exists in this repo (checked: no bullmq/sqs/temporal in
// package.json). The route writes the queued job, fires generation in the
// background, and returns the jobId immediately. If the process restarts
// mid-job, the row stays in `crawling`/`generating` and a future cleanup
// cron can mark it failed; not in scope here.
//
// Spec reference: https://llmstxt.org/ (the proposed standard)
// agents.json reference: https://github.com/wellknown/agents.json (early
// draft — minimal compliant skeleton until the spec stabilizes).
// ---------------------------------------------------------------------------

import { eq } from "drizzle-orm";
import { JSDOM } from "jsdom";
import type { Db } from "@paperclipai/db";
import { llmsTxtJobs, llmsTxtOutputs } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

const DEFAULT_MAX_PAGES = 500;
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_FETCH_CONCURRENCY = 4;
const USER_AGENT =
  "CoherenceDaddy-llms-txt-generator/0.1 (+https://coherencedaddy.com/llms-txt)";

export interface GenerateOptions {
  sitemapUrl?: string;
  accountId?: string;
  maxPages?: number;
}

export interface GenerateResult {
  jobId: string;
}

interface PageRecord {
  url: string;
  title: string;
  description: string;
  h1: string;
  /** First ~600 chars of stripped body text — used for llms-full.txt */
  bodySnippet: string;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function llmsTxtGenerator(db: Db) {
  async function generateForDomain(
    rawDomain: string,
    opts: GenerateOptions = {},
  ): Promise<GenerateResult> {
    const domain = normalizeDomain(rawDomain);
    if (!domain) {
      throw new Error("Invalid domain");
    }

    const [job] = await db
      .insert(llmsTxtJobs)
      .values({
        accountId: opts.accountId,
        domain,
        status: "queued",
        inputSitemapUrl: opts.sitemapUrl,
      })
      .returning({ id: llmsTxtJobs.id });

    const jobId = job.id;
    const maxPages = opts.maxPages ?? DEFAULT_MAX_PAGES;

    // Fire-and-forget. Errors are caught and persisted to the job row.
    void runJob(db, jobId, domain, opts.sitemapUrl, maxPages).catch((err) => {
      logger.error({ err, jobId, domain }, "llms-txt-generator: unhandled job error");
    });

    return { jobId };
  }

  return { generateForDomain };
}

// ---------------------------------------------------------------------------
// Job runner (exported for testing)
// ---------------------------------------------------------------------------

export async function runJob(
  db: Db,
  jobId: string,
  domain: string,
  sitemapHint: string | undefined,
  maxPages: number,
): Promise<void> {
  try {
    await db
      .update(llmsTxtJobs)
      .set({ status: "crawling" })
      .where(eq(llmsTxtJobs.id, jobId));

    const sitemapUrl = sitemapHint ?? (await resolveSitemap(domain));
    if (!sitemapUrl) {
      throw new Error(
        `No sitemap discovered. Tried ${domain}/sitemap.xml, /sitemap_index.xml, /robots.txt.`,
      );
    }

    const urls = await collectUrlsFromSitemap(sitemapUrl, maxPages);
    if (urls.length === 0) {
      throw new Error("Sitemap parsed but contained zero URLs");
    }

    await db
      .update(llmsTxtJobs)
      .set({ status: "generating" })
      .where(eq(llmsTxtJobs.id, jobId));

    const pages = await crawlPages(urls);
    if (pages.length === 0) {
      throw new Error("All page fetches failed");
    }

    const outputs = buildOutputs(domain, pages);

    await db.insert(llmsTxtOutputs).values({
      jobId,
      llmsTxt: outputs.llmsTxt,
      llmsFullTxt: outputs.llmsFullTxt,
      agentsJson: outputs.agentsJson,
      pageCount: pages.length,
    });

    await db
      .update(llmsTxtJobs)
      .set({ status: "complete", completedAt: new Date() })
      .where(eq(llmsTxtJobs.id, jobId));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ jobId, domain, err }, "llms-txt-generator: job failed");
    await db
      .update(llmsTxtJobs)
      .set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date() })
      .where(eq(llmsTxtJobs.id, jobId));
  }
}

// ---------------------------------------------------------------------------
// Domain + sitemap resolution
// ---------------------------------------------------------------------------

export function normalizeDomain(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let urlString = trimmed;
  if (!/^https?:\/\//i.test(urlString)) urlString = `https://${urlString}`;
  try {
    const u = new URL(urlString);
    // Strip path + query — we want just the origin.
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

export async function resolveSitemap(domain: string): Promise<string | null> {
  // 1. Try /sitemap.xml
  const candidate1 = `${domain}/sitemap.xml`;
  if (await urlExists(candidate1)) return candidate1;

  // 2. Try /sitemap_index.xml
  const candidate2 = `${domain}/sitemap_index.xml`;
  if (await urlExists(candidate2)) return candidate2;

  // 3. Parse /robots.txt for Sitemap: directive
  const robotsUrl = `${domain}/robots.txt`;
  const robotsText = await fetchTextSafe(robotsUrl);
  if (robotsText) {
    const sitemap = extractSitemapFromRobots(robotsText);
    if (sitemap) return sitemap;
  }

  return null;
}

export function extractSitemapFromRobots(robotsText: string): string | null {
  const match = robotsText.match(/^\s*Sitemap:\s*(\S+)/im);
  return match ? match[1].trim() : null;
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(url, { method: "HEAD" });
    if (res.ok) return true;
    // Some servers reject HEAD; fall back to a tiny GET.
    if (res.status === 405 || res.status === 501) {
      const getRes = await fetchWithTimeout(url, { method: "GET" });
      return getRes.ok;
    }
    return false;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Sitemap parsing
// ---------------------------------------------------------------------------

export async function collectUrlsFromSitemap(
  sitemapUrl: string,
  maxPages: number,
  visited: Set<string> = new Set(),
): Promise<string[]> {
  if (visited.has(sitemapUrl)) return [];
  visited.add(sitemapUrl);

  const xml = await fetchTextSafe(sitemapUrl);
  if (!xml) return [];

  const trimmed = xml.trim();
  // Sitemap-index recursion. Detect by presence of a root <sitemapindex> tag.
  if (/<sitemapindex[\s>]/i.test(trimmed)) {
    const childSitemaps = extractTagValues(trimmed, "sitemap", "loc");
    const collected: string[] = [];
    for (const child of childSitemaps) {
      if (collected.length >= maxPages) break;
      const childUrls = await collectUrlsFromSitemap(child, maxPages - collected.length, visited);
      for (const u of childUrls) {
        collected.push(u);
        if (collected.length >= maxPages) break;
      }
    }
    return collected;
  }

  // Plain urlset.
  return extractTagValues(trimmed, "url", "loc").slice(0, maxPages);
}

/**
 * Pull all `<innerTag>VALUE</innerTag>` values that occur inside any
 * `<wrapperTag>...</wrapperTag>` block. Hand-rolled because we don't have
 * an XML parser dep — sitemap XML is regular enough for this to work
 * reliably across Yoast, RankMath, Webflow, Shopify, custom emitters.
 */
export function extractTagValues(xml: string, wrapperTag: string, innerTag: string): string[] {
  const wrapperRe = new RegExp(`<${wrapperTag}\\b[^>]*>([\\s\\S]*?)</${wrapperTag}>`, "gi");
  const innerRe = new RegExp(`<${innerTag}\\b[^>]*>([\\s\\S]*?)</${innerTag}>`, "i");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = wrapperRe.exec(xml)) !== null) {
    const inner = m[1].match(innerRe);
    if (inner) {
      const value = decodeXmlEntities(inner[1].trim());
      if (value) results.push(value);
    }
  }
  return results;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ---------------------------------------------------------------------------
// Page crawling
// ---------------------------------------------------------------------------

async function crawlPages(urls: string[]): Promise<PageRecord[]> {
  const results: PageRecord[] = [];
  // Simple bounded-concurrency pool; no p-limit dep available.
  for (let i = 0; i < urls.length; i += PAGE_FETCH_CONCURRENCY) {
    const slice = urls.slice(i, i + PAGE_FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(slice.map((u) => fetchAndParsePage(u)));
    for (const r of settled) {
      if (r.status === "fulfilled" && r.value) results.push(r.value);
    }
  }
  return results;
}

export async function fetchAndParsePage(url: string): Promise<PageRecord | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("text/html") && !ct.includes("application/xhtml")) return null;
    const html = await res.text();
    return parsePage(url, html);
  } catch {
    return null;
  }
}

export function parsePage(url: string, html: string): PageRecord {
  // jsdom is heavyweight but we already use it elsewhere in the server.
  // No `runScripts` so we don't execute any page JS — just a DOM tree.
  const dom = new JSDOM(html);
  const doc = dom.window.document;

  const title = (doc.querySelector("title")?.textContent ?? "").trim().replace(/\s+/g, " ");
  const descMeta = doc.querySelector('meta[name="description"]') as HTMLMetaElement | null;
  const ogDescMeta = doc.querySelector('meta[property="og:description"]') as HTMLMetaElement | null;
  const description = (descMeta?.content ?? ogDescMeta?.content ?? "").trim().replace(/\s+/g, " ");
  const h1 = (doc.querySelector("h1")?.textContent ?? "").trim().replace(/\s+/g, " ");

  // Strip script/style for body snippet.
  doc.querySelectorAll("script,style,noscript").forEach((n) => n.remove());
  const bodyText = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();

  return {
    url,
    title: title || h1 || urlToTitle(url),
    description: description.slice(0, 200),
    h1,
    bodySnippet: bodyText.slice(0, 600),
  };
}

function urlToTitle(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1] ?? u.hostname;
    return last.replace(/[-_]/g, " ").replace(/\.(html?|php|aspx?)$/i, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Output assembly (llmstxt.org format)
// ---------------------------------------------------------------------------

export interface BuiltOutputs {
  llmsTxt: string;
  llmsFullTxt: string;
  agentsJson: string;
}

export function buildOutputs(domain: string, pages: PageRecord[]): BuiltOutputs {
  const siteName = hostnameOf(domain);
  // Pick the homepage (or shortest path) page to source the site description.
  const homepage =
    pages.find((p) => isHomepage(p.url)) ??
    [...pages].sort((a, b) => a.url.length - b.url.length)[0];
  const siteDescription =
    (homepage?.description || homepage?.bodySnippet || "").slice(0, 240) ||
    `Pages from ${siteName}.`;

  const groups = groupPagesByPrefix(pages, domain);

  // ---- llms.txt ----
  const llmsLines: string[] = [];
  llmsLines.push(`# ${siteName}`);
  llmsLines.push("");
  llmsLines.push(`> ${siteDescription}`);
  llmsLines.push("");
  for (const [groupName, groupPages] of Object.entries(groups)) {
    llmsLines.push(`## ${groupName}`);
    llmsLines.push("");
    for (const p of groupPages) {
      const desc = (p.description || p.h1 || "").slice(0, 160);
      llmsLines.push(`- [${escapeMd(p.title)}](${p.url})${desc ? `: ${escapeMd(desc)}` : ""}`);
    }
    llmsLines.push("");
  }
  const llmsTxt = llmsLines.join("\n").trimEnd() + "\n";

  // ---- llms-full.txt ----
  const fullLines: string[] = [];
  fullLines.push(`# ${siteName}`);
  fullLines.push("");
  fullLines.push(`> ${siteDescription}`);
  fullLines.push("");
  for (const [groupName, groupPages] of Object.entries(groups)) {
    fullLines.push(`## ${groupName}`);
    fullLines.push("");
    for (const p of groupPages) {
      fullLines.push(`### ${escapeMd(p.title)}`);
      fullLines.push("");
      fullLines.push(`URL: ${p.url}`);
      if (p.description) fullLines.push(`Description: ${p.description}`);
      if (p.h1 && p.h1 !== p.title) fullLines.push(`H1: ${p.h1}`);
      if (p.bodySnippet) {
        fullLines.push("");
        fullLines.push(p.bodySnippet);
      }
      fullLines.push("");
    }
  }
  const llmsFullTxt = fullLines.join("\n").trimEnd() + "\n";

  // ---- agents.json (minimal compliant skeleton) ----
  const agents = {
    name: siteName,
    version: "0.1",
    endpoints: [] as unknown[],
    "x-llms-txt": `${domain}/llms.txt`,
    "x-llms-full-txt": `${domain}/llms-full.txt`,
    "x-generated-by": "coherencedaddy.com llms.txt generator",
    "x-page-count": pages.length,
  };
  const agentsJson = JSON.stringify(agents, null, 2) + "\n";

  return { llmsTxt, llmsFullTxt, agentsJson };
}

function isHomepage(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname === "/" || u.pathname === "";
  } catch {
    return false;
  }
}

function hostnameOf(domain: string): string {
  try {
    return new URL(domain).hostname;
  } catch {
    return domain;
  }
}

export function groupPagesByPrefix(
  pages: PageRecord[],
  domain: string,
): Record<string, PageRecord[]> {
  const groups: Record<string, PageRecord[]> = {};
  for (const p of pages) {
    const key = firstPathSegment(p.url, domain);
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }
  // Stable ordering: "Pages" (root) first, then alpha.
  const ordered: Record<string, PageRecord[]> = {};
  if (groups["Pages"]) ordered["Pages"] = groups["Pages"];
  for (const k of Object.keys(groups).sort()) {
    if (k !== "Pages") ordered[k] = groups[k];
  }
  return ordered;
}

function firstPathSegment(url: string, _domain: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return "Pages";
    const seg = parts[0];
    // Title-case, strip extensions.
    return seg
      .replace(/\.(html?|php|aspx?)$/i, "")
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  } catch {
    return "Pages";
  }
}

function escapeMd(s: string): string {
  return s.replace(/[\[\]]/g, (c) => `\\${c}`);
}

// ---------------------------------------------------------------------------
// Stripe webhook entry point (skeleton — full routing wired by the portal)
// ---------------------------------------------------------------------------

/**
 * Called from a Stripe webhook handler when a one-time `llms_txt_generation`
 * checkout session completes. Creates a queued job and kicks off generation.
 *
 * The actual webhook endpoint (signature verification, event routing) lives
 * in the consolidated Stripe webhook router that Worker A is in the middle
 * of factoring; this function is the contract we need from there.
 */
export async function handleLlmsTxtCheckout(
  db: Db,
  session: { metadata?: Record<string, string> | null; customer_email?: string | null; client_reference_id?: string | null },
): Promise<{ jobId: string } | { error: string }> {
  const domain = session.metadata?.domain;
  if (!domain) return { error: "No domain in checkout session metadata" };
  const accountId =
    session.metadata?.account_id ||
    session.client_reference_id ||
    undefined;
  const generator = llmsTxtGenerator(db);
  return await generator.generateForDomain(domain, { accountId });
}

// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init.headers ?? {}),
      },
      redirect: "follow",
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchTextSafe(url: string): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, { method: "GET" });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
