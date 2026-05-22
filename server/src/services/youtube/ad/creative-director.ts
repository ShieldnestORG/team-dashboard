/**
 * URL → Product-Ad pipeline — creative-director stage.
 *
 * Turns a scraped {@link ProductSnapshot} into a structured {@link CreativeBrief}
 * — the kind of plan a human creative director would hand to a video team:
 * hook, audience, pain point, value props, CTA, tone, aesthetic, and a 3-5 scene
 * arc (hook → problem → value → proof → CTA).
 *
 * LLM grounding strategy:
 *   - PREFERRED: Anthropic Claude with VISION. We pass the product images as
 *     image content blocks so the brief is grounded in the actual product
 *     imagery (not just copy). This reuses the exact fetch() pattern + the
 *     WATCHTOWER_ANTHROPIC_API_KEY env from the watchtower Claude adapter
 *     (server/src/services/watchtower-engines/claude.ts) — no new SDK, no new
 *     HTTP client, no new dependency. The Messages API natively accepts image
 *     blocks via { type: "image", source: { type: "url", url } }.
 *   - FALLBACK: if the Anthropic key is absent or the call fails, we fall back
 *     to the shared local Ollama chat client (ollama-client.ts, callOllamaChat),
 *     which is text-only — it reasons over snapshot.copy + description instead.
 *
 * Output is always validated and normalized: the model is prompted for JSON
 * only, the response is fence-stripped (same pattern as presentation-renderer),
 * parsed defensively, and every required field is backfilled with a sane
 * default so we never return a partially-typed object.
 */

import { logger } from "../../../middleware/logger.js";
import { callOllamaChat } from "../../ollama-client.js";
import type { BriefScene, CreativeBrief, ProductSnapshot } from "./types.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
// Sonnet-class model: this is a multimodal reasoning task (look at images,
// write real ad copy), not the cheap Q&A Watchtower runs. Override via env.
const DEFAULT_MODEL = "claude-sonnet-4-5";
const TIMEOUT_MS = 60_000;
const MAX_IMAGES = 4; // cap to keep token cost + latency bounded

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a structured creative brief from a scraped product snapshot.
 * Always resolves to a fully-populated CreativeBrief (defaults fill any gaps).
 */
export async function buildCreativeBrief(
  snapshot: ProductSnapshot,
): Promise<CreativeBrief> {
  const prompt = buildPrompt(snapshot);
  const imageUrls = collectImageUrls(snapshot);

  let raw: string | null = null;

  // Preferred path: vision-capable Claude grounded in product imagery.
  if (process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim()) {
    try {
      raw = await callClaudeVision(prompt, imageUrls);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "creative-director: Claude vision call failed, falling back to Ollama",
      );
    }
  } else {
    logger.info(
      "creative-director: WATCHTOWER_ANTHROPIC_API_KEY not set, using text-only Ollama fallback",
    );
  }

  // Fallback path: text-only local LLM over copy + description.
  if (!raw) {
    try {
      const res = await callOllamaChat(
        [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ],
        { temperature: 0.6, maxTokens: 2048 },
      );
      raw = res.content;
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "creative-director: Ollama fallback failed, returning heuristic brief",
      );
    }
  }

  const parsed = raw ? parseBrief(raw) : null;
  return normalizeBrief(parsed, snapshot);
}

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT =
  "You are a senior creative director at a top performance-marketing studio. " +
  "You write tight, conversion-focused short-form video ad briefs (15-30s). " +
  "You respond with raw JSON only — no prose, no markdown fences.";

