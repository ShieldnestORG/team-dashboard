/**
 * Knowledge Graph Cron Jobs — 9 jobs across 4 agents (Nexus, Weaver, Recall, Oracle).
 *
 * Nexus: extract relationships, embed tags
 * Weaver: deduplicate tags, prune edges, stats
 * Recall: expire memories, compact, embed
 * Oracle: warm cache
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { relationshipExtractorService } from "./relationship-extractor.js";
import { graphQueryService } from "./graph-query.js";
import { agentMemoryService } from "./agent-memory.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Weaver helpers
// ---------------------------------------------------------------------------

/** Merge duplicate knowledge tags by embedding similarity > 0.92. */
async function deduplicateTags(db: Db): Promise<number> {
  const duplicates = await db.execute(sql`
    WITH pairs AS (
      SELECT a.id AS keep_id, a.slug AS keep_slug, a.name AS keep_name,
             b.id AS remove_id, b.slug AS remove_slug, b.name AS remove_name,
             b.aliases AS remove_aliases,
             1 - (a.embedding <=> b.embedding) AS sim
      FROM knowledge_tags a
      JOIN knowledge_tags b ON a.id < b.id
        AND a.tag_type = b.tag_type
        AND a.embedding IS NOT NULL
        AND b.embedding IS NOT NULL
      WHERE 1 - (a.embedding <=> b.embedding) > 0.92
    )
    SELECT * FROM pairs ORDER BY sim DESC LIMIT 20
  `) as unknown as Array<{
    keep_id: number;
    keep_slug: string;
    keep_name: string;
    remove_id: number;
    remove_slug: string;
    remove_name: string;
    remove_aliases: string[];
    sim: number;
  }>;

  if (duplicates.length === 0) return 0;

  let merged = 0;
  for (const dup of duplicates) {
    // Add removed tag's name and aliases to the survivor
    const newAliases = [dup.remove_name.toLowerCase(), dup.remove_slug, ...(dup.remove_aliases || [])];
    await db.execute(sql`
      UPDATE knowledge_tags
      SET aliases = (
        SELECT jsonb_agg(DISTINCT v)
        FROM jsonb_array_elements(aliases || ${JSON.stringify(newAliases)}::jsonb) AS v
      ),
      updated_at = NOW()
      WHERE id = ${dup.keep_id}
    `);

    // Redirect all edges from the removed tag to the survivor
    await db.execute(sql`
      UPDATE company_relationships
      SET source_id = ${dup.keep_slug}, updated_at = NOW()
      WHERE source_type = 'tag' AND source_id = ${dup.remove_slug}
    `);
    await db.execute(sql`
      UPDATE company_relationships
      SET target_id = ${dup.keep_slug}, updated_at = NOW()
      WHERE target_type = 'tag' AND target_id = ${dup.remove_slug}
    `);

    // Delete the duplicate tag
    await db.execute(sql`DELETE FROM knowledge_tags WHERE id = ${dup.remove_id}`);

    logger.info({ keep: dup.keep_slug, removed: dup.remove_slug, similarity: dup.sim }, "Weaver: merged duplicate tag");
    merged++;
  }

  // Clean up any duplicate edges created by the merge
  await db.execute(sql`
    DELETE FROM company_relationships a
    USING company_relationships b
    WHERE a.id > b.id
      AND a.source_type = b.source_type AND a.source_id = b.source_id
      AND a.relationship = b.relationship
      AND a.target_type = b.target_type AND a.target_id = b.target_id
  `);

  return merged;
}

