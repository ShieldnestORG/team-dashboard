import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { partnerCompanies } from "./partners.js";

export const crmActivities = pgTable(
  "crm_activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id").notNull().references(() => partnerCompanies.id, { onDelete: "cascade" }),
    actorType: text("actor_type").notNull(),
    actorId: text("actor_id"),
    activityType: text("activity_type").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    visibleToAffiliate: boolean("visible_to_affiliate").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    leadCreatedIdx: index("crm_activities_lead_created_idx").on(t.leadId, t.createdAt),
    actorIdx: index("crm_activities_actor_idx").on(t.actorType, t.actorId),
  }),
);
