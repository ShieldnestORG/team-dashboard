import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const partnerCompanies = pgTable(
  "partner_companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    industry: text("industry").notNull(),
    location: text("location"),
    website: text("website"),
    description: text("description"),
    services: jsonb("services").$type<string[]>().default([]),
    socialHandles: jsonb("social_handles").$type<Record<string, string>>(),
    contactName: text("contact_name"),
    contactEmail: text("contact_email"),
    tier: text("tier").notNull().default("proof"),
    status: text("status").notNull().default("trial"),
    monthlyFee: integer("monthly_fee"),
    referralFeePerClient: integer("referral_fee_per_client"),
    contentMentions: integer("content_mentions").notNull().default(0),
    totalClicks: integer("total_clicks").notNull().default(0),
    dashboardToken: text("dashboard_token"),
    partnerSince: timestamp("partner_since", { withTimezone: true }).defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companySlugUq: uniqueIndex("partner_companies_company_slug_uq").on(
      table.companyId,
      table.slug,
    ),
    companyStatusIdx: index("partner_companies_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    companyIndustryIdx: index("partner_companies_company_industry_idx").on(
      table.companyId,
      table.industry,
    ),
    dashboardTokenUq: uniqueIndex("partner_companies_dashboard_token_uq").on(
      table.dashboardToken,
    ),
  }),
);

export const partnerClicks = pgTable(
  "partner_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerSlug: text("partner_slug").notNull(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    sourceContentId: text("source_content_id"),
    sourceType: text("source_type"),
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    partnerClickedIdx: index("partner_clicks_partner_clicked_idx").on(
      table.partnerSlug,
      table.clickedAt,
    ),
    companyClickedIdx: index("partner_clicks_company_clicked_idx").on(
      table.companyId,
      table.clickedAt,
    ),
  }),
);
