// ---------------------------------------------------------------------------
// Coherent Ones University — agent content safety gate unit test.
//
// Locks in the per-persona sentence ceiling: the default now matches the system
// prompt's "two to four short sentences" (was 2, which contradicted the prompt
// and silently burned LLM spend into scripted fallbacks), and long-form
// personas can raise it via persona.maxSentences without loosening the other
// gates (AI self-reference, advice, jargon, emoji).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { contentSafe, DEFAULT_MAX_SENTENCES } from "./safety.js";

const sentences = (n: number) => Array.from({ length: n }, (_, i) => `Sentence ${i + 1}.`).join(" ");

describe("contentSafe sentence ceiling", () => {
  it("allows up to the default ceiling (matches the system prompt's 'two to four')", () => {
    expect(DEFAULT_MAX_SENTENCES).toBe(4);
    expect(contentSafe(sentences(4)).ok).toBe(true);
    expect(contentSafe(sentences(5))).toEqual({ ok: false, reason: "too_long" });
  });

  it("honors a raised per-persona ceiling for long-form personas", () => {
    expect(contentSafe(sentences(6), false, 6).ok).toBe(true);
    expect(contentSafe(sentences(7), false, 6)).toEqual({ ok: false, reason: "too_long" });
  });

  it("keeps every other gate intact regardless of the ceiling", () => {
    expect(contentSafe("As an AI, I understand.", false, 6).ok).toBe(false);
    expect(contentSafe("You should sell it all.", false, 6).ok).toBe(false);
    expect(contentSafe("Let's leverage synergy here.", false, 6).ok).toBe(false);
    expect(contentSafe("Nice work 🎉", false, 6).ok).toBe(false);
    expect(contentSafe("Nice work 🎉", true, 6).ok).toBe(true);
  });
});
