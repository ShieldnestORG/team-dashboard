/**
 * Scene Planner — URL → Product-Ad pipeline, stage 3.
 *
 *   CreativeBrief  ->  ShotList
 *
 * Turns the creative director's brief into a concrete, ordered shot list (the
 * shot-by-shot edit plan consumed by asset generation and the compositor).
 *
 * Design: the LLM drafts the *creative* breakdown (vivid prompts, shot kinds,
 * ordering, transitions). All *structural* guarantees — durations summing to
 * the target, per-shot clamping to 1.5–4s, CTA-as-last-shot, contiguous index
 * assignment — are enforced deterministically in code. We never trust the LLM
 * for exact arithmetic (Global Rule 5: code answers what code can answer).
 *
 * If the LLM output is missing or unusable we fall back to a deterministic
 * one-shot-per-scene mapping, so this function never throws on a valid brief.
 */

import { logger } from "../../../middleware/logger.js";
import { callOllamaChat } from "../../ollama-client.js";
import type {
  CreativeBrief,
  ShotList,
  Shot,
  ShotKind,
  Transition,
} from "./types.js";

const DEFAULT_TARGET_SEC = 30;
const MIN_SHOT_SEC = 1.5;
const MAX_SHOT_SEC = 4;
const DURATION_TOLERANCE_SEC = 1; // sum must be within ±1s of target

const VALID_KINDS: ReadonlySet<string> = new Set<ShotKind>([
  "product",
  "broll",
  "text_card",
  "cta",
]);
const VALID_TRANSITIONS: ReadonlySet<string> = new Set<Transition>([
  "cut",
  "fade",
  "slide",
  "zoom",
]);

/**
 * Intermediate, pre-structural shape the LLM is asked to produce. Durations
 * here are advisory only — we recompute them in code.
 */
interface DraftShot {
  kind: ShotKind;
  sourceSceneIndex: number;
  visualPrompt: string;
  voiceover?: string;
  onScreenText?: string;
  transitionOut: Transition;
  /** Advisory weight/duration from the model; not trusted for the sum. */
  durationSec?: number;
}

/**
 * Plan the shot list for a creative brief.
 *
 * @param brief        The structured creative brief.
 * @param productionId Identifier carried through to the ShotList.
 * @param opts.targetDurationSec Total target runtime (default 30s).
 */
export async function planShots(
  brief: CreativeBrief,
  productionId: string,
  opts?: { targetDurationSec?: number },
): Promise<ShotList> {
  const target = clampTarget(opts?.targetDurationSec ?? DEFAULT_TARGET_SEC);
  const musicMood = deriveMusicMood(brief.tone);

  // 1. Draft the creative breakdown via the LLM, falling back deterministically.
  let drafts: DraftShot[];
  try {
    drafts = await draftWithLlm(brief, target);
    if (drafts.length === 0) {
      logger.warn("scene-planner: LLM returned no usable shots; using fallback");
      drafts = fallbackDrafts(brief);
    }
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "scene-planner: LLM draft failed; using deterministic fallback",
    );
    drafts = fallbackDrafts(brief);
  }

  // 2. Enforce structural rules in code (CTA-last, durations, clamping, index).
  const shots = finalize(drafts, brief, target);
  const totalDurationSec = round1(shots.reduce((s, x) => s + x.durationSec, 0));

  return { productionId, totalDurationSec, musicMood, shots };
}

// ---------------------------------------------------------------------------
// LLM drafting
// ---------------------------------------------------------------------------

