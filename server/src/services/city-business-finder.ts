/**
 * City Business Finder — topic-based local business scraper.
 *
 * Given a city + topic (e.g., "handyman" in "Austin, TX"), scrapes three
 * sources in parallel to find real local businesses:
 *   1. Firecrawl web search  — broad business listings / review sites
 *   2. Yelp via Firecrawl    — structured category + business cards
 *   3. Reddit JSON API       — community recommendations mentioning businesses
 *
 * Results are deduplicated by name+address and upserted to city_business_leads.
 * Idempotent: repeat calls for the same city+topic accumulate without duplication.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { cityBusinessLeads } from "@paperclipai/db";
import type { NewCityBusinessLead } from "@paperclipai/db";
import { firecrawlSearch, firecrawlScrape } from "./city-collector.js";
import { buildCitySlug } from "./city-collector.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

const PER_SOURCE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface BusinessFinderQuery {
  city: string;
  region?: string | null;
  topic: string;
  limit?: number; // default 30
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withTimeout<T>(
  label: string,
  p: Promise<T>,
  ms = PER_SOURCE_TIMEOUT_MS,
): Promise<T | null> {
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timeout`)), ms),
      ),
    ]);
  } catch (err) {
    logger.warn({ err, label }, "city-business-finder: source failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Industry derivation
// ---------------------------------------------------------------------------

const CATEGORY_INDUSTRY_MAP: Record<string, string> = {
  handyman: "home_services",
  plumber: "home_services",
  electrician: "home_services",
  contractor: "home_services",
  "home repair": "home_services",
  "home services": "home_services",
  restaurant: "dining",
  food: "dining",
  cafe: "dining",
  gym: "fitness",
  fitness: "fitness",
  yoga: "wellness",
  salon: "salon",
  barber: "salon",
  "beauty salon": "salon",
  spa: "wellness",
  mechanic: "auto",
  "auto repair": "auto",
  dentist: "healthcare",
  doctor: "healthcare",
  lawyer: "legal",
  attorney: "legal",
};

function deriveIndustry(category: string | null | undefined): string {
  if (!category) return "local_business";
  const lower = category.toLowerCase();
  for (const [key, industry] of Object.entries(CATEGORY_INDUSTRY_MAP)) {
    if (lower.includes(key)) return industry;
  }
  return "local_business";
}

export { deriveIndustry };

// ---------------------------------------------------------------------------
// Internal lead shape (pre-insert) — rating as number for intermediate use
// ---------------------------------------------------------------------------

interface RawLead {
  name?: string;
  website?: string;
  phone?: string;
  address?: string;
  category?: string;
  rating?: number;
  reviewCount?: number;
  source?: string;
  sourceUrl?: string;
  rawSnippet?: string;
}

// ---------------------------------------------------------------------------
// Source 1: Firecrawl web search
// ---------------------------------------------------------------------------

async function findViaFirecrawl(
  topic: string,
  cityLabel: string,
): Promise<RawLead[]> {
  const queries = [
    `${topic} in ${cityLabel}`,
    `best ${topic} ${cityLabel}`,
    `${topic} ${cityLabel} reviews`,
    `local ${topic} near ${cityLabel}`,
  ];

  const seen = new Set<string>();
  const leads: RawLead[] = [];

  for (const query of queries) {
    const results = await firecrawlSearch(query, 8);
    for (const r of results) {
      if (!r.title || seen.has(r.title.toLowerCase())) continue;
      seen.add(r.title.toLowerCase());
      // Extract a plausible business name from title — strip " - Yelp", " | Google" etc.
      const name = r.title
        .replace(
          /\s*[-|–]\s*(Yelp|Google|Facebook|BBB|HomeAdvisor|Angi|Thumbtack|Houzz|Bark|Nextdoor|Porch).*$/i,
          "",
        )
        .replace(/\s*[-|]\s*.*$/, "")
        .trim()
        .slice(0, 120);
      if (!name || name.length < 3) continue;
      leads.push({
        name,
        website: r.url || undefined,
        source: "firecrawl",
        sourceUrl: r.url || undefined,
        rawSnippet: r.content?.slice(0, 300) || undefined,
      });
      if (leads.length >= 15) break;
    }
    if (leads.length >= 15) break;
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Source 2: Yelp via Firecrawl scrape
// ---------------------------------------------------------------------------

async function findViaYelp(
  topic: string,
  cityLabel: string,
): Promise<RawLead[]> {
  const findDesc = encodeURIComponent(topic);
  const findLoc = encodeURIComponent(cityLabel);
  const url = `https://www.yelp.com/search?find_desc=${findDesc}&find_loc=${findLoc}`;
  const md = await firecrawlScrape(url);
  if (!md) return [];

  const leads: RawLead[] = [];
  const lines = md.split("\n");
  let i = 0;

  while (i < lines.length && leads.length < 20) {
    const line = lines[i]!;

    // Yelp business names often appear as markdown headings or bold text
    const nameMatch =
      line.match(/^#{1,3}\s+(.{3,80})$/) ||
      line.match(/^\*\*(.{3,80})\*\*$/) ||
      line.match(/^\d+\.\s+(.{3,80})$/);

    if (nameMatch) {
      const name = nameMatch[1]!.trim();
      // Skip navigation / UI labels
      if (
        /^(search|filter|sort|category|more|see all|open now|yelp|photos|reviews|write a review)/i.test(
          name,
        )
      ) {
        i++;
        continue;
      }

      // Scan the next few lines for rating, review count, phone, address
      const context = lines.slice(i + 1, i + 8).join(" ");
      const ratingMatch = context.match(/(\d+\.?\d*)\s*(?:star|★|☆|\*)/i);
      const reviewMatch = context.match(/\((\d[\d,]*)\s*reviews?\)/i);
      const phoneMatch = context.match(/\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/);
      const addressMatch = context.match(
        /\d+\s+[A-Z][a-zA-Z\s]+(?:St|Ave|Blvd|Rd|Dr|Ln|Way|Ct|Pl)\b[^,\n]*/i,
      );

      leads.push({
        name,
        phone: phoneMatch?.[0] ?? undefined,
        address: addressMatch?.[0]?.trim() ?? undefined,
        rating: ratingMatch ? parseFloat(ratingMatch[1]!) : undefined,
        reviewCount: reviewMatch
          ? parseInt(reviewMatch[1]!.replace(/,/g, ""), 10)
          : undefined,
        source: "yelp",
        sourceUrl: url,
        rawSnippet: context.slice(0, 300),
      });
    }
    i++;
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Source 3: Reddit JSON API
// ---------------------------------------------------------------------------

