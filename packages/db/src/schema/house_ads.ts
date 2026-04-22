import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { assets } from "./assets.js";

// ---------------------------------------------------------------------------
// House ads — admin-managed in-house creatives served to *.coherencedaddy.com
// subdomains while AdSense approval is pending and as a permanent fallback.
// See docs/products/house-ads.md.
// ---------------------------------------------------------------------------

export const houseAds = pgTable(
  "house_ads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    title: text("title").notNull(),
    imageAssetId: uuid("image_asset_id")
      .notNull()
      .references(() => assets.id),
    imageAlt: text("image_alt").notNull().default(""),
    clickUrl: text("click_url").notNull(),
    // slot: header | in-article-1 | in-article-2 | sidebar | footer (free-text)
    slot: text("slot").notNull(),
    weight: integer("weight").notNull().default(1),
    active: boolean("active").notNull().default(true),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    impressions: bigint("impressions", { mode: "number" }).notNull().default(0),
    clicks: bigint("clicks", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("house_ads_company_idx").on(table.companyId),
    slotActiveIdx: index("house_ads_slot_active_idx").on(table.slot, table.active),
  }),
);
