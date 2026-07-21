// University notes coach — read-only prompt builder. Recast from the dead Optimize Me coach; the write-back/control-tag half was deliberately removed.
//
// Pure string assembly — no imports, no DB, no network. Builds the {system, user}
// pair for the read-only notes Q&A coach: the system prompt is a concise thinking
// partner grounded ONLY in the member's own notes; the user prompt renders their
// recent notes (full-ish) plus a relevance-filtered summary of other notes
// (already narrowed by the caller), then the member's question.

const RECENT_LIMIT = 5;
const RECENT_BODY_CHARS = 300;
const SUMMARY_SNIPPET_CHARS = 120;

const SYSTEM_PROMPT = `You are the notes coach for Coherent University — a sharp, concise thinking partner for one member's own private notes.

Your job: answer the member's question using ONLY the notes shown below, and surface useful connections across those notes (recurring themes, tensions, ideas that build on one another). Reference notes by their title when you draw on them.

Rules:
- Ground every claim in the provided notes. Never invent notes, facts, or details that are not there.
- If the notes do not cover the question, say so plainly (e.g. "Your notes don't touch on that yet") instead of guessing.
- This is read-only: you do not create, edit, tag, or reorganize notes — you only answer and connect.
- Be concise and direct: a few tight sentences, not an essay.`;

export interface CoachRecentNote {
  title: string | null;
  body: string;
  tags: string[];
}

export interface CoachRelatedNote {
  title: string | null;
  body: string;
}

export interface BuildNotesCoachPromptArgs {
  recentNotes: CoachRecentNote[];
  relatedNotes: CoachRelatedNote[];
  question: string;
}

/** Recent notes rendered with (most of) their body — the detailed context. */
function renderRecent(notes: CoachRecentNote[]): string {
  if (notes.length === 0) return "No notes yet.";
  return notes
    .slice(0, RECENT_LIMIT)
    .map((n) => {
      const title = n.title?.trim() || "Untitled";
      const tags = n.tags.length ? ` (tags: ${n.tags.join(", ")})` : "";
      const body = n.body.slice(0, RECENT_BODY_CHARS);
      const more = n.body.length > RECENT_BODY_CHARS ? "..." : "";
      return `"${title}"${tags}\n${body}${more}`;
    })
    .join("\n\n");
}

/** Other relevant notes as a title + short-snippet summary list. */
function renderRelated(notes: CoachRelatedNote[]): string {
  return notes
    .map((n) => {
      const title = n.title?.trim() || "Untitled";
      const snippet = n.body
        .slice(0, SUMMARY_SNIPPET_CHARS)
        .replace(/\s+/g, " ")
        .trim();
      const more = n.body.length > SUMMARY_SNIPPET_CHARS ? "..." : "";
      return `- "${title}" — ${snippet}${more}`;
    })
    .join("\n");
}

/**
 * Build the read-only notes-coach prompt. Returns a `{ system, user }` pair —
 * `system` is the grounded thinking-partner persona, `user` is the rendered
 * notes context followed by the member's question.
 */
export function buildNotesCoachPrompt(args: BuildNotesCoachPromptArgs): {
  system: string;
  user: string;
} {
  const recentBlock = renderRecent(args.recentNotes);
  const relatedBlock = renderRelated(args.relatedNotes);

  const sections: string[] = [
    "The member's own notes:",
    "",
    "Recent notes (most detailed):",
    recentBlock,
  ];

  if (relatedBlock) {
    sections.push("", "Other related notes:", relatedBlock);
  }

  sections.push("", "Question:", args.question.trim());

  return { system: SYSTEM_PROMPT, user: sections.join("\n") };
}
