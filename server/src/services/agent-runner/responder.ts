// ---------------------------------------------------------------------------
// Coherent Ones University — responsive-help intent classification + responder
// selection. Deterministic intent (Rule 5: code, not the model). Ports the
// prototype chat_ai.py responder-selection (prefer the moderator for help).
// ---------------------------------------------------------------------------

import type { AgentPersona } from "./personas.js";

export type Intent = "question" | "struggle" | "celebrate" | "share";

const QUESTION = /\?|\b(how|what|why|when|where|should i|anyone else|does anyone|is it normal|do you|any tips|advice)\b/i;
const STRUGGLE = /\b(strugg|so hard|can'?t|cannot|give up|giving up|quit|doubt|stuck|failing|fell off|missed|reset my streak|not sure|overwhelm|frustrat|burn(ed)? out|hate|tired)\b/i;
const CELEBRATE = /\b(streak|day \d+|\d+ days|milestone|did it|nailed|proud|finally|breakthrough|first time|love this|grateful|unbroken)\b/i;

export function classifyIntent(body: string): Intent {
  // Order matters: struggle outranks a struggling question; celebration last.
  if (STRUGGLE.test(body)) return "struggle";
  if (QUESTION.test(body)) return "question";
  if (CELEBRATE.test(body)) return "celebrate";
  return "share";
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/**
 * Choose 0–2 agent personas to reply to a real member's post.
 * `eligible` is the set the engine has already filtered (active, in-hours,
 * under caps, not paused). We pick intent-appropriately, with variety:
 *  - question/struggle: bias toward the moderator (~one slot), up to `max`
 *  - celebrate/share: a single light-touch responder
 * Moderator is NOT forced every time (Wendell answering everything is a tell).
 */
export function selectResponders(
  eligible: AgentPersona[],
  intent: Intent,
  max = 2,
): AgentPersona[] {
  if (eligible.length === 0) return [];

  const cap = intent === "celebrate" || intent === "share" ? 1 : max;
  const pool = shuffle(eligible);

  // For help intents, surface a moderator into the first slot ~70% of the time.
  if (intent === "question" || intent === "struggle") {
    const modIdx = pool.findIndex((p) => p.role === "moderator");
    if (modIdx > 0 && Math.random() < 0.7) {
      const [mod] = pool.splice(modIdx, 1);
      pool.unshift(mod!);
    }
  }

  return pool.slice(0, cap);
}
