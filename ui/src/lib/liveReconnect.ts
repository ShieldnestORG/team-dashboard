/**
 * Pure helpers for the live-events WebSocket reconnect state machine used by
 * LiveUpdatesProvider. Kept side-effect free so the backoff/classification
 * math is unit-testable without a real WebSocket, DOM timers, or network.
 */

export const RECONNECT_BASE_DELAY_MS = 1000;
export const RECONNECT_MAX_DELAY_MS = 5 * 60 * 1000; // 5 minutes
export const IMMEDIATE_FAILURE_THRESHOLD_MS = 5000;
export const HEALTHY_CONNECTION_THRESHOLD_MS = 60_000;
export const MAX_CONSECUTIVE_IMMEDIATE_FAILURES = 4;

/**
 * Capped exponential backoff with +/-20% jitter. `attempt` is 1-indexed
 * (the first reconnect attempt after a drop is attempt 1). Jitter keeps
 * many tabs/clients from retrying in lockstep after a shared outage.
 */
export function computeBackoffDelayMs(attempt: number, randomFn: () => number = Math.random): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = RECONNECT_BASE_DELAY_MS * 2 ** (safeAttempt - 1);
  const capped = Math.min(RECONNECT_MAX_DELAY_MS, exponential);
  const jitterFactor = 0.8 + randomFn() * 0.4; // [0.8, 1.2)
  return Math.round(capped * jitterFactor);
}

export type DisconnectClassification = "immediate-failure" | "healthy-drop" | "partial-drop";

/**
 * Classifies a socket close based on how long the connection stayed open
 * (0 if it never opened at all — e.g. the upgrade itself was rejected).
 *
 * - immediate-failure: closed within IMMEDIATE_FAILURE_THRESHOLD_MS of open.
 *   Browsers don't expose the HTTP status of a failed WS upgrade, but a
 *   sub-5s close is the closest client-observable signal of an auth
 *   rejection (e.g. a stale session getting a 403) rather than a network
 *   blip — a run of these is what should trigger a REST session probe.
 * - healthy-drop: stayed connected >= HEALTHY_CONNECTION_THRESHOLD_MS.
 *   A normal deploy/restart-style drop — backoff should reset so the next
 *   reconnect is fast again.
 * - partial-drop: connected for a while but not long enough to count as
 *   healthy. Proves the session was valid at connect time (so the
 *   immediate-failure streak should clear) but backoff should keep growing.
 */
export function classifyDisconnect(connectedDurationMs: number): DisconnectClassification {
  if (connectedDurationMs < IMMEDIATE_FAILURE_THRESHOLD_MS) return "immediate-failure";
  if (connectedDurationMs >= HEALTHY_CONNECTION_THRESHOLD_MS) return "healthy-drop";
  return "partial-drop";
}

/** True once enough consecutive immediate failures have happened to justify a REST session probe. */
export function shouldProbeSession(immediateFailureStreak: number): boolean {
  return immediateFailureStreak >= MAX_CONSECUTIVE_IMMEDIATE_FAILURES;
}
