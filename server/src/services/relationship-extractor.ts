/**
 * Relationship Extractor Service — owned by Nexus agent.
 *
 * Processes intel reports through Ollama to extract structured relationship
 * triples (subject, relationship, target) and builds the knowledge graph.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { knowledgeTags, companyRelationships } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_RELATIONSHIPS = [
  "uses", "built_on", "competes_with", "partners_with",
  "fork_of", "invested_in", "maintains", "integrates",
] as const;

/**
 * Patterns that indicate a candidate string is NOT a real entity and should
 * not be auto-promoted to a knowledge_tags row. Keeps junk like `node24`,
 * `v3.0.1`, commit SHAs, and bare file extensions out of the KG.
 *
 * See 2026-04-27 KG audit (kg-audit-20260428.txt). Companion to the prompt
 * patch (PR #14) and harvester slug attribution (PR #15).
 */
export const NON_ENTITY_PATTERNS: RegExp[] = [
  // Version strings: v3.0.1, 1.2, 0.5.0-beta
  /^v?\d+(\.\d+){1,3}(-[\w.]+)?$/i,
  // Node-version shorthand: node24, node 18 (no space form is the bug case)
  /^node\d+$/i,
  // Commit SHAs (7-40 hex chars, no other content)
  /^[a-f0-9]{7,40}$/i,
  // Bare file extensions: .ts, .json
  /^\.\w{1,5}$/,
];