/** Ask the LLM for a JSON shot breakdown; parse defensively. */
async function draftWithLlm(brief: CreativeBrief, target: number): Promise<DraftShot[]> {
  const system = [
    "You are a senior video ad editor planning a short product-ad.",
    "Given a creative brief, output an ordered list of camera shots.",
    "Each brief scene becomes ONE OR MORE shots. Keep the narrative flow:",
    "hook -> problem -> value -> proof -> call-to-action.",
    "Write vivid, model-ready image/video prompts (lighting, composition,",
    "subject, mood) by fusing the scene's visual idea with the brand aesthetic",
    "and tone. The FINAL shot must be the call-to-action.",
    "",
    "Respond with ONLY a JSON object, no prose, no markdown fences:",
    '{ "shots": [ {',
    '  "kind": "product"|"broll"|"text_card"|"cta",',
    '  "sourceSceneIndex": <int, index of the brief scene this serves>,',
    '  "visualPrompt": "<vivid prompt>",',
    '  "voiceover": "<narration or empty>",',
    '  "onScreenText": "<on-screen text or empty>",',
    '  "transitionOut": "cut"|"fade"|"slide"|"zoom",',
    '  "durationSec": <approx seconds, will be re-normalized>',
    "} ] }",
    "Use 'product' for shots focused on the product itself, 'cut' as the",
    "default transition, and reserve 'fade'/'zoom' for emphasis.",
  ].join("\n");

  const user = JSON.stringify({
    targetDurationSec: target,
    productName: brief.productName,
    oneLiner: brief.oneLiner,
    targetAudience: brief.targetAudience,
    painPoint: brief.painPoint,
    hook: brief.hook,
    valueProps: brief.valueProps,
    callToAction: brief.callToAction,
    tone: brief.tone,
    aesthetic: brief.aesthetic,
    brandColors: brief.brandColors,
    scenes: brief.scenes,
  });

  const result = await callOllamaChat(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    { temperature: 0.8 },
  );

  return parseDrafts(result.content, brief);
}

/** Strip markdown fences and parse the model's JSON; tolerate malformed output. */
function parseDrafts(raw: string, brief: CreativeBrief): DraftShot[] {
  const cleaned = stripFences(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // Last resort: grab the first {...} block in the text.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return [];
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return [];
    }
  }

  const list = (parsed as { shots?: unknown })?.shots;
  if (!Array.isArray(list)) return [];

  const maxSceneIndex =
    brief.scenes.length > 0 ? brief.scenes.length - 1 : 0;

  const drafts: DraftShot[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;

    const kind: ShotKind =
      typeof o.kind === "string" && VALID_KINDS.has(o.kind)
        ? (o.kind as ShotKind)
        : "broll";

    const transitionOut: Transition =
      typeof o.transitionOut === "string" && VALID_TRANSITIONS.has(o.transitionOut)
        ? (o.transitionOut as Transition)
        : "cut";

    const visualPrompt =
      typeof o.visualPrompt === "string" && o.visualPrompt.trim()
        ? o.visualPrompt.trim()
        : "";
    if (!visualPrompt) continue; // a shot with no prompt is useless downstream

    let sourceSceneIndex =
      typeof o.sourceSceneIndex === "number" && Number.isFinite(o.sourceSceneIndex)
        ? Math.round(o.sourceSceneIndex)
        : 0;
    if (sourceSceneIndex < 0) sourceSceneIndex = 0;
    if (sourceSceneIndex > maxSceneIndex) sourceSceneIndex = maxSceneIndex;

    const voiceover =
      typeof o.voiceover === "string" && o.voiceover.trim()
        ? o.voiceover.trim()
        : undefined;
    const onScreenText =
      typeof o.onScreenText === "string" && o.onScreenText.trim()
        ? o.onScreenText.trim()
        : undefined;
    const durationSec =
      typeof o.durationSec === "number" && Number.isFinite(o.durationSec)
        ? o.durationSec
        : undefined;

    drafts.push({
      kind,
      sourceSceneIndex,
      visualPrompt,
      voiceover,
      onScreenText,
      transitionOut,
      durationSec,
    });
  }
  return drafts;
}

