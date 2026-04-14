/**
 * Agent Memory Service — structured fact storage per agent.
 *
 * Agents write subject-predicate-object triples during their work.
 * Supports semantic recall via BGE-M3 embeddings and exact-match lookups.
 * Managed by the Recall agent (expire, compact, embed, promote).
 */

import { sql, eq, and, lt } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agentMemory } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MemoryFact {
  id: number;
  agentName: string;
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
  source: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RememberOpts {
  confidence?: number;
  source?: string;
  expiresAt?: Date;
  embed?: boolean;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function agentMemoryService(db: Db) {
  return {
    /** Store a fact in agent memory. Upserts on (agent, subject, predicate). */
    async remember(
      agentName: string,
      subject: string,
      predicate: string,
      object: string,
      opts: RememberOpts = {},
    ): Promise<MemoryFact> {
      const confidence = opts.confidence ?? 1.0;
      const source = opts.source ?? null;
      const expiresAt = opts.expiresAt ?? null;

      // Upsert: if same (agent, subject, predicate) exists, update
      const existing = await db
        .select()
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.agentName, agentName),
            eq(agentMemory.subject, subject),
            eq(agentMemory.predicate, predicate),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const row = existing[0]!;
        await db
          .update(agentMemory)
          .set({
            object,
            confidence,
            source,
            expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(agentMemory.id, row.id));
        return { ...row, object, confidence, source, expiresAt: expiresAt?.toISOString() ?? null } as unknown as MemoryFact;
      }

      const [inserted] = await db
        .insert(agentMemory)
        .values({
          agentName,
          subject,
          predicate,
          object,
          confidence,
          source,
          expiresAt,
        })
        .returning();

      // Optionally embed
      if (opts.embed) {
        try {
          const { getEmbedding } = await import("./intel-embeddings.js");
          const text = `${subject} ${predicate} ${object}`;
          const embedding = await getEmbedding(text);
          const embeddingStr = `[${embedding.join(",")}]`;
          await db.execute(sql`
            UPDATE agent_memory SET embedding = ${embeddingStr}::vector
            WHERE id = ${inserted!.id}
          `);
        } catch (err) {
          logger.warn({ err, id: inserted!.id }, "Agent memory: failed to embed on write");
        }
      }

      return inserted as unknown as MemoryFact;
    },

    /** Semantic search over an agent's memories using embedding similarity. */
    async recall(agentName: string, query: string, limit = 10): Promise<Array<MemoryFact & { similarity: number }>> {
      try {
        const { getEmbedding } = await import("./intel-embeddings.js");
        const embedding = await getEmbedding(query);
        const embeddingStr = `[${embedding.join(",")}]`;

        const rows = await db.execute(sql`
          SELECT id, agent_name, subject, predicate, object, confidence, source,
                 expires_at, created_at, updated_at,
                 1 - (embedding <=> ${embeddingStr}::vector) AS similarity
          FROM agent_memory
          WHERE agent_name = ${agentName}
            AND embedding IS NOT NULL
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY embedding <=> ${embeddingStr}::vector
          LIMIT ${limit}
        `) as unknown as Array<MemoryFact & { similarity: number }>;

        return rows;
      } catch (err) {
        logger.warn({ err, agentName }, "Agent memory: semantic recall failed");
        return [];
      }
    },

    /** Exact-match recall by subject. */
    async recallBySubject(agentName: string, subject: string): Promise<MemoryFact[]> {
      const rows = await db
        .select()
        .from(agentMemory)
        .where(
          and(
            eq(agentMemory.agentName, agentName),
            eq(agentMemory.subject, subject),
          ),
        );
      return rows as unknown as MemoryFact[];
    },

    /** Delete a specific memory. */
    async forget(agentName: string, id: number): Promise<boolean> {
      const result = await db
        .delete(agentMemory)
        .where(and(eq(agentMemory.id, id), eq(agentMemory.agentName, agentName)))
        .returning();
      return result.length > 0;
    },

    /** List memories for an agent with optional pagination. */
    async list(agentName: string, limit = 50, offset = 0): Promise<MemoryFact[]> {
      const rows = await db
        .select()
        .from(agentMemory)
        .where(eq(agentMemory.agentName, agentName))
        .orderBy(agentMemory.createdAt)
        .limit(limit)
        .offset(offset);
      return rows as unknown as MemoryFact[];
    },

    /** Delete all memories past their expiry date. */
    async expireOldMemories(): Promise<number> {
      const deleted = await db
        .delete(agentMemory)
        .where(lt(agentMemory.expiresAt, new Date()))
        .returning();
      if (deleted.length > 0) {
        logger.info({ count: deleted.length }, "Agent memory: expired old memories");
      }
      return deleted.length;
    },

    /** Compact near-duplicate memories for a single agent. */
    async compactMemories(agentName: string): Promise<number> {
      // Find pairs with >0.95 similarity and same predicate
      const duplicates = await db.execute(sql`
        WITH pairs AS (
          SELECT a.id AS keep_id, b.id AS remove_id,
                 1 - (a.embedding <=> b.embedding) AS sim
          FROM agent_memory a
          JOIN agent_memory b ON a.id < b.id
            AND a.agent_name = b.agent_name
            AND a.predicate = b.predicate
            AND a.embedding IS NOT NULL
            AND b.embedding IS NOT NULL
          WHERE a.agent_name = ${agentName}
            AND 1 - (a.embedding <=> b.embedding) > 0.95
        )
        SELECT keep_id, remove_id FROM pairs
        ORDER BY sim DESC
        LIMIT 50
      `) as unknown as Array<{ keep_id: number; remove_id: number }>;

      if (duplicates.length === 0) return 0;

      const removeIds = duplicates.map((d) => d.remove_id);
      const deleted = await db.execute(sql`
        DELETE FROM agent_memory WHERE id = ANY(${removeIds}::int[])
      `);

      logger.info({ agentName, compacted: removeIds.length }, "Agent memory: compacted duplicates");
      return removeIds.length;
    },

    /** Embed all memories that don't have embeddings yet. */
    async embedUnembedded(limit = 100): Promise<number> {
      const rows = await db.execute(sql`
        SELECT id, subject, predicate, object
        FROM agent_memory
        WHERE embedding IS NULL
        LIMIT ${limit}
      `) as unknown as Array<{ id: number; subject: string; predicate: string; object: string }>;

      if (rows.length === 0) return 0;

      const { getEmbeddings } = await import("./intel-embeddings.js");
      const texts = rows.map((r) => `${r.subject} ${r.predicate} ${r.object}`);
      const embeddings = await getEmbeddings(texts);

      for (let i = 0; i < rows.length; i++) {
        const embeddingStr = `[${embeddings[i]!.join(",")}]`;
        await db.execute(sql`
          UPDATE agent_memory SET embedding = ${embeddingStr}::vector
          WHERE id = ${rows[i]!.id}
        `);
      }

      logger.info({ count: rows.length }, "Agent memory: embedded unembedded memories");
      return rows.length;
    },

    /** Get memory counts per agent. */
    async stats(): Promise<Array<{ agentName: string; count: number; withEmbedding: number }>> {
      const rows = await db.execute(sql`
        SELECT agent_name,
               COUNT(*)::int AS count,
               COUNT(embedding)::int AS with_embedding
        FROM agent_memory
        GROUP BY agent_name
        ORDER BY count DESC
      `) as unknown as Array<{ agent_name: string; count: number; with_embedding: number }>;

      return rows.map((r) => ({
        agentName: r.agent_name,
        count: r.count,
        withEmbedding: r.with_embedding,
      }));
    },
  };
}
