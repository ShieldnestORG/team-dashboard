import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

/**
 * City Intelligence — collected local-area signals per city.
 *
 * One row per (company, city slug). Populated by the city-collector service,
 * which scrapes Firecrawl + Google Trends + Bing News + Reddit + Yelp and
 * merges the results via Ollama into three ranked top-50 lists:
 *
 *   - topSearches    — most-looked-up things in the area
 *   - serviceDemand  — what kinds of help/work locals want done
 *   - trendingTopics — local news + social trends good for marketing hooks
 *
 * Consumed by:
 *   - partner-content.ts (auto-enrich content generation for located partners)
 *   - cities API (manual pitch generator for sales)
 *   - directory cross-reference (surface projects in a region)
 */

export type CityItem = {
  term: string;
  rank: number;
  score: number;
  source: string;
  meta?: Record<string, unknown>;
};

export type CityRawSource = {
  source: string;
  url: string;
  fetchedAt: string;
  itemCount: number;
};

export const cityIntelligence = pgTable(
  "city_intelligence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    slug: text("slug").notNull(), // e.g. "austin-tx-us"
    city: text("city").notNull(),
    region: text("region"),
    country: text("country").notNull().default("US"),
    population: integer("population"),
    topSearches: jsonb("top_searches").$type<CityItem[]>().default([]),
    serviceDemand: jsonb("service_demand").$type<CityItem[]>().default([]),
    trendingTopics: jsonb("trending_topics").$type<CityItem[]>().default([]),
    rawSources: jsonb("raw_sources").$type<CityRawSource[]>().default([]),
    collectedAt: timestamp("collected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    freshUntil: timestamp("fresh_until", { withTimezone: true }),
    collectionDurationMs: integer("collection_duration_ms"),
    collectionStatus: text("collection_status").notNull().default("pending"),
    collectionError: text("collection_error"),
  },
  (t) => ({
    companySlugUq: uniqueIndex("city_intelligence_company_slug_idx").on(
      t.companyId,
      t.slug,
    ),
    collectedAtIdx: index("city_intelligence_collected_at_idx").on(t.collectedAt),
  }),
);
