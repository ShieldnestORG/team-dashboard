// ---------------------------------------------------------------------------
// Trends-digest contract — the data shapes that make the "what's hot" feed
// STRUCTURALLY unable to hallucinate.
//
// This is the type-level half of the hardened anti-hallucination method
// (owner directive 2026-06-25; full spec: coherencedaddy-landing
// docs/plans/2026-06-25-university-whats-hot-and-50off.md §1.8). The whole
// point is that the contract itself enforces the rules:
//
//   Rule 1 — Numbers come from data, never the model. A figure is a
//            `DigestStat.value` (a number field) carrying a `SourceRef`; the
//            model is never handed a slot to emit a number into.
//   Rule 2 — The model only writes grounded prose. The single free-text line
//            (`GroundedProse`) always carries the `SourceRef[]` it restates.
//   Rule 3 — Verdicts are computed, not opined. `SaturationScore` is produced
//            by saturation.ts from numeric inputs, never by a model.
//   Rule 5 — Provenance ships to members (`Provenance` ✅/🟡/⚠); paid-ad copy
//            is restricted to `independent` items (`adFriendlyItemIds`).
//   Rule 6 — Crawl provenance is on every `SourceRef` (`fetchedAt` + page
//            `dateline`).
//   Rule 7 — A digest is `pending` until a human approves it (`DigestStatus`).
// ---------------------------------------------------------------------------

/**
 * A fetched source behind a fact or claim. EVERY number and EVERY prose line in
 * the digest traces to one of these. (Rules 1, 2, 6)
 */
export interface SourceRef {
  url: string;
  title?: string;
  publisher?: string;
  /** ISO time the source was fetched/crawled. (Rule 6: stamp crawl time.) */
  fetchedAt: string;
  /**
   * The page's own dateline if detected — preferred over `fetchedAt` for
   * display ("as stated on <publisher>, <dateline>"). Null when no dateline
   * could be parsed. (Rule 6)
   */
  dateline?: string | null;
}

/**
 * A numeric fact, inserted by CODE from a fetched field — never authored by a
 * model. (Rule 1) `value` is the raw fetched number; `display` is a
 * code-formatted human string. If you find yourself wanting a model to fill
 * either field, stop — that is the exact failure this type exists to prevent.
 */
export interface DigestStat {
  /** What the number measures, e.g. "HN points", "24h change". */
  label: string;
  /** The raw fetched number. */
  value: number;
  /** Code-formatted for humans, e.g. "+12.4%", "177", "$0.0000123". */
  display: string;
  /** Optional unit, e.g. "%", "points", "USD". */
  unit?: string;
  /** Where the number came from. */
  source: SourceRef;
}

/** Provenance confidence carried all the way to the member-facing card. (Rule 5) */
export type Provenance = "independent" | "single_source" | "unverified";

/** Member-facing badge for each provenance level. (Rule 5) */
export const PROVENANCE_BADGE: Record<Provenance, string> = {
  independent: "✅",
  single_source: "🟡",
  unverified: "⚠",
};

// --- Saturation verdict (Rule 3 — computed, not opined) --------------------

export type SaturationBucket = "OPEN" | "CONTESTED" | "SATURATED";
export type Momentum = "RISING" | "PLATEAUED" | "FALLING";
export type Verdict = "RIDE" | "COATTAIL" | "DIFFERENTIATE" | "AVOID";

/**
 * Normalized 0..1 saturation contributions. Direction is uniform: **1 = more
 * saturated / harder to win, 0 = wide open.** Every field is optional — the
 * scorer renormalizes its weights over whichever inputs are actually present,
 * so a topic with only some signals still gets a defensible score (graceful
 * degradation), and a topic with none is flagged rather than guessed.
 */
export interface SaturationInputs {
  /** 1 − normalized SERP domain diversity. Few domains dominate → near 1. */
  domainConcentration?: number;
  /** Keyword difficulty 0..1 (SERP / keyword API). */
  keywordDifficulty?: number;
  /** How concentrated AI answers are on a few brands 0..1 (watchtower engines). */
  aiAnswerConcentration?: number;
  /**
   * Trend velocity 0..1 — **1 = surging, 0 = flat/falling.** Drives BOTH the
   * momentum label and the inverse-velocity saturation term (a slow trend
   * leaves less room to ride). The scorer derives `inverseVelocity = 1 −
   * velocity` internally.
   */
  velocity?: number;
  /** Coverage 0..1 — how much existing content already blankets the topic. */
  coverage?: number;
}

export interface SaturationScore {
  /** 0..100, higher = more saturated. Meaningful only when `inputsUsed` ≠ []. */
  score: number;
  bucket: SaturationBucket;
  momentum: Momentum;
  verdict: Verdict;
  /** Human-readable evidence line built ONLY from inputs that were present. */
  evidence: string;
  /** Which inputs actually fed the score — the score's own provenance. */
  inputsUsed: Array<keyof SaturationInputs>;
}

// --- Prose + items ---------------------------------------------------------

/**
 * A grounded prose line plus the sources it restates. (Rule 2) `fallback` is
 * true when the deterministic code path produced the line (model unavailable
 * or its output was rejected by the number guard) — the feed never blocks on
 * the model.
 */
export interface GroundedProse {
  text: string;
  sources: SourceRef[];
  fallback: boolean;
}

export interface DigestItem {
  id: string;
  /** Fetched (e.g. the HN story title) — not model-authored text. */
  title: string;
  category: string;
  /** What's hot: the signal restated + its source. */
  whatsHot: { text: string; source: SourceRef };
  /** Why it's hot: a grounded 1–2 sentence line. (Rule 2) */
  whyItsHot: GroundedProse;
  /** Numeric facts, code-inserted. (Rule 1) */
  stats: DigestStat[];
  /** Computed opportunity verdict. (Rule 3) */
  saturation: SaturationScore;
  /** Optional ready-to-use angle for the "reuse it / market your thing" loop (§1.4). */
  reuseAngle?: string;
  /** Provenance tag carried to members. (Rule 5) */
  provenance: Provenance;
}

export type DigestStatus = "pending" | "approved" | "sent" | "rejected";

export interface TrendDigest {
  /** YYYY-MM-DD (the run's date). */
  digestDate: string;
  /** ISO time the digest was assembled. */
  generatedAt: string;
  status: DigestStatus;
  items: DigestItem[];
  /**
   * Item ids cleared for paid-ad copy — `independent` (✅) provenance only.
   * (Rule 5) Ad surfaces MUST read from this list, never from `items` directly.
   */
  adFriendlyItemIds: string[];
}
