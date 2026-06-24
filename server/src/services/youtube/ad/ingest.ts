/**
 * URL → Product-Ad pipeline — INGEST stage.
 *
 *   ingestUrl(url) : string -> ProductSnapshot
 *
 * Scrapes a product/app URL into a structured {@link ProductSnapshot} that the
 * downstream creative-director stage consumes. Reuses the repo's existing
 * self-hosted Firecrawl integration (same env config + `/v1/scrape` shape as
 * `server/src/routes/audit.ts`'s `fcScrape`, plus the Crawlee fallback in
 * `server/src/services/crawlee-fallback.ts`). We additionally request the
 * `html` format so we can mine product images and brand colors that the
 * markdown view alone drops.
 *
 * Design contract: only throw when the URL is genuinely unfetchable. Every
 * optional field (price, reviews, OG image, colors, …) degrades to
 * absent/empty rather than failing the whole stage.
 */

import { logger } from "../../../middleware/logger.js";
import { crawleeFallbackEnabled, crawleeScrape } from "../../crawlee-fallback.js";
import type { ProductSnapshot } from "./types.js";

// Same env contract as routes/audit.ts and the other Firecrawl callers.
const FIRECRAWL_URL =
  process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY || "self-hosted";

interface FcScrapeResult {
  markdown: string;
  html: string;
  links: string[];
  metadata: Record<string, unknown>;
}

/**
 * Scrape one URL via the self-hosted Firecrawl, falling back to Crawlee
 * (markdown-only) when Firecrawl is unreachable. Throws only if both fail —
 * i.e. the URL cannot be fetched at all.
 */
