import {
  pgTable,
  uuid,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

export const agentInstructionFiles = pgTable(
  "agent_instruction_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    relativePath: text("relative_path").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentPathUniqueIdx: uniqueIndex("agent_instruction_files_agent_path_idx").on(
      table.agentId,
      table.relativePath,
    ),
    companyIdx: index("agent_instruction_files_company_idx").on(table.companyId),
  }),
);
