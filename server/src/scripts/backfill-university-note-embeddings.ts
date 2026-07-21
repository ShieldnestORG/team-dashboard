// ---------------------------------------------------------------------------
// OWNER-GATED — RUN MANUALLY. Prereq: migration manual/0125 applied
// (university_notes.embedding column exists). Run this BEFORE building any
// HNSW/ANN index (indexing an empty/NULL column returns silent zero rows — the
// glossary_embeddings incident). Reuses the shared BGE-M3 service via
// EMBED_URL/EMBED_API_KEY, same as intel/glossary. Default is DRY-RUN; pass
// --apply to write.
// ---------------------------------------------------------------------------
//
// Coherent Ones University — Smart Notes semantic search. One-shot backfill:
// embeds every member note that has real signal (body >= 40 chars, matching the
// enrichment guard) and still has a NULL embedding, then writes the 1024-dim
// BGE-M3 vector into university_notes.embedding as a raw `::vector` cast (the
// same raw-SQL pattern intel_reports uses — the column is NOT in the drizzle
// schema).
//
// Safety posture:
//   * DRY-RUN by default — with no `--apply` flag it only COUNTS the rows that
//     WOULD be embedded and writes NOTHING. Only `--apply` performs UPDATEs.
//   * Idempotent — it only ever selects `embedding IS NULL` rows, so a re-run
//     (or a resumed run after a crash) touches only what is still missing.
//   * Fail-soft per batch — one failed batch (embed call or UPDATE) is logged
//     and skipped; the run continues with the next batch.
//
// Run (against the target DB — this is a data write, NOT part of a deploy that
// restarts the shared container). EMBED_URL/EMBED_API_KEY must point at the same
// BGE-M3 service intel/glossary use:
//
//   # DRY-RUN (default, writes nothing — just counts):
//   DATABASE_URL=postgres://... EMBED_URL=... EMBED_API_KEY=... \
//     pnpm --filter @paperclipai/server tsx \
//       server/src/scripts/backfill-university-note-embeddings.ts
//
//   # APPLY (performs the UPDATEs):
//   DATABASE_URL=postgres://... EMBED_URL=... EMBED_API_KEY=... \
//     pnpm --filter @paperclipai/server tsx \
//       server/src/scripts/backfill-university-note-embeddings.ts --apply
// ---------------------------------------------------------------------------

import { createDb, sql } from "@paperclipai/db";
import { getEmbeddings } from "../services/intel-embeddings.js";

// BGE-M3 is 1024-dim; the embedding service batches up to 32 texts per call.
const EMBED_DIM = 1024;
const BATCH_SIZE = 32;

// Default is DRY-RUN. `--apply` opts in to writes; an explicit `--dry-run`
// always wins over `--apply` (safety — an accidental extra flag can't turn a
// dry run into a live write).
const argv = process.argv.slice(2);
const APPLY = argv.includes("--apply") && !argv.includes("--dry-run");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");

const db = createDb(url);

// The eligible set, defined once so the COUNT (dry-run) and the SELECT (apply)
// can never drift: notes with real signal that are still missing an embedding.
const ELIGIBLE = sql`embedding IS NULL AND length(body) >= 40`;

interface NoteRow {
  id: string; // uuid
  email: string;
  account_id: string | null;
  lesson_slug: string;
  note_key: string;
  body: string;
}

async function countEligible(): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT COUNT(*) AS total FROM university_notes WHERE ${ELIGIBLE}`,
  )) as unknown as Array<{ total: string }>;
  return Number(rows[0]?.total ?? 0);
}

// Guard: only accept a well-formed 1024-dim numeric vector. A malformed vector
// would otherwise blow up the `::vector` cast and take its whole batch down.
function toVectorLiteral(vec: number[] | undefined): string | null {
  if (!Array.isArray(vec) || vec.length !== EMBED_DIM) return null;
  for (const n of vec) {
    if (typeof n !== "number" || !Number.isFinite(n)) return null;
  }
  return `[${vec.join(",")}]`;
}

async function main() {
  const total = await countEligible();

  if (!APPLY) {
    console.log(
      `DRY-RUN: ${total} note(s) WOULD be embedded ` +
        `(embedding IS NULL AND length(body) >= 40). Nothing written.`,
    );
    console.log("Re-run with --apply to perform the UPDATEs.");
    process.exit(0);
  }

  if (total === 0) {
    console.log("Nothing to do: 0 eligible notes (embedding IS NULL, body >= 40).");
    process.exit(0);
  }

  // Deterministic order so batches are stable across resumed runs.
  const notes = (await db.execute(sql`
    SELECT id, email, account_id, lesson_slug, note_key, body
    FROM university_notes
    WHERE ${ELIGIBLE}
    ORDER BY created_at, id
  `)) as unknown as NoteRow[];

  console.log(`APPLY: embedding ${notes.length} note(s) in batches of ${BATCH_SIZE}...`);

  let done = 0;
  let skipped = 0;
  let failedBatches = 0;

  for (let i = 0; i < notes.length; i += BATCH_SIZE) {
    const batch = notes.slice(i, i + BATCH_SIZE);

    try {
      const bodies = batch.map((n) => n.body);
      const vectors = await getEmbeddings(bodies);

      if (vectors.length !== batch.length) {
        throw new Error(
          `embedding count mismatch: got ${vectors.length}, expected ${batch.length}`,
        );
      }

      for (let j = 0; j < batch.length; j++) {
        const note = batch[j]!;
        const literal = toVectorLiteral(vectors[j]);
        if (literal === null) {
          skipped++;
          console.warn(
            `  ! skip note ${note.id} (${note.email} / ${note.lesson_slug} / ${note.note_key}): ` +
              `bad embedding shape`,
          );
          continue;
        }

        // Raw `::vector` cast — the embedding column is not in the drizzle
        // schema. The literal is built only from finite numbers (validated
        // above), and is passed as a bound parameter, not string-concatenated
        // into the statement.
        await db.execute(
          sql`UPDATE university_notes SET embedding = ${literal}::vector WHERE id = ${note.id}`,
        );
        done++;
      }
    } catch (err) {
      failedBatches++;
      console.error(
        `  ! batch ${Math.floor(i / BATCH_SIZE) + 1} failed (notes ${i}..${
          i + batch.length - 1
        }) — logged and skipped:`,
        err,
      );
      continue;
    }

    console.log(`embedded ${done} / ${notes.length}`);
  }

  console.log(
    `Done. embedded=${done}, skipped(bad-shape)=${skipped}, failedBatches=${failedBatches}, ` +
      `total_eligible=${notes.length}.`,
  );
  // Non-zero exit if anything didn't land, so a caller/CI notices.
  process.exit(skipped > 0 || failedBatches > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
