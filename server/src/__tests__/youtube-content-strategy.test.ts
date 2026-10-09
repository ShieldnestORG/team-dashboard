import { describe, it, expect } from "vitest";
import {
  PILLAR_TARGETS,
  NICHE_TOPICS,
  selectPillarBalanced,
  selectTopicLru,
} from "../services/youtube/content-strategy.js";

describe("selectPillarBalanced", () => {
  it('returns tx_blockchain when crypto dominates the recent history', () => {
    expect(
      selectPillarBalanced(["crypto", "crypto", "motivation"], PILLAR_TARGETS, () => 0),
    ).toBe("tx_blockchain");
  });

  it("returns a target pillar when all are tied (rand decides; () => 0 picks the first)", () => {
    const result = selectPillarBalanced(
      ["tx_blockchain", "crypto", "motivation"],
      PILLAR_TARGETS,
      () => 0,
    );
    expect(Object.keys(PILLAR_TARGETS)).toContain(result);
    expect(result).toBe(Object.keys(PILLAR_TARGETS)[0]);
  });

  it("behaves like empty history when the only entry is an unknown pillar", () => {
    const result = selectPillarBalanced(["site-walker"], PILLAR_TARGETS, () => 0);
    expect(Object.keys(PILLAR_TARGETS)).toContain(result);
    // Unknown pillars are ignored, so history is empty and rand picks the first target.
    expect(result).toBe(Object.keys(PILLAR_TARGETS)[0]);
  });
});

describe("selectTopicLru", () => {
  it("returns the first seed when there is no history", () => {
    expect(selectTopicLru("motivation", [])).toBe(NICHE_TOPICS.motivation[0]);
  });

  it("returns the third seed when the first two are used (older one first)", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const history = [
      { topic: NICHE_TOPICS.motivation[0], createdAt: new Date("2026-10-01T00:00:00Z") },
      { topic: NICHE_TOPICS.motivation[1], createdAt: new Date("2026-10-02T00:00:00Z") },
    ];
    expect(selectTopicLru("motivation", history, now)).toBe(NICHE_TOPICS.motivation[2]);
  });

  it("returns the seed used longest ago when all are used", () => {
    const now = new Date("2026-10-08T00:00:00Z");
    const history = NICHE_TOPICS.motivation.map((topic, i) => ({
      topic,
      // seed[0] most recent, seed[last] oldest
      createdAt: new Date(Date.UTC(2026, 9, 20 - i)), // seed[0] newest ... seed[last] oldest
    }));
    expect(selectTopicLru("motivation", history, now)).toBe(
      NICHE_TOPICS.motivation[NICHE_TOPICS.motivation.length - 1],
    );
  });
});

describe("seed title-safety", () => {
  it("contains no banned title patterns across all seeds", () => {
    // "millionaire fantasy" is the one allowed use of "millionaire".
    const banned = /\bbest\b|\bbuy\b|price\s*prediction|\bpicks\b|financial\s*freedom|\bmillionaire\b/i;
    const seeds = Object.values(NICHE_TOPICS).flat();
    for (const seed of seeds) {
      const offending = seed.replace(/millionaire fantasy/i, "");
      expect(offending).not.toMatch(banned);
    }
  });
});
