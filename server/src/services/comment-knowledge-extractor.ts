/**
 * Comment Knowledge Extractor — owned by Recall agent.
 *
 * Reads recent agent-authored issue comments, extracts structured operational
 * triples (subject, predicate, object) via Ollama, and stores them in
 * agent_memory under agent_name='recall' with source = "issue:<id>:comment:<id>".
 *
 * Parallels the relationship-extractor.ts pattern (Nexus) but targets
 * operational/ops knowledge instead of product/tech KG. Includes contradiction
 * handling: when a new triple shares (subject, predicate) with an existing row
 * but a different object, the older row's confidence decays.
 */

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { callOllamaGenerate } from "./ollama-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_PREDICATES = [
  "lives_at",
  "owned_by",
  "depends_on",
  "blocks",
  "causes",
  "breaks",
  "replaces",
  "deprecated_by",
  "requires",
  "do_not",
  "learned_that",
] as const;

type ValidPredicate = typeof VALID_PREDICATES[number];

/**
 * Patterns for strings that are not real operational entities and should be
 * dropped rather than stored as triple subjects/objects.
 */
const NON_ENTITY_PATTERNS: RegExp[] = [
  /^v?\d+(\.\d+){1,3}(-[\w.]+)?$/i,                                       // version strings
  /^[a-f0-9]{7,40}$/i,                                                    // commit SHAs
  /^\.\w{1,5}$/,                                                          // bare file extensions
  /^\d+$/,                                                                // bare numbers
  /^https?:\/\/\S+$/i,                                                    // URLs
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i,      // bare UUIDs
];

export function looksLikeNonEntity(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < 3) return true;
  return NON_ENTITY_PATTERNS.some((p) => p.test(trimmed));
}

interface ExtractedTriple {
  subject: string;
  predicate: ValidPredicate;
  object: string;
  confidence: number;
}

export interface CommentExtractionResult {
  commentsProcessed: number;
  triplesExtracted: number;
  contradictionsDecayed: number;
  errors: number;
}

// ---------------------------------------------------------------------------
// Extraction prompt
// ---------------------------------------------------------------------------