/** Remove low-confidence unverified edges with no recent evidence. */
async function pruneEdges(db: Db): Promise<number> {
  // Remove edges with confidence < 0.2 that are older than 7 days
  const result = await db.execute(sql`
    DELETE FROM company_relationships
    WHERE confidence < 0.2
      AND verified = false
      AND created_at < NOW() - INTERVAL '7 days'
    RETURNING id
  `) as unknown as Array<{ id: number }>;

  // Downgrade confidence for stale edges (no update in 30 days)
  await db.execute(sql`
    UPDATE company_relationships
    SET confidence = GREATEST(0.1, confidence - 0.1),
        updated_at = NOW()
    WHERE verified = false
      AND updated_at < NOW() - INTERVAL '30 days'
      AND confidence > 0.2
  `);

  // Auto-verify high-confidence edges with 3+ evidence reports
  await db.execute(sql`
    UPDATE company_relationships
    SET verified = true, updated_at = NOW()
    WHERE verified = false
      AND confidence >= 0.85
      AND jsonb_array_length(evidence_report_ids) >= 3
  `);

  if (result.length > 0) {
    logger.info({ pruned: result.length }, "Weaver: pruned low-confidence edges");
  }
  return result.length;
}

/** Compact all agents' memories. */
async function compactAllAgentMemories(db: Db): Promise<number> {
  const memory = agentMemoryService(db);
  const agents = await db.execute(sql`
    SELECT DISTINCT agent_name FROM agent_memory
  `) as unknown as Array<{ agent_name: string }>;

  let total = 0;
  for (const agent of agents) {
    total += await memory.compactMemories(agent.agent_name);
  }
  return total;
}

/** Pre-compute common traversals and cache in agent_memory. */
async function warmGraphCache(db: Db): Promise<number> {
  const graph = graphQueryService(db);

  // Find top connected tags to warm
  const topTags = await db.execute(sql`
    SELECT target_id AS slug
    FROM company_relationships
    WHERE target_type = 'tag'
    GROUP BY target_id
    ORDER BY COUNT(*) DESC
    LIMIT 20
  `) as unknown as Array<{ slug: string }>;

  const memory = agentMemoryService(db);
  let cached = 0;

  for (const tag of topTags) {
    const edges = await graph.traverseRelationships(tag.slug, "tag", 2);
    await memory.remember(
      "oracle",
      `cache:tag:${tag.slug}`,
      "cached_query",
      JSON.stringify({ edges: edges.length, data: edges.slice(0, 50) }),
      { confidence: 1.0, source: "warm-cache", expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    );
    cached++;
  }

  logger.info({ cached }, "Oracle: warmed graph cache");
  return cached;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function startKnowledgeGraphCrons(db: Db): void {
  const extractor = relationshipExtractorService(db);
  const graph = graphQueryService(db);
  const memory = agentMemoryService(db);

  // Nexus jobs
  registerCronJob({
    jobName: "kg:extract-relationships",
    schedule: "0 */3 * * *",
    ownerAgent: "nexus",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => extractor.extractFromReports(50),
  });
  registerCronJob({
    jobName: "kg:embed-tags",
    schedule: "0 */6 * * *",
    ownerAgent: "nexus",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => extractor.embedTagsBatch(),
  });

  // Weaver jobs
  registerCronJob({
    jobName: "kg:deduplicate-tags",
    schedule: "0 2 * * *",
    ownerAgent: "weaver",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => deduplicateTags(db),
  });
  registerCronJob({
    jobName: "kg:prune-edges",
    schedule: "0 3 * * *",
    ownerAgent: "weaver",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => pruneEdges(db),
  });
  registerCronJob({
    jobName: "kg:stats",
    schedule: "0 */12 * * *",
    ownerAgent: "weaver",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => graph.getGraphStats(),
  });

  // Recall jobs
  registerCronJob({
    jobName: "memory:expire",
    schedule: "0 4 * * *",
    ownerAgent: "recall",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => memory.expireOldMemories(),
  });
  registerCronJob({
    jobName: "memory:compact",
    schedule: "0 5 * * *",
    ownerAgent: "recall",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => compactAllAgentMemories(db),
  });
  registerCronJob({
    jobName: "memory:embed",
    schedule: "0 */4 * * *",
    ownerAgent: "recall",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => memory.embedUnembedded(100),
  });

  // Oracle jobs
  registerCronJob({
    jobName: "kg:warm-cache",
    schedule: "0 6 * * *",
    ownerAgent: "oracle",
    sourceFile: "knowledge-graph-crons.ts",
    handler: () => warmGraphCache(db),
  });

  logger.info({ count: 9 }, "Knowledge graph cron jobs registered");
}
