/**
 * Graph Query Service — owned by Oracle agent.
 *
 * Executes multi-hop relationship queries using PostgreSQL recursive CTEs,
 * combines graph traversal with vector similarity search (hybrid queries),
 * and provides graph intelligence to other services.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphNode {
  type: "company" | "tag";
  id: string;
  name?: string;
  tagType?: string;
}

export interface GraphEdge {
  sourceType: string;
  sourceId: string;
  relationship: string;
  targetType: string;
  targetId: string;
  confidence: number;
  verified: boolean;
  depth: number;
}

export interface GraphStats {
  totalTags: number;
  totalEdges: number;
  verifiedEdges: number;
  avgConfidence: number;
  topConnected: Array<{ type: string; id: string; edgeCount: number }>;
  relationshipCounts: Array<{ relationship: string; count: number }>;
}

export interface PathResult {
  found: boolean;
  path: GraphEdge[];
  depth: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function graphQueryService(db: Db) {
  return {
    /**
     * Traverse relationships from a starting entity using recursive CTE.
     * Returns all connected entities within maxDepth hops.
     */
    async traverseRelationships(
      startId: string,
      startType: "company" | "tag",
      maxDepth = 2,
      relationshipFilter?: string[],
    ): Promise<GraphEdge[]> {
      const depth = Math.min(maxDepth, 4); // cap at 4 to prevent runaway
      const relFilter = relationshipFilter && relationshipFilter.length > 0
        ? sql`AND cr.relationship = ANY(${relationshipFilter}::text[])`
        : sql``;

      const rows = await db.execute(sql`
        WITH RECURSIVE graph AS (
          SELECT source_type, source_id, relationship, target_type, target_id,
                 confidence, verified, 1 AS depth,
                 ARRAY[source_type || ':' || source_id] AS visited
          FROM company_relationships
          WHERE source_type = ${startType} AND source_id = ${startId}
            AND (verified = true OR confidence >= 0.4)
          UNION ALL
          SELECT cr.source_type, cr.source_id, cr.relationship, cr.target_type, cr.target_id,
                 cr.confidence, cr.verified, g.depth + 1,
                 g.visited || (cr.source_type || ':' || cr.source_id)
          FROM company_relationships cr
          JOIN graph g ON cr.source_type = g.target_type AND cr.source_id = g.target_id
          WHERE g.depth < ${depth}
            AND NOT (cr.target_type || ':' || cr.target_id) = ANY(g.visited)
            AND (cr.verified = true OR cr.confidence >= 0.4)
            ${relFilter}
        )
        SELECT DISTINCT ON (source_type, source_id, relationship, target_type, target_id)
          source_type, source_id, relationship, target_type, target_id,
          confidence, verified, depth
        FROM graph
        ORDER BY source_type, source_id, relationship, target_type, target_id, depth
      `) as unknown as Array<{
        source_type: string;
        source_id: string;
        relationship: string;
        target_type: string;
        target_id: string;
        confidence: number;
        verified: boolean;
        depth: number;
      }>;

      return rows.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        relationship: r.relationship,
        targetType: r.target_type,
        targetId: r.target_id,
        confidence: r.confidence,
        verified: r.verified,
        depth: r.depth,
      }));
    },

    /** Get direct neighbors (depth=1) for an entity. */
    async getNeighbors(
      id: string,
      type: "company" | "tag",
    ): Promise<GraphEdge[]> {
      const rows = await db.execute(sql`
        SELECT source_type, source_id, relationship, target_type, target_id,
               confidence, verified
        FROM company_relationships
        WHERE (source_type = ${type} AND source_id = ${id})
           OR (target_type = ${type} AND target_id = ${id})
        ORDER BY confidence DESC
      `) as unknown as Array<{
        source_type: string;
        source_id: string;
        relationship: string;
        target_type: string;
        target_id: string;
        confidence: number;
        verified: boolean;
      }>;

      return rows.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        relationship: r.relationship,
        targetType: r.target_type,
        targetId: r.target_id,
        confidence: r.confidence,
        verified: r.verified,
        depth: 1,
      }));
    },

    /**
     * Hybrid search: embed query → vector search for companies → expand via graph.
     */
    async hybridSearch(query: string, limit = 20): Promise<{
      directMatches: Array<{ type: string; id: string; name: string; similarity: number }>;
      graphExpanded: GraphEdge[];
    }> {
      try {
        const { getEmbedding } = await import("./intel-embeddings.js");
        const embedding = await getEmbedding(query);
        const embeddingStr = `[${embedding.join(",")}]`;

        // Step 1: Vector search in intel_companies and knowledge_tags
        const companyMatches = await db.execute(sql`
          SELECT 'company' AS type, slug AS id, name,
                 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
          FROM intel_reports
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT 10
        `) as unknown as Array<{ type: string; id: string; name: string; similarity: number }>;

        const tagMatches = await db.execute(sql`
          SELECT 'tag' AS type, slug AS id, name,
                 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
          FROM knowledge_tags
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT 10
        `) as unknown as Array<{ type: string; id: string; name: string; similarity: number }>;

        const directMatches = [...companyMatches, ...tagMatches]
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        // Step 2: Expand top results via graph (1-hop)
        const graphExpanded: GraphEdge[] = [];
        const topSlugs = directMatches.slice(0, 5);
        for (const match of topSlugs) {
          const neighbors = await this.getNeighbors(match.id, match.type as "company" | "tag");
          graphExpanded.push(...neighbors);
        }

        return { directMatches, graphExpanded };
      } catch (err) {
        logger.warn({ err }, "Graph query: hybrid search failed");
        return { directMatches: [], graphExpanded: [] };
      }
    },

    /** Find shortest path between two entities via BFS. */
    async findConnections(
      sourceId: string,
      sourceType: "company" | "tag",
      targetId: string,
      targetType: "company" | "tag",
      maxDepth = 4,
    ): Promise<PathResult> {
      const rows = await db.execute(sql`
        WITH RECURSIVE paths AS (
          SELECT source_type, source_id, relationship, target_type, target_id,
                 confidence, verified, 1 AS depth,
                 ARRAY[ROW(source_type, source_id, relationship, target_type, target_id)::text] AS path_arr
          FROM company_relationships
          WHERE source_type = ${sourceType} AND source_id = ${sourceId}
            AND (verified = true OR confidence >= 0.3)
          UNION ALL
          SELECT cr.source_type, cr.source_id, cr.relationship, cr.target_type, cr.target_id,
                 cr.confidence, cr.verified, p.depth + 1,
                 p.path_arr || ROW(cr.source_type, cr.source_id, cr.relationship, cr.target_type, cr.target_id)::text
          FROM company_relationships cr
          JOIN paths p ON cr.source_type = p.target_type AND cr.source_id = p.target_id
          WHERE p.depth < ${Math.min(maxDepth, 5)}
            AND NOT (cr.target_type || ':' || cr.target_id) = ANY(
              SELECT unnest(ARRAY(
                SELECT split_part(e, ',', 4) || ':' || split_part(e, ',', 5)
                FROM unnest(p.path_arr) AS e
              ))
            )
            AND (cr.verified = true OR cr.confidence >= 0.3)
        )
        SELECT source_type, source_id, relationship, target_type, target_id,
               confidence, verified, depth
        FROM paths
        WHERE target_type = ${targetType} AND target_id = ${targetId}
        ORDER BY depth
        LIMIT 1
      `) as unknown as Array<{
        source_type: string;
        source_id: string;
        relationship: string;
        target_type: string;
        target_id: string;
        confidence: number;
        verified: boolean;
        depth: number;
      }>;

      if (rows.length === 0) return { found: false, path: [], depth: 0 };

      return {
        found: true,
        path: rows.map((r) => ({
          sourceType: r.source_type,
          sourceId: r.source_id,
          relationship: r.relationship,
          targetType: r.target_type,
          targetId: r.target_id,
          confidence: r.confidence,
          verified: r.verified,
          depth: r.depth,
        })),
        depth: rows[rows.length - 1]!.depth,
      };
    },

    /** Get graph statistics. */
    async getGraphStats(): Promise<GraphStats> {
      const [tagCount] = await db.execute(sql`
        SELECT COUNT(*)::int AS count FROM knowledge_tags
      `) as unknown as [{ count: number }];

      const [edgeCount] = await db.execute(sql`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE verified)::int AS verified,
               COALESCE(AVG(confidence), 0)::real AS avg_confidence
        FROM company_relationships
      `) as unknown as [{ total: number; verified: number; avg_confidence: number }];

      const topConnected = await db.execute(sql`
        SELECT type, id, COUNT(*)::int AS edge_count FROM (
          SELECT source_type AS type, source_id AS id FROM company_relationships
          UNION ALL
          SELECT target_type, target_id FROM company_relationships
        ) sub
        GROUP BY type, id
        ORDER BY edge_count DESC
        LIMIT 10
      `) as unknown as Array<{ type: string; id: string; edge_count: number }>;

      const relationshipCounts = await db.execute(sql`
        SELECT relationship, COUNT(*)::int AS count
        FROM company_relationships
        GROUP BY relationship
        ORDER BY count DESC
      `) as unknown as Array<{ relationship: string; count: number }>;

      const stats: GraphStats = {
        totalTags: tagCount?.count ?? 0,
        totalEdges: edgeCount?.total ?? 0,
        verifiedEdges: edgeCount?.verified ?? 0,
        avgConfidence: edgeCount?.avg_confidence ?? 0,
        topConnected: topConnected.map((r) => ({ type: r.type, id: r.id, edgeCount: r.edge_count })),
        relationshipCounts: relationshipCounts.map((r) => ({ relationship: r.relationship, count: r.count })),
      };

      logger.info(stats, "Graph query: stats computed");
      return stats;
    },

    /** List relationships with filters. */
    async listRelationships(opts: {
      sourceId?: string;
      targetId?: string;
      relationship?: string;
      minConfidence?: number;
      verified?: boolean;
      limit?: number;
      offset?: number;
    } = {}): Promise<GraphEdge[]> {
      const conditions: ReturnType<typeof sql>[] = [];
      if (opts.sourceId) conditions.push(sql`source_id = ${opts.sourceId}`);
      if (opts.targetId) conditions.push(sql`target_id = ${opts.targetId}`);
      if (opts.relationship) conditions.push(sql`relationship = ${opts.relationship}`);
      if (opts.minConfidence != null) conditions.push(sql`confidence >= ${opts.minConfidence}`);
      if (opts.verified != null) conditions.push(sql`verified = ${opts.verified}`);

      const where = conditions.length > 0
        ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
        : sql``;

      const rows = await db.execute(sql`
        SELECT source_type, source_id, relationship, target_type, target_id,
               confidence, verified, id
        FROM company_relationships
        ${where}
        ORDER BY confidence DESC, created_at DESC
        LIMIT ${opts.limit ?? 50}
        OFFSET ${opts.offset ?? 0}
      `) as unknown as Array<{
        source_type: string;
        source_id: string;
        relationship: string;
        target_type: string;
        target_id: string;
        confidence: number;
        verified: boolean;
        id: number;
      }>;

      return rows.map((r) => ({
        sourceType: r.source_type,
        sourceId: r.source_id,
        relationship: r.relationship,
        targetType: r.target_type,
        targetId: r.target_id,
        confidence: r.confidence,
        verified: r.verified,
        depth: 0,
      }));
    },
  };
}
