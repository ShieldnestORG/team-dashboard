/**
 * On-page SEO/AEO auditor.
 *
 * Fetches a URL, parses its HTML, and validates the 16-item SEO/AEO checklist
 * defined in `docs/guides/seo-aeo-checklist.md`. Reuses the validator scaffolding
 * from `partner-seo-checklist.ts` rather than duplicating keys.
 *
 * This service only READS remote sites — it never writes or patches anything.
 * The companion `repo-update-advisor.ts` turns failures into suggestions for
 * admin review; the cron in `seo-audit-cron.ts` orchestrates both.
 */

import {
  REQUIRED_SEO_ITEMS,
  type SeoChecklist,
} from "./partner-seo-checklist.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeoAuditResult {
  url: string;
  fetchedAt: string;
  httpStatus: number | null;
  ok: boolean;
  score: number;
  total: number;
  checklist: Partial<SeoChecklist>;
  failures: Array<{
    key: keyof SeoChecklist;
    label: string;
    priority: "critical" | "high" | "medium";
    detail: string;
  }>;
  evidence: {
    title: string | null;
    metaDescription: string | null;
    canonical: string | null;
    robotsMeta: string | null;
    ogImage: string | null;
    ogImageOk: boolean | null;
    twitterImage: string | null;
    twitterImageOk: boolean | null;
    jsonLdTypes: string[];
    sitemapOk: boolean | null;
    robotsTxtOk: boolean | null;
  };
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function match(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] ?? null : null;
}

function extractMetaContent(html: string, nameOrProp: string, attr: "name" | "property"): string | null {
  const re = new RegExp(
    `<meta[^>]*${attr}=["']${nameOrProp}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const fwd = match(html, re);
  if (fwd) return fwd;
  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*${attr}=["']${nameOrProp}["']`,
    "i",
  );
  return match(html, re2);
}

function extractJsonLdTypes(html: string): string[] {
  const types: string[] = [];
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    const raw = (block[1] ?? "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      collectTypes(parsed, types);
    } catch {
      // ignore malformed blocks — they still count as "present" but not usable
    }
  }
  return Array.from(new Set(types));
}

function collectTypes(node: unknown, acc: string[]): void {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, acc);
    return;
  }
  if (typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  const t = obj["@type"];
  if (typeof t === "string") acc.push(t);
  else if (Array.isArray(t)) t.forEach((v) => typeof v === "string" && acc.push(v));
  const graph = obj["@graph"];
  if (Array.isArray(graph)) for (const g of graph) collectTypes(g, acc);
  const mainEntity = obj.mainEntity;
  if (mainEntity) collectTypes(mainEntity, acc);
}

async function head(url: string, timeoutMs = 6000): Promise<number | null> {
  try {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), timeoutMs);
    const res = await fetch(url, { method: "HEAD", signal: ac.signal, redirect: "follow" });
    clearTimeout(to);
    return res.status;
  } catch {
    return null;
  }
}

