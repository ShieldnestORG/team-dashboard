import { describe, it, expect } from "vitest";
import {
  extractKeywords,
  scoreNotesByKeyword,
  type ScorableNote,
} from "../services/university/notes-keyword-fallback.js";

describe("notes-keyword-fallback", () => {
  it("extractKeywords lowercases, strips punctuation, drops stopwords + short words", () => {
    // "the"/"and" are stopwords; "of" is length 2 (dropped by len > 2).
    expect(extractKeywords("The Fear of failing, and worthiness!")).toEqual([
      "fear",
      "failing",
      "worthiness",
    ]);
    expect(extractKeywords("")).toEqual([]);
  });

  const notes: ScorableNote[] = [
    {
      noteKey: "a",
      lessonSlug: "l1",
      title: "Scarcity mindset",
      body: "I keep hoarding time out of fear",
      tags: ["fear", "scarcity"],
    },
    {
      noteKey: "b",
      lessonSlug: "l1",
      title: "Morning routine",
      body: "cold plunge and journaling",
      tags: ["habit"],
    },
    {
      noteKey: "c",
      lessonSlug: "l2",
      title: "Worthiness",
      body: "fear of not being enough",
      tags: ["worthiness", "fear"],
    },
  ];

  it("ranks notes by keyword overlap desc and drops zero-overlap notes", () => {
    // "fear scarcity": a matches both (2), c matches fear only (1), b matches none.
    const ranked = scoreNotesByKeyword("fear scarcity", notes);
    expect(ranked.map((n) => n.noteKey)).toEqual(["a", "c"]);
    expect(ranked.find((n) => n.noteKey === "b")).toBeUndefined();
  });

  it("returns [] for an all-stopword or empty query", () => {
    expect(scoreNotesByKeyword("the and of", notes)).toEqual([]);
    expect(scoreNotesByKeyword("", notes)).toEqual([]);
  });
});
