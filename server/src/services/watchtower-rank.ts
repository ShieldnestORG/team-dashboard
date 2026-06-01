// ---------------------------------------------------------------------------
// Watchtower rank check — classical SEO signal via self-hosted Firecrawl.
//
// Watchtower's engines measure AEO/GEO (do the AI assistants mention the
// brand). This module adds the complementary classical-SEO signal: for a
// given domain + keyword queries, query Firecrawl's /v1/search (the same
// self-hosted endpoint city-business-finder already uses in prod) and record
// where the domain first appears in the ranked results.
//
// Caveat (surfaced in the digest copy): Firecrawl's search backend is not
// Google's organic ranker, so `position` is an approximate visibility signal,
// not a guaranteed Google SERP position. Good enough for a monthly "are we
// showing up, and is it moving" read.
//
// Fail-soft by design: a query that errors or times out yields
// { position: null } rather than throwing, so one bad query never sinks the
// whole weekly run.
// ---------------------------------------------------------------------------

import { firecrawlSearch } from "./city-collector.js";
import { logger } from "../middleware/logger.js";

export interface RankEntry {
  query: string;
  /** 1-based position of the first result on `domain`, or null if not found. */
  position: number | null;
  /** The brand's matching result URL, or null when not found. */
  matchedUrl: string | null;
  /** The #1 result URL for the query (context for the digest). */
  topUrl: string | null;
}

/** How many results to scan per query when looking for the domain. */
const RANK_SEARCH_DEPTH = 20;
/** Bounded concurrency so a multi-query check doesn't hammer Firecrawl. */
const RANK_CONCURRENCY = 3;

/** Search transport shape — overridable in tests. */
export type RankSearchFn = (
  query: string,
  limit: number,
) => Promise<Array<{ title: string; url: string; content: string }>>;

/**
 * Normalize a domain or URL to a bare lowercase host without a leading
 * `www.` — so "https://www.RogueDefender.law/foo" and "roguedefender.law"
 * compare equal.
 */
export function normalizeHost(input: string): string {
  let s = input.trim().toLowerCase();
  if (!s) return "";
  // Strip scheme if present so URL parsing isn't required for bare domains.
  s = s.replace(/^[a-z]+:\/\//, "");
  // Drop path/query/hash and any port.
  s = s.split(/[/?#]/)[0]!.split(":")[0]!;
  return s.replace(/^www\./, "");
}

/**
 * Compute the brand's rank from an ordered result list. Position is 1-based;
 * a result counts as the brand's when its host equals `domain` or is a
 * subdomain of it. Pure — exported for tests.
 */
export function computeRankFromResults(
  domain: string,
  results: Array<{ url: string }>,
): Pick<RankEntry, "position" | "matchedUrl" | "topUrl"> {
  const target = normalizeHost(domain);
  const topUrl = results[0]?.url ?? null;
  if (!target) return { position: null, matchedUrl: null, topUrl };

  for (let i = 0; i < results.length; i++) {
    const host = normalizeHost(results[i]!.url);
    if (host && (host === target || host.endsWith(`.${target}`))) {
      return { position: i + 1, matchedUrl: results[i]!.url, topUrl };
    }
  }
  return { position: null, matchedUrl: null, topUrl };
}

/**
 * Run the rank check for a domain across keyword queries with bounded
 * concurrency. Never throws: a failed query resolves to position=null.
 */
export async function runRankCheck(
  domain: string,
  queries: string[],
  searchFn: RankSearchFn = firecrawlSearch,
): Promise<RankEntry[]> {
  const cleaned = queries
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim());

  const out: RankEntry[] = new Array(cleaned.length);
  let cursor = 0;
  const workers = Array.from({
    length: Math.min(RANK_CONCURRENCY, cleaned.length || 1),
  }).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= cleaned.length) return;
      const query = cleaned[idx]!;
      try {
        const results = await searchFn(query, RANK_SEARCH_DEPTH);
        out[idx] = { query, ...computeRankFromResults(domain, results) };
      } catch (err) {
        logger.warn(
          { err, query, domain },
          "watchtower-rank: query failed; recording position=null",
        );
        out[idx] = { query, position: null, matchedUrl: null, topUrl: null };
      }
    }
  });
  await Promise.all(workers);
  return out;
}
