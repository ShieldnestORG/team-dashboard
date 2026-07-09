/**
 * Centralized cron registry — replaces per-file setInterval tick loops.
 *
 * Each *-crons.ts file calls registerCronJob() to register its jobs.
 * On boot, syncCronRegistry() upserts all registered jobs into the DB.
 * startCronScheduler() runs a single 30s tick that checks DB state
 * (enabled, schedule_override) and executes due jobs.
 */

import { eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { systemCrons, socialAutomations } from "@paperclipai/db";
import { parseCron, nextCronTick } from "./cron.js";
import { logger } from "../middleware/logger.js";
import { sendAlert } from "./alerting.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CronJobDefinition {
  jobName: string;
  schedule: string;
  ownerAgent: string;
  sourceFile: string;
  handler: () => Promise<unknown>;
}

export interface CronJobState {
  jobName: string;
  schedule: string;
  scheduleOverride: string | null;
  ownerAgent: string;
  sourceFile: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: string | null;
  runCount: number;
  errorCount: number;
  running: boolean;
}

// ---------------------------------------------------------------------------
// In-memory registry
// ---------------------------------------------------------------------------

interface RegisteredJob {
  def: CronJobDefinition;
  handler: () => Promise<unknown>;
  running: boolean;
  nextRun: Date | null;
  // Self-healing: consecutive failures since the last success. Reset to 0 on
  // any successful run; incremented in the tick's catch. Kept in-memory only
  // (no migration) — resets on process restart, which is the desired behavior.
  consecutiveFailures: number;
  // True once the circuit breaker has auto-disabled this job, so we only fire
  // one alert + one auto-pause per crash-loop episode (not every tick).
  breakerTripped: boolean;
}

const registry = new Map<string, RegisteredJob>();

// ---------------------------------------------------------------------------
// Circuit breaker config (env-gated, no migration — in-memory state only)
// ---------------------------------------------------------------------------

const CIRCUIT_BREAKER_THRESHOLD = Math.max(
  1,
  Number(process.env.CRON_CIRCUIT_BREAKER_THRESHOLD) || 5,
);
// Auto-pause behaviour defaults ON; alert-only when explicitly "false".
const CIRCUIT_BREAKER_ENABLED =
  (process.env.CRON_CIRCUIT_BREAKER_ENABLED ?? "true") !== "false";

/**
 * Safely parse a cron expression. parseCron() THROWS on invalid syntax; this
 * wrapper converts a throw into null so a single bad schedule degrades only
 * that one job instead of taking down registration or the tick loop.
 */
function safeParseCron(expression: string): ReturnType<typeof parseCron> | null {
  try {
    return parseCron(expression);
  } catch (err) {
    logger.warn(
      { err, expression },
      "Invalid cron expression — job will not be scheduled until corrected",
    );
    return null;
  }
}

// DB state cache (refreshed from DB on each tick)
let dbState = new Map<string, {
  enabled: boolean;
  scheduleOverride: string | null;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastError: string | null;
  nextRunAt: Date | null;
  runCount: number;
  errorCount: number;
}>();

// ---------------------------------------------------------------------------
// Public API: register
// ---------------------------------------------------------------------------

export function registerCronJob(def: CronJobDefinition): void {
  const parsed = safeParseCron(def.schedule);
  const nextRun = parsed ? nextCronTick(parsed, new Date()) : null;
  registry.set(def.jobName, {
    def,
    handler: def.handler,
    running: false,
    nextRun,
    consecutiveFailures: 0,
    breakerTripped: false,
  });
}

// ---------------------------------------------------------------------------
// Public API: sync to DB
// ---------------------------------------------------------------------------

export async function syncCronRegistry(db: Db): Promise<void> {
  for (const [jobName, entry] of registry) {
    const { def } = entry;
    const effectiveSchedule = def.schedule;
    const parsed = safeParseCron(effectiveSchedule);
    const nextRunAt = parsed ? nextCronTick(parsed, new Date()) : null;

    // Upsert: insert if missing, update schedule/owner/source if changed
    await db
      .insert(systemCrons)
      .values({
        jobName,
        schedule: def.schedule,
        ownerAgent: def.ownerAgent,
        sourceFile: def.sourceFile,
        nextRunAt,
      })
      .onConflictDoUpdate({
        target: systemCrons.jobName,
        set: {
          schedule: def.schedule,
          ownerAgent: def.ownerAgent,
          sourceFile: def.sourceFile,
          updatedAt: new Date(),
        },
      });
  }

  // Load DB state into cache
  await refreshDbState(db);

  logger.info(
    { count: registry.size, jobs: Array.from(registry.keys()) },
    "Cron registry synced to DB",
  );
}

