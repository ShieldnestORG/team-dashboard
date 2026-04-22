import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const ownedSites = pgTable(
  "owned_sites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    slug: text("slug").notNull(),
    domain: text("domain").notNull(),
    displayName: text("display_name").notNull(),
    primaryTool: text("primary_tool"),
    niche: text("niche"),
    // building | live | adsense_pending | monetized | killed
    status: text("status").notNull().default("building"),
    launchedAt: timestamp("launched_at", { withTimezone: true }),
    adsenseAccountId: text("adsense_account_id"),
    gaPropertyId: text("ga_property_id"),
    gscSiteUrl: text("gsc_site_url"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUq: uniqueIndex("owned_sites_company_slug_uq").on(
      table.companyId,
      table.slug,
    ),
    domainUq: uniqueIndex("owned_sites_domain_uq").on(table.domain),
    companyStatusIdx: index("owned_sites_company_status_idx").on(
      table.companyId,
      table.status,
    ),
  }),
);

export const ownedSiteMetrics = pgTable(
  "owned_site_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    siteId: uuid("site_id").notNull().references(() => ownedSites.id, {
      onDelete: "cascade",
    }),
    date: date("date").notNull(),
    sessions: integer("sessions").notNull().default(0),
    pageviews: integer("pageviews").notNull().default(0),
    adImpressions: integer("ad_impressions").notNull().default(0),
    adRevenueCents: integer("ad_revenue_cents").notNull().default(0),
    rpmCents: integer("rpm_cents").notNull().default(0),
    outboundClicksToCoherence: integer("outbound_clicks_to_coherence")
      .notNull()
      .default(0),
    outboundClicksToTokns: integer("outbound_clicks_to_tokns").notNull().default(0),
    // "ga4" | "adsense" | "manual"
    source: text("source").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    siteDateSourceUq: uniqueIndex("owned_site_metrics_site_date_source_uq").on(
      table.siteId,
      table.date,
      table.source,
    ),
    siteDateIdx: index("owned_site_metrics_site_date_idx").on(
      table.siteId,
      table.date,
    ),
  }),
);
