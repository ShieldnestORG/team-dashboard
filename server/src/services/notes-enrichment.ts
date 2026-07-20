/**
 * University Smart Notes — fire-and-forget AI enrichment.
 *
 * After a member saves a note, we (best-effort) derive a short title + a few
 * tags via the shared LLM router (llm-client). This runs OUT of the request
 * path — the caller does NOT await it — so it must NEVER throw: every failure is
 * swallowed. It self-limits: it only runs once a note has enough body AND no
 * title yet, so re-saves stop calling the model as soon as a title exists.
 *
 * Routing: the enrichment is pinned to the Ollama (Cloud) provider so it never
 * spends against the metered Claude account. If Ollama is not configured we
 * no-op rather than let the router fall back to Claude. Metering is whatever
 * llm-client already records — no extra ledger here.
 *
 * Persistence is injected (`apply`) by the caller — the portal route already
 * holds the DB-scoped customer-portal service — so this module has no DB or
 * service coupling. `apply` wraps `customerPortalService(db).setNoteEnrichment`,
 * which writes the tags and fills the title only when it is still NULL.
 */

import { logger } from "../middleware/logger.js";
import { callLlmChat, isProviderConfigured } from "./llm-client.js";

// Enough text to be worth summarizing — below this the title/tags would be
// noise. Also the self-limit floor.
const MIN_BODY_LEN = 40;
const ENRICH_MAX_TOKENS = 200;
const ENRICH_TIMEOUT_MS = 20_000;

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

    // GUARD 2 — never fall through to the metered Claude account. If Ollama is
    // not configured, don't even attempt (an unconfigured primary would fail
    // and the router would fall back to Claude).
    if (!isProviderConfigured("ollama")) return;

    const result = await callLlmChat(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: body },
      ],
      // Pin to Ollama AND never fall back to the metered Claude account, even if
      // the Ollama call fails at runtime (timeout/5xx). GUARD 2 above covers the
      // "unconfigured" case; disableFallback covers "configured but failed" — so
      // enrichment can never bill Claude regardless of how the primary fails.
      {
        provider: "ollama",
        disableFallback: true,
        maxTokens: ENRICH_MAX_TOKENS,
        timeoutMs: ENRICH_TIMEOUT_MS,
      },
    );

    const parsed = parseEnrichment(result.content);
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
