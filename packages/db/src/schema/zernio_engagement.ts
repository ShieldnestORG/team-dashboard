import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { socialAccounts } from "./social_accounts.js";
import { socialPosts } from "./social_posts.js";

// Zernio engagement layer (migration 0122_zernio_engagement, team-dashboard's
// own sequence). Comment->DM->captured-lead loop + Goal B analytics storage.
// Spec: marketing/plans/plan-zernio-leverage.md §2; CONTROLLER-AUDIT Goal B.
// NOTE: never blend these analytics with x_engagement_log (X-engine) numbers —
// they measure different things.

// At-least-once webhook inbox, deduped on Zernio's stable event id.
export const zernioWebhookEvents = pgTable(
  "zernio_webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    zernioAccountId: text("zernio_account_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    error: text("error"),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    eventIdUq: uniqueIndex("zernio_webhook_events_event_id_uq").on(table.eventId),
    typeReceivedIdx: index("zernio_webhook_events_type_received_idx").on(
      table.eventType,
      table.receivedAt,
    ),
  }),
);

// Captured leads (comment / dm / lead_form / contact_tag). Brevo is the
// nurture CRM: rows with an email are synced by the lead relayer tick.
export const socialLeads = pgTable(
  "social_leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull().default("zernio"),
    // 'comment' | 'dm' | 'lead_form' | 'contact_tag'
    captureKind: text("capture_kind").notNull(),
    platform: text("platform"),
    zernioAccountId: text("zernio_account_id"),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    platformUserId: text("platform_user_id"),
    handle: text("handle"),
    displayName: text("display_name"),
    email: text("email"),
    keyword: text("keyword"),
    clickTag: text("click_tag"),
    zernioContactId: text("zernio_contact_id"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    eventCount: integer("event_count").notNull().default(1),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull().defaultNow(),
    brevoSyncedAt: timestamp("brevo_synced_at", { withTimezone: true }),
    brevoAttempts: integer("brevo_attempts").notNull().default(0),
    brevoError: text("brevo_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Partial unique indexes (WHERE ... IS NOT NULL) are declared in the SQL
    // migration; drizzle-kit's typed builder can't express them, so only the
    // plain lookup index is mirrored here.
    accountIdx: index("social_leads_account_idx").on(table.zernioAccountId, table.lastEventAt),
  }),
);

// Local mirror of Zernio comment automations (keyword funnels: ROOM, COHERENT,
// ...). Zernio is the source of truth; this powers the cockpit list and
// supplies the clickTag set the contacts poller scans.
export const zernioCommentAutomations = pgTable(
  "zernio_comment_automations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    zernioAutomationId: text("zernio_automation_id").notNull(),
    zernioAccountId: text("zernio_account_id").notNull(),
    socialAccountId: uuid("social_account_id").references(() => socialAccounts.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    platform: text("platform"),
    // 'comment' | 'story_reply'
    trigger: text("trigger").notNull().default("comment"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    // 'exact' | 'contains'
    matchMode: text("match_mode").notNull().default("contains"),
    dmMessage: text("dm_message").notNull(),
    buttons: jsonb("buttons").$type<Record<string, unknown>[]>().notNull().default([]),
    commentReply: text("comment_reply"),
    linkTracking: boolean("link_tracking").notNull().default(true),
    clickTag: text("click_tag"),
    isActive: boolean("is_active").notNull().default(true),
    stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({}),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    zidUq: uniqueIndex("zernio_comment_automations_zid_uq").on(table.zernioAutomationId),
    accountIdx: index("zernio_comment_automations_account_idx").on(table.zernioAccountId),
  }),
);

// Whole-endpoint analytics snapshots (daily-metrics, best-time, content-decay,
// posting-frequency, follower-stats, health, inbox-volume, ...).
export const zernioAnalyticsSnapshots = pgTable(
  "zernio_analytics_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    metric: text("metric").notNull(),
    zernioAccountId: text("zernio_account_id"),
    platform: text("platform"),
    windowFrom: timestamp("window_from", { withTimezone: true }),
    windowTo: timestamp("window_to", { withTimezone: true }),
    addonMissing: boolean("addon_missing").notNull().default(false),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index("zernio_analytics_snapshots_lookup_idx").on(
      table.metric,
      table.zernioAccountId,
      table.fetchedAt,
    ),
  }),
);

// Per-post analytics, flattened per platform, correlated back to social_posts
// via platform_post_id / posted_url (External-Post-ID correlation, Goal B).
export const zernioPostAnalytics = pgTable(
  "zernio_post_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalPostId: text("external_post_id").notNull(),
    zernioPostId: text("zernio_post_id"),
    zernioAccountId: text("zernio_account_id"),
    platform: text("platform").notNull(),
    platformPostId: text("platform_post_id"),
    platformPostUrl: text("platform_post_url"),
    socialPostId: uuid("social_post_id").references(() => socialPosts.id, {
      onDelete: "set null",
    }),
    content: text("content"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    extUq: uniqueIndex("zernio_post_analytics_ext_uq").on(table.externalPostId, table.platform),
    accountIdx: index("zernio_post_analytics_account_idx").on(
      table.zernioAccountId,
      table.publishedAt,
    ),
  }),
);

export type ZernioWebhookEvent = typeof zernioWebhookEvents.$inferSelect;
export type NewZernioWebhookEvent = typeof zernioWebhookEvents.$inferInsert;
export type SocialLead = typeof socialLeads.$inferSelect;
export type NewSocialLead = typeof socialLeads.$inferInsert;
export type ZernioCommentAutomation = typeof zernioCommentAutomations.$inferSelect;
export type NewZernioCommentAutomation = typeof zernioCommentAutomations.$inferInsert;
export type ZernioAnalyticsSnapshot = typeof zernioAnalyticsSnapshots.$inferSelect;
export type NewZernioAnalyticsSnapshot = typeof zernioAnalyticsSnapshots.$inferInsert;
export type ZernioPostAnalytics = typeof zernioPostAnalytics.$inferSelect;
export type NewZernioPostAnalytics = typeof zernioPostAnalytics.$inferInsert;
