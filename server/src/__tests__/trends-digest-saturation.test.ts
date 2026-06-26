// ---------------------------------------------------------------------------
// Saturation scorer tests — Rule 3 ("verdicts are computed, not opined").
// Pure arithmetic; no model, no network, no DB.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { computeSaturation } from "../services/trends-digest/saturation.js";

describe("computeSaturation — score + buckets", () => {
  it("wide-open + surging → low score, OPEN, RISING, RIDE", () => {
    const r = computeSaturation({
      domainConcentration: 0.05,
      keywordDifficulty: 0.1,
      aiAnswerConcentration: 0.1,
      velocity: 0.9,
      coverage: 0.05,
    });
    expect(r.score).toBeLessThan(34);
    expect(r.bucket).toBe("OPEN");
    expect(r.momentum).toBe("RISING");
    expect(r.verdict).toBe("RIDE");
    expect(r.inputsUsed).toHaveLength(5);
  });

  it("crowded + surging → high score, SATURATED, RISING, COATTAIL", () => {
    const r = computeSaturation({
      domainConcentration: 0.95,
      keywordDifficulty: 0.9,
      aiAnswerConcentration: 0.9,
      velocity: 0.8,
      coverage: 0.9,
    });
    expect(r.score).toBeGreaterThan(66);
    expect(r.bucket).toBe("SATURATED");
    expect(r.momentum).toBe("RISING");
    expect(r.verdict).toBe("COATTAIL");
  });

  it("crowded + dying → SATURATED, FALLING, AVOID", () => {
    const r = computeSaturation({
      domainConcentration: 0.9,
      keywordDifficulty: 0.9,
      aiAnswerConcentration: 0.9,
      velocity: 0.1,
      coverage: 0.9,
    });
    expect(r.bucket).toBe("SATURATED");
    expect(r.momentum).toBe("FALLING");
    expect(r.verdict).toBe("AVOID");
  });

  it("contested + flat → DIFFERENTIATE", () => {
    const r = computeSaturation({
      domainConcentration: 0.5,
      keywordDifficulty: 0.5,
      aiAnswerConcentration: 0.5,
      velocity: 0.45, // PLATEAUED (between 0.33 and 0.6)
      coverage: 0.5,
    });
    expect(r.bucket).toBe("CONTESTED");
    expect(r.momentum).toBe("PLATEAUED");
    expect(r.verdict).toBe("DIFFERENTIATE");
  });

  it("open + dying → DIFFERENTIATE (not AVOID — it's not saturated)", () => {
    const r = computeSaturation({
      domainConcentration: 0.05,
      keywordDifficulty: 0.05,
      aiAnswerConcentration: 0.05,
      velocity: 0.1,
      coverage: 0.05,
    });
    expect(r.bucket).toBe("OPEN");
    expect(r.momentum).toBe("FALLING");
    expect(r.verdict).toBe("DIFFERENTIATE");
  });
});

describe("computeSaturation — graceful degradation", () => {
  it("renormalizes weights over present inputs only", () => {
    // Only AI-answer concentration present, at 1.0 → score should be 100
    // (its weight is the only one, renormalized to 1.0), not 25.
    const r = computeSaturation({ aiAnswerConcentration: 1 });
    expect(r.score).toBe(100);
    expect(r.inputsUsed).toEqual(["aiAnswerConcentration"]);
  });

  it("no inputs at all → flagged default, empty inputsUsed", () => {
    const r = computeSaturation({});
    expect(r.inputsUsed).toEqual([]);
    expect(r.bucket).toBe("CONTESTED");
    expect(r.verdict).toBe("DIFFERENTIATE");
    expect(r.evidence).toMatch(/no saturation signals/i);
  });

  it("velocity alone drives momentum even with no saturation terms... ", () => {
    // velocity is both a saturation term (inverseVelocity) and momentum driver
    const r = computeSaturation({ velocity: 0.95 });
    expect(r.momentum).toBe("RISING");
    expect(r.inputsUsed).toEqual(["velocity"]);
  });

  it("clamps out-of-range and ignores non-finite inputs", () => {
    const r = computeSaturation({
      domainConcentration: 5, // clamps to 1
      keywordDifficulty: Number.NaN, // ignored
      velocity: -3, // clamps to 0 → FALLING
    });
    expect(r.momentum).toBe("FALLING");
    expect(r.inputsUsed).toContain("domainConcentration");
    expect(r.inputsUsed).not.toContain("keywordDifficulty");
  });
});

describe("computeSaturation — determinism", () => {
  it("same inputs always yield the same verdict", () => {
    const inputs = {
      domainConcentration: 0.7,
      keywordDifficulty: 0.6,
      aiAnswerConcentration: 0.8,
      velocity: 0.7,
      coverage: 0.4,
    };
    const a = computeSaturation(inputs);
    const b = computeSaturation(inputs);
    expect(a).toEqual(b);
  });
});
