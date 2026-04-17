import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const contentClicks = pgTable(
  "content_clicks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentItemId: text("content_item_id").notNull(),
    companyId: uuid("company_id").references(() => companies.id),
    eventType: text("event_type").notNull(), // 'view' | 'click' | 'share'
    referrer: text("referrer"),
    userAgent: text("user_agent"),
    ipHash: text("ip_hash"),
    clickOrigin: text("click_origin").notNull().default("cd"),
    visitorType: text("visitor_type"), // 'human' | 'agent' | 'unknown'
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    clickedAt: timestamp("clicked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentClickedIdx: index("content_clicks_content_clicked_idx").on(
      table.contentItemId,
      table.clickedAt,
    ),
    companyClickedIdx: index("content_clicks_company_clicked_idx").on(
      table.companyId,
      table.clickedAt,
    ),
  }),
);
