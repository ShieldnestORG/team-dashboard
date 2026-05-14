// ---------------------------------------------------------------------------
// Causal-constraint check cron.
//
// Job:    causal-constraints:check
// When:   Every 5 minutes.
// Owner:  causal (RAPIDE-style event-graph observer).
//
// On tick: iterate every enabled row in `event_constraints`. For each one,
// look at the last hour of activity_log rows with event_kind = pattern.of
// that are "old enough to have resolved" (created_at older than maxLagMs)
// and that lack a matching pattern.require child whose caused_by[] contains
// the parent id. Each unmatched parent is a VIOLATION:
//   - warn-logged
//   - recorded as `causal.constraint.violated` (so violations are themselves
//     causal events the next layer can constrain on)
//   - aggregated into per-constraint counters via a single UPDATE.
//
// Constraint recording itself uses recordEvent(), which swallows errors —
// observability must never crash the observer.
// ---------------------------------------------------------------------------

import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { eventConstraints } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { recordEvent } from "./causal-events.js";
import { logger } from "../middleware/logger.js";

const CHECK_SCHEDULE = "*/5 * * * *"; // every 5 minutes
const VIOLATION_BATCH_LIMIT = 100;

interface ViolationRow extends Record<string, unknown> {
  id: string;
  created_at: Date;
  entity_id: string;
  company_id: string | null;
}

export interface CausalConstraintCheckResult {
  constraintsChecked: number;
  totalViolations: number;
  errors: number;
}

/**
 * Default constraints seeded at boot. Idempotent: skipped per-kind if a row
 * with that `kind` already exists.
 */
const DEFAULT_CONSTRAINTS: Array<{
  kind: string;
  pattern: { of: string; require: string };
  maxLagMs: number;
}> = [
  {
    kind: "watchtower:query-completes",
    pattern: { of: "watchtower.query.sent", require: "watchtower.query.response" },
    maxLagMs: 60_000,
  },
  {
    kind: "watchtower:run-completes",
    pattern: { of: "watchtower.run.started", require: "watchtower.run.completed" },
    maxLagMs: 600_000,
  },
];

/**
 * Insert default constraints if no row exists for that `kind`. Safe to call
 * on every boot — it skips kinds that already exist.
 */
export async function seedDefaultEventConstraints(db: Db): Promise<number> {
  let inserted = 0;
  for (const defn of DEFAULT_CONSTRAINTS) {
    const existing = await db
      .select({ id: eventConstraints.id })
      .from(eventConstraints)
      .where(eq(eventConstraints.kind, defn.kind))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(eventConstraints).values({
      kind: defn.kind,
      pattern: defn.pattern,
      maxLagMs: defn.maxLagMs,
      enabled: true,
    });
    inserted += 1;
  }
  if (inserted > 0) {
    logger.info({ inserted }, "causal: seeded default event constraints");
  }
  return inserted;
}

/**
 * Find violators for a single constraint. Uses NOT EXISTS to delegate the
 * child-match check to Postgres rather than fanning out N queries.
 */
async function findViolators(
  db: Db,
  ofKind: string,
  requireKind: string,
  maxLagMs: number,
): Promise<ViolationRow[]> {
  const lagInterval = sql.raw(`'${maxLagMs} milliseconds'::interval`);
  const result = await db.execute<ViolationRow>(sql`
    SELECT parent.id, parent.created_at, parent.entity_id, parent.company_id
    FROM activity_log parent
    WHERE parent.event_kind = ${ofKind}
      AND parent.created_at > NOW() - INTERVAL '1 hour'
      AND parent.created_at < NOW() - ${lagInterval}
      AND NOT EXISTS (
        SELECT 1 FROM activity_log child
        WHERE child.event_kind = ${requireKind}
          AND parent.id = ANY(child.caused_by)
          AND child.created_at <= parent.created_at + ${lagInterval}
      )
    LIMIT ${VIOLATION_BATCH_LIMIT}
  `);
  // drizzle pg execute returns { rows } shape on node-postgres, or array on
  // neon-http. Normalize.
  const rows = Array.isArray(result)
    ? (result as unknown as ViolationRow[])
    : ((result as unknown as { rows: ViolationRow[] }).rows ?? []);
  return rows;
}