async function findViaReddit(
  city: string,
  topic: string,
): Promise<RawLead[]> {
  const subreddit = city.replace(/[^a-zA-Z0-9]/g, "");
  const queries = [
    `${topic} recommendation`,
    `best ${topic}`,
    `${topic} near me`,
  ];
  const leads: RawLead[] = [];

  for (const q of queries) {
    try {
      const url = `https://www.reddit.com/r/${subreddit}/search.json?q=${encodeURIComponent(q)}&restrict_sr=on&limit=10&sort=top`;
      const res = await fetch(url, {
        headers: { "User-Agent": "coherence-daddy-city-collector/1.0" },
        signal: AbortSignal.timeout(PER_SOURCE_TIMEOUT_MS),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        data?: {
          children?: Array<{
            data?: { title?: string; selftext?: string; url?: string };
          }>;
        };
      };
      const children = data.data?.children ?? [];
      for (const c of children) {
        const title = c.data?.title?.trim();
        if (!title) continue;
        // Extract business name mentions from titles like "XYZ Plumbing is great!"
        // We keep the whole title as raw_snippet and use a heuristic for name
        const nameMatch = title.match(
          /([A-Z][a-zA-Z\s&']{2,40}(?:LLC|Inc|Co|Services?|Repair|Shop|Studio|Salon|Gym|Cafe|Bar|Restaurant|Auto|Plumbing|Electric|Handyman)?)/,
        );
        if (!nameMatch) continue;
        leads.push({
          name: nameMatch[1]!.trim().slice(0, 120),
          source: "reddit",
          sourceUrl: c.data?.url ?? url,
          rawSnippet: title.slice(0, 300),
        });
        if (leads.length >= 10) return leads;
      }
    } catch (err) {
      logger.debug({ err, q }, "city-business-finder: reddit query failed");
    }
  }

  return leads;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function findLocalBusinesses(
  db: Db,
  query: BusinessFinderQuery,
): Promise<(typeof cityBusinessLeads.$inferSelect)[]> {
  const { city, region, topic, limit = 30 } = query;
  const cityLabel = [city, region].filter(Boolean).join(", ");
  const citySlug = buildCitySlug({ city, region: region ?? null, country: "US" });

  logger.info({ city, topic }, "city-business-finder: starting");

  const [firecrawlLeads, yelpLeads, redditLeads] = await Promise.all([
    withTimeout("firecrawl", findViaFirecrawl(topic, cityLabel)),
    withTimeout("yelp", findViaYelp(topic, cityLabel)),
    withTimeout("reddit", findViaReddit(city, topic)),
  ]);

  // Merge all leads, dedup on lower(name)
  const allLeads = [
    ...(firecrawlLeads ?? []),
    ...(yelpLeads ?? []),
    ...(redditLeads ?? []),
  ];

  const seen = new Set<string>();
  const deduped: NewCityBusinessLead[] = [];

  for (const lead of allLeads) {
    if (!lead.name) continue;
    const key = lead.name.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      companyId: COMPANY_ID,
      citySlug,
      topic: topic.toLowerCase(),
      name: lead.name,
      website: lead.website ?? null,
      phone: lead.phone ?? null,
      address: lead.address ?? null,
      category:
        lead.category ??
        deriveIndustry(lead.name + " " + (lead.rawSnippet ?? "")),
      rating:
        lead.rating != null ? lead.rating.toString() : null,
      reviewCount: lead.reviewCount ?? null,
      source: lead.source ?? "unknown",
      sourceUrl: lead.sourceUrl ?? null,
      rawSnippet: lead.rawSnippet ?? null,
      leadStatus: "new",
      partnerId: null,
      foundAt: new Date(),
      actionedAt: null,
      notes: null,
    });
    if (deduped.length >= limit) break;
  }

  if (deduped.length === 0) {
    logger.info({ city, topic }, "city-business-finder: no leads found");
    return [];
  }

  // Upsert — idempotent on (companyId, citySlug, topic, lower(name))
  // Since there's no unique constraint on name, we insert and skip conflicts
  // by doing a manual SELECT-first check on name to avoid duplicates
  const existingNames = await db
    .select({ name: cityBusinessLeads.name })
    .from(cityBusinessLeads)
    .where(
      sql`${cityBusinessLeads.companyId} = ${COMPANY_ID}
          AND ${cityBusinessLeads.citySlug} = ${citySlug}
          AND lower(${cityBusinessLeads.topic}) = ${topic.toLowerCase()}`,
    );

  const existingSet = new Set(
    existingNames.map((r) => r.name.toLowerCase().trim()),
  );
  const toInsert = deduped.filter(
    (l) => !existingSet.has(l.name.toLowerCase().trim()),
  );

  if (toInsert.length > 0) {
    await db.insert(cityBusinessLeads).values(toInsert);
  }

  logger.info(
    {
      city,
      topic,
      found: allLeads.length,
      inserted: toInsert.length,
      skipped: deduped.length - toInsert.length,
    },
    "city-business-finder: complete",
  );

  // Return all leads for this city+topic (including pre-existing)
  return db
    .select()
    .from(cityBusinessLeads)
    .where(
      sql`${cityBusinessLeads.companyId} = ${COMPANY_ID}
          AND ${cityBusinessLeads.citySlug} = ${citySlug}
          AND lower(${cityBusinessLeads.topic}) = ${topic.toLowerCase()}`,
    )
    .orderBy(cityBusinessLeads.foundAt);
}
