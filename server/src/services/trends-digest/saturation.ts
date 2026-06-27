// ---------------------------------------------------------------------------
// Saturation scorer — Rule 3 of the hardened anti-hallucination method:
// "Verdicts are computed, not opined." RIDE / COATTAIL / DIFFERENTIATE / AVOID
// comes from a deterministic formula over numeric inputs, NEVER from a model.
//
// One of the original one-off run's errors was a saturated keyword the model
// labelled "open". A model has no business judging saturation — it's arithmetic
// over SERP diversity, keyword difficulty, AI-answer concentration, and
// velocity. This module is that arithmetic, and nothing else.
//
// Formula (coherencedaddy-landing plan §1.4), all terms normalized so 1 = more
// saturated:
//   score = 100 · ( 0.30·domainConcentration
//                 + 0.25·keywordDifficulty
//                 + 0.25·aiAnswerConcentration
//                 + 0.10·inverseVelocity         (= 1 − velocity)
//                 + 0.10·coverage )
//
// Weights renormalize over whichever inputs are present (graceful degradation),
// so a topic with partial signals still scores defensibly and a topic with no
// signals is flagged (DIFFERENTIATE, the conservative default) rather than
// guessed at.
// ---------------------------------------------------------------------------

import type {
  Momentum,
  SaturationBucket,
  SaturationInputs,
  SaturationScore,
  Verdict,
} from "./types.js";

/** Weight each saturation term carries when present (sums to 1.0). */
const WEIGHTS = {
  domainConcentration: 0.3,
  keywordDifficulty: 0.25,
  aiAnswerConcentration: 0.25,
  inverseVelocity: 0.1,
  coverage: 0.1,
} as const;

/** Bucket thresholds on the 0..100 score. */
const OPEN_MAX = 34; // < 34 → OPEN
const SATURATED_MIN = 66; // > 66 → SATURATED, else CONTESTED

/** Velocity thresholds (0..1) for the momentum label. */
const RISING_MIN = 0.6;
const FALLING_MAX = 0.33;

/**
 * Verdict lookup, bucket × momentum. Deterministic and auditable — this table
 * IS the strategy, so it lives in one place where it can be reviewed.
 *
 *               RISING        PLATEAUED       FALLING
 *   OPEN        RIDE          RIDE            DIFFERENTIATE
 *   CONTESTED   RIDE          DIFFERENTIATE   AVOID
 *   SATURATED   COATTAIL      DIFFERENTIATE   AVOID
 *
 * Reasoning: open + alive → just ride it; saturated + still surging → you can't
 * win head-on so coattail the leaders; anything saturated/contested and falling
 * → avoid; the dead-but-open and saturated-but-flat middles → differentiate.
 */
const VERDICT_MATRIX: Record<SaturationBucket, Record<Momentum, Verdict>> = {
  OPEN: { RISING: "RIDE", PLATEAUED: "RIDE", FALLING: "DIFFERENTIATE" },
  CONTESTED: { RISING: "RIDE", PLATEAUED: "DIFFERENTIATE", FALLING: "AVOID" },
  SATURATED: { RISING: "COATTAIL", PLATEAUED: "DIFFERENTIATE", FALLING: "AVOID" },
};

/** Clamp a value into [0, 1]; non-finite → undefined (treated as absent). */
function norm(v: number | undefined): number | undefined {
  if (v === undefined || !Number.isFinite(v)) return undefined;
  return Math.min(1, Math.max(0, v));
}

function bucketFor(score: number): SaturationBucket {
  if (score < OPEN_MAX) return "OPEN";
  if (score > SATURATED_MIN) return "SATURATED";
  return "CONTESTED";
}

function momentumFor(velocity: number | undefined): Momentum {
  if (velocity === undefined) return "PLATEAUED";
  if (velocity >= RISING_MIN) return "RISING";
  if (velocity <= FALLING_MAX) return "FALLING";
  return "PLATEAUED";
}

function pct(v: number): string {
  return v.toFixed(2);
}

