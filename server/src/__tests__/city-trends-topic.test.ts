import { describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// content:city-trends:blog topic choice.
//
// Until 2026-11-04 the job wrote about the same national Google Trends term
// for 4-10 weeks running ("ben affleck", "casper ruud"): every city row held
// the same 30 terms at score 0.6, the row was cached 30 days, and nothing
// checked what had already been written. These tests pin the three fixes:
// national terms are skipped, recent terms are skipped, and Google News
// headlines are parsed as the local source.
// ---------------------------------------------------------------------------

vi.mock("../services/ollama-client.js", () => ({
  callOllamaGenerate: async () => "",
}));

import {
  JOB_DEFS,
  chooseCityTrendTopic,
  cityTrendPrompt,
  cityTrendTermFromPrompt,
  type CityTrendCandidate,
} from "../services/content-crons.ts";
import { parseGoogleNewsRss } from "../services/city-collector.ts";

const c = (term: string, source: string, score = 1, mentionWeight = 1): CityTrendCandidate => ({
  term,
  score,
  source,
  city: "Kahului, Hawaii",
  mentionWeight,
});

describe("chooseCityTrendTopic", () => {
  it("never picks a term written about recently", () => {
    const candidates = [c("Kahului harbor grant", "google-news"), c("Maui bus chargers", "google-news")];
    const used = new Set(["kahului harbor grant"]);
    expect(chooseCityTrendTopic(candidates, used)?.term).toBe("Maui bus chargers");
  });

  it("matches recent terms case-insensitively", () => {
    const used = new Set(["maui bus chargers"]);
    expect(chooseCityTrendTopic([c("Maui Bus Chargers ", "google-news")], used)).toBeNull();
  });

  it("returns null when every term was used (job skips the week)", () => {
    const used = new Set(["a", "b"]);
    expect(chooseCityTrendTopic([c("a", "google-news"), c("b", "firecrawl-search")], used)).toBeNull();
  });

  it("skips national Google Trends terms even when they score highest", () => {
    const candidates = [c("casper ruud", "google-trends", 5), c("Kahului harbor grant", "google-news", 1)];
    expect(chooseCityTrendTopic(candidates, new Set())?.term).toBe("Kahului harbor grant");
  });

  it("returns null for the 2026-11-04 prod rows (all national terms)", () => {
    const prodRow = ["casper ruud", "leylah fernandez", "nfc south"].map((t) => c(t, "google-trends", 0.6));
    expect(chooseCityTrendTopic(prodRow, new Set())).toBeNull();
  });

  it("weights by score x partner mention weight, ties keep the first", () => {
    const candidates = [
      c("first", "google-news", 1, 0.5),
      c("second", "google-news", 1, 1),
      c("third", "google-news", 2, 0.5),
    ];
    expect(chooseCityTrendTopic(candidates, new Set())?.term).toBe("second");
  });
});

describe("content:city-trends:blog job", () => {
  it("is drafts-only: posts wait in Content Review, nothing auto-publishes", () => {
    const job = JOB_DEFS.find((j) => j.name === "content:city-trends:blog");
    expect(job?.autoPublish).toBe(false);
  });
});

describe("city-trends prompt round trip", () => {
  it("reads the term back from the stored prompt", () => {
    expect(cityTrendTermFromPrompt(cityTrendPrompt("Kahului Harbor Grant", "Kahului, Hawaii"))).toBe(
      "kahului harbor grant",
    );
  });

  it("reads prompts stored by the old picker (prod text)", () => {
    const stored =
      'Write a blog post about "casper ruud" relevant to local businesses and residents in Southern Oregon. Focus on practical local relevance, community impact, and how small businesses can leverage this trend.';
    expect(cityTrendTermFromPrompt(stored)).toBe("casper ruud");
  });

  it("ignores other topics", () => {
    expect(cityTrendTermFromPrompt("Why AEO outperforms SEO in 2026")).toBeNull();
  });
});

describe("parseGoogleNewsRss", () => {
  it("extracts headlines, strips the publisher and decodes entities", () => {
    const xml = `<rss><channel><title>"Ashland" Oregon - Google News</title>
      <item><title>Ashland wants residents to flag transportation problems - Jefferson Public Radio</title><link>x</link></item>
      <item><title><![CDATA[Election 2026: Q&amp;A grid - Ashland News]]></title></item>
      <item><title>Rain, roller skating &amp; a witches&#39; dance - Ashland.news</title></item>
    </channel></rss>`;
    expect(parseGoogleNewsRss(xml)).toEqual([
      "Ashland wants residents to flag transportation problems",
      "Election 2026: Q&A grid",
      "Rain, roller skating & a witches' dance",
    ]);
  });

  it("returns nothing for an empty feed", () => {
    expect(parseGoogleNewsRss("<rss><channel></channel></rss>")).toEqual([]);
  });
});
