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
import { sql, desc, asc } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { cityIntelligence, cityBusinessLeads, contentItems } from "@paperclipai/db";
import type { CityBusinessLead } from "@paperclipai/db";
import {
  collectCity,
  buildCitySlug,
  generatePitch,
} from "../services/city-collector.js";
import { findLocalBusinesses, deriveIndustry } from "../services/city-business-finder.js";
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

  // -------------------------------------------------------------------------
  // POST /find-businesses — search for local businesses by city + topic
  // -------------------------------------------------------------------------
  router.post("/find-businesses", async (req, res) => {
    try {
      const { city, region, topic, limit } = req.body as {
        city?: string;
        region?: string | null;
        topic?: string;
        limit?: number;
      };

      if (!city || typeof city !== "string") {
        res.status(400).json({ error: "city is required" });
        return;
      }
      if (!topic || typeof topic !== "string") {
        res.status(400).json({ error: "topic is required" });
        return;
      }

      const leads = await findLocalBusinesses(db, {
        city,
        region: region ?? null,
        topic,
        limit: typeof limit === "number" ? limit : 30,
      });

      res.json({ leads, count: leads.length });
    } catch (err) {
      logger.error({ err }, "cities find-businesses failed");
      res.status(500).json({ error: "Failed to find businesses" });
    }
  });

  // -------------------------------------------------------------------------
  // GET /:slug/leads — list business leads for a city
  // -------------------------------------------------------------------------
  router.get("/:slug/leads", async (req, res) => {
    try {
      const slug = req.params.slug as string;
      const topic = req.query.topic as string | undefined;
      const status = req.query.status as string | undefined;

      let whereClause = sql`${cityBusinessLeads.companyId} = ${COMPANY_ID}
        AND ${cityBusinessLeads.citySlug} = ${slug}`;

      if (topic) {
        whereClause = sql`${whereClause} AND lower(${cityBusinessLeads.topic}) = ${topic.toLowerCase()}`;
      }
      if (status) {
        whereClause = sql`${whereClause} AND ${cityBusinessLeads.leadStatus} = ${status}`;
      }

      const leads = await db
        .select()
        .from(cityBusinessLeads)
        .where(whereClause)
        .orderBy(asc(cityBusinessLeads.foundAt))
        .limit(200);

      // Distinct topics found for this city (for the UI topic filter dropdown)
      const topicRows = await db
        .selectDistinct({ topic: cityBusinessLeads.topic })
        .from(cityBusinessLeads)
        .where(
          sql`${cityBusinessLeads.companyId} = ${COMPANY_ID} AND ${cityBusinessLeads.citySlug} = ${slug}`,
        );

      res.json({
        leads,
        count: leads.length,
        topics: topicRows.map((r) => r.topic),
      });
    } catch (err) {
      logger.error({ err }, "cities get-leads failed");
      res.status(500).json({ error: "Failed to load leads" });
    }
  });

  // -------------------------------------------------------------------------
  // PATCH /leads/:id — update lead status or notes
  // -------------------------------------------------------------------------
  router.patch("/leads/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      const { leadStatus, notes } = req.body as {
        leadStatus?: string;
        notes?: string;
      };

      const validStatuses = ["new", "verified", "promoted_partner", "skipped"];
      if (leadStatus && !validStatuses.includes(leadStatus)) {
        res.status(400).json({ error: `leadStatus must be one of: ${validStatuses.join(", ")}` });
        return;
      }

      const updates: Record<string, unknown> = { actionedAt: new Date() };
      if (leadStatus !== undefined) updates.leadStatus = leadStatus;
      if (notes !== undefined) updates.notes = notes;

      const updated = await db
        .update(cityBusinessLeads)
        .set(updates)
        .where(
          sql`${cityBusinessLeads.id} = ${id} AND ${cityBusinessLeads.companyId} = ${COMPANY_ID}`,
        )
        .returning();

      if (updated.length === 0) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      res.json({ lead: updated[0] });
    } catch (err) {
      logger.error({ err }, "cities patch-lead failed");
      res.status(500).json({ error: "Failed to update lead" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /leads/:id/promote-partner — return pre-fill payload for partner form
  // -------------------------------------------------------------------------

  // Category → partner industry mapping (mirrors deriveIndustry in city-business-finder)
  const CATEGORY_TO_INDUSTRY: Record<string, string> = {
    home_services: "home_services",
    handyman: "home_services",
    plumber: "home_services",
    electrician: "home_services",
    contractor: "home_services",
    dining: "dining",
    restaurant: "dining",
    fitness: "fitness",
    gym: "fitness",
    wellness: "wellness",
    salon: "salon",
    auto: "auto",
    healthcare: "healthcare",
    legal: "legal",
    local_business: "retail",
  };

  router.post("/leads/:id/promote-partner", async (req, res) => {
    try {
      const id = req.params.id as string;

      const rows = await db
        .select()
        .from(cityBusinessLeads)
        .where(
          sql`${cityBusinessLeads.id} = ${id} AND ${cityBusinessLeads.companyId} = ${COMPANY_ID}`,
        )
        .limit(1);

      const lead = rows[0] as CityBusinessLead | undefined;
      if (!lead) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      // Derive city + region from the city slug (slug is like "austin-tx-us")
      const slugParts = lead.citySlug.split("-");
      const country = slugParts[slugParts.length - 1]?.toUpperCase() ?? "US";
      const region =
        slugParts.length >= 3 ? slugParts[slugParts.length - 2]?.toUpperCase() : undefined;
      const cityName = slugParts
        .slice(0, slugParts.length - (region ? 2 : 1))
        .join(" ");
      const location = [cityName, region]
        .filter(Boolean)
        .map((s) => (s as string).charAt(0).toUpperCase() + (s as string).slice(1))
        .join(", ");

      const category = lead.category ?? "local_business";
      const industry =
        CATEGORY_TO_INDUSTRY[category.toLowerCase()] ?? deriveIndustry(category);

      const preFill = {
        name: lead.name,
        website: lead.website ?? "",
        phone: lead.phone ?? "",
        address: lead.address ?? "",
        industry,
        location,
        description: lead.rawSnippet
          ? `${lead.name} — found via ${lead.source} search for "${lead.topic}" in ${location}.`
          : "",
        contactEmail: "",
      };

      // Mark lead as verified (about to be promoted)
      await db
        .update(cityBusinessLeads)
        .set({ leadStatus: "verified", actionedAt: new Date() })
        .where(sql`${cityBusinessLeads.id} = ${id}`);

      res.json({ preFill, lead });
    } catch (err) {
      logger.error({ err }, "cities promote-partner failed");
      res.status(500).json({ error: "Failed to promote lead" });
    }
  });

  // -------------------------------------------------------------------------
  // POST /leads/:id/generate-content — seed a content item from lead data
  // -------------------------------------------------------------------------
  router.post("/leads/:id/generate-content", async (req, res) => {
    try {
      const id = req.params.id as string;
      const { personalityId = "cipher", contentType = "blog_post" } = req.body as {
        personalityId?: string;
        contentType?: string;
      };

      const rows = await db
        .select()
        .from(cityBusinessLeads)
        .where(
          sql`${cityBusinessLeads.id} = ${id} AND ${cityBusinessLeads.companyId} = ${COMPANY_ID}`,
        )
        .limit(1);

      const lead = rows[0] as CityBusinessLead | undefined;
      if (!lead) {
        res.status(404).json({ error: "Lead not found" });
        return;
      }

      // Build topic from lead data
      const cityLabel = lead.citySlug
        .split("-")
        .slice(0, -1) // drop country suffix
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
      const topic = `${lead.topic} services in ${cityLabel}`;

      // Build context from lead data
      const contextSnippet = [
        `Business: ${lead.name}`,
        lead.category ? `Category: ${lead.category}` : null,
        lead.address ? `Location: ${lead.address}` : null,
        lead.rating ? `Rating: ${lead.rating} stars` : null,
        lead.reviewCount ? `Reviews: ${lead.reviewCount}` : null,
        lead.website ? `Website: ${lead.website}` : null,
        lead.rawSnippet ? `Context: ${lead.rawSnippet.slice(0, 200)}` : null,
      ]
        .filter(Boolean)
        .join(". ");

      const [contentItem] = await db
        .insert(contentItems)
        .values({
          companyId: COMPANY_ID,
          personalityId,
          contentType,
          platform: contentType === "blog_post" ? "blog" : "twitter",
          topic,
          content: "",
          status: "pending",
          contextQuery: contextSnippet,
          brand: "cd",
        })
        .returning();

      res.json({ contentItem, topic });
    } catch (err) {
      logger.error({ err }, "cities generate-content failed");
      res.status(500).json({ error: "Failed to generate content" });
    }
  });

  return router;
}