/**
 * Compute the saturation verdict from numeric inputs. Pure and deterministic:
 * the same inputs always yield the same verdict, and no model is involved.
 *
 * Inputs are optional; weights renormalize over the present ones. When NO
 * saturation signals are present the score is a documented neutral default and
 * `inputsUsed` is empty — downstream code (e.g. the ad-friendly gate) can and
 * should treat an empty `inputsUsed` as "score not data-backed".
 */
export function computeSaturation(inputs: SaturationInputs): SaturationScore {
  const velocity = norm(inputs.velocity);

  // Build the term list (term key → normalized contribution), skipping absent
  // inputs. inverseVelocity is derived from velocity.
  const terms: Array<{ key: keyof typeof WEIGHTS; value: number }> = [];
  const domainConcentration = norm(inputs.domainConcentration);
  const keywordDifficulty = norm(inputs.keywordDifficulty);
  const aiAnswerConcentration = norm(inputs.aiAnswerConcentration);
  const coverage = norm(inputs.coverage);

  if (domainConcentration !== undefined)
    terms.push({ key: "domainConcentration", value: domainConcentration });
  if (keywordDifficulty !== undefined)
    terms.push({ key: "keywordDifficulty", value: keywordDifficulty });
  if (aiAnswerConcentration !== undefined)
    terms.push({ key: "aiAnswerConcentration", value: aiAnswerConcentration });
  if (velocity !== undefined)
    terms.push({ key: "inverseVelocity", value: 1 - velocity });
  if (coverage !== undefined) terms.push({ key: "coverage", value: coverage });

  const inputsUsed: SaturationScore["inputsUsed"] = [];
  if (domainConcentration !== undefined) inputsUsed.push("domainConcentration");
  if (keywordDifficulty !== undefined) inputsUsed.push("keywordDifficulty");
  if (aiAnswerConcentration !== undefined)
    inputsUsed.push("aiAnswerConcentration");
  if (velocity !== undefined) inputsUsed.push("velocity");
  if (coverage !== undefined) inputsUsed.push("coverage");

  let score: number;
  if (terms.length === 0) {
    // No saturation signals — neutral default, conservatively CONTESTED. Not a
    // hallucinated number: a documented code default, flagged via inputsUsed=[].
    score = 50;
  } else {
    const totalWeight = terms.reduce((s, t) => s + WEIGHTS[t.key], 0);
    const weighted = terms.reduce(
      (s, t) => s + WEIGHTS[t.key] * t.value,
      0,
    );
    score = Math.round((weighted / totalWeight) * 100);
  }

  const bucket = terms.length === 0 ? "CONTESTED" : bucketFor(score);
  const momentum = momentumFor(velocity);
  const verdict = VERDICT_MATRIX[bucket][momentum];

  const evidence =
    terms.length === 0
      ? "No saturation signals available — defaulting to a conservative DIFFERENTIATE/CONTESTED read."
      : buildEvidence({
          domainConcentration,
          keywordDifficulty,
          aiAnswerConcentration,
          velocity,
          coverage,
          bucket,
          momentum,
        });

  return { score, bucket, momentum, verdict, evidence, inputsUsed };
}

function buildEvidence(p: {
  domainConcentration?: number;
  keywordDifficulty?: number;
  aiAnswerConcentration?: number;
  velocity?: number;
  coverage?: number;
  bucket: SaturationBucket;
  momentum: Momentum;
}): string {
  const parts: string[] = [];
  if (p.domainConcentration !== undefined)
    parts.push(`SERP domain concentration ${pct(p.domainConcentration)}`);
  if (p.keywordDifficulty !== undefined)
    parts.push(`keyword difficulty ${pct(p.keywordDifficulty)}`);
  if (p.aiAnswerConcentration !== undefined)
    parts.push(`AI-answer concentration ${pct(p.aiAnswerConcentration)}`);
  if (p.velocity !== undefined) parts.push(`velocity ${pct(p.velocity)}`);
  if (p.coverage !== undefined) parts.push(`coverage ${pct(p.coverage)}`);
  return `${p.bucket} / ${p.momentum} — ${parts.join(", ")}.`;
}
