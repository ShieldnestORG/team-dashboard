import type { Db } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";
import { logger } from "../middleware/logger.js";

/**
 * Causal-event recorder (PyRapide / RAPIDE-inspired).
 *
 * Records a row in activity_log with `event_kind` and optional `caused_by`
 * edges. Returns the new event's id so callers can chain — pass the id into
 * the `causedBy` of the next event to build the causal DAG.
 *
 * Usage:
 *   const runId = await recordEvent(db, {
 *     kind: "watchtower.run.started",
 *     companyId,
 *     entityId: subscriptionId,
 *     payload: { subscriptionId, prompts: 25 },
 *   });
 *   // ... later ...
 *   const sentId = await recordEvent(db, {
 *     kind: "watchtower.query.sent",
 *     companyId,
 *     entityId: subscriptionId,
 *     causedBy: [runId],
 *     payload: { engine: "claude", prompt },
 *   });
 *   const respId = await recordEvent(db, {
 *     kind: "watchtower.query.response",
 *     companyId,
 *     entityId: subscriptionId,
 *     causedBy: [sentId],
 *     payload: { engine: "claude", latencyMs, ok },
 *   });
 *
 * Failure mode: errors are logged but never re-thrown. Event recording must
 * never break the workload it's observing. Returns empty string on failure.
 */
export interface RecordEventInput {
  /** Dotted namespace: "watchtower.query.sent", "agent.scribe.run.completed", etc. */
  kind: string;
  companyId: string;
  /** Domain entity this event is about (subscription id, run id, etc.). */
  entityId: string;
  /** Defaults to the first segment of kind (e.g. "watchtower"). */
  entityType?: string;
  /** Parent event ids in activity_log. */
  causedBy?: string[];
  /** Free-form structured payload. */
  payload?: Record<string, unknown>;
  /** Optional agent_id / run_id FKs if this is part of a heartbeat run. */
  agentId?: string | null;
  runId?: string | null;
  /** Override actor; defaults to system + kind's first segment. */
  actorType?: "agent" | "user" | "system";
  actorId?: string;
}

/**
 * Master kill switch for causal-event recording. When set to "false" (case
 * insensitive), `recordEvent` becomes a no-op that returns "" without touching
 * the DB. Default is enabled — set `CAUSAL_EVENTS_ENABLED=false` in env to
 * disable in an emergency (e.g. caused_by column writes misbehaving).
 */
function causalEventsEnabled(): boolean {
  const raw = process.env.CAUSAL_EVENTS_ENABLED;
  if (raw === undefined || raw === null || raw === "") return true;
  return raw.toLowerCase() !== "false" && raw !== "0";
}

export async function recordEvent(db: Db, input: RecordEventInput): Promise<string> {
  if (!causalEventsEnabled()) return "";
  // Compute the fallback actor namespace inside the try in case `input.kind`
  // is missing or non-string — split() on undefined would throw and we must
  // not let it escape.
  try {
    if (!input.kind || typeof input.kind !== "string") {
      // Missing kind is a programming error in the caller, but we still must
      // never break observed code. Log warn and bail.
      logger.warn({ input }, "recordEvent: missing or invalid `kind`");
      return "";
    }
    const firstSegment = input.kind.split(".")[0] ?? "system";
    // Defensive: normalize causedBy outside the insert call so an exotic input
    // (non-array, contains non-string) can't poison the array marshalling.
    let causedBy: string[] | null = null;
    if (Array.isArray(input.causedBy) && input.causedBy.length > 0) {
      const filtered = input.causedBy.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      );
      causedBy = filtered.length > 0 ? filtered : null;
    }
    return await logActivity(db, {
      companyId: input.companyId,
      actorType: input.actorType ?? "system",
      actorId: input.actorId ?? firstSegment,
      action: "event",
      entityType: input.entityType ?? firstSegment,
      entityId: input.entityId,
      agentId: input.agentId ?? null,
      runId: input.runId ?? null,
      details: input.payload ?? null,
      eventKind: input.kind,
      causedBy,
    });
  } catch (err) {
    // Swallow — observability must not break observed code. Log a warn so we
    // can find it in pino if the failure is systematic.
    try {
      logger.warn({ err, kind: input?.kind }, "recordEvent failed");
    } catch {
      // even logging shouldn't be allowed to throw out of here
    }
    return "";
  }
}
