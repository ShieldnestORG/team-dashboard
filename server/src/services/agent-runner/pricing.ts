// ---------------------------------------------------------------------------
// Coherent Ones University — agent LLM pricing (USD per 1M tokens).
// Rates verified against the Anthropic model table (2026-06-20).
// Used to compute cost_usd for every university_agent_usage row.
// ---------------------------------------------------------------------------

interface ModelPrice {
  inputPerMtok: number;
  outputPerMtok: number;
}

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPerMtok: 1, outputPerMtok: 5 },
  "claude-sonnet-4-6": { inputPerMtok: 3, outputPerMtok: 15 },
  "claude-opus-4-8": { inputPerMtok: 5, outputPerMtok: 25 },
};

/**
 * Cost of one Claude call in USD. Returns 0 for an unknown model rather than
 * throwing — a pricing gap must never crash an agent tick (Rule 10: surface,
 * don't crash). Rounded to 6 dp (micro-dollars) to match the NUMERIC(12,6)
 * cost_usd column.
 */
export function costUsd(model: string, inTok: number, outTok: number): number {
  const price = MODEL_PRICES[model];
  if (!price) return 0;
  const dollars =
    (inTok / 1_000_000) * price.inputPerMtok +
    (outTok / 1_000_000) * price.outputPerMtok;
  return Math.round(dollars * 1_000_000) / 1_000_000;
}
