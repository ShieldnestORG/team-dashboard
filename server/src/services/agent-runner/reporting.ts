// ---------------------------------------------------------------------------
// Coherent Ones University — admin-only agent reports + cost ledger writers.
// reportAgentProblem(): deterministic, code-emitted problem reports (idempotent
// per (report_kind, dedupe_key)). logAgentUsage(): one row per Claude call with
// computed USD cost. Both are best-effort — a logging failure must NEVER crash
// an agent tick (Rule 10): they catch + log and return.
// ---------------------------------------------------------------------------

import { universityAgentReports, universityAgentUsage, type Db } from "@paperclipai/db";
import { gte, sql } from "drizzle-orm";
import { costUsd } from "./pricing.js";
import type { ReportKind, ReportSeverity, UsagePurpose } from "./types.js";
import { logger } from "../../middleware/logger.js";

export async function reportAgentProblem(
  db: Db,
  args: {
    memberId?: string | null; // nullable: auth_failure fires when the member is gone
    personaKey?: string | null;
    kind: ReportKind;
    severity?: ReportSeverity;
    message: string;
    context?: Record<string, unknown>;
    // '<persona|email>:<UTC-date>:<target>' — one row/day/kind/target.
    dedupeKey: string;
  },
): Promise<void> {
  try {
    await db
      .insert(universityAgentReports)
      .values({
        memberId: args.memberId ?? null,
        agentPersonaKey: args.personaKey ?? null,
        reportKind: args.kind,
        severity: args.severity ?? "warning",
        message: args.message,
        context: args.context ?? {},
        dedupeKey: args.dedupeKey,
      })
      .onConflictDoNothing({
        target: [
          universityAgentReports.reportKind,
          universityAgentReports.dedupeKey,
        ],
      });
  } catch (err) {
    logger.error({ err, kind: args.kind }, "agent-runner: reportAgentProblem failed (non-fatal)");
  }
}

export async function logAgentUsage(
  db: Db,
  args: {
    memberId?: string | null;
    personaKey: string;
    model: string;
    purpose: UsagePurpose;
    inputTokens: number;
    outputTokens: number;
    source?: "llm" | "fallback";
  },
): Promise<void> {
  try {
    const cost = costUsd(args.model, args.inputTokens, args.outputTokens);
    await db.insert(universityAgentUsage).values({
      memberId: args.memberId ?? null,
      agentPersonaKey: args.personaKey,
      model: args.model,
      purpose: args.purpose,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: cost.toFixed(6), // NUMERIC(12,6) takes a string
      source: args.source ?? "llm",
    });
  } catch (err) {
    logger.error({ err, model: args.model }, "agent-runner: logAgentUsage failed (non-fatal)");
  }
}

/** Sum today's (UTC) agent spend — drives the daily spend ceiling. */
export async function spentTodayUsd(db: Db): Promise<number> {
  try {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    // Date-filtered SQL SUM: only today's (UTC) rows, summed in-DB. This is the
    // value the daily-budget gate compares against — it MUST be today's spend,
    // not the all-time ledger total (which would false-trip the gate and
    // permanently silence agents). Mirrors the owned-sites.ts SUM pattern.
    const rows = await db
      .select({
        total: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)`,
      })
      .from(universityAgentUsage)
      .where(gte(universityAgentUsage.createdAt, startOfDay));
    return Number(rows[0]?.total ?? 0);
  } catch (err) {
    logger.error({ err }, "agent-runner: spentTodayUsd failed (non-fatal)");
    return 0;
  }
}
