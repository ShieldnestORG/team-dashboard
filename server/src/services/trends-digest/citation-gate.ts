// ---------------------------------------------------------------------------
// Citation-check gate — Rule 4 ("automated citation-check gate before
// publish"). A cheap second-model pass, modelled on the Watchtower accuracy
// judge (watchtower-accuracy-judge.ts): Haiku, fail-soft, bounded concurrency.
// It is the LAST line before a digest is published, and it does three things:
//
//   * Strips an unsupported claim. If the judge says the "why it's hot" line
//     is NOT supported by its cited source, the model line is replaced with the
//     deterministic templated line (grounded by construction). The feed never
//     ships a model claim the source doesn't back.
//   * Tags provenance (Rule 5). ≥2 independent sources → ✅ independent; 1
//     source → 🟡 single_source; unconfirmable → ⚠ unverified.
//   * Downgrades unranked superlatives. "#1 / biggest / largest" with no cited
//     ranking can never be ✅ (so it can never become paid-ad copy).
//
// Fail-soft has two distinct meanings here, and they differ on purpose:
//   * Judge SAYS unsupported  → strip (a definite negative judgment).
//   * Judge is UNAVAILABLE     → keep the (already number-guarded) line but cap
//     provenance at ⚠ unverified. A judge outage must never blank the feed.
// ---------------------------------------------------------------------------

import { logger } from "../../middleware/logger.js";
import { templatedLine } from "./why-its-hot.js";
import type { DigestItem, Provenance } from "./types.js";

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 4;
const MAX_JUDGED = 200; // defence-in-depth bound on judge fan-out

const SUPERLATIVE_RE =
  /(#\s?1\b|\bnumber one\b|\bbiggest\b|\blargest\b|\bbest\b|\bfastest[-\s]growing\b|\bhighest\b|\bmost\s+\w+\b|\bleading\b|\bdominant\b|\btop\s+\d)/i;

/** Judge verdict. `null` means the judge was UNAVAILABLE (fail-soft: do not strip). */
export interface CitationVerdict {
  supported: boolean;
  reason?: string;
}
export type CitationJudge = (
  claim: string,
  sourceText: string,
) => Promise<CitationVerdict | null>;

/** One item to gate, with the raw grounding text the published shape doesn't carry. */
export interface GateInput {
  item: DigestItem;
  /** The fetched text the "why it's hot" line must be supported by. */
  groundingText: string;
  /** Count of distinct independent sources behind the item. */
  sourceCount: number;
}

export interface GateOptions {
  /** Injectable judge (tests). Defaults to the Haiku citation judge. */
  judge?: CitationJudge;
  concurrency?: number;
}

const LEVELS: Provenance[] = ["unverified", "single_source", "independent"];
const levelToProv = (n: number): Provenance =>
  LEVELS[Math.max(0, Math.min(2, n))]!;

/** A superlative is "supported" only if the source text uses it too. */
function hasUnsupportedSuperlative(claim: string, sourceText: string): boolean {
  const m = claim.match(SUPERLATIVE_RE);
  if (!m) return false;
  const token = m[0].toLowerCase().replace(/\s+/g, " ");
  return !sourceText.toLowerCase().includes(token);
}

// --- default Haiku judge ---------------------------------------------------

const JUDGE_SYSTEM =
  "You are a citation checker. You are given a CLAIM and the SOURCE TEXT it " +
  "cites. Decide whether the claim is FULLY supported by the source text. A " +
  "claim is supported only if everything it asserts is stated in, or directly " +
  "entailed by, the source text. If the claim adds facts, numbers, or " +
  "rankings not present in the source, it is NOT supported. Reply with ONLY a " +
  'JSON object, no prose, no markdown: {"supported": true|false, "reason": "<short>"}.';

function parseVerdict(text: string): CitationVerdict | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const tryParse = (s: string): CitationVerdict | null => {
    try {
      const o = JSON.parse(s) as { supported?: unknown; reason?: unknown };
      if (typeof o.supported !== "boolean") return null;
      return {
        supported: o.supported,
        reason: typeof o.reason === "string" ? o.reason : undefined,
      };
    } catch {
      return null;
    }
  };
  const fast = tryParse(trimmed);
  if (fast) return fast;
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  return tryParse(trimmed.slice(first, last + 1));
}

