import { pgTable, uuid, text, timestamp, unique } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const xOauthTokens = pgTable(
  "x_oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    accountSlug: text("account_slug").notNull().default("primary"),
    xUserId: text("x_user_id").notNull(),
    xUsername: text("x_username").notNull(),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    scope: text("scope").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    companyAccountUq: unique("x_oauth_tokens_company_account_uq").on(table.companyId, table.accountSlug),
  }),
);
