// ---------------------------------------------------------------------------
// Firecrawl provenance stamping — Rule 6. Firecrawl returns REAL scraped text;
// it does not invent. Its risks are staleness and wrong-element extraction.
// So we don't "trust the crawl" blindly — we stamp every crawl with the time
// we fetched it, prefer the page's OWN dateline when we can parse one, present
// figures as "as stated on <source>, <date>", and treat a crawl older than a
// freshness window as stale (re-crawl). Fabrication can only re-enter if a
// model summarizes the crawl and embeds a number — and Rule 1's number guard
// covers that.
// ---------------------------------------------------------------------------

import type { SourceRef } from "./types.js";

export interface StampedCrawl {
  url: string;
  text: string;
  /** ISO time we fetched/crawled the page. */
  fetchedAt: string;
  /** The page's own published date (display string) if one was parsed, else null. */
  dateline: string | null;
}

const MONTHS =
  "(January|February|March|April|May|June|July|August|September|October|November|December)";

// Ordered most-specific → least. First match wins.
const DATELINE_PATTERNS: RegExp[] = [
  /\b(\d{4}-\d{2}-\d{2})\b/, // 2026-06-25 (ISO)
  new RegExp(`\\b${MONTHS}\\s+\\d{1,2},?\\s+\\d{4}\\b`, "i"), // June 25, 2026
  new RegExp(`\\b\\d{1,2}\\s+${MONTHS}\\s+\\d{4}\\b`, "i"), // 25 June 2026
  /\b(\d{1,2}\/\d{1,2}\/\d{4})\b/, // 06/25/2026
];

/**
 * Best-effort extraction of a page's own dateline. Prefers a line explicitly
 * labelled as a publish/updated date, then falls back to the first date-shaped
 * token anywhere in the text. Returns the matched display string, or null.
 */
export function extractDateline(text: string): string | null {
  if (!text) return null;

  // Prefer an explicitly labelled date line.
  const labelled = text.match(
    /(?:published|posted|updated|date)[:\s-]+([^\n]{0,40})/i,
  );
  if (labelled?.[1]) {
    for (const re of DATELINE_PATTERNS) {
      const m = labelled[1].match(re);
      if (m) return m[0];
    }
  }

  // Otherwise, first date-shaped token anywhere.
  for (const re of DATELINE_PATTERNS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

/** Stamp a raw crawl with fetch time + parsed dateline. */
export function stampCrawl(
  url: string,
  text: string,
  fetchedAt: string = new Date().toISOString(),
): StampedCrawl {
  return { url, text, fetchedAt, dateline: extractDateline(text) };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Build a SourceRef from a stamped crawl (carries crawl provenance). */
export function toSourceRef(
  crawl: StampedCrawl,
  meta: { title?: string; publisher?: string } = {},
): SourceRef {
  return {
    url: crawl.url,
    title: meta.title,
    publisher: meta.publisher ?? hostOf(crawl.url),
    fetchedAt: crawl.fetchedAt,
    dateline: crawl.dateline,
  };
}

/** The date a figure should be attributed to: the page's dateline if we have
 *  one, else the crawl date (never silently present a crawl as "today"). */
export function attributionDate(source: SourceRef): string {
  if (source.dateline) return source.dateline;
  return source.fetchedAt.slice(0, 10); // YYYY-MM-DD of the crawl
}

/** "<value> (as stated on <publisher>, <date>)" — Rule 6 presentation. */
export function asStatedOn(value: string, source: SourceRef): string {
  const where = source.publisher ?? hostOf(source.url);
  return `${value} (as stated on ${where}, ${attributionDate(source)})`;
}

/** True when a crawl is older than `windowMs` and should be re-crawled. */
export function isStale(
  fetchedAt: string,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return true; // unparseable → treat as stale
  return now - t > windowMs;
}