const EXTRACTION_PROMPT = `You are extracting operational knowledge from agent comments on internal issues in the team-dashboard system. Extract structured triples that describe the system, its constraints, deployments, ownership, dependencies, and lessons learned.

RULES:
1. Each block is delimited by "---" and prefixed by "[ISSUE-<id>:comment-<id>]". Treat blocks as INDEPENDENT — never combine subjects from one block with targets from another.
2. Only emit triples that are explicitly stated or strongly implied by the prose. No speculation.
3. Use canonical names ("VPS4" not "the production VPS"; "/api/portal" not "the portal route"; "Stripe webhook" not "the webhook").
4. Skip pure status updates ("done", "fixed it", "looks good"), greetings, and empty acknowledgements.
5. Skip blocks that reference user-only context (passwords, personal data, individual user IDs).
6. Drop any triple whose subject or object is: a version number (v3.0.1, node24), commit SHA, bare UUID, bare number, URL, or filesystem extension.

Output ONLY a JSON array of objects with these fields:
- "subject": the entity the fact is about (string)
- "predicate": one of: lives_at, owned_by, depends_on, blocks, causes, breaks, replaces, deprecated_by, requires, do_not, learned_that
- "object": the related entity or value (string)
- "confidence": float 0.0-1.0 (drop below 0.3)

PREDICATE GUIDE:
- lives_at: where something is deployed/runs ("/api/portal lives_at VPS4")
- owned_by: which agent/team/repo owns something
- depends_on: runtime or build dependency
- blocks: dependency where A cannot proceed without B
- causes: causal relationship between an event and an outcome
- breaks: A is known to break B
- replaces: A has replaced B
- deprecated_by: A is deprecated in favor of B
- requires: A must satisfy condition B
- do_not: rules about what NOT to do ("team-dashboard repo do_not use git add -A")
- learned_that: lessons from incidents or investigations ("Stripe webhook learned_that retries 3x with exponential backoff")

EXAMPLES:

Block: "[ISSUE-abc123:comment-def456] The /api/portal route now serves from VPS4 — moved during the 2026-05-09 consolidation away from VPS1."
Output:
[
  {"subject":"/api/portal","predicate":"lives_at","object":"VPS4","confidence":0.95},
  {"subject":"/api/portal","predicate":"deprecated_by","object":"VPS1 deployment","confidence":0.85}
]

Block: "[ISSUE-xyz789:comment-ghi012] Don't run git add -A in this repo — last week it staged .env and we had to rotate secrets."
Output:
[
  {"subject":"team-dashboard repo","predicate":"do_not","object":"use git add -A (stages secrets)","confidence":0.95}
]

Block: "[ISSUE-foo:comment-bar] LGTM, merging now."
Output:
[]

Output ONLY valid JSON, no markdown, no explanation.

Comment blocks:
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse Ollama JSON output, handling common formatting issues. */
export function parseTriples(response: string): ExtractedTriple[] {
  const match = response.match(/\[[\s\S]*\]/);
  if (!match) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const out: ExtractedTriple[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const t = item as Record<string, unknown>;
    if (!("subject" in t) || !("predicate" in t) || !("object" in t)) continue;

    const pred = String(t.predicate).toLowerCase().replace(/\s+/g, "_");
    if (!(VALID_PREDICATES as readonly string[]).includes(pred)) continue;

    const subj = String(t.subject).trim();
    const obj = String(t.object).trim();
    if (looksLikeNonEntity(subj) || looksLikeNonEntity(obj)) continue;

    const rawConf = typeof t.confidence === "number" ? t.confidence : 0.5;
    if (rawConf < 0.3) continue;

    out.push({
      subject: subj,
      predicate: pred as ValidPredicate,
      object: obj,
      confidence: Math.min(1, Math.max(0, rawConf)),
    });
  }
  return out;
}

/** Load the set of (issueId:commentId) keys already processed by Recall. */
async function getProcessedKeys(db: Db): Promise<Set<string>> {
  const rows = (await db.execute(sql`
    SELECT object FROM agent_memory
    WHERE agent_name = 'recall'
      AND predicate = 'processed_comment_batch'
    ORDER BY created_at DESC
    LIMIT 100
  `)) as unknown as Array<{ object: string }>;

  const keys = new Set<string>();
  for (const row of rows) {
    try {
      const batch = JSON.parse(row.object) as string[];
      for (const k of batch) keys.add(k);
    } catch {
      // skip malformed ledger entries
    }
  }
  return keys;
}

/** Record processed comment keys in the agent_memory ledger. */
async function recordProcessed(db: Db, keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db.execute(sql`
    INSERT INTO agent_memory (agent_name, subject, predicate, object, confidence, source)
    VALUES ('recall', 'extraction', 'processed_comment_batch', ${JSON.stringify(keys)}, 1.0, 'comment-knowledge-extractor')
  `);
}

const CONTRADICTION_DECAY_STEP = 0.15;

/**
 * Upsert a triple into agent_memory keyed on (agent, subject, predicate, object).
 * Decays confidence on existing rows that share (agent, subject, predicate) but
 * disagree on object — these are stigmergic contradictions.
 *
 * Returns the number of contradicting rows decayed.
 */
async function upsertTripleWithContradictionCheck(
  db: Db,
  triple: ExtractedTriple,
  source: string,
): Promise<number> {
  // Decay any rows that agree on (subject, predicate) but disagree on object.
  const contradictions = (await db.execute(sql`
    SELECT id, confidence FROM agent_memory
    WHERE agent_name = 'recall'
      AND subject = ${triple.subject}
      AND predicate = ${triple.predicate}
      AND object != ${triple.object}
  `)) as unknown as Array<{ id: number; confidence: number }>;

  for (const row of contradictions) {
    const newConf = Math.max(0, row.confidence - CONTRADICTION_DECAY_STEP);
    await db.execute(sql`
      UPDATE agent_memory
      SET confidence = ${newConf}, updated_at = NOW()
      WHERE id = ${row.id}
    `);
  }

  // Exact-match row? Update confidence to MAX(existing, new) and refresh source.
  const exact = (await db.execute(sql`
    SELECT id, confidence FROM agent_memory
    WHERE agent_name = 'recall'
      AND subject = ${triple.subject}
      AND predicate = ${triple.predicate}
      AND object = ${triple.object}
    ORDER BY id ASC
    LIMIT 1
  `)) as unknown as Array<{ id: number; confidence: number }>;

  if (exact.length > 0) {
    const row = exact[0]!;
    const newConf = Math.min(1, Math.max(row.confidence, triple.confidence));
    await db.execute(sql`
      UPDATE agent_memory
      SET confidence = ${newConf}, source = ${source}, updated_at = NOW()
      WHERE id = ${row.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO agent_memory (agent_name, subject, predicate, object, confidence, source)
      VALUES ('recall', ${triple.subject}, ${triple.predicate}, ${triple.object}, ${triple.confidence}, ${source})
    `);
  }

  return contradictions.length;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function commentKnowledgeExtractorService(db: Db) {
  return {
    /** Extract triples from recent agent-authored comments. */
    async extractFromComments(limit = 50): Promise<CommentExtractionResult> {
      const result: CommentExtractionResult = {
        commentsProcessed: 0,
        triplesExtracted: 0,
        contradictionsDecayed: 0,
        errors: 0,
      };

      const processed = await getProcessedKeys(db);

      const comments = (await db.execute(sql`
        SELECT id, issue_id, body, created_at
        FROM issue_comments
        WHERE author_agent_id IS NOT NULL
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT ${limit * 2}
      `)) as unknown as Array<{
        id: string;
        issue_id: string;
        body: string;
        created_at: string;
      }>;

      const unprocessed = comments.filter((c) => !processed.has(`${c.issue_id}:${c.id}`));
      if (unprocessed.length === 0) return result;

      const batch = unprocessed.slice(0, limit);
      const batchKeys: string[] = [];

      // Chunk into groups of 10 comments per Ollama call.
      for (let i = 0; i < batch.length; i += 10) {
        const chunk = batch.slice(i, i + 10);
        const combined = chunk
          .map(
            (c) =>
              `[ISSUE-${c.issue_id.slice(0, 8)}:comment-${c.id.slice(0, 8)}] ${c.body.slice(0, 800)}`,
          )
          .join("\n---\n");

        try {
          const response = await callOllamaGenerate(EXTRACTION_PROMPT + combined);
          const triples = parseTriples(response);

          // Source tag for the first comment in the chunk — chunks are small
          // and the prompt enforces block-independence, but evidence is
          // approximate at the chunk level for batched upsert.
          for (const triple of triples) {
            try {
              const source =
                chunk.length > 0
                  ? `issue:${chunk[0]!.issue_id}:comment:${chunk[0]!.id}`
                  : "comment-knowledge-extractor";
              const decayed = await upsertTripleWithContradictionCheck(db, triple, source);
              result.triplesExtracted++;
              result.contradictionsDecayed += decayed;
            } catch (err) {
              logger.warn(
                { err, triple },
                "comment-knowledge-extractor: failed to upsert triple",
              );
              result.errors++;
            }
          }

          batchKeys.push(...chunk.map((c) => `${c.issue_id}:${c.id}`));
          result.commentsProcessed += chunk.length;
        } catch (err) {
          logger.warn({ err }, "comment-knowledge-extractor: Ollama extraction failed for chunk");
          result.errors++;
        }
      }

      await recordProcessed(db, batchKeys);

      logger.info(result, "comment-knowledge-extractor: batch complete");
      return result;
    },

    // Expose internals for tests / introspection.
    parseTriples,
    looksLikeNonEntity,
  };
}
