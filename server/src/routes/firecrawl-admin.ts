/**
 * Firecrawl Admin route — powers the Activity tab on the firecrawl plugin
 * settings page (/instance/settings/plugins/coherencedaddy.firecrawl).
 *
 * Exposes:
 *  - GET  /api/firecrawl/admin/overview  → aggregated cron + metrics snapshot
 *  - POST /api/firecrawl/admin/run/:jobName → manually trigger a firecrawl
 *    cron job (whitelisted to jobs with a "firecrawl:" prefix so this route
 *    can't be used to run arbitrary crons).
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { getCronStatus, triggerCronJob } from "../services/cron-registry.js";
import { logger } from "../middleware/logger.js";

interface RecentScrapeRow extends Record<string, unknown> {
  id: number;
  company_slug: string;
  headline: string;
  source_url: string | null;
  captured_at: string | Date;
  body_size: number;
}

interface CountRow extends Record<string, unknown> {
  total: number;
}

export function firecrawlAdminRoutes(_db: Db) {
  const db = _db;
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /overview — aggregated snapshot for the Activity tab
  // -------------------------------------------------------------------------
  router.get("/overview", async (_req, res) => {
    try {
      // 1. Cron jobs from the central registry, filtered to firecrawl-owned work.
      //    We match on either jobName prefix or source file so we pick up any
      //    future firecrawl-related jobs automatically.
      const allCrons = getCronStatus();
      const crons = allCrons.filter((c) =>
        c.jobName.startsWith("firecrawl:") ||
        c.sourceFile === "firecrawl-crons.ts",
      );

      // 2. Scrape counts from intel_reports (report_type='firecrawl-sync')
      const [{ total: totalScrapes } = { total: 0 }] = (await db.execute<CountRow>(sql`
        SELECT COUNT(*)::int AS total
        FROM intel_reports
        WHERE report_type = 'firecrawl-sync'
      `)) as unknown as CountRow[];

      const [{ total: scrapesLast7d } = { total: 0 }] = (await db.execute<CountRow>(sql`
        SELECT COUNT(*)::int AS total
        FROM intel_reports
        WHERE report_type = 'firecrawl-sync'
          AND captured_at > now() - interval '7 days'
      `)) as unknown as CountRow[];

      const [{ total: scrapesLast24h } = { total: 0 }] = (await db.execute<CountRow>(sql`
        SELECT COUNT(*)::int AS total
        FROM intel_reports
        WHERE report_type = 'firecrawl-sync'
          AND captured_at > now() - interval '24 hours'
      `)) as unknown as CountRow[];

      // 3. Distinct companies touched by firecrawl sync
      const [{ total: intelCompaniesCovered } = { total: 0 }] = (await db.execute<CountRow>(sql`
        SELECT COUNT(DISTINCT company_slug)::int AS total
        FROM intel_reports
        WHERE report_type = 'firecrawl-sync'
      `)) as unknown as CountRow[];

      // 4. 10 most recent scrapes
      const recentRows = (await db.execute<RecentScrapeRow>(sql`
        SELECT
          id,
          company_slug,
          headline,
          source_url,
          captured_at,
          COALESCE(LENGTH(body), 0)::int AS body_size
        FROM intel_reports
        WHERE report_type = 'firecrawl-sync'
        ORDER BY captured_at DESC
        LIMIT 10
      `)) as unknown as RecentScrapeRow[];

      const recentScrapes = recentRows.map((r) => ({
        id: r.id,
        companySlug: r.company_slug,
        headline: r.headline,
        sourceUrl: r.source_url,
        capturedAt:
          typeof r.captured_at === "object" && r.captured_at !== null
            ? (r.captured_at as Date).toISOString()
            : String(r.captured_at),
        bodySize: r.body_size,
      }));

      // 5. Host info — which Firecrawl instance we're pointed at
      const host =
        process.env.FIRECRAWL_URL || "https://firecrawl.coherencedaddy.com";
      const isSelfHosted = !/\.firecrawl\.dev/i.test(host);

      res.json({
        crons,
        metrics: {
          totalScrapes,
          scrapesLast7d,
          scrapesLast24h,
          intelCompaniesCovered,
        },
        recentScrapes,
        host: {
          url: host,
          mode: isSelfHosted ? "self-hosted" : "cloud",
        },
      });
    } catch (err) {
      logger.error({ err }, "firecrawl-admin overview failed");
      res.status(500).json({ error: "Failed to build firecrawl overview" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /run/:jobName — manually trigger a firecrawl cron job
  // -------------------------------------------------------------------------
  router.post("/run/:jobName", async (req, res) => {
    try {
      const jobName = req.params.jobName as string;
      if (!jobName.startsWith("firecrawl:")) {
        res
          .status(400)
          .json({ error: "Only firecrawl:* jobs can be triggered from this route" });
        return;
      }

      const result = await triggerCronJob(jobName);
      if (!result.ok) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "firecrawl-admin trigger failed");
      res.status(500).json({ error: "Failed to trigger firecrawl job" });
    }
  });

  return router;
}
