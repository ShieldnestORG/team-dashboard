import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { partnerCompanies } from "./partners.js";

/**
 * City Business Leads — local businesses found via topic-based city search.
 *
 * Staging area: admin searches "handyman in Austin TX", the system scrapes
 * Firecrawl/Yelp/Reddit, and found businesses land here. Admin then decides:
 *
 *   - Promote to partner (partner_id set, lead_status = 'promoted_partner')
 *   - Verify and add notes (lead_status = 'verified')
 *   - Skip (lead_status = 'skipped')
 *
 * city_slug is a soft reference to city_intelligence.slug (not a FK) so leads
 * can be collected without a pre-existing city intelligence row.
 *
 * Lead statuses: 'new' | 'verified' | 'promoted_partner' | 'skipped'
 */

export type CityBusinessLead = typeof cityBusinessLeads.$inferSelect;
export type NewCityBusinessLead = typeof cityBusinessLeads.$inferInsert;

export const cityBusinessLeads = pgTable(
  "city_business_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    citySlug: text("city_slug").notNull(),
    topic: text("topic").notNull(),
    name: text("name").notNull(),
    website: text("website"),
    phone: text("phone"),
    address: text("address"),
    category: text("category"),
    rating: numeric("rating", { precision: 3, scale: 1 }),
    reviewCount: integer("review_count"),
    source: text("source").notNull(),
    sourceUrl: text("source_url"),
    rawSnippet: text("raw_snippet"),
    leadStatus: text("lead_status").notNull().default("new"),
    partnerId: uuid("partner_id").references(() => partnerCompanies.id, {
      onDelete: "set null",
    }),
    foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
    actionedAt: timestamp("actioned_at", { withTimezone: true }),
    notes: text("notes"),
  },
  (t) => ({
    companyCityIdx: index("city_business_leads_company_city_idx").on(
      t.companyId,
      t.citySlug,
    ),
    topicIdx: index("city_business_leads_topic_idx").on(t.companyId, t.topic),
    statusIdx: index("city_business_leads_status_idx").on(t.leadStatus),
  }),
);
