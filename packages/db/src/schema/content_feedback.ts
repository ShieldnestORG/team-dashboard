import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const contentFeedback = pgTable(
  "content_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    contentItemId: uuid("content_item_id").notNull(),
    contentType: text("content_type").notNull(),
    rating: text("rating").notNull(),
    comment: text("comment"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyTypeCreatedIdx: index("content_feedback_company_type_created_idx").on(
      table.companyId,
      table.contentType,
      table.createdAt,
    ),
    contentItemIdx: index("content_feedback_content_item_idx").on(table.contentItemId),
  }),
);
