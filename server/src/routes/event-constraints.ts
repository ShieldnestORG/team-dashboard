import { Router } from "express";
import { eventConstraints, type Db } from "@paperclipai/db";
import { and, desc, eq } from "drizzle-orm";
import { assertBoard } from "./authz.js";
import { badRequest, notFound } from "../errors.js";

/**
 * CRUD for `event_constraints` — pattern-match constraints checked by
 * `services/causal-constraints-cron.ts`. Each row says "every event of
 * `pattern.of` must be followed within `maxLagMs` by an event of
 * `pattern.require` that has the parent in its caused_by".
 */

type Row = typeof eventConstraints.$inferSelect;

interface SerializedConstraint {
  id: string;
  companyId: string | null;
  kind: string;
  pattern: { of: string; require: string };
  maxLagMs: number;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastViolationAt: string | null;
  violationCount: number;
  createdAt: string;
  updatedAt: string;
}

function serialize(row: Row): SerializedConstraint {
  return {
    id: row.id,
    companyId: row.companyId,
    kind: row.kind,
    pattern: row.pattern,
    maxLagMs: row.maxLagMs,
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt ? row.lastCheckedAt.toISOString() : null,
    lastViolationAt: row.lastViolationAt ? row.lastViolationAt.toISOString() : null,
    violationCount: row.violationCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parsePattern(raw: unknown): { of: string; require: string } {
  if (!raw || typeof raw !== "object") {
    throw badRequest("pattern must be an object with `of` and `require` strings");
  }
  const p = raw as { of?: unknown; require?: unknown };
  if (!isNonEmptyString(p.of) || !isNonEmptyString(p.require)) {
    throw badRequest("pattern.of and pattern.require must be non-empty strings");
  }
  return { of: p.of, require: p.require };
}

export function eventConstraintsRoutes(db: Db) {
  const router = Router();

  // GET /api/event-constraints?companyId=
  router.get("/", async (req, res) => {
    assertBoard(req);
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    const conds = [];
    if (companyId) conds.push(eq(eventConstraints.companyId, companyId));
    const rows = await db
      .select()
      .from(eventConstraints)
      .where(conds.length > 0 ? and(...conds) : undefined)
      .orderBy(desc(eventConstraints.createdAt));
    res.json({ constraints: rows.map(serialize) });
  });

  // POST /api/event-constraints
  router.post("/", async (req, res) => {
    assertBoard(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!isNonEmptyString(body.kind)) {
      throw badRequest("`kind` must be a non-empty string");
    }
    const pattern = parsePattern(body.pattern);
    const maxLagMs =
      typeof body.maxLagMs === "number" && Number.isFinite(body.maxLagMs) && body.maxLagMs > 0
        ? Math.floor(body.maxLagMs)
        : 60000;
    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const companyId = isNonEmptyString(body.companyId) ? body.companyId : null;

    const [row] = await db
      .insert(eventConstraints)
      .values({
        kind: body.kind,
        pattern,
        maxLagMs,
        enabled,
        companyId,
      })
      .returning();
    res.status(201).json({ constraint: serialize(row) });
  });

  // PATCH /api/event-constraints/:id
  router.patch("/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw badRequest("Invalid constraint id");
    }
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: Partial<typeof eventConstraints.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.kind !== undefined) {
      if (!isNonEmptyString(body.kind)) {
        throw badRequest("`kind` must be a non-empty string");
      }
      patch.kind = body.kind;
    }
    if (body.pattern !== undefined) {
      patch.pattern = parsePattern(body.pattern);
    }
    if (body.maxLagMs !== undefined) {
      if (typeof body.maxLagMs !== "number" || !Number.isFinite(body.maxLagMs) || body.maxLagMs <= 0) {
        throw badRequest("`maxLagMs` must be a positive number");
      }
      patch.maxLagMs = Math.floor(body.maxLagMs);
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== "boolean") {
        throw badRequest("`enabled` must be a boolean");
      }
      patch.enabled = body.enabled;
    }

    const [row] = await db
      .update(eventConstraints)
      .set(patch)
      .where(eq(eventConstraints.id, id))
      .returning();
    if (!row) {
      throw notFound("Constraint not found");
    }
    res.json({ constraint: serialize(row) });
  });

  // DELETE /api/event-constraints/:id
  router.delete("/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw badRequest("Invalid constraint id");
    }
    const [row] = await db
      .delete(eventConstraints)
      .where(eq(eventConstraints.id, id))
      .returning();
    if (!row) {
      throw notFound("Constraint not found");
    }
    res.status(204).end();
  });

  return router;
}
