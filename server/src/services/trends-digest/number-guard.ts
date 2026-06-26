// ---------------------------------------------------------------------------
// Number guard — the enforcement teeth of Rule 1 ("numbers come from data,
// never the model"). This is the net under the high wire: even though the
// pipeline hands the model only source text and asks for prose, a model can
// still slip a number in. This module detects any number in generated prose
// that is NOT present in its grounding source (or the code-inserted stats),
// so the caller can reject the line and fall back to a templated one.
//
// The "$910B" hallucination from the one-off run is the canonical case: that
// figure was invented, not fetched. With this guard, a generated "$910B" whose
// source never said "910 billion" / "$910B" / "910b" is flagged and dropped.
//
// Tiny bare integers (< 10, no $/%/magnitude unit) are intentionally NOT
// flagged — prose legitimately says "1–2 sentences", "3 reasons". The
// dangerous class is large numbers, decimals, money, percentages, and
// magnitude-suffixed figures, which are always checked.
// ---------------------------------------------------------------------------

const MAGNITUDE_WORDS: Record<string, string> = {
  thousand: "k",
  million: "m",
  billion: "b",
  trillion: "t",
};

/** Collapse "910 billion" → "910b" and "12.4 percent" → "12.4%" so the same
 *  quantity written different ways canonicalizes identically. */
function preNormalize(text: string): string {
  let t = text.toLowerCase();
  t = t.replace(
    /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion|trillion)\b/g,
    (_m, num: string, word: string) => `${num}${MAGNITUDE_WORDS[word]}`,
  );
  t = t.replace(
    /(\d[\d,]*(?:\.\d+)?)\s*percent\b/g,
    (_m, num: string) => `${num}%`,
  );
  return t;
}

// $? optional, digits with optional thousands commas, optional decimal,
// optional single magnitude/percent unit.
const TOKEN_RE = /(\$)?\s?(\d[\d,]*(?:\.\d+)?)\s?([kmbt%])?/g;

export interface NumberToken {
  /** Comparable form: digits (commas stripped) + unit (`%` or k/m/b/t), no `$`. */
  canonical: string;
  /** Numeric magnitude of the digits portion (ignores unit), for the small-bare skip. */
  value: number;
  /** True when the token carried `$`, `%`, or a magnitude suffix. */
  hasUnit: boolean;
}

/** Extract every numeric token from text in canonical comparable form. */
export function tokenize(text: string): NumberToken[] {
  const t = preNormalize(text);
  const out: NumberToken[] = [];
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(t)) !== null) {
    const dollar = m[1];
    const digits = m[2];
    const suffix = m[3];
    if (!digits) continue;
    const bare = digits.replace(/,/g, "");
    const value = Number.parseFloat(bare);
    if (!Number.isFinite(value)) continue;
    const unit = suffix ?? "";
    out.push({
      canonical: bare + unit,
      value,
      hasUnit: Boolean(dollar) || Boolean(suffix),
    });
  }
  return out;
}

/** Set of canonical tokens present in the grounding text (+ allowed extras). */
export function groundingTokenSet(
  groundingText: string,
  allowed: Iterable<string | number> = [],
): Set<string> {
  const set = new Set<string>();
  for (const tok of tokenize(groundingText)) set.add(tok.canonical);
  for (const a of allowed) {
    for (const tok of tokenize(String(a))) set.add(tok.canonical);
  }
  return set;
}

/**
 * Return the canonical numeric tokens in `generated` that are NOT supported by
 * `groundingText` (or the `allowed` set of code-inserted values). Empty array
 * means every number in the prose traces to the source. Tiny bare integers are
 * skipped (see file header).
 */
export function findUngroundedNumbers(
  generated: string,
  groundingText: string,
  allowed: Iterable<string | number> = [],
): string[] {
  const grounded = groundingTokenSet(groundingText, allowed);
  const ungrounded = new Set<string>();
  for (const tok of tokenize(generated)) {
    // Skip tiny bare INTEGERS only ("1–2 sentences", "3 reasons"). Decimals,
    // money, percentages, and magnitude-suffixed figures are always checked —
    // a precise "3.5" is exactly the kind of figure worth grounding.
    if (!tok.hasUnit && Number.isInteger(tok.value) && tok.value < 10) continue;
    if (!grounded.has(tok.canonical)) ungrounded.add(tok.canonical);
  }
  return [...ungrounded];
}

/** Convenience boolean: does the generated prose contain an ungrounded number? */
export function hasUngroundedNumbers(
  generated: string,
  groundingText: string,
  allowed: Iterable<string | number> = [],
): boolean {
  return findUngroundedNumbers(generated, groundingText, allowed).length > 0;
}
