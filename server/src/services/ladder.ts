import Database from "better-sqlite3";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

const DB_PATH = join(homedir(), ".ladder", "ladder.db");

// Lazy singleton, read-only
let db: Database.Database | null = null;

function getDb(): Database.Database | null {
  if (!existsSync(DB_PATH)) return null;
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
  }
  return db;
}

export interface PipelineEntry {
  id: string;
  entry_id: string;
  project: string;
  stage: string;
  title: string;
  status: string;
  content: string | null;
  metadata: Record<string, unknown>;
  upstream_ids: string[];
  created_at: string;
  updated_at: string;
}

export interface TelemetryEvent {
  id: string;
  project: string;
  event_type: string;
  event_data: Record<string, unknown>;
  created_at: string;
}

function parseEntry(row: Record<string, string>): PipelineEntry {
  return {
    id: row.id,
    entry_id: row.entry_id,
    project: row.project,
    stage: row.stage,
    title: row.title,
    status: row.status,
    content: row.content || null,
    metadata: JSON.parse(row.metadata || "{}"),
    upstream_ids: JSON.parse(row.upstream_ids || "[]"),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

/** Check whether the ladder DB file exists on disk. */
export function isAvailable(): boolean {
  return existsSync(DB_PATH);
}

/**
 * Get pipeline entry counts grouped by stage and status.
 * Returns null if the DB is not available.
 */
export function getPipelineStatus(
  project?: string,
): Record<string, Record<string, number>> | null {
  const d = getDb();
  if (!d) return null;

  const where = project ? "WHERE project = ?" : "";
  const params = project ? [project] : [];

  const rows = d
    .prepare(
      `SELECT stage, status, COUNT(*) as count FROM pipeline_entries ${where} GROUP BY stage, status`,
    )
    .all(...params) as Array<{ stage: string; status: string; count: number }>;

  const result: Record<string, Record<string, number>> = {};
  for (const stage of [
    "source",
    "idea",
    "hypothesis",
    "experiment",
    "algorithm",
    "result",
  ]) {
    result[stage] = { draft: 0, active: 0, testing: 0, complete: 0, archived: 0 };
  }
  for (const row of rows) {
    if (result[row.stage]) result[row.stage][row.status] = row.count;
  }
  return result;
}

/**
 * Get telemetry stats for the last N days.
 * Returns null if the DB is not available.
 */
export function getTelemetryStats(
  project?: string,
  days = 7,
): {
  total: number;
  byType: Array<{ event_type: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
} | null {
  const d = getDb();
  if (!d) return null;

  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const where = project
    ? "WHERE project = ? AND created_at >= ?"
    : "WHERE created_at >= ?";
  const params = project ? [project, since] : [since];

  const totalRow = d
    .prepare(`SELECT COUNT(*) as count FROM telemetry_events ${where}`)
    .get(...params) as { count: number };

  const byType = d
    .prepare(
      `SELECT event_type, COUNT(*) as count FROM telemetry_events ${where} GROUP BY event_type ORDER BY count DESC`,
    )
    .all(...params) as Array<{ event_type: string; count: number }>;

  const byDay = d
    .prepare(
      `SELECT DATE(created_at) as day, COUNT(*) as count FROM telemetry_events ${where} GROUP BY DATE(created_at) ORDER BY day`,
    )
    .all(...params) as Array<{ day: string; count: number }>;

  return { total: totalRow.count, byType, byDay };
}

/**
 * Get recent telemetry events.
 * Returns [] if the DB is not available.
 */
export function getRecentEvents(
  project?: string,
  limit = 20,
): TelemetryEvent[] {
  const d = getDb();
  if (!d) return [];

  const where = project ? "WHERE project = ?" : "";
  const params = project ? [project, limit] : [limit];

  const rows = d
    .prepare(
      `SELECT * FROM telemetry_events ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params) as Record<string, string>[];

  return rows.map((r) => ({
    id: r.id,
    project: r.project,
    event_type: r.event_type,
    event_data: JSON.parse(r.event_data || "{}"),
    created_at: r.created_at,
  }));
}

/**
 * Get pipeline entries with optional filters.
 * Returns [] if the DB is not available.
 */
export function getEntries(filters: {
  project?: string;
  stage?: string;
  status?: string;
  limit?: number;
}): PipelineEntry[] {
  const d = getDb();
  if (!d) return [];

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.project) {
    conditions.push("project = ?");
    params.push(filters.project);
  }
  if (filters.stage) {
    conditions.push("stage = ?");
    params.push(filters.stage);
  }
  if (filters.status) {
    conditions.push("status = ?");
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(filters.limit ?? 50, 200);

  const rows = d
    .prepare(
      `SELECT * FROM pipeline_entries ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as Record<string, string>[];

  return rows.map(parseEntry);
}

/**
 * Get all distinct project names from both pipeline entries and telemetry events.
 * Returns [] if the DB is not available.
 */
export function getProjects(): string[] {
  const d = getDb();
  if (!d) return [];

  const rows = d
    .prepare(
      `SELECT DISTINCT project FROM pipeline_entries
       UNION
       SELECT DISTINCT project FROM telemetry_events
       ORDER BY project`,
    )
    .all() as Array<{ project: string }>;

  return rows.map((r) => r.project);
}
