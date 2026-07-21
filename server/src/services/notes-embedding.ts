/**
 * University Smart Notes — fire-and-forget embedding.
 *
 * After a member saves a note, we (best-effort) compute a 1024-dim embedding via
 * the shared BGE-M3 service and persist it, so "find related notes" (semantic
 * search) works. Mirrors notes-enrichment.ts: runs OUT of the request path (the
 * caller does NOT await it), NEVER throws — every failure is swallowed — and
 * self-limits (skips bodies below the floor). It re-embeds on EVERY save, so an
 * edited note's vector stays current (the Optimize Me original only embedded on
 * create — that bug is fixed here by not gating to "create only").
 *
 * Persistence is injected (`apply`) by the caller — pass `svc.setNoteEmbedding`
 * — so this module has no DB/service coupling, exactly like enrichNote.
 *
 * Embeddings ride the SAME shared BGE-M3 service (EMBED_URL/EMBED_API_KEY) as
 * intel/glossary. The dedicated-key isolation (UNIVERSITY_OLLAMA_API_KEY) is
 * only for the enrichment LLM label call — NOT embeddings.
 */

import { getEmbedding } from "./intel-embeddings.js";
import { logger } from "../middleware/logger.js";

// Below this the note is too low-signal to embed usefully. Matches the
// enrichment self-limit floor (notes-enrichment.ts MIN_BODY_LEN) so short
// in-lesson one-liners don't pollute semantic search with boilerplate.
const MIN_BODY_LEN = 40;

export interface EmbedNoteArgs {
  accountId: string;
  lessonSlug: string;
  noteKey: string;
  body: string;
  /**
   * Persists the computed embedding (identity-scoped). Injected so this module
   * stays free of DB/service coupling — pass `svc.setNoteEmbedding`.
   */
  apply: (args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
    embedding: number[];
  }) => Promise<void>;
}

/**
 * Best-effort embed a note. Fire-and-forget: never awaited in the response
 * path, never throws. Returns void.
 */
export async function embedNote(args: EmbedNoteArgs): Promise<void> {
  try {
    const body = (args.body ?? "").trim();
    // Self-limiting: only embed notes with enough body. Keeps one-line
    // lesson-slot answers out of semantic search.
    if (body.length < MIN_BODY_LEN) return;

    const embedding = await getEmbedding(body);
    if (!Array.isArray(embedding) || embedding.length === 0) return;

    await args.apply({
      accountId: args.accountId,
      lessonSlug: args.lessonSlug,
      noteKey: args.noteKey,
      embedding,
    });
  } catch (err) {
    // Swallow ALL errors — embedding is best-effort and must never surface.
    // The backfill script re-embeds any note left without a vector.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "notes-embedding: embedNote failed (swallowed)",
    );
  }
}
