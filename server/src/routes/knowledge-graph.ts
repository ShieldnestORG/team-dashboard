import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { knowledgeTags } from "@paperclipai/db";
import { eq, sql } from "drizzle-orm";
import { graphQueryService } from "../services/graph-query.js";
import { relationshipExtractorService } from "../services/relationship-extractor.js";

const CONTENT_API_KEY = process.env.CONTENT_API_KEY || "";

function requireApiKey(
  req: { headers: Record<string, string | string[] | undefined> },
  res: { status: (code: number) => { json: (body: unknown) => void } },
  next: () => void,
) {
  if (!CONTENT_API_KEY) { next(); return; }
  const provided =
    (req.headers["x-api-key"] as string) ||
    (req.headers.authorization as string)?.replace("Bearer ", "");
  if (provided !== CONTENT_API_KEY) {
    res.status(401).json({ error: "Invalid API key" });
    return;
  }
  next();
}

export function knowledgeGraphRoutes(db: Db) {
  const router = Router();
  const graph = graphQueryService(db);
  const extractor = relationshipExtractorService(db);

  // GET /api/knowledge-graph/stats
  router.get("/stats", async (_req, res) => {
    try {
      const stats = await graph.getGraphStats();
      res.json(stats);
    } catch (err) {
      console.error("knowledge-graph stats error:", err);
      res.status(500).json({ error: "Failed to fetch graph stats" });
    }
  });

  // GET /api/knowledge-graph/search?q=cosmos&limit=20
  router.get("/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q) { res.status(400).json({ error: "q parameter required" }); return; }
      const limit = Math.min(Number(req.query.limit) || 20, 100);
      const result = await graph.hybridSearch(q, limit);
      res.json(result);
    } catch (err) {
      console.error("knowledge-graph search error:", err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  // GET /api/knowledge-graph/entity/:type/:slug
  router.get("/entity/:type/:slug", async (req, res) => {
    try {
      const entityType = req.params.type as string;
      const slug = req.params.slug as string;
      if (entityType !== "company" && entityType !== "tag") {
        res.status(400).json({ error: "type must be 'company' or 'tag'" });
        return;
      }

      const neighbors = await graph.getNeighbors(slug, entityType);

      // If it's a tag, also return the tag details
      let tagDetails = null;
      if (entityType === "tag") {
        const [tag] = await db.select().from(knowledgeTags).where(eq(knowledgeTags.slug, slug)).limit(1);
        tagDetails = tag ?? null;
      }

      res.json({ type: entityType, id: slug, neighbors, tagDetails });
    } catch (err) {
      console.error("knowledge-graph entity error:", err);
      res.status(500).json({ error: "Failed to fetch entity" });
    }
  });

  // GET /api/knowledge-graph/entity/:type/:slug/neighbors
  router.get("/entity/:type/:slug/neighbors", async (req, res) => {
    try {
      const entityType = req.params.type as string;
      const slug = req.params.slug as string;
      if (entityType !== "company" && entityType !== "tag") {
        res.status(400).json({ error: "type must be 'company' or 'tag'" });
        return;
      }
      const neighbors = await graph.getNeighbors(slug, entityType);
      res.json({ neighbors });
    } catch (err) {
      console.error("knowledge-graph neighbors error:", err);
      res.status(500).json({ error: "Failed to fetch neighbors" });
    }
  });

  // GET /api/knowledge-graph/traverse/:type/:slug?depth=2&relationships=uses,built_on
  router.get("/traverse/:type/:slug", async (req, res) => {
    try {
      const entityType = req.params.type as string;
      const slug = req.params.slug as string;
      if (entityType !== "company" && entityType !== "tag") {
        res.status(400).json({ error: "type must be 'company' or 'tag'" });
        return;
      }
      const depth = Math.min(Number(req.query.depth) || 2, 4);
      const relationships = req.query.relationships
        ? (req.query.relationships as string).split(",")
        : undefined;
      const edges = await graph.traverseRelationships(slug, entityType, depth, relationships);
      res.json({ edges });
    } catch (err) {
      console.error("knowledge-graph traverse error:", err);
      res.status(500).json({ error: "Traversal failed" });
    }
  });

  // GET /api/knowledge-graph/path/:sType/:sSlug/:tType/:tSlug
  router.get("/path/:sType/:sSlug/:tType/:tSlug", async (req, res) => {
    try {
      const sType = req.params.sType as string;
      const sSlug = req.params.sSlug as string;
      const tType = req.params.tType as string;
      const tSlug = req.params.tSlug as string;
      if ((sType !== "company" && sType !== "tag") || (tType !== "company" && tType !== "tag")) {
        res.status(400).json({ error: "type must be 'company' or 'tag'" });
        return;
      }
      const result = await graph.findConnections(sSlug, sType, tSlug, tType);
      res.json(result);
    } catch (err) {
      console.error("knowledge-graph path error:", err);
      res.status(500).json({ error: "Path search failed" });
    }
  });

  // GET /api/knowledge-graph/relationships
  router.get("/relationships", async (req, res) => {
    try {
      const edges = await graph.listRelationships({
        sourceId: req.query.sourceId as string | undefined,
        targetId: req.query.targetId as string | undefined,
        relationship: req.query.relationship as string | undefined,
        minConfidence: req.query.minConfidence ? Number(req.query.minConfidence) : undefined,
        verified: req.query.verified === "true" ? true : req.query.verified === "false" ? false : undefined,
        limit: Math.min(Number(req.query.limit) || 50, 200),
        offset: Number(req.query.offset) || 0,
      });
      res.json({ relationships: edges });
    } catch (err) {
      console.error("knowledge-graph relationships error:", err);
      res.status(500).json({ error: "Failed to list relationships" });
    }
  });

  // POST /api/knowledge-graph/relationships (requires API key)
  router.post("/relationships", requireApiKey, async (req, res) => {
    try {
      const { sourceType, sourceId, relationship, targetType, targetId, confidence, metadata } = req.body as {
        sourceType: string;
        sourceId: string;
        relationship: string;
        targetType: string;
        targetId: string;
        confidence?: number;
        metadata?: Record<string, unknown>;
      };

      if (!sourceType || !sourceId || !relationship || !targetType || !targetId) {
        res.status(400).json({ error: "sourceType, sourceId, relationship, targetType, targetId required" });
        return;
      }

      await db.execute(sql`
        INSERT INTO company_relationships
          (source_type, source_id, relationship, target_type, target_id, confidence, metadata, extracted_by, verified)
        VALUES
          (${sourceType}, ${sourceId}, ${relationship}, ${targetType}, ${targetId},
           ${confidence ?? 0.8}, ${JSON.stringify(metadata ?? {})}::jsonb, 'manual', true)
        ON CONFLICT (source_type, source_id, relationship, target_type, target_id)
        DO UPDATE SET
          confidence = GREATEST(company_relationships.confidence, EXCLUDED.confidence),
          verified = true,
          updated_at = NOW()
      `);

      res.json({ ok: true });
    } catch (err) {
      console.error("knowledge-graph create relationship error:", err);
      res.status(500).json({ error: "Failed to create relationship" });
    }
  });

  // PATCH /api/knowledge-graph/relationships/:id
  router.patch("/relationships/:id", requireApiKey, async (req, res) => {
    try {
      const id = Number(req.params.id as string);
      const { confidence, verified } = req.body as { confidence?: number; verified?: boolean };

      const sets: string[] = [];
      if (confidence != null) sets.push(`confidence = ${confidence}`);
      if (verified != null) sets.push(`verified = ${verified}`);
      if (sets.length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }

      await db.execute(sql`
        UPDATE company_relationships
        SET ${sql.raw(sets.join(", "))}, updated_at = NOW()
        WHERE id = ${id}
      `);
      res.json({ ok: true });
    } catch (err) {
      console.error("knowledge-graph update relationship error:", err);
      res.status(500).json({ error: "Failed to update relationship" });
    }
  });

  // DELETE /api/knowledge-graph/relationships/:id
  router.delete("/relationships/:id", requireApiKey, async (req, res) => {
    try {
      const id = Number(req.params.id as string);
      await db.execute(sql`DELETE FROM company_relationships WHERE id = ${id}`);
      res.json({ ok: true });
    } catch (err) {
      console.error("knowledge-graph delete relationship error:", err);
      res.status(500).json({ error: "Failed to delete relationship" });
    }
  });

  // GET /api/knowledge-graph/tags?search=cosmos&type=technology
  router.get("/tags", async (req, res) => {
    try {
      const search = req.query.search as string | undefined;
      const tagType = req.query.type as string | undefined;
      const limit = Math.min(Number(req.query.limit) || 50, 200);

      let query;
      if (search && tagType) {
        query = sql`
          SELECT id, slug, name, tag_type, description, aliases, created_at
          FROM knowledge_tags
          WHERE (name ILIKE ${'%' + search + '%'} OR slug ILIKE ${'%' + search + '%'})
            AND tag_type = ${tagType}
          ORDER BY name LIMIT ${limit}
        `;
      } else if (search) {
        query = sql`
          SELECT id, slug, name, tag_type, description, aliases, created_at
          FROM knowledge_tags
          WHERE name ILIKE ${'%' + search + '%'} OR slug ILIKE ${'%' + search + '%'}
          ORDER BY name LIMIT ${limit}
        `;
      } else if (tagType) {
        query = sql`
          SELECT id, slug, name, tag_type, description, aliases, created_at
          FROM knowledge_tags
          WHERE tag_type = ${tagType}
          ORDER BY name LIMIT ${limit}
        `;
      } else {
        query = sql`
          SELECT id, slug, name, tag_type, description, aliases, created_at
          FROM knowledge_tags
          ORDER BY name LIMIT ${limit}
        `;
      }

      const tags = await db.execute(query);
      res.json({ tags });
    } catch (err) {
      console.error("knowledge-graph tags error:", err);
      res.status(500).json({ error: "Failed to list tags" });
    }
  });

  // POST /api/knowledge-graph/tags
  router.post("/tags", requireApiKey, async (req, res) => {
    try {
      const { name, tagType, description, aliases } = req.body as {
        name: string;
        tagType?: string;
        description?: string;
        aliases?: string[];
      };
      if (!name) { res.status(400).json({ error: "name required" }); return; }

      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      const [tag] = await db
        .insert(knowledgeTags)
        .values({
          slug,
          name,
          tagType: tagType ?? "technology",
          description: description ?? null,
          aliases: aliases ?? [name.toLowerCase()],
        })
        .onConflictDoNothing()
        .returning();

      res.json({ tag: tag ?? { slug, name, message: "Already exists" } });
    } catch (err) {
      console.error("knowledge-graph create tag error:", err);
      res.status(500).json({ error: "Failed to create tag" });
    }
  });

  // GET /api/knowledge-graph/visualization — nodes + edges for graph rendering
  router.get("/visualization", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 100, 500);

      const edges = await db.execute(sql`
        SELECT source_type, source_id, relationship, target_type, target_id, confidence, verified
        FROM company_relationships
        WHERE confidence >= 0.4 OR verified = true
        ORDER BY confidence DESC
        LIMIT ${limit}
      `) as unknown as Array<{
        source_type: string;
        source_id: string;
        relationship: string;
        target_type: string;
        target_id: string;
        confidence: number;
        verified: boolean;
      }>;

      // Collect unique nodes
      const nodeSet = new Map<string, { type: string; id: string }>();
      for (const e of edges) {
        nodeSet.set(`${e.source_type}:${e.source_id}`, { type: e.source_type, id: e.source_id });
        nodeSet.set(`${e.target_type}:${e.target_id}`, { type: e.target_type, id: e.target_id });
      }

      res.json({
        nodes: Array.from(nodeSet.values()),
        edges: edges.map((e) => ({
          source: `${e.source_type}:${e.source_id}`,
          target: `${e.target_type}:${e.target_id}`,
          relationship: e.relationship,
          confidence: e.confidence,
          verified: e.verified,
        })),
      });
    } catch (err) {
      console.error("knowledge-graph visualization error:", err);
      res.status(500).json({ error: "Failed to build visualization" });
    }
  });

  return router;
}
