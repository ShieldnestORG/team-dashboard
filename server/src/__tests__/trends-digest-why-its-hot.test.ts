// ---------------------------------------------------------------------------
// Grounded "why it's hot" generator tests — Rule 2. Models are injected, so no
// network: we prove the guard rejects ungrounded numbers and the feed always
// gets a grounded line.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
  clampSentences,
  generateWhyItsHot,
  templatedLine,
  type ProseModel,
  type WhyItsHotInput,
} from "../services/trends-digest/why-its-hot.js";

const baseInput: WhyItsHotInput = {
  title: "Show HN: an open-source agent framework",
  category: "AI/ML",
  sourceText:
    "Show HN: an open-source agent framework. Developers are discussing it on Hacker News.",
  source: {
    url: "https://news.ycombinator.com/item?id=1",
    publisher: "Hacker News",
    fetchedAt: "2026-06-25T12:00:00.000Z",
    dateline: null,
  },
};

const model = (text: string): ProseModel => async () => text;
const throwingModel: ProseModel = async () => {
  throw new Error("model down");
};

describe("generateWhyItsHot", () => {
  it("accepts clean grounded prose and attaches the source", async () => {
    const r = await generateWhyItsHot(baseInput, {
      models: [model("Developers are discussing a new open-source agent framework on Hacker News.")],
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/agent framework/i);
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]!.url).toBe(baseInput.source.url);
  });

  it("rejects a model that invents a number and falls back (no model number ships)", async () => {
    const r = await generateWhyItsHot(baseInput, {
      models: [model("This framework already has 50,000 GitHub stars and a $910B market.")],
    });
    expect(r.fallback).toBe(true);
    expect(r.text).toBe(templatedLine(baseInput));
    expect(r.text).not.toMatch(/910|50,?000/);
  });

  it("tries the next model when the first introduces an ungrounded number", async () => {
    const r = await generateWhyItsHot(baseInput, {
      models: [
        model("It hit 99 percent adoption overnight."), // ungrounded → rejected
        model("An open-source agent framework is being discussed on Hacker News."), // clean
      ],
    });
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/discussed on Hacker News/i);
  });

  it("allows a code-inserted stat number to appear in prose", async () => {
    const r = await generateWhyItsHot(
      { ...baseInput, allowedNumbers: [177] },
      { models: [model("The framework is trending with 177 points on Hacker News.")] },
    );
    expect(r.fallback).toBe(false);
    expect(r.text).toMatch(/177/);
  });

  it("falls back to the template when every model throws", async () => {
    const r = await generateWhyItsHot(baseInput, {
      models: [throwingModel, throwingModel],
    });
    expect(r.fallback).toBe(true);
    expect(r.text).toBe(templatedLine(baseInput));
  });

  it("never throws — empty model output yields the grounded template", async () => {
    const r = await generateWhyItsHot(baseInput, { models: [model("   ")] });
    expect(r.fallback).toBe(true);
    expect(r.text).toBe(templatedLine(baseInput));
  });
});

describe("clampSentences", () => {
  it("trims to at most two sentences and strips wrapping quotes/markdown", () => {
    const out = clampSentences('"One. Two. Three. Four."');
    expect(out).toBe("One. Two.");
  });
});
