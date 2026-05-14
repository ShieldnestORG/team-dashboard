import { Router } from "express";
import { activityLog, type Db } from "@paperclipai/db";
import { and, desc, eq, gte, inArray, isNotNull, like, sql } from "drizzle-orm";
import { assertBoard } from "./authz.js";

/**
 * Causal Events viewer (PyRapide / RAPIDE-inspired DAG debugger).
 *
 * Reads from activity_log rows that carry an `event_kind` value and walks the
 * `caused_by` edges. Used by the /causal-events admin UI to debug agent and
 * Watchtower runs by visualizing parent/child event chains.
 */

interface SerializedEvent {
  id: string;
  kind: string | null;
  entityId: string;
  entityType: string;
  causedBy: string[] | null;
  details: Record<string, unknown> | null;
  createdAt: string;
  runId: string | null;
  agentId: string | null;
  companyId: string;
}

type Row = typeof activityLog.$inferSelect;

function serialize(row: Row): SerializedEvent {
  return {
    id: row.id,
    kind: row.eventKind,
    entityId: row.entityId,
    entityType: row.entityType,
    causedBy: row.causedBy ?? null,
    details: row.details ?? null,
    createdAt: row.createdAt.toISOString(),
    runId: row.runId,
    agentId: row.agentId,
    companyId: row.companyId,
  };
}

export function causalEventsRoutes(db: Db) {
  const router = Router();

  // GET /api/causal-events/kinds — distinct event_kind values, last 7 days.
  // (Mounted before /:id so it isn't captured as an id param.)
  router.get("/kinds", async (req, res) => {
    assertBoard(req);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rows = await db
      .selectDistinct({ kind: activityLog.eventKind })
      .from(activityLog)
      .where(and(isNotNull(activityLog.eventKind), gte(activityLog.createdAt, sevenDaysAgo)));
    const kinds = rows
      .map((r) => r.kind)
      .filter((k): k is string => typeof k === "string" && k.length > 0)
      .sort();
    res.json({ kinds });
  });

  // GET /api/causal-events?kind=&companyId=&limit=100
  router.get("/", async (req, res) => {
    assertBoard(req);
    const kind = typeof req.query.kind === "string" ? req.query.kind : undefined;
    const companyId = typeof req.query.companyId === "string" ? req.query.companyId : undefined;
    const rawLimit = Number(req.query.limit);
    const limit = Math.min(Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 100, 500);

    const conds = [isNotNull(activityLog.eventKind)];
    if (kind) conds.push(like(activityLog.eventKind, `${kind}%`));
    if (companyId) conds.push(eq(activityLog.companyId, companyId));

    const rows = await db
      .select()
      .from(activityLog)
      .where(and(...conds))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit);

    res.json({ events: rows.map(serialize) });
  });

  // GET /api/causal-events/:id — single event + ancestors (back 3 hops) +
  // descendants (forward 3 hops via `caused_by @> ARRAY[$id]::uuid[]`).
  router.get("/:id", async (req, res) => {
    assertBoard(req);
    const id = req.params.id as string;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).json({ error: "Invalid event id" });
      return;
    }

    const [event] = await db.select().from(activityLog).where(eq(activityLog.id, id)).limit(1);
    if (!event) {
      res.status(404).json({ error: "Event not found" });
      return;
    }

    const MAX_HOPS = 3;
    const seen = new Set<string>([event.id]);

    // Ancestors: BFS over caused_by ids, 3 hops.
    const ancestors: Row[] = [];
    let frontier: string[] = event.causedBy ?? [];
    for (let hop = 0; hop < MAX_HOPS && frontier.length > 0; hop++) {
      const fresh = frontier.filter((fid) => !seen.has(fid));
      if (fresh.length === 0) break;
      for (const fid of fresh) seen.add(fid);
      const rows = await db
        .select()
        .from(activityLog)
        .where(inArray(activityLog.id, fresh));
      ancestors.push(...rows);
      const nextFrontier: string[] = [];
      for (const r of rows) {
        for (const parent of r.causedBy ?? []) {
          if (!seen.has(parent)) nextFrontier.push(parent);
        }
      }
      frontier = nextFrontier;
    }

    // Descendants: rows where caused_by contains the focus id. BFS, 3 hops.
    const descendants: Row[] = [];
    let descFrontier: string[] = [event.id];
    for (let hop = 0; hop < MAX_HOPS && descFrontier.length > 0; hop++) {
      const rows = await db
        .select()
        .from(activityLog)
        .where(sql`${activityLog.causedBy} && ${descFrontier}::uuid[]`);
      const nextIds: string[] = [];
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        descendants.push(r);
        nextIds.push(r.id);
      }
      descFrontier = nextIds;
    }

    res.json({
      event: serialize(event),
      ancestors: ancestors.map(serialize),
      descendants: descendants.map(serialize),
    });
  });

  return router;
}