/** Remove leading/trailing ```json fences a chat model may wrap output in. */
function stripFences(s: string): string {
  return s
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

// ---------------------------------------------------------------------------
// Deterministic fallback — one shot per scene
// ---------------------------------------------------------------------------

/**
 * Build a serviceable shot list directly from the brief, with no LLM. One shot
 * per scene; the final scene (or an appended one) becomes the CTA. visualPrompt
 * still fuses scene + aesthetic + tone so downstream stages get a usable prompt.
 */
function fallbackDrafts(brief: CreativeBrief): DraftShot[] {
  const scenes = brief.scenes ?? [];
  const drafts: DraftShot[] = [];

  scenes.forEach((scene, i) => {
    const purpose = (scene.purpose || "").toLowerCase();
    const isCtaScene = purpose.includes("cta") || purpose.includes("call");
    const isProduct =
      purpose.includes("product") ||
      purpose.includes("value") ||
      purpose.includes("proof");

    const kind: ShotKind = isCtaScene
      ? "cta"
      : isProduct
        ? "product"
        : "broll";

    drafts.push({
      kind,
      sourceSceneIndex: scene.index ?? i,
      visualPrompt: synthPrompt(scene.visualIdea, brief),
      voiceover: scene.voiceover || undefined,
      onScreenText: scene.onScreenText || undefined,
      transitionOut: "cut",
    });
  });

  return drafts;
}

/** Compose a model-ready prompt from a visual idea + brand aesthetic + tone. */
function synthPrompt(visualIdea: string, brief: CreativeBrief): string {
  const idea = (visualIdea || brief.oneLiner || brief.productName).trim();
  const colors = brief.brandColors?.length
    ? `; brand palette ${brief.brandColors.join(", ")}`
    : "";
  return `${idea}. Aesthetic: ${brief.aesthetic}. Tone: ${brief.tone}${colors}.`;
}

// ---------------------------------------------------------------------------
// Structural finalization (deterministic)
// ---------------------------------------------------------------------------

/**
 * Apply every hard structural rule to the draft shots:
 *  - guarantee at least one shot,
 *  - guarantee the LAST shot is a CTA carrying the brief's callToAction,
 *  - assign per-shot durations that sum to `target` (±tolerance) with each
 *    shot clamped to [MIN_SHOT_SEC, MAX_SHOT_SEC],
 *  - assign contiguous indices 0..n-1,
 *  - let the final shot fade out.
 */
function finalize(drafts: DraftShot[], brief: CreativeBrief, target: number): Shot[] {
  let working = drafts.length > 0 ? [...drafts] : fallbackDrafts(brief);
  if (working.length === 0) {
    // Brief had zero scenes — still produce a single CTA shot.
    working = [
      {
        kind: "cta",
        sourceSceneIndex: 0,
        visualPrompt: synthPrompt(brief.callToAction, brief),
        transitionOut: "fade",
      },
    ];
  }

  // --- Cap the shot count so each shot can still reach MIN_SHOT_SEC. ---
  const maxShots = Math.max(1, Math.floor(target / MIN_SHOT_SEC));
  if (working.length > maxShots) {
    // Keep the leading shots, but always preserve a CTA candidate at the end.
    const tail = working[working.length - 1];
    working = working.slice(0, maxShots - 1);
    working.push(tail);
  }

  // --- Guarantee a CTA as the last shot. ---
  const last = working[working.length - 1];
  if (last.kind !== "cta") {
    // Promote the last shot to CTA if it lacks one, rather than over-running
    // the duration budget by appending an extra shot.
    last.kind = "cta";
  }
  // The CTA shot must carry the brief's call to action.
  last.onScreenText = brief.callToAction;
  last.voiceover = brief.callToAction;
  last.transitionOut = "fade";

  // --- Distribute durations to hit the target within tolerance. ---
  const durations = allocateDurations(working, target);

  // --- Materialize Shots with contiguous indices. ---
  return working.map((d, i) => {
    const shot: Shot = {
      index: i,
      kind: d.kind,
      durationSec: durations[i],
      sourceSceneIndex: d.sourceSceneIndex,
      visualPrompt: d.visualPrompt,
      // productImageRef is intentionally left undefined: the asset-generation
      // stage owns mapping product shots to scraped image URLs; we have none.
      productImageRef: undefined,
      voiceover: d.voiceover,
      onScreenText: d.onScreenText,
      transitionOut: d.transitionOut,
    };
    return shot;
  });
}

/**
 * Allocate a duration to each shot so the total equals `target` (within
 * DURATION_TOLERANCE_SEC) and every shot is in [MIN_SHOT_SEC, MAX_SHOT_SEC].
 *
 * Strategy: start from the LLM's advisory weights (or an even split), rescale
 * to the target, clamp, then iteratively redistribute the residual created by
 * clamping across shots that still have headroom. Guaranteed to terminate.
 */
function allocateDurations(shots: DraftShot[], target: number): number[] {
  const n = shots.length;

  // Feasible total given hard per-shot bounds.
  const feasible = Math.min(n * MAX_SHOT_SEC, Math.max(n * MIN_SHOT_SEC, target));

  // Seed weights from advisory durations, else even split.
  let weights = shots.map((s) =>
    typeof s.durationSec === "number" && s.durationSec > 0 ? s.durationSec : 1,
  );
  const weightSum = weights.reduce((a, b) => a + b, 0) || n;
  weights = weights.map((w) => w / weightSum);

  // Initial proportional allocation toward the feasible total.
  let dur = weights.map((w) => clamp(w * feasible, MIN_SHOT_SEC, MAX_SHOT_SEC));

  // Redistribute the difference between current sum and feasible total.
  for (let iter = 0; iter < 50; iter++) {
    const sum = dur.reduce((a, b) => a + b, 0);
    const diff = feasible - sum;
    if (Math.abs(diff) < 0.001) break;

    // Indices that can still move in the needed direction.
    const movable =
      diff > 0
        ? dur.map((d, i) => (d < MAX_SHOT_SEC ? i : -1)).filter((i) => i >= 0)
        : dur.map((d, i) => (d > MIN_SHOT_SEC ? i : -1)).filter((i) => i >= 0);
    if (movable.length === 0) break; // hit bounds; can't get closer

    const step = diff / movable.length;
    for (const i of movable) {
      dur[i] = clamp(dur[i] + step, MIN_SHOT_SEC, MAX_SHOT_SEC);
    }
  }

  // Round to 0.1s, then nudge a movable shot to absorb rounding drift so the
  // sum stays within tolerance of the target.
  dur = dur.map(round1);
  const finalSum = dur.reduce((a, b) => a + b, 0);
  const drift = round1(target - finalSum);
  if (Math.abs(drift) > DURATION_TOLERANCE_SEC) {
    // Apply the drift to the first shot that has room, clamped.
    for (let i = 0; i < n; i++) {
      const adjusted = clamp(dur[i] + drift, MIN_SHOT_SEC, MAX_SHOT_SEC);
      if (adjusted !== dur[i]) {
        dur[i] = round1(adjusted);
        break;
      }
    }
  }

  return dur;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a brand/brief tone to a music mood hint for selection or generation. */
function deriveMusicMood(tone: string): string {
  const t = (tone || "").toLowerCase();
  if (/energetic|upbeat|exciting|bold|dynamic/.test(t)) return "upbeat electronic, driving";
  if (/premium|luxury|elegant|sophisticat/.test(t)) return "cinematic, refined, ambient";
  if (/calm|relax|soothing|gentle|minimal/.test(t)) return "soft ambient, mellow";
  if (/playful|fun|quirky|friendly/.test(t)) return "playful pop, light";
  if (/serious|professional|confident|trust/.test(t)) return "confident corporate, steady";
  return "modern upbeat";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** targetDurationSec must be large enough for at least one valid shot. */
function clampTarget(t: number): number {
  if (!Number.isFinite(t) || t < MIN_SHOT_SEC) return DEFAULT_TARGET_SEC;
  return t;
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}
