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

    // ── Business profile (Phase 2) ──────────────────────────────
    address: text("address"),
    phone: text("phone"),
    hours: jsonb("hours").$type<Record<string, string>>(),
    logoUrl: text("logo_url"),
    brandColors: jsonb("brand_colors").$type<{ primary: string; secondary: string; accent: string }>(),
    targetKeywords: jsonb("target_keywords").$type<string[]>(),
    targetAudience: text("target_audience"),

    // ── Microsite management (Phase 2) ──────────────────────────
    siteUrl: text("site_url"),
    siteRepoUrl: text("site_repo_url"),
    siteDeployStatus: text("site_deploy_status").notNull().default("none"),
    siteLastDeployedAt: timestamp("site_last_deployed_at", { withTimezone: true }),
    siteConfig: jsonb("site_config").$type<{
      template?: string;
      pages?: string[];
      navItems?: string[];
      ctaText?: string;
      ctaUrl?: string;
    }>(),
    siteVercelProjectId: text("site_vercel_project_id"),

    // ── Analytics baseline (Phase 2) ────────────────────────────
    baselineAnalytics: jsonb("baseline_analytics").$type<{
      capturedAt: string;
      monthlyVisitors?: number;
      domainAuthority?: number;
      topKeywords?: string[];
      sourceBreakdown?: Record<string, number>;
    }>(),
    baselineCapturedAt: timestamp("baseline_captured_at", { withTimezone: true }),

    // ── Content tracking (Phase 2) ──────────────────────────────
    contentPostCount: integer("content_post_count").notNull().default(0),
    lastContentGeneratedAt: timestamp("last_content_generated_at", { withTimezone: true }),
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
    siteDeployStatusIdx: index("partner_companies_site_status_idx").on(
      table.companyId,
      table.siteDeployStatus,
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

    // ── Enhanced tracking (Phase 2) ─────────────────────────────
    clickOrigin: text("click_origin").notNull().default("cd"),
    visitorType: text("visitor_type"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
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
    originIdx: index("partner_clicks_origin_idx").on(
      table.partnerSlug,
      table.clickOrigin,
    ),
  }),
);

export const partnerSiteContent = pgTable(
  "partner_site_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    partnerId: uuid("partner_id").notNull().references(() => partnerCompanies.id),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    contentType: text("content_type").notNull().default("blog_post"),
    body: text("body").notNull(),
    metaDescription: text("meta_description"),
    keywords: jsonb("keywords").$type<string[]>(),
    status: text("status").notNull().default("draft"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedUrl: text("published_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    partnerStatusIdx: index("partner_site_content_partner_status_idx").on(
      table.partnerId,
      table.status,
    ),
    partnerCreatedIdx: index("partner_site_content_partner_created_idx").on(
      table.partnerId,
      table.createdAt,
    ),
  }),
);