/** Return true if `candidate` looks like a non-entity that shouldn't become a tag. */
export function looksLikeNonEntity(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < 3) return true;
  for (const pattern of NON_ENTITY_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

type RelationshipType = typeof VALID_RELATIONSHIPS[number];

interface ExtractedTriple {
  source: string;
  relationship: string;
  target: string;
  confidence: number;
}

export interface ExtractionResult {
  reportsProcessed: number;
  triplesExtracted: number;
  tagsCreated: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are a knowledge graph extraction agent. Given an intel report about a blockchain/crypto/tech company, extract structured relationship triples.

CRITICAL — SUBJECT SCOPING RULES (read before extracting):
1. Each report block is delimited by "---". Treat blocks as INDEPENDENT.
   Never emit a triple whose source comes from one block and whose target
   comes from a different block.
2. The bracketed slug at the start of each block (e.g. "[argo-cd]") identifies
   which subject this block is about — it is the ONLY allowed subject for that
   block. Do not infer a different subject from text inside the block. However,
   in the emitted "source" field, prefer the canonical display name (e.g.
   "Argo CD", "Amazon Bedrock") over the slug whenever the block's prose makes
   the proper name clear; fall back to the slug only when the proper name is
   unavailable.
3. If the block is a price snapshot, chain-metrics JSON, or otherwise has no
   prose describing what the subject uses/integrates/etc., emit nothing for
   that block.
4. Dependabot / version-bump commits ("chore(deps): bump X", "chore(deps-dev):
   bump X", "Updated to use nodeNN", "bump library/...") are NOT relationship
   evidence. Skip them. They surface transitive deps and dev-tooling, not
   product architecture.
5. Frontend build tooling (Vite, PostCSS, Webpack, Rollup, Tailwind, esbuild)
   inside a sibling /ui or /web subdirectory describes the UI subproject, not
   the parent product. Do not emit "<backend product> uses <frontend tool>"
   edges.
6. Reject anything that isn't a real named product/company/library:
   version numbers (node24, v3.0.1), file paths, PR titles, commit SHAs.

Output ONLY a JSON array of objects with these fields:
- "source": the name of the source entity (company or technology)
- "relationship": one of: uses, built_on, competes_with, partners_with, fork_of, invested_in, maintains, integrates
- "target": the name of the target entity (company or technology)
- "confidence": a float 0.0-1.0 indicating how confident you are

Rules:
- Extract only factual relationships explicitly stated or strongly implied
- Use canonical names (e.g., "Cosmos SDK" not "the Cosmos framework")
- Do not extract speculative or uncertain relationships below 0.3 confidence
- Return an empty array [] if no relationships are found
- Output ONLY valid JSON, no markdown or explanation

Positive example:
Block: "[osmosis] Osmosis upgrades to Cosmos SDK v0.50 — also enabled IBC v8."
Output: [{"source":"Osmosis","relationship":"built_on","target":"Cosmos SDK","confidence":0.95},
         {"source":"Osmosis","relationship":"integrates","target":"IBC Protocol","confidence":0.9}]

NEGATIVE examples (DO NOT emit these):
- Block "[argo-cd] chore(deps-dev): bump postcss from 8.5.6 to 8.5.10 in /ui"
  → emit []. PostCSS is dev-tooling for the UI subdir; this is a Dependabot bump.
- Block "[aws-bedrock] released v3.0.1 ... upgraded to Vite 8 ..."
  Source: github.com/aws/graph-explorer
  → emit []. The release belongs to aws/graph-explorer, not Bedrock; the slug
  is wrong but you cannot re-attribute it. Skip rather than misattribute.
- Block "[azure-openai] Updated to use node24"
  → emit []. node24 = Node.js 24 runtime version, not an entity.

Intel report:
`;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function relationshipExtractorService(db: Db) {
  /** Get IDs of already-processed reports from agent memory. */
  async function getProcessedIds(): Promise<Set<number>> {
    const rows = await db.execute(sql`
      SELECT object FROM agent_memory
      WHERE agent_name = 'nexus'
        AND predicate = 'processed_report_batch'
      ORDER BY created_at DESC
      LIMIT 100
    `) as unknown as Array<{ object: string }>;

    const ids = new Set<number>();
    for (const row of rows) {
      try {
        const batch = JSON.parse(row.object) as number[];
        for (const id of batch) ids.add(id);
      } catch { /* skip bad entries */ }
    }
    return ids;
  }

  /** Record processed report IDs in agent memory. */
  async function recordProcessed(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    await db.execute(sql`
      INSERT INTO agent_memory (agent_name, subject, predicate, object, confidence, source)
      VALUES ('nexus', 'extraction', 'processed_report_batch', ${JSON.stringify(ids)}, 1.0, 'relationship-extractor')
    `);
  }

  /**
   * Resolve an entity name to a company slug or tag slug.
   *
   * Returns `null` if the candidate matches a non-entity pattern (version
   * string, node version, SHA, file extension, sub-3-char) AND no existing
   * company/tag/alias matches. Callers should drop any triple referencing
   * a null resolution to avoid creating half-formed edges.
   */
  async function resolveEntity(name: string): Promise<{ type: "company" | "tag"; id: string } | null> {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    // Check intel_companies first
    const company = await db.execute(sql`
      SELECT slug FROM intel_companies WHERE slug = ${slug} LIMIT 1
    `) as unknown as Array<{ slug: string }>;

    if (company.length > 0) return { type: "company", id: company[0]!.slug };

    // Check knowledge_tags
    const tag = await db.execute(sql`
      SELECT slug FROM knowledge_tags WHERE slug = ${slug} LIMIT 1
    `) as unknown as Array<{ slug: string }>;

    if (tag.length > 0) return { type: "tag", id: tag[0]!.slug };

    // Check aliases
    const aliasTag = await db.execute(sql`
      SELECT slug FROM knowledge_tags WHERE aliases @> ${JSON.stringify([name.toLowerCase()])}::jsonb LIMIT 1
    `) as unknown as Array<{ slug: string }>;

    if (aliasTag.length > 0) return { type: "tag", id: aliasTag[0]!.slug };

    // Denylist gate: don't auto-create knowledge_tags for things that aren't entities.
    // (See NON_ENTITY_PATTERNS / looksLikeNonEntity above.) Drop the triple instead.
    if (looksLikeNonEntity(name)) {
      logger.warn(
        { name, slug },
        "Relationship extractor: skipping tag creation for non-entity candidate (denylist)",
      );
      return null;
    }

    // Create new tag
    const [newTag] = await db
      .insert(knowledgeTags)
      .values({
        slug,
        name,
        tagType: "technology",
        aliases: [name.toLowerCase()],
      })
      .onConflictDoNothing()
      .returning();

    if (newTag) {
      logger.info({ slug, name }, "Relationship extractor: created new knowledge tag");
    }

    return { type: "tag", id: slug };
  }

  /** Parse Ollama JSON response, handling common formatting issues. */
  function parseTriples(response: string): ExtractedTriple[] {
    // Extract JSON array from response (may have surrounding text)
    const match = response.match(/\[[\s\S]*\]/);
    if (!match) return [];

    try {
      const parsed = JSON.parse(match[0]) as unknown[];
      const triples: ExtractedTriple[] = [];

      for (const item of parsed) {
        if (
          item &&
          typeof item === "object" &&
          "source" in item &&
          "relationship" in item &&
          "target" in item
        ) {
          const t = item as Record<string, unknown>;
          const rel = String(t.relationship).toLowerCase().replace(/\s+/g, "_");
          if (!VALID_RELATIONSHIPS.includes(rel as RelationshipType)) continue;

          const confidence = typeof t.confidence === "number" ? t.confidence : 0.5;
          if (confidence < 0.3) continue;

          triples.push({
            source: String(t.source).trim(),
            relationship: rel,
            target: String(t.target).trim(),
            confidence: Math.min(1, Math.max(0, confidence)),
          });
        }
      }

      return triples;
    } catch {
      return [];
    }
  }

  return {
    /** Extract relationships from unprocessed intel reports. */
    async extractFromReports(limit = 50): Promise<ExtractionResult> {
      const result: ExtractionResult = { reportsProcessed: 0, triplesExtracted: 0, tagsCreated: 0, errors: 0 };

      const processedIds = await getProcessedIds();

      // Fetch recent reports not yet processed
      const reports = await db.execute(sql`
        SELECT id, company_slug, report_type, headline, body
        FROM intel_reports
        WHERE captured_at > NOW() - INTERVAL '7 days'
          AND report_type != 'discovery'
        ORDER BY captured_at DESC
        LIMIT ${limit * 2}
      `) as unknown as Array<{
        id: number;
        company_slug: string;
        report_type: string;
        headline: string;
        body: string;
      }>;

      // Filter out already-processed
      const unprocessed = reports.filter((r) => !processedIds.has(r.id));
      if (unprocessed.length === 0) return result;

      const batch = unprocessed.slice(0, limit);
      const batchIds: number[] = [];

      // Process in chunks of 10
      for (let i = 0; i < batch.length; i += 10) {
        const chunk = batch.slice(i, i + 10);
        const combinedText = chunk
          .map((r) => `[${r.company_slug}] ${r.headline}\n${r.body.slice(0, 500)}`)
          .join("\n---\n");

        try {
          const response = await callOllamaGenerate(EXTRACTION_PROMPT + combinedText);
          const triples = parseTriples(response);

          for (const triple of triples) {
            try {
              const source = await resolveEntity(triple.source);
              const target = await resolveEntity(triple.target);

              // Drop the triple if either endpoint is a denylisted non-entity.
              if (!source || !target) {
                logger.warn(
                  { triple, sourceResolved: !!source, targetResolved: !!target },
                  "Relationship extractor: dropping triple with unresolvable endpoint",
                );
                continue;
              }

              // Upsert edge
              await db.execute(sql`
                INSERT INTO company_relationships
                  (source_type, source_id, relationship, target_type, target_id,
                   confidence, evidence_report_ids, extracted_by)
                VALUES
                  (${source.type}, ${source.id}, ${triple.relationship},
                   ${target.type}, ${target.id}, ${triple.confidence},
                   ${JSON.stringify(chunk.map((c) => c.id))}::jsonb, 'nexus')
                ON CONFLICT (source_type, source_id, relationship, target_type, target_id)
                DO UPDATE SET
                  confidence = GREATEST(company_relationships.confidence, EXCLUDED.confidence),
                  evidence_report_ids = (
                    SELECT jsonb_agg(DISTINCT v)
                    FROM jsonb_array_elements(
                      company_relationships.evidence_report_ids || EXCLUDED.evidence_report_ids
                    ) AS v
                  ),
                  updated_at = NOW()
              `);

              result.triplesExtracted++;
            } catch (err) {
              logger.warn({ err, triple }, "Relationship extractor: failed to upsert triple");
              result.errors++;
            }
          }

          batchIds.push(...chunk.map((c) => c.id));
          result.reportsProcessed += chunk.length;
        } catch (err) {
          logger.warn({ err }, "Relationship extractor: Ollama extraction failed for chunk");
          result.errors++;
        }
      }

      // Record processed IDs
      await recordProcessed(batchIds);

      logger.info(result, "Relationship extractor: batch complete");
      return result;
    },

    /** Embed knowledge tags that don't have embeddings yet. */
    async embedTagsBatch(limit = 100): Promise<number> {
      const rows = await db.execute(sql`
        SELECT id, name, description, tag_type
        FROM knowledge_tags
        WHERE embedding IS NULL
        LIMIT ${limit}
      `) as unknown as Array<{ id: number; name: string; description: string | null; tag_type: string }>;

      if (rows.length === 0) return 0;

      const { getEmbeddings } = await import("./intel-embeddings.js");
      const texts = rows.map((r) => `${r.tag_type}: ${r.name}${r.description ? ` — ${r.description}` : ""}`);
      const embeddings = await getEmbeddings(texts);

      for (let i = 0; i < rows.length; i++) {
        const embeddingStr = `[${embeddings[i]!.join(",")}]`;
        await db.execute(sql`
          UPDATE knowledge_tags SET embedding = ${embeddingStr}::vector
          WHERE id = ${rows[i]!.id}
        `);
      }

      logger.info({ count: rows.length }, "Relationship extractor: embedded tags batch");
      return rows.length;
    },

    resolveEntity,
    parseTriples,
  };
}