function originOf(u: string): string {
  try {
    return new URL(u).origin;
  } catch {
    return u.replace(/\/[^/]*$/, "");
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export async function auditUrl(url: string): Promise<SeoAuditResult> {
  const fetchedAt = new Date().toISOString();
  const baseResult: SeoAuditResult = {
    url,
    fetchedAt,
    httpStatus: null,
    ok: false,
    score: 0,
    total: REQUIRED_SEO_ITEMS.length,
    checklist: {},
    failures: [],
    evidence: {
      title: null,
      metaDescription: null,
      canonical: null,
      robotsMeta: null,
      ogImage: null,
      ogImageOk: null,
      twitterImage: null,
      twitterImageOk: null,
      jsonLdTypes: [],
      sitemapOk: null,
      robotsTxtOk: null,
    },
  };

  let html = "";
  try {
    const res = await fetch(url, { redirect: "follow" });
    baseResult.httpStatus = res.status;
    if (!res.ok) {
      baseResult.error = `HTTP ${res.status}`;
      return baseResult;
    }
    html = await res.text();
  } catch (err) {
    baseResult.error = err instanceof Error ? err.message : String(err);
    return baseResult;
  }

  // --- Evidence extraction -------------------------------------------------
  baseResult.evidence.title = match(html, /<title[^>]*>([^<]*)<\/title>/i)?.trim() || null;
  baseResult.evidence.metaDescription = extractMetaContent(html, "description", "name");
  baseResult.evidence.canonical = match(html, /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["']/i);
  baseResult.evidence.robotsMeta = extractMetaContent(html, "robots", "name");
  baseResult.evidence.ogImage = extractMetaContent(html, "og:image", "property");
  baseResult.evidence.twitterImage = extractMetaContent(html, "twitter:image", "name");
  baseResult.evidence.jsonLdTypes = extractJsonLdTypes(html);

  // --- Resolve OG image + twitter:image (HEAD checks) ----------------------
  if (baseResult.evidence.ogImage) {
    const abs = baseResult.evidence.ogImage.startsWith("http")
      ? baseResult.evidence.ogImage
      : new URL(baseResult.evidence.ogImage, url).toString();
    const status = await head(abs);
    baseResult.evidence.ogImageOk = status !== null && status >= 200 && status < 400;
  }
  if (baseResult.evidence.twitterImage) {
    const abs = baseResult.evidence.twitterImage.startsWith("http")
      ? baseResult.evidence.twitterImage
      : new URL(baseResult.evidence.twitterImage, url).toString();
    const status = await head(abs);
    baseResult.evidence.twitterImageOk = status !== null && status >= 200 && status < 400;
  }

  // --- /sitemap.xml and /robots.txt ----------------------------------------
  const origin = originOf(url);
  baseResult.evidence.sitemapOk = (await head(`${origin}/sitemap.xml`)) === 200;
  baseResult.evidence.robotsTxtOk = (await head(`${origin}/robots.txt`)) === 200;

  // --- Checklist evaluation ------------------------------------------------
  const c: Partial<SeoChecklist> = {};
  const jsonTypes = baseResult.evidence.jsonLdTypes.map((t) => t.toLowerCase());

  c.titleTag = !!baseResult.evidence.title && baseResult.evidence.title.length <= 70;
  c.metaDescription =
    !!baseResult.evidence.metaDescription && baseResult.evidence.metaDescription.length >= 50;
  c.canonicalUrl = !!baseResult.evidence.canonical;
  c.openGraph = !!baseResult.evidence.ogImage && baseResult.evidence.ogImageOk === true;
  c.twitterCard =
    !!baseResult.evidence.twitterImage && baseResult.evidence.twitterImageOk === true;

  c.organizationSchema = jsonTypes.includes("organization") || jsonTypes.includes("localbusiness");
  c.webSiteSchema = jsonTypes.includes("website");
  c.breadcrumbSchema = jsonTypes.includes("breadcrumblist");
  c.localBusinessSchema = jsonTypes.includes("localbusiness");
  c.faqSchema = jsonTypes.includes("faqpage");
  c.howToSchema = jsonTypes.includes("howto");

  c.robotsTxt = baseResult.evidence.robotsTxtOk === true;
  c.sitemapXml = baseResult.evidence.sitemapOk === true;
  c.llmsTxt = (await head(`${origin}/llms.txt`)) === 200;
  c.webManifest =
    !!match(html, /<link[^>]*rel=["'](?:manifest|web-manifest)["'][^>]*href=["']([^"']*)["']/i);
  c.mobileResponsive = !!match(html, /<meta[^>]*name=["']viewport["'][^>]*>/i);
  c.httpsEnabled = url.startsWith("https://");
  c.gzip = true; // can't detect from client-side fetch alone; leave optimistic

  baseResult.checklist = c;

  // --- Failures ------------------------------------------------------------
  for (const item of REQUIRED_SEO_ITEMS) {
    if (c[item.key]) continue;
    let detail = `${item.label} is missing or invalid.`;
    if (item.key === "openGraph") {
      if (!baseResult.evidence.ogImage) detail = "No og:image meta tag found.";
      else if (baseResult.evidence.ogImageOk === false)
        detail = `og:image URL ${baseResult.evidence.ogImage} did not resolve (HEAD check failed).`;
    } else if (item.key === "twitterCard") {
      if (!baseResult.evidence.twitterImage) detail = "No twitter:image meta tag found.";
      else if (baseResult.evidence.twitterImageOk === false)
        detail = `twitter:image URL ${baseResult.evidence.twitterImage} did not resolve.`;
    } else if (item.key === "faqSchema") {
      detail = "No FAQPage JSON-LD block found — AEO engines prefer FAQPage for answer extraction.";
    } else if (item.key === "organizationSchema") {
      detail = "No Organization or LocalBusiness JSON-LD block found.";
    } else if (item.key === "titleTag" && baseResult.evidence.title) {
      detail = `Title is ${baseResult.evidence.title.length} chars (recommended ≤ 70).`;
    }
    baseResult.failures.push({
      key: item.key,
      label: item.label,
      priority: item.priority,
      detail,
    });
  }

  baseResult.score = baseResult.total - baseResult.failures.length;
  baseResult.ok = baseResult.failures.length === 0;

  logger.info(
    { url, score: baseResult.score, total: baseResult.total, failures: baseResult.failures.length },
    "SEO audit complete",
  );

  return baseResult;
}
