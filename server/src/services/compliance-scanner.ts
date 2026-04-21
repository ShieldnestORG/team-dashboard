// ---------------------------------------------------------------------------
// Affiliate compliance scanner
//
// Scans text an affiliate can write (affiliate_notes, CRM note entries, etc.)
// for policy violations (§6 misrepresentation). Two-pass detection: regex
// first, then LLM as a second opinion to reduce false positives.
//
// LLM strategy (same as seo-engine): Ollama Cloud first (free, VPS-hosted,
// gemma4:31b by default), fall back to Claude Haiku only when Ollama fails.
// If neither is available, insert on regex hit alone with a warning log.
//
// Exports:
//   - scanAffiliateText(db, { affiliateId, leadId?, source, text })
//   - startComplianceScanCron(db) — registers the `affiliate:engagement-scan`
//     cron that scans rows changed since the last run using systemCrons as
//     the cursor.
// ---------------------------------------------------------------------------

import { and, eq, gt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  affiliateViolations,
  crmActivities,
  partnerCompanies,
  systemCrons,
  type AffiliateViolationEvidence,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import {
  sendTransactional,
  type EmailTemplate,
  type EmailVars,
} from "./email-templates.js";
import { registerCronJob } from "./cron-registry.js";
import { callOllamaChat } from "./ollama-client.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const COMPLIANCE_CRON_NAME = "affiliate:engagement-scan";

// ---------------------------------------------------------------------------
// Regex rules
// ---------------------------------------------------------------------------

type Severity = "warning" | "strike" | "terminal";

interface ComplianceRule {
  rule: string;
  description: string;
  regex: RegExp;
  severity: Severity;
}

const PATTERNS: ComplianceRule[] = [
  {
    rule: "pricing_promise",
    description:
      "Promising or guaranteeing a specific price, rate, or discount to a prospect",
    regex: /\b(guarantee|promise|locked[- ]?in)\b.*\b(price|rate|discount)\b/i,
    severity: "warning",
  },
  {
    rule: "custom_discount",
    description: "Offering a specific percentage discount not authorized by CD",
    regex: /\b(\d{1,2})%\s*(off|discount)\b/i,
    severity: "warning",
  },
  {
    rule: "exclusive_territory",
    description: "Claiming exclusive territory or regional rights",
    regex: /\bexclusive\s+(territory|region|area)\b/i,
    severity: "strike",
  },
  {
    rule: "guarantee",
    description: "Guaranteeing specific outcomes, results, or leads",
    regex: /\b(guaranteed|will definitely)\b.*\b(results?|outcomes?|leads?)\b/i,
    severity: "strike",
  },
];

export type ComplianceSource =
  | "affiliate_notes"
  | "crm_note"
  | "first_touch_notes"
  | "email"
  | "admin_report";

export interface ScanInput {
  affiliateId: string;
  leadId?: string | null;
  source: ComplianceSource | string;
  text: string;
}

export interface ScanResult {
  violations: number;
}

// ---------------------------------------------------------------------------
// LLM second opinion — Ollama first, Claude fallback
// ---------------------------------------------------------------------------

function buildPrompt(rule: ComplianceRule, excerpt: string): string {
  return `Does this affiliate outreach text violate policy rule ${rule.rule} (${rule.description})? Answer YES or NO and one sentence.

Text:
"""
${excerpt}
"""`;
}

function parseVerdict(text: string): boolean | null {
  const trimmed = text.trim().toUpperCase();
  if (trimmed.startsWith("YES")) return true;
  if (trimmed.startsWith("NO")) return false;
  return null;
}

async function askOllama(rule: ComplianceRule, excerpt: string): Promise<boolean | null> {
  try {
    const result = await callOllamaChat(
      [{ role: "user", content: buildPrompt(rule, excerpt) }],
      { temperature: 0, maxTokens: 128, timeoutMs: 30_000 },
    );
    return parseVerdict(result.content);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), rule: rule.rule },
      "compliance-scanner: Ollama classification failed — trying Claude fallback",
    );
    return null;
  }
}

async function askClaude(rule: ComplianceRule, excerpt: string): Promise<boolean | null> {
  if (!ANTHROPIC_API_KEY) return null;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 128,
        messages: [{ role: "user", content: buildPrompt(rule, excerpt) }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: body.slice(0, 200), rule: rule.rule },
        "compliance-scanner: Claude API error — falling back to regex-only",
      );
      return null;
    }

    const data = (await res.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };
    return parseVerdict(data.content?.[0]?.text ?? "");
  } catch (err) {
    logger.warn({ err, rule: rule.rule }, "compliance-scanner: Claude fetch failed");
    return null;
  }
}

async function classifyViolation(
  rule: ComplianceRule,
  excerpt: string,
): Promise<{ verdict: boolean | null; backend: "ollama" | "claude" | "none" }> {
  const ollama = await askOllama(rule, excerpt);
  if (ollama !== null) return { verdict: ollama, backend: "ollama" };

  const claude = await askClaude(rule, excerpt);
  if (claude !== null) return { verdict: claude, backend: "claude" };

  return { verdict: null, backend: "none" };
}

// ---------------------------------------------------------------------------
// Public: scanAffiliateText
// ---------------------------------------------------------------------------

