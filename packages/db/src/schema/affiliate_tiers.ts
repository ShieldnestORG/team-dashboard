import {
  pgTable, uuid, text, timestamp, numeric, integer, jsonb, uniqueIndex,
} from "drizzle-orm/pg-core";

export const affiliateTiers = pgTable(
  "affiliate_tiers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    displayOrder: integer("display_order").notNull(),
    commissionRate: numeric("commission_rate", { precision: 5, scale: 4 }).notNull(),
    minLifetimeCents: integer("min_lifetime_cents").notNull(),
    minActivePartners: integer("min_active_partners").notNull().default(0),
    perks: jsonb("perks").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameUq: uniqueIndex("affiliate_tiers_name_uq").on(t.name),
  }),
);
