import { boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Every ops alert fired through sendAlert() lands here, whether or not it was
// emailed. severity: "critical" = emailed immediately; "routine" = queued for
// the Sunday alert:weekly-recap roll-up email.
export const alertEvents = pgTable(
  "alert_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    emailSent: boolean("email_sent").notNull().default(false),
    emailError: text("email_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    createdIdx: index("alert_events_created_idx").on(table.createdAt),
    typeCreatedIdx: index("alert_events_type_created_idx").on(table.type, table.createdAt),
  }),
);
