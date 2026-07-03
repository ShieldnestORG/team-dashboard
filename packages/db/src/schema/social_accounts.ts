import { pgTable, uuid, text, timestamp, index, jsonb, boolean } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Single source of truth for every social handle the org operates.
// Connects platforms (X/Reddit/IG/etc.) to brands and to OAuth/manual records.
export const socialAccounts = pgTable(
  "social_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // 'cd' | 'tokns' | 'tx' | 'shieldnest' | 'directory' | 'partners' | 'coherencedaddy'
    brand: text("brand").notNull(),
    // 'x' | 'reddit' | 'devto' | 'hn' | 'instagram' | 'facebook' | 'youtube' |
    // 'discord' | 'bluesky' | 'linkedin' | 'substack' | 'skool' | 'tiktok' | 'github'
    platform: text("platform").notNull(),
    handle: text("handle").notNull(),
    displayName: text("display_name"),
    profileUrl: text("profile_url"),
    // 'oauth' | 'api_key' | 'manual' | 'none'
    connectionType: text("connection_type").notNull().default("manual"),
    // Pointer like "x_oauth_tokens:<accountSlug>" or "canva_oauth_tokens:<id>"
    oauthRef: text("oauth_ref"),
    // First-class Zernio account id (backfilled from oauth_ref "zernio:<id>",
    // migration 0122_zernio_engagement). oauth_ref stays authoritative for
    // publish routing; this column serves lead/analytics joins.
    zernioAccountId: text("zernio_account_id"),
    // 'active' | 'dormant' | 'paused' | 'deprecated'
    status: text("status").notNull().default("active"),
    // 'full_auto' | 'assisted' | 'manual' | 'none'
    automationMode: text("automation_mode").notNull().default("manual"),
    // Funnel-control gate (migration 0146_account_funnel_gate): whether this
    // account may run IG DM/comment funnels. Default OFF — an admin enables it
    // before any Zernio comment automation can be created/re-activated for it.
    funnelsEnabled: boolean("funnels_enabled").notNull().default(false),
    automationNotes: text("automation_notes"),
    lastActivityAt: timestamp("last_activity_at", { withTimezone: true }),
    ownerUserId: uuid("owner_user_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    archived: boolean("archived").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyBrandPlatformIdx: index("social_accounts_company_brand_platform_idx").on(
      table.companyId,
      table.brand,
      table.platform,
    ),
    platformIdx: index("social_accounts_platform_idx").on(table.platform),
    statusIdx: index("social_accounts_status_idx").on(table.status),
    zernioAccountIdx: index("social_accounts_zernio_account_idx").on(table.zernioAccountId),
  }),
);