export async function scanAffiliateText(
  db: Db,
  input: ScanInput,
): Promise<ScanResult> {
  const { affiliateId, leadId, source, text } = input;
  if (!text || text.trim().length === 0) return { violations: 0 };

  let violationCount = 0;

  for (const rule of PATTERNS) {
    const match = rule.regex.exec(text);
    if (!match) continue;

    const excerpt = text.slice(0, 280);

    // LLM second opinion — Ollama first, Claude fallback.
    // If both are unavailable (backend="none"), insert on regex hit alone
    // with a warning log so the ops team knows classifier coverage dropped.
    const { verdict, backend } = await classifyViolation(rule, excerpt);
    if (verdict === false) continue; // LLM rejected — drop the regex false positive
    if (backend === "none") {
      logger.warn(
        { rule: rule.rule, affiliateId, source },
        "compliance-scanner: no LLM available — inserting regex-only violation",
      );
    }

    const evidence: AffiliateViolationEvidence = {
      source,
      excerpt,
      matchedPattern: rule.regex.toString(),
    };

    try {
      await db.insert(affiliateViolations).values({
        affiliateId,
        leadId: leadId ?? null,
        detectionType: "automated",
        ruleCode: rule.rule,
        severity: rule.severity,
        evidence,
        status: "open",
      });
      violationCount += 1;

      // Email admin — template owner is the email-templates author. Cast the
      // template name so this compiles before that template lands.
      const adminEmail =
        process.env.AFFILIATE_SUPPORT_EMAIL ??
        process.env.ALERT_EMAIL_TO ??
        process.env.SMTP_USER;
      if (adminEmail) {
        const vars: EmailVars = {
          recipientName: "Team",
          recipientEmail: adminEmail,
          affiliateName: affiliateId,
        };
        sendTransactional(
          "affiliate-violation-warning" as EmailTemplate,
          adminEmail,
          vars,
        ).catch((err) =>
          logger.warn({ err }, "compliance-scanner: admin email failed"),
        );
      }
    } catch (err) {
      logger.error(
        { err, affiliateId, rule: rule.rule, source },
        "compliance-scanner: failed to insert violation",
      );
    }
  }

  return { violations: violationCount };
}

// ---------------------------------------------------------------------------
// Cursor helpers
// ---------------------------------------------------------------------------

async function getCursor(db: Db): Promise<Date | null> {
  const [row] = await db
    .select({ lastRunAt: systemCrons.lastRunAt })
    .from(systemCrons)
    .where(eq(systemCrons.jobName, COMPLIANCE_CRON_NAME))
    .limit(1);
  return row?.lastRunAt ?? null;
}

// ---------------------------------------------------------------------------
// Cron: affiliate:engagement-scan
// ---------------------------------------------------------------------------

export function startComplianceScanCron(db: Db): void {
  registerCronJob({
    jobName: COMPLIANCE_CRON_NAME,
    schedule: "30 5 * * *",
    ownerAgent: "nova",
    sourceFile: "compliance-scanner.ts",
    handler: async () => {
      const cursor = await getCursor(db);

      let totalViolations = 0;
      let totalScanned = 0;

      // Source 1: partnerCompanies.affiliateNotes — scan rows updated since
      // the cursor. The affiliateId is on the partner row.
      try {
        const notesConds = cursor
          ? and(
              sql`${partnerCompanies.affiliateNotes} IS NOT NULL`,
              sql`${partnerCompanies.affiliateId} IS NOT NULL`,
              gt(partnerCompanies.updatedAt, cursor),
            )
          : and(
              sql`${partnerCompanies.affiliateNotes} IS NOT NULL`,
              sql`${partnerCompanies.affiliateId} IS NOT NULL`,
            );

        const notesRows = await db
          .select({
            leadId: partnerCompanies.id,
            affiliateId: partnerCompanies.affiliateId,
            affiliateNotes: partnerCompanies.affiliateNotes,
          })
          .from(partnerCompanies)
          .where(notesConds);

        for (const row of notesRows) {
          if (!row.affiliateId || !row.affiliateNotes) continue;
          totalScanned += 1;
          const r = await scanAffiliateText(db, {
            affiliateId: row.affiliateId,
            leadId: row.leadId,
            source: "affiliate_notes",
            text: row.affiliateNotes,
          });
          totalViolations += r.violations;
        }
      } catch (err) {
        logger.error({ err }, "compliance-scanner: affiliate_notes scan failed");
      }

      // Source 2: crm_activities.note WHERE actor_type = 'affiliate'
      try {
        const crmConds = cursor
          ? and(
              eq(crmActivities.actorType, "affiliate"),
              sql`${crmActivities.note} IS NOT NULL`,
              gt(crmActivities.createdAt, cursor),
            )
          : and(
              eq(crmActivities.actorType, "affiliate"),
              sql`${crmActivities.note} IS NOT NULL`,
            );

        const crmRows = await db
          .select({
            leadId: crmActivities.leadId,
            affiliateId: crmActivities.actorId,
            note: crmActivities.note,
          })
          .from(crmActivities)
          .where(crmConds);

        for (const row of crmRows) {
          if (!row.affiliateId || !row.note) continue;
          totalScanned += 1;
          const r = await scanAffiliateText(db, {
            affiliateId: row.affiliateId,
            leadId: row.leadId,
            source: "crm_note",
            text: row.note,
          });
          totalViolations += r.violations;
        }
      } catch (err) {
        logger.error({ err }, "compliance-scanner: crm_activities scan failed");
      }

      // Source 3: partnerCompanies.firstTouchNotes — the current schema does
      // not expose this column on `partner_companies` (first-touch notes live
      // on `referral_attribution.firstTouchNotes` instead). If and when the
      // column is added, scan it here. Skipped gracefully for now.

      logger.info(
        { totalScanned, totalViolations },
        "affiliate:engagement-scan complete",
      );
      return { scanned: totalScanned, violations: totalViolations };
    },
  });
}