/** Default judge: Haiku via the same Anthropic transport as the codebase.
 *  Returns null on any error / missing key (fail-soft). */
const haikuJudge: CitationJudge = async (claim, sourceText) => {
  const apiKey =
    process.env.ANTHROPIC_API_KEY?.trim() ||
    process.env.WATCHTOWER_ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  const model =
    process.env.TRENDS_CITATION_JUDGE_MODEL?.trim() ||
    process.env.ANTHROPIC_MODEL?.trim() ||
    DEFAULT_MODEL;
  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: JUDGE_SYSTEM,
        messages: [
          {
            role: "user",
            content: `CLAIM:\n${claim}\n\nSOURCE TEXT:\n${sourceText}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      logger.warn(
        { status: res.status },
        "trends-digest:citation-gate judge non-2xx (fail-soft, keep + downgrade)",
      );
      return null;
    }
    const data = (await res.json()) as {
      content?: Array<{ type: string; text: string }>;
    };
    const text =
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n") ?? "";
    return parseVerdict(text);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "trends-digest:citation-gate judge threw (fail-soft, keep + downgrade)",
    );
    return null;
  }
};

/**
 * Gate one item: apply superlative downgrade, judge the claim, strip if
 * unsupported, and assign final provenance. Pure given an injected judge.
 */
async function gateOne(
  input: GateInput,
  judge: CitationJudge,
): Promise<DigestItem> {
  const { item, groundingText, sourceCount } = input;
  let level = sourceCount >= 2 ? 2 : sourceCount === 1 ? 1 : 0;
  let prose = item.whyItsHot;

  // Superlative with no source ranking → never ✅.
  if (hasUnsupportedSuperlative(prose.text, groundingText)) {
    level = Math.max(0, level - 1);
  }

  if (prose.fallback) {
    // Already the deterministic template — grounded by construction, no model
    // claim to verify. It restates one source, so cap at single_source.
    level = Math.min(level, 1);
  } else {
    const verdict = await judge(prose.text, groundingText);
    if (verdict === null) {
      // Judge unavailable — keep, but we couldn't independently confirm.
      level = 0;
    } else if (!verdict.supported) {
      // Definite negative — strip the model claim, fall to grounded template.
      logger.warn(
        { title: item.title, reason: verdict.reason },
        "trends-digest:citation-gate stripped unsupported claim",
      );
      prose = {
        text: templatedLine({
          title: item.title,
          category: item.category,
          sourceText: "",
          source: prose.sources[0] ?? item.whatsHot.source,
        }),
        sources: prose.sources,
        fallback: true,
      };
      level = Math.min(level, 1);
    }
  }

  return { ...item, whyItsHot: prose, provenance: levelToProv(level) };
}

/**
 * Run the citation gate over a batch. Bounded concurrency; never throws — a
 * judge outage degrades provenance, it does not fail the publish. Items beyond
 * MAX_JUDGED keep their incoming provenance (defence-in-depth bound).
 */
export async function runCitationGate(
  inputs: GateInput[],
  opts: GateOptions = {},
): Promise<DigestItem[]> {
  const judge = opts.judge ?? haikuJudge;
  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);

  const out: DigestItem[] = new Array(inputs.length);
  let cursor = 0;
  const workers = Array.from({
    length: Math.min(concurrency, inputs.length || 1),
  }).map(async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= inputs.length) return;
      if (idx >= MAX_JUDGED) {
        out[idx] = inputs[idx]!.item;
        continue;
      }
      out[idx] = await gateOne(inputs[idx]!, judge);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Ad-friendly ids — ✅ independent provenance only (Rule 5). */
export function adFriendlyIds(items: DigestItem[]): string[] {
  return items.filter((i) => i.provenance === "independent").map((i) => i.id);
}
