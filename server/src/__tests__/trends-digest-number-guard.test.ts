// ---------------------------------------------------------------------------
// Number-guard tests — Rule 1 enforcement ("numbers come from data, never the
// model"). The headline case is the "$910B" hallucination: a figure the model
// invented that the source never stated.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  findUngroundedNumbers,
  hasUngroundedNumbers,
  tokenize,
} from "../services/trends-digest/number-guard.js";

describe("tokenize", () => {
  it("canonicalizes money, percent, commas, and magnitude words/letters", () => {
    const canon = (s: string) => tokenize(s).map((t) => t.canonical);
    expect(canon("$910B")).toContain("910b");
    expect(canon("910 billion")).toContain("910b");
    expect(canon("12.4%")).toContain("12.4%");
    expect(canon("12.4 percent")).toContain("12.4%");
    expect(canon("1,234 points")).toContain("1234");
    expect(canon("$1.2 million")).toContain("1.2m");
  });
});

describe("findUngroundedNumbers — the $910B class", () => {
  it("flags an invented market cap absent from the source", () => {
    const source = "Solana rallied today as on-chain volume climbed.";
    const generated = "Solana's market cap hit $910B today.";
    expect(findUngroundedNumbers(generated, source)).toContain("910b");
    expect(hasUngroundedNumbers(generated, source)).toBe(true);
  });

  it("passes when the source actually stated the figure (any phrasing)", () => {
    const source = "The total market cap reached 910 billion dollars.";
    const generated = "Market cap hit $910B.";
    expect(findUngroundedNumbers(generated, source)).toEqual([]);
    expect(hasUngroundedNumbers(generated, source)).toBe(false);
  });

  it("allows code-inserted stat values via the `allowed` set", () => {
    const source = "Show HN: a new tool for agents.";
    const generated = "It's trending with 177 points on Hacker News.";
    // 177 isn't in the prose source, but it's a code-inserted stat.
    expect(findUngroundedNumbers(generated, source, [177])).toEqual([]);
    expect(findUngroundedNumbers(generated, source)).toContain("177");
  });
});

describe("findUngroundedNumbers — false-positive control", () => {
  it("does not flag tiny bare integers used in prose", () => {
    const source = "AI agents are surging.";
    const generated = "Here are 2 reasons in 1 sentence about agents.";
    expect(findUngroundedNumbers(generated, source)).toEqual([]);
  });

  it("still flags large bare integers and decimals", () => {
    const source = "AI agents are surging.";
    const generated = "Adoption grew 47 points and 3.5x year over year.";
    const ung = findUngroundedNumbers(generated, source);
    expect(ung).toContain("47");
    expect(ung).toContain("3.5");
  });

  it("flags money even when small (a price can be hallucinated)", () => {
    const source = "The token is up today.";
    const generated = "It now trades at $5.";
    expect(findUngroundedNumbers(generated, source)).toContain("5");
  });
});
