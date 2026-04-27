import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// ---------------------------------------------------------------------------
// Launch Tracked Items — HN / Reddit / dev.to launch posts the team is
// actively watching. The comment-monitor cron polls each active row's
// platform endpoint and inserts new comments into `comment_replies`.
//
// Polling stops automatically once `watch_until` is passed OR `active` is
// flipped to false. `last_polled_at` is updated each cycle for ops visibility.
// ---------------------------------------------------------------------------

export const launchTrackedItems = pgTable(
  "launch_tracked_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    // platform: hn | reddit | devto
    platform: text("platform").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title"),
    postUrl: text("post_url"),
    watchUntil: timestamp("watch_until", { withTimezone: true }).notNull(),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniq: uniqueIndex("launch_tracked_items_company_platform_external_uniq").on(
      table.companyId,
      table.platform,
      table.externalId,
    ),
    activeIdx: index("launch_tracked_items_active_idx").on(table.active, table.watchUntil),
  }),
);

export type LaunchTrackedItem = typeof launchTrackedItems.$inferSelect;
export type NewLaunchTrackedItem = typeof launchTrackedItems.$inferInsert;
