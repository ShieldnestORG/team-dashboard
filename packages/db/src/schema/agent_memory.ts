import {
  pgTable,
  serial,
  text,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const agentMemory = pgTable(
  "agent_memory",
  {
    id: serial("id").primaryKey(),
    agentName: text("agent_name").notNull(),
    subject: text("subject").notNull(),
    predicate: text("predicate").notNull(),
    object: text("object").notNull(),
    confidence: real("confidence").notNull().default(1.0),
    source: text("source"),
    // embedding stored as vector(1024) in postgres via migration;
    // Drizzle doesn't have native pgvector support, so we use raw SQL for vector ops
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index("idx_agent_memory_agent_drizzle").on(table.agentName),
    subjectIdx: index("idx_agent_memory_subject_drizzle").on(table.subject, table.predicate),
    expiresIdx: index("idx_agent_memory_expires_drizzle").on(table.expiresAt),
  }),
);
