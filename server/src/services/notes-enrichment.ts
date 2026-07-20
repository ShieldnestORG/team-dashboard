/**
 * University Smart Notes — fire-and-forget AI enrichment.
 *
 * After a member saves a note, we (best-effort) derive a short title + a few
 * tags via the shared LLM router (llm-client). This runs OUT of the request
 * path — the caller does NOT await it — so it must NEVER throw: every failure is
 * swallowed. It self-limits: it only runs once a note has enough body AND no
 * title yet, so re-saves stop calling the model as soon as a title exists.
 *
 * Routing: enrichment calls Ollama Cloud DIRECTLY with a dedicated University key
 * (UNIVERSITY_OLLAMA_API_KEY, falling back to the shared OLLAMA_API_KEY only if the
 * dedicated one is unset). It does NOT go through the shared LLM router — so it is
 * isolated from content generation and structurally cannot fall back to the metered
 * Claude account. No usable key → no-op.
 *
 * Persistence is injected (`apply`) by the caller — the portal route already
 * holds the DB-scoped customer-portal service — so this module has no DB or
 * service coupling. `apply` wraps `customerPortalService(db).setNoteEnrichment`,
 * which writes the tags and fills the title only when it is still NULL.
 */

import { logger } from "../middleware/logger.js";

// Enough text to be worth summarizing — below this the title/tags would be
// noise. Also the self-limit floor.
const MIN_BODY_LEN = 40;
const ENRICH_MAX_TOKENS = 200;
const ENRICH_TIMEOUT_MS = 20_000;

// University notes use their OWN Ollama Cloud key, isolated from the content-gen
// key (OLLAMA_API_KEY). Keeps notes' quota/metering separate, and means a notes
// problem can never affect the content engine. Falls back to the shared key only
// if the dedicated one isn't set, so notes still work before isolation is wired.
const OLLAMA_BASE = process.env.OLLAMA_URL || "https://ollama.com";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma4:31b";

function notesOllamaKey(): string | undefined {
  return (
    process.env.UNIVERSITY_OLLAMA_API_KEY || process.env.OLLAMA_API_KEY || undefined
  );
}

/**
 * Minimal, self-contained Ollama Cloud chat call for notes enrichment — uses the
 * University key ONLY (never the shared LLM router), so it structurally cannot fall
 * back to Claude. Times out; returns the assistant text, or "" on any non-2xx /
 * malformed response.
 */
async function ollamaEnrichChat(
  key: string,
  system: string,
  user: string,
): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ENRICH_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        stream: false,
        options: { num_predict: ENRICH_MAX_TOKENS },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) return "";
    const data = (await res.json()) as { message?: { content?: string } };
    return data?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT = `You label a short personal reflection note for a self-development app. Respond with ONLY valid JSON — no markdown, no backticks — in exactly this shape:
{"title":"3-6 word title","tags":["tag1","tag2"]}
Rules:
- title: a concise 3-6 word title capturing the essence of the note.
- tags: 2-5 lowercase tags. Prefer emotional/behavioral patterns (scarcity, fear, worthiness) or core drives (ground, edge, signal, bond, climb, legacy); otherwise use short themes derived from the content.
- Output nothing except the single JSON object.`;

export interface EnrichNoteArgs {
  accountId: string;
  lessonSlug: string;
  noteKey: string;
  body: string;
  /** Current title on the row (if any). Enrichment is skipped when set. */
  existingTitle?: string | null;
  /**
   * Persists the derived title/tags (identity-scoped). Injected so this module
   * stays free of DB/service coupling — pass `svc.setNoteEnrichment`.
   */
  apply: (args: {
    accountId: string;
    lessonSlug: string;
    noteKey: string;
    title?: string;
    tags?: string[];
  }) => Promise<void>;
}

/**
 * Best-effort enrich a note with a title + tags. Fire-and-forget: never awaited
 * in the response path, never throws. Returns void.
 */
export async function enrichNote(args: EnrichNoteArgs): Promise<void> {
  try {
    const body = (args.body ?? "").trim();
    const existingTitle = (args.existingTitle ?? "").trim();

    // GUARD 1 — self-limiting: only run with enough body AND no title yet. Once
    // a title exists (user-set or a prior enrichment), re-saves skip the model.
    if (body.length < MIN_BODY_LEN || existingTitle.length > 0) return;

    // GUARD 2 — University notes have a dedicated Ollama key. No usable key → no-op.
    // There is NO router and NO fallback here, so enrichment can never reach the
    // metered Claude account no matter how the Ollama call fails.
    const key = notesOllamaKey();
    if (!key) return;

    const content = await ollamaEnrichChat(key, SYSTEM_PROMPT, body);
    const parsed = parseEnrichment(content);
    if (!parsed) return;
    const { title, tags } = parsed;
    if (!title && tags.length === 0) return;

    await args.apply({
      accountId: args.accountId,
      lessonSlug: args.lessonSlug,
      noteKey: args.noteKey,
      title: title || undefined,
      tags,
    });
  } catch (err) {
    // Swallow ALL errors — enrichment is best-effort and must never surface.
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "notes-enrichment: enrichNote failed (swallowed)",
    );
  }
}

/**
 * Tolerant JSON extraction from a possibly-chatty model response. Strips a
 * ```json fence if present, else falls back to the outermost { … } span, then
 * validates the {title, tags} shape. Returns null on any failure.
 */
function parseEnrichment(
  raw: string,
): { title: string; tags: string[] } | null {
  if (!raw) return null;
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  if (!text.startsWith("{")) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) return null;
    text = text.slice(start, end + 1);
  }

  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object") return null;

  const rec = obj as Record<string, unknown>;
  const title =
    typeof rec.title === "string" ? rec.title.trim().slice(0, 200) : "";
  const tags = Array.isArray(rec.tags)
    ? rec.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0 && t.length <= 40)
        .slice(0, 5)
    : [];

  return { title, tags };
}
