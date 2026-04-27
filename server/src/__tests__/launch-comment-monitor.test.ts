import { describe, expect, it } from "vitest";
import {
  CLASSIFIER_THRESHOLD,
  PATTERN_BANK,
  PATTERN_IDS,
  buildClassifierSystemPrompt,
  enforceClassifierInvariants,
} from "../services/launch-comment-monitor.js";

const EXPECTED_PATTERN_IDS = [
  "aider",
  "cursor",
  "cheap_tokens",
  "gemma_bad",
  "other_tool",
  "latency",
  "setup_hassle",
  "obvious",
] as const;

describe("launch-comment-monitor pattern bank", () => {
  it("exposes exactly the 8 documented pattern ids", () => {
    expect(PATTERN_IDS).toHaveLength(8);
    expect(new Set(PATTERN_IDS)).toEqual(new Set(EXPECTED_PATTERN_IDS));
  });

  it("classifier system prompt embeds all 8 patterns verbatim", () => {
    const prompt = buildClassifierSystemPrompt();
    for (const p of PATTERN_BANK) {
      // pattern_id label appears for each pattern
      expect(prompt).toContain(`pattern_id: "${p.patternId}"`);
      // matches description appears
      expect(prompt).toContain(p.matches);
      // The reply text is JSON-encoded into the prompt — assert a
      // reasonably long, distinctive substring of each reply survives.
      const distinctive = p.reply.slice(0, 60);
      // Replies use straight ASCII apostrophes inside the file, but
      // when JSON.stringify embeds them they remain unescaped — match
      // accordingly via JSON-encoded slice.
      const encoded = JSON.stringify(p.reply).slice(1, 61);
      expect(prompt.includes(distinctive) || prompt.includes(encoded)).toBe(true);
    }
  });

  it("threshold is 0.85", () => {
    expect(CLASSIFIER_THRESHOLD).toBe(0.85);
  });
});

describe("enforceClassifierInvariants", () => {
  it("nulls suggestedReply and patternId when confidence < 0.85", () => {
    const out = enforceClassifierInvariants({
      patternId: "aider",
      confidence: 0.84,
      suggestedReply: "anything",
    });
    expect(out.patternId).toBeNull();
    expect(out.suggestedReply).toBeNull();
    expect(out.confidence).toBe(0.84);
  });

  it("forces suggestedReply to the canonical pattern reply at >= 0.85", () => {
    const aider = PATTERN_BANK.find((p) => p.patternId === "aider")!;
    const out = enforceClassifierInvariants({
      patternId: "aider",
      confidence: 0.95,
      // Model may have hallucinated a paraphrase — we force it back.
      suggestedReply: "paraphrased reply",
    });
    expect(out.patternId).toBe("aider");
    expect(out.suggestedReply).toBe(aider.reply);
  });

  it("rejects unknown pattern ids even with high confidence", () => {
    const out = enforceClassifierInvariants({
      patternId: "made_up",
      confidence: 0.99,
      suggestedReply: "x",
    });
    expect(out.patternId).toBeNull();
    expect(out.suggestedReply).toBeNull();
  });
});
