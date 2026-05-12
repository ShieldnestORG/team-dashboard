import type { Db } from "@paperclipai/db";
import { logActivity } from "./activity-log.js";

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

export async function recordEvent(db: Db, input: RecordEventInput): Promise<string> {
  const firstSegment = input.kind.split(".")[0] ?? "system";
  try {
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
      causedBy: input.causedBy && input.causedBy.length > 0 ? input.causedBy : null,
    });
  } catch (_err) {
    // Swallow — observability must not break observed code. The logActivity
    // layer already logs failures via pino.
    return "";
  }
}
