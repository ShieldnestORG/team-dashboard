import {
  pgTable,
  text,
  timestamp,
  jsonb,
  index,
  uuid,
} from "drizzle-orm/pg-core";

export interface MediaDropFile {
  objectKey: string;
  contentType: string;
  originalFilename: string;
  byteSize: number;
}

export const mediaDrops = pgTable(
  "media_drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: text("company_id").notNull(),
    caption: text("caption"),
    hashtags: text("hashtags").array(),
    platform: text("platform").notNull().default("twitter"),
    status: text("status").notNull().default("available"), // available | queued | posted
    files: jsonb("files").notNull().$type<MediaDropFile[]>(),
    postedTweetId: text("posted_tweet_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("media_drops_company_idx").on(table.companyId),
    statusIdx: index("media_drops_status_idx").on(table.status),
    createdAtIdx: index("media_drops_created_at_idx").on(table.createdAt),
  }),
);
