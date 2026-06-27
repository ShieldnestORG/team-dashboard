// ---------------------------------------------------------------------------
// Serper.dev SERP enrichment — the cheap saturation signal (plan §1.3: Serper
// at $0.30/1k beat DataForSEO ~5× and SerpApi ~80×). It feeds two of the
// saturation scorer's inputs: SERP domain concentration and a keyword-difficulty
// proxy. EVERY number here is derived from the API response, never invented
// (Rule 1). No key (or any error) → returns null, and the scorer degrades
// gracefully — Serper is a bolt-on, not a hard dependency.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import type { SaturationInputs } from "./types.js";

const SERPER_ENDPOINT = "https://google.serper.dev/search";
const TIMEOUT_MS = 15_000;

export interface SerperOrganic {
  link?: string;
}
export interface SerperResponse {
  organic?: SerperOrganic[];
  ads?: unknown[];
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Pure computation of saturation inputs from a SERP response. Exported so it
 * can be unit-tested without the network.
 *
 * - domainConcentration = 1 − (uniqueDomains / results). All 10 results from 3
 *   domains → low diversity → high concentration.
 * - keywordDifficulty = blended proxy: half the domain concentration (a SERP
 *   owned by few domains is hard to crack) + half the ad density (advertisers
 *   bidding signals commercial competition), each normalized.
 */
export function computeSerpInputs(resp: SerperResponse): Partial<SaturationInputs> {
  const links = (resp.organic ?? [])
    .map((o) => (o.link ? hostOf(o.link) : null))
    .filter((h): h is string => Boolean(h));
  const out: Partial<SaturationInputs> = {};

  if (links.length > 0) {
    const unique = new Set(links).size;
    const concentration = 1 - unique / links.length;
    out.domainConcentration = Math.min(1, Math.max(0, concentration));
    const adDensity = Math.min(1, (resp.ads?.length ?? 0) / 4);
    out.keywordDifficulty = Math.min(
      1,
      Math.max(0, 0.5 * out.domainConcentration + 0.5 * adDensity),
    );
  }
  return out;
}

/**
 * Fetch SERP saturation inputs for a keyword. Returns null when SERPER_API_KEY
 * is unset or on any error (fail-soft). Network call; numbers come only from
 * the response.
 */
export async function serperSaturation(
  keyword: string,
): Promise<Partial<SaturationInputs> | null> {
  const apiKey = process.env.SERPER_API_KEY?.trim();
  if (!apiKey) return null;
  try {
    const res = await fetch(SERPER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
      body: JSON.stringify({ q: keyword, num: 10 }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status, keyword },
        "trends-digest:serper non-2xx (fail-soft, no enrichment)",
      );
      return null;
    }
    const data = (await res.json()) as SerperResponse;
    return computeSerpInputs(data);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), keyword },
      "trends-digest:serper threw (fail-soft, no enrichment)",
    );
    return null;
  }
}
