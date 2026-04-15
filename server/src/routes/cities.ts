/**
 * Cities API — city intelligence collection, listing, and pitch generation.
 *
 * Routes:
 *   GET    /api/cities                   → list collected cities (+ filters)
 *   GET    /api/cities/:slug             → one collected city (full row)
 *   POST   /api/cities/collect           → trigger collection (fresh cache short-circuits)
 *   POST   /api/cities/:slug/refresh     → force re-collect
 *   POST   /api/cities/:slug/pitch       → generate pitch grounded in city data
 *   GET    /api/cities/:slug/directory-matches → intel_companies/directory_listings in region
 */

import { Router } from "express";
import { sql, desc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { cityIntelligence } from "@paperclipai/db";
import {
  collectCity,
  buildCitySlug,
  generatePitch,
} from "../services/city-collector.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

interface DirectoryMatchRow extends Record<string, unknown> {
  slug: string;
  name: string;
  directory: string;
  website: string | null;
  category: string;
}

export function citiesRoutes(db: Db) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET / — list collected cities
  // -------------------------------------------------------------------------
  router.get("/", async (req, res) => {
    try {
      const status = (req.query.status as string | undefined) || undefined;
      const q = (req.query.q as string | undefined)?.toLowerCase();

      let whereClause = sql`${cityIntelligence.companyId} = ${COMPANY_ID}`;
      if (status) {
        whereClause = sql`${whereClause} AND ${cityIntelligence.collectionStatus} = ${status}`;
      }
      if (q) {
        whereClause = sql`${whereClause} AND (lower(${cityIntelligence.city}) LIKE ${"%" + q + "%"} OR lower(${cityIntelligence.slug}) LIKE ${"%" + q + "%"})`;
      }

      const rows = await db
        .select()
        .from(cityIntelligence)
        .where(whereClause)
        .orderBy(desc(cityIntelligence.collectedAt))
        .limit(200);

      const cities = rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        city: r.city,
        region: r.region,
        country: r.country,
        population: r.population,
        collectedAt: r.collectedAt,
        freshUntil: r.freshUntil,
        collectionStatus: r.collectionStatus,
        collectionError: r.collectionError,
        collectionDurationMs: r.collectionDurationMs,
        itemCounts: {
          topSearches: (r.topSearches ?? []).length,
          serviceDemand: (r.serviceDemand ?? []).length,
          trendingTopics: (r.trendingTopics ?? []).length,
        },
      }));

      const totalItems = cities.reduce(
        (acc, c) =>
          acc + c.itemCounts.topSearches + c.itemCounts.serviceDemand + c.itemCounts.trendingTopics,
        0,
      );

      res.json({
        cities,
        stats: {
          total: cities.length,
          ready: cities.filter((c) => c.collectionStatus === "ready").length,
          running: cities.filter((c) => c.collectionStatus === "running").length,
          error: cities.filter((c) => c.collectionStatus === "error").length,
          totalItems,
        },
      });
    } catch (err) {
      logger.error({ err }, "cities list failed");
      res.status(500).json({ error: "Failed to list cities" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:slug — single city (full row)
  // -------------------------------------------------------------------------
  router.get("/:slug", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const rows = await db
        .select()
        .from(cityIntelligence)
        .where(
          sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
        )
        .limit(1);

      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "City not found" });
        return;
      }
      res.json({ city: row });
    } catch (err) {
      logger.error({ err }, "cities get failed");
      res.status(500).json({ error: "Failed to load city" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /collect — start (or short-circuit to cached) collection
  // -------------------------------------------------------------------------
  router.post("/collect", async (req, res) => {
    try {
      const {
        city,
        region,
        country,
        force,
      } = req.body as {
        city?: string;
        region?: string | null;
        country?: string | null;
        force?: boolean;
      };

      if (!city || typeof city !== "string") {
        res.status(400).json({ error: "city is required" });
        return;
      }

      const slug = buildCitySlug({ city, region: region ?? null, country: country ?? "US" });

      // Fresh-cache short-circuit
      if (!force) {
        const existing = await db
          .select()
          .from(cityIntelligence)
          .where(
            sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
          )
          .limit(1);
        const row = existing[0];
        const now = new Date();
        if (
          row &&
          row.collectionStatus === "ready" &&
          row.freshUntil &&
          row.freshUntil > now
        ) {
          res.json({ slug, status: "ready", cached: true, city: row });
          return;
        }
      }

      // Run synchronously — caller gets the result when collection completes.
      // The UI shows a loading spinner; collection is ~60-120s typical.
      const result = await collectCity(db, {
        city,
        region: region ?? null,
        country: country ?? "US",
      });

      res.json({ slug: result.slug, status: result.status, result });
    } catch (err) {
      logger.error({ err }, "cities collect failed");
      res.status(500).json({ error: "Failed to collect city" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:slug/refresh — force re-collect
  // -------------------------------------------------------------------------
  router.post("/:slug/refresh", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const rows = await db
        .select()
        .from(cityIntelligence)
        .where(
          sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "City not found" });
        return;
      }
      const result = await collectCity(db, {
        city: row.city,
        region: row.region,
        country: row.country,
      });
      res.json({ slug: result.slug, status: result.status, result });
    } catch (err) {
      logger.error({ err }, "cities refresh failed");
      res.status(500).json({ error: "Failed to refresh city" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /:slug/pitch — Ollama pitch generator grounded in city data
  // -------------------------------------------------------------------------
  router.post("/:slug/pitch", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const { productOrService, audience } = req.body as {
        productOrService?: string;
        audience?: string;
      };
      if (!productOrService || typeof productOrService !== "string") {
        res.status(400).json({ error: "productOrService is required" });
        return;
      }

      const pitch = await generatePitch(slug, db, { productOrService, audience });
      if (!pitch) {
        res.status(404).json({ error: "City not found or pitch generation failed" });
        return;
      }

      res.json(pitch);
    } catch (err) {
      logger.error({ err }, "cities pitch failed");
      res.status(500).json({ error: "Failed to generate pitch" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:slug/directory-matches — CD-indexed projects in region
  // -------------------------------------------------------------------------
  router.get("/:slug/directory-matches", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const rows = await db
        .select()
        .from(cityIntelligence)
        .where(
          sql`${cityIntelligence.companyId} = ${COMPANY_ID} AND ${cityIntelligence.slug} = ${slug}`,
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        res.status(404).json({ error: "City not found" });
        return;
      }

      // intel_companies doesn't currently have a structured location column;
      // fall back to matching city/region text in name + description. This is
      // best-effort until we add a proper location tag.
      const cityPattern = `%${row.city.toLowerCase()}%`;
      const matches = (await db.execute<DirectoryMatchRow>(sql`
        SELECT slug, name, directory, website, category
        FROM intel_companies
        WHERE lower(name) LIKE ${cityPattern}
           OR lower(description) LIKE ${cityPattern}
        ORDER BY name
        LIMIT 25
      `)) as unknown as DirectoryMatchRow[];

      res.json({ matches });
    } catch (err) {
      logger.error({ err }, "cities directory-matches failed");
      res.status(500).json({ error: "Failed to load directory matches" });
    }
  });

  return router;
}
