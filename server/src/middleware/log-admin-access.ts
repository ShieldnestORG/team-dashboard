import type { Request, RequestHandler } from "express";
import type { Db } from "@paperclipai/db";
import { adminAccessLog } from "@paperclipai/db";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// log-admin-access — writes one row to `admin_access_log` per authenticated
// (or unauthenticated 401) admin route hit. Ops telemetry, NOT compliance.
//
// Design notes:
//   - Writes AFTER the response is sent (`res.on('finish', ...)`) so logging
//     latency never adds to user-visible response time.
//   - DB failure here MUST NOT 500 the request — we `logger.warn` and move
//     on. Losing one access-log row is strictly better than dropping the
//     response the operator was waiting for.
//   - `request_summary` records ONLY query params (sanitized) + the SHAPE of
//     the body (top-level keys + value-kinds), never raw values. The /api
//     surface routinely accepts secrets in POST bodies (API keys, Stripe
//     tokens, magic-link payloads); logging values would turn this table
//     into a compliance liability. See `redactRequestSummary`.
//   - `opts.skipGet === true` skips logging GETs. Useful for route groups
//     that have very chatty read-only listings; off by default since the
//     audit doc explicitly wants read events captured for forensics.
//   - Unauth attempts (no `req.actor` or `req.actor.type === 'none'`) ARE
//     logged with `actor_type='none'`, typically against a 401 status.
//
// 90-day retention is enforced by `admin-access-log-retention-cron.ts`
// (job `admin-access-log:purge`, daily 04:30 UTC, 100k batch cap).
//
// TODO follow-up (NOT in this PR):
//   1. Apply this middleware to `system-crons.ts`, `intel-billing.ts`,
//      and other admin-only route groups (audit doc lists them; intentionally
//      not done here to keep PR blast radius small).
//   2. Surface an "Audit log" tab in `ui/src/pages/WatchtowerAdmin.tsx`
//      backed by `GET /api/watchtower-admin/audit?path=...`.
// ---------------------------------------------------------------------------

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

/** What kind of value we saw, without ever recording the value itself. */
function describeValueKind(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `array[${v.length}]`;
  return typeof v;
}

/**
 * Build a redacted summary of the request — query keys + a shape map of the
 * body (top-level keys → value kind, no values). Pure function, exported for
 * unit testing without an Express request.
 */
export function redactRequestSummary(req: {
  query?: unknown;
  body?: unknown;
}): Record<string, unknown> {
  const summary: Record<string, unknown> = {};

  // Query params: keep keys, redact values to their kind. Query string is
  // already visible in `path` (req.originalUrl) so this is mostly to make
  // it ergonomic to filter by-key in BI tooling.
  if (req.query && typeof req.query === "object") {
    const queryKeys: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.query as Record<string, unknown>)) {
      queryKeys[k] = describeValueKind(v);
    }
    if (Object.keys(queryKeys).length > 0) {
      summary.query_keys = queryKeys;
    }
  }

  // Body: keys + value kinds only. We deliberately do not recurse — a body
  // shape ({ apiKey: 'string', config: 'object' }) is enough forensic
  // signal without ever recording the secret.
  if (
    req.body &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
  ) {
    const bodyShape: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.body as Record<string, unknown>)) {
      bodyShape[k] = describeValueKind(v);
    }
    if (Object.keys(bodyShape).length > 0) {
      summary.body_shape = bodyShape;
    }
  } else if (Array.isArray(req.body)) {
    summary.body_shape = `array[${(req.body as unknown[]).length}]`;
  }

  return summary;
}

/** Resolve a forensic label for the actor without touching the request body. */
function actorLabel(req: Request): string | null {
  const a = req.actor;
  if (!a || a.type === "none") return null;
  if (a.type === "board") return a.userId ?? null;
  if (a.type === "agent") return a.agentId ?? null;
  return null;
}

/** Coerce the actor id to a UUID column value, or null if non-UUID. */
function actorIdForColumn(req: Request): string | null {
  const a = req.actor;
  if (!a || a.type === "none") return null;
  const candidate =
    a.type === "board" ? a.userId : a.type === "agent" ? a.agentId : undefined;
  return isUuid(candidate) ? candidate : null;
}

/**
 * Pull an entity id from route params, if the route has one named in a
 * conventional way. We never guess — only well-known names. The column is
 * UUID-typed so we coerce; non-UUID values fall back to null.
 */
function entityFromParams(
  req: Request,
): { entityType: string | null; entityId: string | null } {
  const params = (req.params ?? {}) as Record<string, string | undefined>;
  const candidates: Array<[string, string]> = [
    ["subscriptionId", "subscription"],
    ["subscription_id", "subscription"],
    ["runId", "run"],
    ["run_id", "run"],
    ["customerId", "customer"],
    ["customer_id", "customer"],
    ["accountId", "account"],
    ["account_id", "account"],
    ["id", "entity"],
  ];
  for (const [paramName, entityType] of candidates) {
    const value = params[paramName] as string | undefined;
    if (value && isUuid(value)) {
      return { entityType, entityId: value };
    }
  }
  return { entityType: null, entityId: null };
}

export interface LogAdminAccessOptions {
  /** Skip logging GET requests. Off by default — audit doc wants reads logged. */
  skipGet?: boolean;
}

/**
 * Express middleware factory. Records one row per request (after the
 * response is sent) to `admin_access_log`. Mount AFTER `actorMiddleware`
 * so `req.actor` is populated.
 */
export function logAdminAccess(
  db: Db,
  opts: LogAdminAccessOptions = {},
): RequestHandler {
  const { skipGet = false } = opts;

  return (req, res, next) => {
    const startedAt = Date.now();

    res.on("finish", () => {
      // Decision tree intentionally inside the listener so we read the
      // final res.statusCode after the response has been sent.
      try {
        if (skipGet && req.method.toUpperCase() === "GET") return;

        const durationMs = Date.now() - startedAt;
        const { entityType, entityId } = entityFromParams(req);
        const actorType = req.actor?.type ?? "none";

        const row = {
          actorId: actorIdForColumn(req),
          actorType,
          actorLabel: actorLabel(req),
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          entityType,
          entityId,
          requestSummary: redactRequestSummary({
            query: req.query,
            body: req.body,
          }),
          durationMs,
        };

        // Wrap the insert in its own try/catch — we already swallow sync
        // errors above, but the drizzle insert returns a promise.
        Promise.resolve(db.insert(adminAccessLog).values(row)).catch((err) => {
          logger.warn(
            { err, path: req.originalUrl, method: req.method },
            "admin_access_log write failed",
          );
        });
      } catch (err) {
        logger.warn(
          { err, path: req.originalUrl, method: req.method },
          "admin_access_log middleware threw before insert",
        );
      }
    });

    next();
  };
}