function buildPrompt(s: ProductSnapshot): string {
  const reviewLine = s.reviews
    ? `Reviews: rating=${s.reviews.rating ?? "?"}, count=${s.reviews.count ?? "?"}` +
      (s.reviews.quotes?.length
        ? `, quotes=${JSON.stringify(s.reviews.quotes.slice(0, 3))}`
        : "")
    : "Reviews: none";

  const copy = s.copy.slice(0, 20).join("\n- ");

  return [
    "Produce a creative brief for a 15-30 second product ad video from the data below.",
    "",
    `URL: ${s.url}`,
    `Title: ${s.title}`,
    `Description: ${s.description}`,
    s.priceText ? `Price: ${s.priceText}` : "Price: not stated",
    s.category ? `Category: ${s.category}` : "Category: unknown",
    `Brand colors (hex, most dominant first): ${s.brandColors.join(", ") || "none"}`,
    reviewLine,
    "",
    "Copy / on-page text:",
    `- ${copy}`,
    "",
    "If product images are attached, study them: read the actual product, its",
    "form factor, materials, UI, and mood. Ground the visual ideas and aesthetic",
    "in what you genuinely see, not generic stock-ad clichés.",
    "",
    "Return ONLY a JSON object with EXACTLY these keys:",
    "{",
    '  "productName": string,',
    '  "oneLiner": string,                      // <= 12 words',
    '  "targetAudience": string,',
    '  "painPoint": string,                     // the problem this solves',
    '  "hook": string,                          // first ~3s; punchy, SPECIFIC to this product, not generic',
    '  "valueProps": string[],                  // 3-4 concrete benefits',
    '  "callToAction": string,',
    '  "tone": string,                          // e.g. "energetic, premium, confident"',
    '  "aesthetic": string,                     // lighting, composition, mood',
    '  "brandColors": string[],                 // hex #RRGGBB; reuse the given colors, refine only if clearly better',
    '  "scenes": [                              // 3-5 scenes forming a hook -> problem -> value -> proof -> cta arc',
    "    {",
    '      "index": number,                     // 0-based, sequential',
    '      "purpose": string,                   // "hook" | "problem" | "value" | "proof" | "cta"',
    '      "visualIdea": string,                // what is on screen',
    '      "voiceover": string,                 // a REAL spoken narration line for this scene',
    '      "onScreenText": string               // optional short caption',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

/** Best-quality images first; OG image as a backstop. Deduped, capped. */
function collectImageUrls(s: ProductSnapshot): string[] {
  const urls = [...s.productImageUrls];
  if (s.ogImageUrl) urls.push(s.ogImageUrl);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const trimmed = u?.trim();
    if (trimmed && /^https?:\/\//i.test(trimmed) && !seen.has(trimmed)) {
      seen.add(trimmed);
      out.push(trimmed);
      if (out.length >= MAX_IMAGES) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Anthropic vision call (reuses watchtower-claude fetch pattern; no SDK)
// ---------------------------------------------------------------------------

interface AnthropicTextBlock {
  type: "text";
  text: string;
}
interface AnthropicImageBlock {
  type: "image";
  source: { type: "url"; url: string };
}
type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

async function callClaudeVision(
  prompt: string,
  imageUrls: string[],
): Promise<string> {
  const apiKey = process.env.WATCHTOWER_ANTHROPIC_API_KEY!.trim();
  const model = process.env.WATCHTOWER_CLAUDE_MODEL?.trim() || DEFAULT_MODEL;

  const content: AnthropicContentBlock[] = [
    ...imageUrls.map(
      (url): AnthropicImageBlock => ({
        type: "image",
        source: { type: "url", url },
      }),
    ),
    { type: "text", text: prompt },
  ];

  const res = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text =
    data.content
      ?.filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim() ?? "";

  if (!text) throw new Error("Anthropic returned empty content");
  logger.info(
    { model, images: imageUrls.length },
    "creative-director: built brief via Claude vision",
  );
  return text;
}

// ---------------------------------------------------------------------------
// Defensive parsing + normalization
// ---------------------------------------------------------------------------

/** Strip markdown fences and parse the first JSON object found. */
function parseBrief(raw: string): Partial<CreativeBrief> | null {
  let text = raw.trim();

  // Same fence-stripping approach as presentation-renderer.ts.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Fall back to the outermost {...} span if there is leading/trailing prose.
  if (!text.startsWith("{")) {
    const first = text.indexOf("{");
    const last = text.lastIndexOf("}");
    if (first !== -1 && last > first) text = text.slice(first, last + 1);
  }

  try {
    const obj = JSON.parse(text) as unknown;
    return obj && typeof obj === "object" ? (obj as Partial<CreativeBrief>) : null;
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "creative-director: failed to parse model JSON",
    );
    return null;
  }
}

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim());
}

/**
 * Coerce a (possibly partial / malformed) model object into a complete,
 * fully-typed CreativeBrief, backfilling every field from the snapshot.
 */
function normalizeBrief(
  parsed: Partial<CreativeBrief> | null,
  s: ProductSnapshot,
): CreativeBrief {
  const p = parsed ?? {};
  const productName = str(p.productName, s.title || "This product");

  // Brand colors: prefer model output if it gave valid hex, else snapshot.
  const modelColors = strArray(p.brandColors).filter((c) => HEX_RE.test(c));
  const snapColors = (s.brandColors ?? []).filter((c) => HEX_RE.test(c));
  const brandColors = (modelColors.length ? modelColors : snapColors).slice(0, 6);

  let valueProps = strArray(p.valueProps).slice(0, 4);
  if (valueProps.length === 0) {
    // Derive from copy as a last resort so the field is never empty.
    valueProps = s.copy.filter((c) => c.trim()).slice(0, 3);
    if (valueProps.length === 0) valueProps = [s.description || productName];
  }

  const scenes = normalizeScenes(p.scenes, {
    productName,
    cta: str(p.callToAction, "Learn more"),
  });

  return {
    productName,
    oneLiner: str(p.oneLiner, s.description || productName),
    targetAudience: str(p.targetAudience, "people looking for " + productName),
    painPoint: str(p.painPoint, "the problem " + productName + " solves"),
    hook: str(p.hook, `Meet ${productName}.`),
    valueProps,
    callToAction: str(p.callToAction, "Learn more"),
    tone: str(p.tone, "energetic, premium, confident"),
    aesthetic: str(
      p.aesthetic,
      "clean modern lighting, crisp product close-ups, dynamic motion",
    ),
    brandColors: brandColors.length ? brandColors : ["#111111", "#FFFFFF"],
    scenes,
  };
}

/** Normalize scenes; synthesize a minimal arc if the model gave none usable. */
function normalizeScenes(
  raw: unknown,
  ctx: { productName: string; cta: string },
): BriefScene[] {
  const arr = Array.isArray(raw) ? raw : [];
  const cleaned: BriefScene[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const visualIdea = str(o.visualIdea, "");
    const voiceover = str(o.voiceover, "");
    if (!visualIdea && !voiceover) continue; // skip empty scenes
    const scene: BriefScene = {
      index: cleaned.length,
      purpose: str(o.purpose, "value"),
      visualIdea: visualIdea || `Product shot of ${ctx.productName}.`,
      voiceover: voiceover || `${ctx.productName}.`,
    };
    const ost = str(o.onScreenText, "");
    if (ost) scene.onScreenText = ost;
    cleaned.push(scene);
    if (cleaned.length >= 5) break;
  }

  if (cleaned.length >= 3) return cleaned;

  // Synthesize a coherent hook → value → CTA arc as a guaranteed floor.
  return [
    {
      index: 0,
      purpose: "hook",
      visualIdea: `Bold opening shot of ${ctx.productName}.`,
      voiceover: `This is ${ctx.productName}.`,
    },
    {
      index: 1,
      purpose: "value",
      visualIdea: `${ctx.productName} in use, highlighting its key benefit.`,
      voiceover: `Here's why ${ctx.productName} is different.`,
    },
    {
      index: 2,
      purpose: "cta",
      visualIdea: `${ctx.productName} hero shot with call-to-action overlay.`,
      voiceover: ctx.cta,
      onScreenText: ctx.cta,
    },
  ];
}
