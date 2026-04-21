import {
  pgTable, uuid, text, timestamp, integer, jsonb, index,
} from "drizzle-orm/pg-core";
import { affiliates } from "./affiliates.js";
import { partnerCompanies } from "./partners.js";

export type AffiliateViolationEvidence = {
  source: string;
  excerpt: string;
  matchedPattern?: string;
};

export const affiliateViolations = pgTable(
  "affiliate_violations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    affiliateId: uuid("affiliate_id").notNull().references(() => affiliates.id),
    leadId: uuid("lead_id").references(() => partnerCompanies.id),
    detectionType: text("detection_type").notNull(),
    ruleCode: text("rule_code").notNull(),
    severity: text("severity").notNull(),
    evidence: jsonb("evidence").$type<AffiliateViolationEvidence>().notNull(),
    status: text("status").notNull().default("open"),
    commissionsClawedBack: integer("commissions_clawed_back").notNull().default(0),
    reviewedByUserId: uuid("reviewed_by_user_id"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    affiliateStatusIdx: index("affiliate_violations_affiliate_status_idx").on(t.affiliateId, t.status),
    severityIdx: index("affiliate_violations_severity_idx").on(t.severity),
  }),
);