async function refreshDbState(db: Db): Promise<void> {
  const rows = await db.select().from(systemCrons);
  const newState = new Map<string, typeof dbState extends Map<string, infer V> ? V : never>();
  for (const row of rows) {
    newState.set(row.jobName, {
      enabled: row.enabled,
      scheduleOverride: row.scheduleOverride,
      lastRunAt: row.lastRunAt,
      lastDurationMs: row.lastDurationMs,
      lastError: row.lastError,
      nextRunAt: row.nextRunAt,
      runCount: row.runCount,
      errorCount: row.errorCount,
    });
  }
  dbState = newState;
}

// ---------------------------------------------------------------------------
// Public API: scheduler
// ---------------------------------------------------------------------------

let schedulerDb: Db | null = null;
let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startCronScheduler(db: Db): () => void {
  schedulerDb = db;
  const TICK_INTERVAL_MS = 30_000;

  // Refresh DB state every 5 minutes (10 ticks) to pick up UI changes
  let tickCount = 0;

  const tick = async () => {
    tickCount++;

    // Refresh DB state periodically (every 5 min)
    if (tickCount % 10 === 0) {
      try {
        await refreshDbState(db);
      } catch (err) {
        logger.error({ err }, "Failed to refresh cron DB state");
      }
    }

    const now = new Date();

    for (const [jobName, entry] of registry) {
      if (entry.running) continue;

      // Check DB state for enabled/schedule override
      const state = dbState.get(jobName);
      if (state && !state.enabled) continue;

      // Determine effective schedule
      const effectiveSchedule = state?.scheduleOverride || entry.def.schedule;

      // Recompute nextRun if schedule changed
      if (!entry.nextRun) {
        const parsed = safeParseCron(effectiveSchedule);
        entry.nextRun = parsed ? nextCronTick(parsed, new Date()) : null;
      }

      if (!entry.nextRun || now < entry.nextRun) continue;

      // Execute the job
      entry.running = true;
      const startTime = Date.now();
      logger.info({ job: jobName, ownerAgent: entry.def.ownerAgent }, "Cron job starting");

      try {
        await entry.handler();
        const durationMs = Date.now() - startTime;
        logger.info({ job: jobName, ownerAgent: entry.def.ownerAgent, durationMs }, "Cron job completed");

        // Self-healing: a clean run resets the circuit breaker.
        entry.consecutiveFailures = 0;
        entry.breakerTripped = false;

        // Update DB state
        await db
          .update(systemCrons)
          .set({
            lastRunAt: new Date(),
            lastDurationMs: durationMs,
            lastError: null,
            runCount: sql`${systemCrons.runCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(systemCrons.jobName, jobName));

        // Update cache
        if (state) {
          state.lastRunAt = new Date();
          state.lastDurationMs = durationMs;
          state.lastError = null;
          state.runCount = (state.runCount || 0) + 1;
        }
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.error({ err, job: jobName, ownerAgent: entry.def.ownerAgent }, "Cron job failed");

        // Self-healing: track consecutive failures for the circuit breaker.
        entry.consecutiveFailures += 1;

        await db
          .update(systemCrons)
          .set({
            lastRunAt: new Date(),
            lastDurationMs: durationMs,
            lastError: errorMsg,
            runCount: sql`${systemCrons.runCount} + 1`,
            errorCount: sql`${systemCrons.errorCount} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(systemCrons.jobName, jobName))
          .catch((e) => logger.error({ e }, "Failed to update cron error state"));

        if (state) {
          state.lastRunAt = new Date();
          state.lastDurationMs = durationMs;
          state.lastError = errorMsg;
          state.runCount = (state.runCount || 0) + 1;
          state.errorCount = (state.errorCount || 0) + 1;
        }

        // Circuit breaker — must never throw back into the tick.
        await tripCircuitBreakerIfNeeded(db, jobName, entry, errorMsg).catch(
          (e) =>
            logger.error({ e, job: jobName }, "Circuit breaker handler failed"),
        );
      } finally {
        entry.running = false;
        // Compute next run
        const sched = (state?.scheduleOverride) || entry.def.schedule;
        const parsed = safeParseCron(sched);
        entry.nextRun = parsed ? nextCronTick(parsed, new Date()) : null;

        // Update nextRunAt in DB
        if (entry.nextRun) {
          await db
            .update(systemCrons)
            .set({ nextRunAt: entry.nextRun })
            .where(eq(systemCrons.jobName, jobName))
            .catch((e) => logger.error({ e }, "Failed to update cron nextRunAt"));
        }
      }
    }
  };

  schedulerInterval = setInterval(tick, TICK_INTERVAL_MS);

  logger.info({ jobCount: registry.size }, "Cron scheduler started (30s tick)");

  return () => {
    if (schedulerInterval) clearInterval(schedulerInterval);
    schedulerInterval = null;
    schedulerDb = null;
  };
}

// ---------------------------------------------------------------------------
// Circuit breaker — self-healing for crash-looping jobs
// ---------------------------------------------------------------------------

/**
 * Called from the tick's catch block after a failure. When a job crosses the
 * consecutive-failure threshold, fire ONE alert (and, unless alert-only mode is
 * configured, auto-disable the job through the registry's normal persisted
 * update path so it stops re-running). Fires at most once per crash-loop
 * episode — a later success resets `breakerTripped`.
 *
 * This function must never throw back into the tick; the caller also guards it.
 */
async function tripCircuitBreakerIfNeeded(
  db: Db,
  jobName: string,
  entry: RegisteredJob,
  lastError: string,
): Promise<void> {
  if (entry.consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return;
  if (entry.breakerTripped) return; // already handled this episode

  entry.breakerTripped = true;

  if (CIRCUIT_BREAKER_ENABLED) {
    logger.warn(
      {
        job: jobName,
        ownerAgent: entry.def.ownerAgent,
        consecutiveFailures: entry.consecutiveFailures,
        threshold: CIRCUIT_BREAKER_THRESHOLD,
        lastError,
      },
      "Circuit breaker tripped — auto-disabling crash-looping cron job",
    );
    // Disable via the same persisted path the registry already uses, so it
    // stops re-running and the change is reflected in DB + cache + UI.
    const result = await updateCronJob(db, jobName, { enabled: false });
    if (!result.ok) {
      logger.error(
        { job: jobName, error: result.error },
        "Circuit breaker failed to auto-disable cron job",
      );
    }
  } else {
    logger.warn(
      {
        job: jobName,
        ownerAgent: entry.def.ownerAgent,
        consecutiveFailures: entry.consecutiveFailures,
        threshold: CIRCUIT_BREAKER_THRESHOLD,
        lastError,
      },
      "Circuit breaker threshold reached (auto-disable off) — alerting only",
    );
  }

  const action = CIRCUIT_BREAKER_ENABLED
    ? "Auto-disabled to stop the crash loop. Fix the underlying error, then re-enable from /automation-health."
    : "Auto-disable is OFF (CRON_CIRCUIT_BREAKER_ENABLED=false); the job is still running. Fix the underlying error.";
  await sendAlert(
    "cron_breaker",
    `Cron job "${jobName}" crash-looping`,
    `Job "${jobName}" (owner: ${entry.def.ownerAgent}, ${entry.def.sourceFile}) failed ${entry.consecutiveFailures} consecutive times (threshold ${CIRCUIT_BREAKER_THRESHOLD}).\n\nLast error: ${lastError}\n\n${action}`,
  );
}

// ---------------------------------------------------------------------------
// Public API: status (for API routes)
// ---------------------------------------------------------------------------

export function getCronStatus(): CronJobState[] {
  const result: CronJobState[] = [];

  for (const [jobName, entry] of registry) {
    const state = dbState.get(jobName);
    result.push({
      jobName,
      schedule: entry.def.schedule,
      scheduleOverride: state?.scheduleOverride ?? null,
      ownerAgent: entry.def.ownerAgent,
      sourceFile: entry.def.sourceFile,
      enabled: state?.enabled ?? true,
      lastRunAt: state?.lastRunAt?.toISOString() ?? null,
      lastDurationMs: state?.lastDurationMs ?? null,
      lastError: state?.lastError ?? null,
      nextRunAt: entry.nextRun?.toISOString() ?? state?.nextRunAt?.toISOString() ?? null,
      runCount: state?.runCount ?? 0,
      errorCount: state?.errorCount ?? 0,
      running: entry.running,
    });
  }

  return result.sort((a, b) => a.ownerAgent.localeCompare(b.ownerAgent) || a.jobName.localeCompare(b.jobName));
}

// ---------------------------------------------------------------------------
// Public API: manual trigger
// ---------------------------------------------------------------------------

export async function triggerCronJob(jobName: string): Promise<{ ok: boolean; error?: string }> {
  const entry = registry.get(jobName);
  if (!entry) return { ok: false, error: `Job "${jobName}" not found` };
  if (entry.running) return { ok: false, error: `Job "${jobName}" is already running` };

  const db = schedulerDb;
  if (!db) return { ok: false, error: "Scheduler not started" };

  entry.running = true;
  const startTime = Date.now();

  try {
    await entry.handler();
    const durationMs = Date.now() - startTime;

    await db
      .update(systemCrons)
      .set({
        lastRunAt: new Date(),
        lastDurationMs: durationMs,
        lastError: null,
        runCount: sql`${systemCrons.runCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(systemCrons.jobName, jobName));

    return { ok: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const durationMs = Date.now() - startTime;

    await db
      .update(systemCrons)
      .set({
        lastRunAt: new Date(),
        lastDurationMs: durationMs,
        lastError: errorMsg,
        runCount: sql`${systemCrons.runCount} + 1`,
        errorCount: sql`${systemCrons.errorCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(systemCrons.jobName, jobName))
      .catch(() => {});

    return { ok: false, error: errorMsg };
  } finally {
    entry.running = false;
    const state = dbState.get(jobName);
    const sched = state?.scheduleOverride || entry.def.schedule;
    const parsed = safeParseCron(sched);
    entry.nextRun = parsed ? nextCronTick(parsed, new Date()) : null;
  }
}

// ---------------------------------------------------------------------------
// Public API: update job settings (called from API route)
// ---------------------------------------------------------------------------

export async function updateCronJob(
  db: Db,
  jobName: string,
  updates: { enabled?: boolean; scheduleOverride?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const entry = registry.get(jobName);
  if (!entry) return { ok: false, error: `Job "${jobName}" not found` };

  // Validate schedule if provided
  if (updates.scheduleOverride) {
    try {
      parseCron(updates.scheduleOverride);
    } catch (err) {
      return { ok: false, error: `Invalid cron expression: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  const setValues: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.enabled !== undefined) setValues.enabled = updates.enabled;
  if (updates.scheduleOverride !== undefined) setValues.scheduleOverride = updates.scheduleOverride;

  // Recompute nextRunAt if schedule changed
  const effectiveSchedule = updates.scheduleOverride || entry.def.schedule;
  const parsed = parseCron(effectiveSchedule);
  const nextRunAt = parsed ? nextCronTick(parsed, new Date()) : null;
  setValues.nextRunAt = nextRunAt;
  entry.nextRun = nextRunAt;

  await db
    .update(systemCrons)
    .set(setValues)
    .where(eq(systemCrons.jobName, jobName));

  // Side-effect: keep social_automations rows in sync with system_crons changes
  // so the read-only Automation tab on /socials doesn't show stale data until the
  // next manual sync. Mirrors `enabled` (toggle) and `cronExpr`/`nextRunAt`
  // (schedule override). Not every cron is a social automation — if no row
  // matches, drizzle's update is a no-op. Failure here is logged but not fatal:
  // system_crons is the source of truth.
  const automationPatch: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.enabled !== undefined) {
    automationPatch.enabled = updates.enabled;
  }
  if (updates.scheduleOverride !== undefined) {
    automationPatch.cronExpr = effectiveSchedule;
    automationPatch.nextRunAt = nextRunAt;
  }
  if (Object.keys(automationPatch).length > 1) {
    try {
      await db
        .update(socialAutomations)
        .set(automationPatch)
        .where(eq(socialAutomations.sourceRef, jobName));
    } catch (err) {
      logger.error(
        { err, jobName },
        "Failed to live-sync social_automations after cron update",
      );
    }
  }

  // Update cache
  const state = dbState.get(jobName);
  if (state) {
    if (updates.enabled !== undefined) state.enabled = updates.enabled;
    if (updates.scheduleOverride !== undefined) state.scheduleOverride = updates.scheduleOverride;
    state.nextRunAt = nextRunAt;
  }

  return { ok: true };
}

// Expose handler access for the registry (used by auto-reply's dynamic interval)
export function getRegisteredJob(jobName: string): RegisteredJob | undefined {
  return registry.get(jobName);
}

// Get the effective schedule for a job (DB override or default)
export function getEffectiveSchedule(jobName: string): string | null {
  const entry = registry.get(jobName);
  if (!entry) return null;
  const state = dbState.get(jobName);
  return state?.scheduleOverride || entry.def.schedule;
}