/**
 * Run one check cycle across all enabled constraints. Exported for tests.
 */
export async function runCausalConstraintCheck(
  db: Db,
): Promise<CausalConstraintCheckResult> {
  const constraints = await db
    .select()
    .from(eventConstraints)
    .where(eq(eventConstraints.enabled, true));

  let totalViolations = 0;
  let errors = 0;
  const now = new Date();

  for (const c of constraints) {
    try {
      const ofKind = c.pattern.of;
      const requireKind = c.pattern.require;
      const violators = await findViolators(db, ofKind, requireKind, c.maxLagMs);

      if (violators.length > 0) {
        for (const v of violators) {
          logger.warn(
            {
              constraintId: c.id,
              constraintKind: c.kind,
              of: ofKind,
              require: requireKind,
              maxLagMs: c.maxLagMs,
              violatorEventId: v.id,
              violatorEntityId: v.entity_id,
              violatorCreatedAt: v.created_at,
            },
            "causal: constraint violation",
          );

          // Record the violation as a causal event itself. companyId is required
          // by recordEvent; fall back to the violator's entity_id namespace if
          // the parent row's company_id is null (shouldn't happen in practice
          // for the seeded constraints, but the column is nullable).
          if (v.company_id) {
            await recordEvent(db, {
              kind: "causal.constraint.violated",
              companyId: v.company_id,
              entityId: c.id,
              entityType: "event_constraint",
              causedBy: [v.id],
              payload: {
                constraintId: c.id,
                constraintKind: c.kind,
                of: ofKind,
                require: requireKind,
                maxLagMs: c.maxLagMs,
                violatorKind: ofKind,
                violatorEntityId: v.entity_id,
              },
            });
          }
        }

        // Single aggregate UPDATE per constraint.
        await db
          .update(eventConstraints)
          .set({
            violationCount: sql`${eventConstraints.violationCount} + ${violators.length}`,
            lastViolationAt: now,
            lastCheckedAt: now,
            updatedAt: now,
          })
          .where(eq(eventConstraints.id, c.id));

        totalViolations += violators.length;
      } else {
        // No violations — just stamp last_checked_at.
        await db
          .update(eventConstraints)
          .set({ lastCheckedAt: now, updatedAt: now })
          .where(eq(eventConstraints.id, c.id));
      }
    } catch (err) {
      errors += 1;
      logger.error(
        { err, constraintId: c.id, constraintKind: c.kind },
        "causal: constraint check failed",
      );
    }
  }

  return {
    constraintsChecked: constraints.length,
    totalViolations,
    errors,
  };
}

/**
 * Whether the constraint-check cron is enabled. Default is enabled in prod;
 * set `CAUSAL_CONSTRAINTS_ENABLED=false` in env to disable scheduling (e.g. if
 * the check query is misbehaving and we need to stop writing
 * `causal.constraint.violated` events into activity_log).
 */
function causalConstraintsEnabled(): boolean {
  const raw = process.env.CAUSAL_CONSTRAINTS_ENABLED;
  if (raw === undefined || raw === null || raw === "") return true;
  return raw.toLowerCase() !== "false" && raw !== "0";
}

/**
 * Register the cron + seed defaults. Call from app boot.
 */
export function startCausalConstraintsCron(db: Db): void {
  if (!causalConstraintsEnabled()) {
    logger.warn(
      "causal: CAUSAL_CONSTRAINTS_ENABLED=false — skipping cron + default seed",
    );
    return;
  }

  // Fire-and-forget seed; logged inside. Don't await — boot must not block.
  void seedDefaultEventConstraints(db).catch((err) => {
    logger.error({ err }, "causal: seed default constraints failed");
  });

  registerCronJob({
    jobName: "causal-constraints:check",
    schedule: CHECK_SCHEDULE,
    ownerAgent: "causal",
    sourceFile: "causal-constraints-cron.ts",
    handler: async () => {
      const summary = await runCausalConstraintCheck(db);
      logger.info(summary, "causal: constraint check cycle complete");
    },
  });
}

// Suppress unused-import warning when `and` isn't referenced after refactors;
// kept here intentionally for future multi-condition queries.
void and;