async function fcScrape(url: string): Promise<FcScrapeResult> {
  let res: Response;
  try {
    res = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
      },
      // `html` is requested in addition to the audit pipeline's formats so we
      // can extract <img> srcs and inline color declarations.
      body: JSON.stringify({
        url,
        formats: ["markdown", "html", "links"],
        timeout: 30000,
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return fcScrapeFallbackOrThrow(url, (err as Error).message);
  }
  if (!res.ok) {
    return fcScrapeFallbackOrThrow(url, `HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    success?: boolean;
    data?: {
      markdown?: string;
      html?: string;
      links?: string[];
      metadata?: Record<string, unknown>;
    };
  };
  if (!data.success || !data.data) {
    return fcScrapeFallbackOrThrow(url, "response missing data");
  }
  return {
    markdown: (data.data.markdown ?? "").slice(0, 120_000),
    html: data.data.html ?? "",
    links: data.data.links ?? [],
    metadata: data.data.metadata ?? {},
  };
}

// Crawlee yields markdown only (no html/links/metadata), so brand-color and
// image extraction will simply find nothing — which is the intended graceful
// degradation, not a failure.
async function fcScrapeFallbackOrThrow(
  url: string,
  reason: string,
): Promise<FcScrapeResult> {
  if (crawleeFallbackEnabled()) {
    try {
      const md = await crawleeScrape(url);
      if (md) {
        logger.info({ url, via: "crawlee" }, "ad/ingest: Crawlee fallback succeeded");
        return { markdown: md.slice(0, 120_000), html: "", links: [], metadata: {} };
      }
    } catch (err) {
      logger.warn(
        { url, errorMessage: (err as Error).message },
        "ad/ingest: Crawlee fallback threw",
      );
    }
  }
  throw new Error(`ad/ingest: unable to fetch ${url} (${reason})`);
}

// ── Metadata helpers ──────────────────────────────────────────────────────────

/** Read a metadata key tolerantly — Firecrawl uses several casings/aliases. */
function metaString(metadata: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = metadata[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (Array.isArray(v) && typeof v[0] === "string" && v[0].trim()) return v[0].trim();
  }
  return undefined;
}

/** Resolve a possibly-relative URL against the page URL; drop if unparseable. */
function toAbsolute(candidate: string, base: string): string | undefined {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return undefined;
  }
}

// ── HTML extraction (best-effort, regex-based — no DOM dependency) ──────────────

/** Pull <img> src/srcset URLs from raw HTML, resolved absolute, in document order. */
function extractImageUrls(html: string, base: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const imgRe = /<img\b[^>]*?\bsrc=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = imgRe.exec(html)) !== null) {
    const src = m[1]?.trim();
    if (!src || src.startsWith("data:")) continue; // skip inline data-URIs
    const abs = toAbsolute(src, base);
    if (abs && !seen.has(abs)) {
      seen.add(abs);
      out.push(abs);
    }
  }
  return out;
}

/**
 * Extract brand colors: collect hex colors from inline style attributes,
 * <style> blocks and meta theme-color, then rank by frequency (most-dominant
 * first). Pragmatic — no image sampling, no headless browser.
 */
function extractBrandColors(html: string, metadata: Record<string, unknown>): string[] {
  const counts = new Map<string, number>();
  const bump = (raw: string): void => {
    let hex = raw.toLowerCase();
    // Expand shorthand #rgb → #rrggbb so duplicates collapse.
    if (/^#[0-9a-f]{3}$/.test(hex)) {
      hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
    }
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    // Drop pure black/white — they're rarely a meaningful "brand" color.
    if (hex === "#000000" || hex === "#ffffff") return;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  };

  const themeColor = metaString(metadata, "theme-color", "themeColor");
  if (themeColor) bump(themeColor);

  if (html) {
    const hexRe = /#[0-9a-fA-F]{3,6}\b/g;
    let m: RegExpExecArray | null;
    while ((m = hexRe.exec(html)) !== null) bump(m[0]);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([hex]) => hex);
}

/** Markdown headings + the first few non-trivial lines, as ordered copy. */
function extractCopy(markdown: string): string[] {
  const copy: string[] = [];
  const seen = new Set<string>();
  const push = (s: string): void => {
    const t = s.trim();
    if (t.length >= 12 && t.length <= 400 && !seen.has(t)) {
      seen.add(t);
      copy.push(t);
    }
  };
  for (const line of markdown.split("\n")) {
    const heading = /^#{1,3}\s+(.*)$/.exec(line.trim());
    if (heading?.[1]) push(heading[1]);
  }
  // Fall back to leading prose paragraphs if headings were sparse.
  if (copy.length < 3) {
    for (const para of markdown.split(/\n{2,}/)) {
      const clean = para.replace(/^[#>*\-\s]+/, "").trim();
      if (!clean.includes("|") && !clean.startsWith("![")) push(clean);
      if (copy.length >= 8) break;
    }
  }
  return copy.slice(0, 12);
}

/** Best-effort price string: first currency-looking token in the markdown. */
function extractPriceText(markdown: string): string | undefined {
  const m =
    /(?:[$£€]\s?\d[\d,]*(?:\.\d{2})?(?:\s?\/\s?\w+)?)|(?:\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP))/i.exec(
      markdown,
    );
  return m?.[0]?.replace(/\s+/g, " ").trim();
}

/** Best-effort reviews: aggregate rating + count from markdown text. */
function extractReviews(markdown: string): ProductSnapshot["reviews"] {
  const ratingMatch = /(\d(?:\.\d)?)\s*(?:\/\s*5|out of 5|stars?)\b/i.exec(markdown);
  const countMatch = /([\d,]{2,})\s+(?:reviews?|ratings?)\b/i.exec(markdown);
  const rating = ratingMatch ? Number(ratingMatch[1]) : undefined;
  const count = countMatch ? Number(countMatch[1]!.replace(/,/g, "")) : undefined;
  if (rating === undefined && count === undefined) return undefined;
  const reviews: NonNullable<ProductSnapshot["reviews"]> = {};
  if (rating !== undefined && !Number.isNaN(rating)) reviews.rating = rating;
  if (count !== undefined && !Number.isNaN(count)) reviews.count = count;
  return Object.keys(reviews).length ? reviews : undefined;
}

// ── Public stage entry point ────────────────────────────────────────────────────

/**
 * Ingest a product/app URL into a {@link ProductSnapshot}. Throws only when the
 * URL cannot be fetched at all; all optional fields degrade gracefully.
 */
export async function ingestUrl(url: string): Promise<ProductSnapshot> {
  // Validate up front so we throw a clear error rather than letting a bad URL
  // fail deeper in.
  let pageUrl: string;
  try {
    pageUrl = new URL(url).toString();
  } catch {
    throw new Error(`ad/ingest: invalid URL "${url}"`);
  }

  const { markdown, html, links, metadata } = await fcScrape(pageUrl);

  const title =
    metaString(metadata, "ogTitle", "og:title", "title") ??
    /^#\s+(.*)$/m.exec(markdown)?.[1]?.trim() ??
    new URL(pageUrl).hostname;

  const description =
    metaString(metadata, "ogDescription", "og:description", "description") ?? "";

  const ogImageUrlRaw = metaString(metadata, "ogImage", "og:image", "image");
  const ogImageUrl = ogImageUrlRaw ? toAbsolute(ogImageUrlRaw, pageUrl) : undefined;

  const faviconRaw = metaString(metadata, "favicon");
  const faviconUrl = faviconRaw
    ? toAbsolute(faviconRaw, pageUrl)
    : toAbsolute("/favicon.ico", pageUrl);

  // Best-representative image first: OG image, then in-document <img>s.
  const docImages = extractImageUrls(html, pageUrl);
  const productImageUrls = [
    ...(ogImageUrl ? [ogImageUrl] : []),
    ...docImages.filter((u) => u !== ogImageUrl),
  ];

  const snapshot: ProductSnapshot = {
    url: pageUrl,
    fetchedAt: new Date().toISOString(),
    title,
    description,
    copy: extractCopy(markdown),
    priceText: extractPriceText(markdown),
    productImageUrls,
    ogImageUrl,
    faviconUrl,
    brandColors: extractBrandColors(html, metadata),
    category: metaString(metadata, "ogType", "og:type", "article:section"),
    reviews: extractReviews(markdown),
    // Keep everything potentially useful for downstream stages / debugging.
    raw: {
      firecrawlMetadata: metadata,
      links: links.slice(0, 100),
      markdown: markdown.slice(0, 20_000),
      hadHtml: Boolean(html),
    },
  };

  logger.info(
    {
      url: pageUrl,
      images: productImageUrls.length,
      colors: snapshot.brandColors.length,
      hasPrice: Boolean(snapshot.priceText),
    },
    "ad/ingest: snapshot built",
  );

  return snapshot;
}
