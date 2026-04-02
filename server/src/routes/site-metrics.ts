import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import type { Db } from "@paperclipai/db";
import { z } from "zod";
import { validate } from "../middleware/validate.js";
import { badRequest, forbidden, unauthorized } from "../errors.js";
import { assertCompanyAccess } from "./authz.js";
import { resolvePaperclipInstanceRoot } from "../home-paths.js";

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const toolViewSchema = z.object({
  slug: z.string().min(1),
  views: z.number().int().nonnegative(),
});

const referrerSchema = z.object({
  source: z.string().min(1),
  count: z.number().int().nonnegative(),
});

const ingestBodySchema = z.object({
  siteId: z.string().min(1),
  metrics: z.object({
    pageViews: z.number().int().nonnegative().optional(),
    uniqueVisitors: z.number().int().nonnegative().optional(),
    toolViews: z.array(toolViewSchema).optional(),
    subscribers: z.number().int().nonnegative().optional(),
    directoryClicks: z.number().int().nonnegative().optional(),
    topReferrers: z.array(referrerSchema).optional(),
    period: z.enum(["hourly", "daily", "weekly"]),
    timestamp: z.string().refine(
      (v) => !Number.isNaN(Date.parse(v)),
      { message: "timestamp must be a valid ISO 8601 string" },
    ),
  }),
});

type IngestBody = z.infer<typeof ingestBodySchema>;

// ---------------------------------------------------------------------------
// Persistence helpers — JSON file per company, kept in the instance data dir
// ---------------------------------------------------------------------------

interface StoredMetricEntry {
  siteId: string;
  metrics: IngestBody["metrics"];
  receivedAt: string;
}

function metricsDir(): string {
  return path.resolve(resolvePaperclipInstanceRoot(), "data", "site-metrics");
}

function metricsFilePath(companyId: string): string {
  return path.join(metricsDir(), `${companyId}.json`);
}

function readMetrics(companyId: string): StoredMetricEntry[] {
  const filePath = metricsFilePath(companyId);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as StoredMetricEntry[];
  } catch {
    return [];
  }
}

function writeMetrics(companyId: string, entries: StoredMetricEntry[]): void {
  const dir = metricsDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(metricsFilePath(companyId), JSON.stringify(entries, null, 2));
}

// In-memory cache so reads are fast; file is the persistence layer
const metricsCache = new Map<string, StoredMetricEntry[]>();

function getCachedMetrics(companyId: string): StoredMetricEntry[] {
  if (!metricsCache.has(companyId)) {
    metricsCache.set(companyId, readMetrics(companyId));
  }
  return metricsCache.get(companyId)!;
}

function appendMetric(companyId: string, entry: StoredMetricEntry): void {
  const entries = getCachedMetrics(companyId);
  entries.push(entry);

  // Cap at 10 000 entries per company — drop oldest when exceeded
  const MAX_ENTRIES = 10_000;
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES);
  }
  metricsCache.set(companyId, entries);
  writeMetrics(companyId, entries);
}

// ---------------------------------------------------------------------------
// Shared-secret auth for external callers
// ---------------------------------------------------------------------------

const METRICS_KEY_ENV = "SITE_METRICS_KEY";

function isValidMetricsKey(headerValue: string | undefined): boolean {
  const expected = process.env[METRICS_KEY_ENV];
  if (!expected) return false;
  return headerValue === expected;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function siteMetricsRoutes(_db: Db) {
  const router = Router();

  /**
   * POST /companies/:companyId/site-metrics/ingest
   *
   * Auth: standard bearer token (agent or board) OR X-Site-Metrics-Key header.
   */
  router.post(
    "/companies/:companyId/site-metrics/ingest",
    validate(ingestBodySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;

      // Allow through if the caller provided a valid shared secret
      const metricsKeyHeader = req.header("x-site-metrics-key");
      if (metricsKeyHeader) {
        if (!isValidMetricsKey(metricsKeyHeader)) {
          throw unauthorized("Invalid site metrics key");
        }
        // Shared-secret callers are trusted for the specified company
      } else {
        // Fall back to standard actor auth
        if (req.actor.type === "none") {
          throw unauthorized();
        }
        assertCompanyAccess(req, companyId);
      }

      const body = req.body as IngestBody;

      const entry: StoredMetricEntry = {
        siteId: body.siteId,
        metrics: body.metrics,
        receivedAt: new Date().toISOString(),
      };

      appendMetric(companyId, entry);

      res.status(201).json({ ok: true, receivedAt: entry.receivedAt });
    },
  );

  /**
   * GET /companies/:companyId/site-metrics
   *
   * Query params:
   *   siteId  — filter by site (optional)
   *   period  — filter by period (optional)
   *   limit   — max entries returned, default 200
   */
  router.get("/companies/:companyId/site-metrics", async (req, res) => {
    const companyId = req.params.companyId as string;

    // Shared-secret auth or standard auth
    const metricsKeyHeader = req.header("x-site-metrics-key");
    if (metricsKeyHeader) {
      if (!isValidMetricsKey(metricsKeyHeader)) {
        throw unauthorized("Invalid site metrics key");
      }
    } else {
      if (req.actor.type === "none") {
        throw unauthorized();
      }
      assertCompanyAccess(req, companyId);
    }

    const siteId = req.query.siteId as string | undefined;
    const period = req.query.period as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 200, 5000);

    let entries = getCachedMetrics(companyId);

    if (siteId) {
      entries = entries.filter((e) => e.siteId === siteId);
    }
    if (period) {
      entries = entries.filter((e) => e.metrics.period === period);
    }

    // Return newest first, capped by limit
    const result = entries.slice(-limit).reverse();

    res.json({ metrics: result, total: entries.length });
  });

  return router;
}
