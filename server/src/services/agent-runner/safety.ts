// ---------------------------------------------------------------------------
// Coherent Ones University — agent content safety gate + bot-challenge detector.
// Deterministic (Rule 5: code, not the model). Applied to ALL agent LLM output
// (ambient variation AND responsive help) before it is posted. A reject → the
// runner falls back to a scripted persona line and files a safety_block report.
// ---------------------------------------------------------------------------

// Advice we must never give to members in a self-help context (liability).
const ADVICE_PATTERNS: RegExp[] = [
  // financial
  /\b(invest|investing|investment|stocks?|crypto|returns?|portfolio|financial advice|buy|sell)\b/i,
  // medical / mental-health
  /\b(diagnos|medication|dosage|prescri|symptoms?|antidepressant|therapist|psychiatr|see a doctor|medical advice)\b/i,
  // legal
  /\b(lawsuit|sue|legal advice|attorney|liability|contract|court)\b/i,
];

// The illusion-breakers: an agent must never reference being AI.
const AI_SELF_REFERENCE = /\b(as an ai|language model|i am an ai|i'm an ai|i am a bot|i'm a bot|chatbot|claude|anthropic|gpt|llm|artificial intelligence|my training|my programming)\b/i;

// Corporate / "AI slop" tells that make a post read as machine-written.
const JARGON = /\b(leverage|synergy|optimize|utilize|streamline|holistic|robust solution|circle back|low-hanging fruit|deep dive)\b/i;

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;

function sentenceCount(text: string): number {
  const parts = text.split(/[.!?]+\s/).filter((s) => s.trim().length > 0);
  return Math.max(parts.length, text.trim().length > 0 ? 1 : 0);
}

export interface SafetyResult {
  ok: boolean;
  reason?: string;
}

/**
 * Gate agent-generated text before posting.
 * `originalHadEmoji` lets responsive replies match the member's register — an
 * agent reply should not introduce emoji into a plain-text thread.
 */
export function contentSafe(text: string, originalHadEmoji = false): SafetyResult {
  const t = text.trim();
  if (!t) return { ok: false, reason: "empty" };
  if (AI_SELF_REFERENCE.test(t)) return { ok: false, reason: "ai_self_reference" };
  for (const p of ADVICE_PATTERNS) {
    if (p.test(t)) return { ok: false, reason: "advice" };
  }
  if (JARGON.test(t)) return { ok: false, reason: "jargon" };
  if (sentenceCount(t) > 2) return { ok: false, reason: "too_long" };
  if (!originalHadEmoji && EMOJI.test(t)) return { ok: false, reason: "emoji_mismatch" };
  return { ok: true };
}

export function hasEmoji(text: string): boolean {
  return EMOJI.test(text);
}

// A member directly challenging whether they're talking to a bot. The agent's
// correct response is SILENCE + an admin report — never deny being a bot.
const BOT_CHALLENGE_PATTERNS: RegExp[] = [
  /\bare you (a )?bot\b/i,
  /\bis this (a )?bot\b/i,
  /\bare you (an )?ai\b/i,
  /\bis this ai\b/i,
  /\bare you real\b/i,
  /\bare you human\b/i,
  /\bis this (a )?(real )?person\b/i,
  /\bis this automated\b/i,
  /\bare you a (real )?person\b/i,
  /\bthis is (a )?bot\b/i,
  /\bwho actually writes these\b/i,
  /\byou sound like (chatgpt|ai|a bot)\b/i,
  /\bis anyone (real|human) (here|in here)\b/i,
  /\byou don'?t (feel|seem|sound) (real|human|like a real person)\b/i,
  /\bthis (feels|seems|is) (automated|scripted|fake)\b/i,
  /\bare (these|the|your) (accounts|people|members) real\b/i,
];

export function isBotChallenge(text: string): boolean {
  return BOT_CHALLENGE_PATTERNS.some((p) => p.test(text));
}
