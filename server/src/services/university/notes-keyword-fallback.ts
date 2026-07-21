/**
 * University notes coach — keyword-overlap fallback (pure, dependency-free).
 *
 * The deterministic ranker that picks candidate notes when semantic search
 * (BGE-M3 + pgvector) is unavailable or returns nothing. No imports, no DB, no
 * network. Ported verbatim from the dead Optimize Me coach (notes-context.ts):
 * the STOP_WORDS set, extractKeywords, and the word-overlap scoring loop are
 * byte-identical in logic — only the row shape (a University note) and the
 * searchable blob differ.
 */

export type ScorableNote = {
  noteKey: string;
  lessonSlug: string;
  body: string;
  title: string | null;
  tags: string[];
};

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "to", "of", "in", "for",
  "on", "with", "at", "by", "from", "as", "into", "about", "like",
  "through", "after", "over", "between", "out", "up", "down", "off",
  "and", "but", "or", "nor", "not", "so", "yet", "both", "either",
  "i", "me", "my", "we", "our", "you", "your", "he", "she", "it",
  "they", "them", "this", "that", "these", "those", "what", "which",
  "who", "how", "when", "where", "why", "all", "each", "every",
  "any", "some", "no", "just", "only", "very", "too", "also",
]);

export function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Rank notes by how many of the query's keywords appear in each note's
 * searchable blob (`[title, ...tags, body]`, lowercased). Returns only notes
 * with an overlap score > 0, sorted by score descending. Scoring loop is
 * byte-identical to the source; the blob and the row shape are the only edits.
 */
export function scoreNotesByKeyword<T extends ScorableNote>(
  query: string,
  notes: T[],
): T[] {
  const queryWords = extractKeywords(query);
  if (queryWords.length === 0) return [];

  const scored = notes.map((note) => {
    let score = 0;
    const text = [note.title ?? "", ...note.tags, note.body]
      .join(" ")
      .toLowerCase();
    for (const word of queryWords) {
      if (text.includes(word)) score++;
    }
    return { note, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((s) => s.note);
}
