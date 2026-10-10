/**
 * YouTube Pipeline — SEO Optimizer service
 *
 * Title, description, tags, chapters, hashtags, scoring.
 * Uses Ollama for AI-enhanced optimization.
 */

import type { Db } from "@paperclipai/db";
import { ytSeoData } from "@paperclipai/db";
import { callOllamaChat } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";
import type { ContentStrategy } from "./content-strategy.js";
import { DISCLOSURE_LINE, needsDisclosure, needsNotAdvice } from "./script-writer.js";
import type { ScriptData } from "./script-writer.js";
import { getAeoCta } from "../aeo-cta.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SeoData {
  id?: string;
  title: string;
  description: string;
  tags: string[];
  hashtags: string[];
  chapters: Array<{ time: string; title: string; seconds: number }>;
  endScreen: Record<string, unknown>;
  seoScore: number;
  metadata: Record<string, unknown>;
  /** AEO funnel pinned comment text — post as first comment after upload */
  pinnedCommentText: string;
}

// ---------------------------------------------------------------------------
// Tag sanitization — YouTube compliance
// ---------------------------------------------------------------------------

export function sanitizeTags(rawTags: string[]): string[] {
  return rawTags
    .map((t) =>
      t
        .replace(/[_]/g, " ")
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase(),
    )
    .filter((t) => {
      if (t.length < 2 || t.length > 100) return false;
      if (!/[a-zA-Z]/.test(t)) return false;
      if (!/\s/.test(t) && t.length > 25) return false;
      return true;
    })
    .filter((t, i, arr) => arr.indexOf(t) === i) // dedupe
    .slice(0, 30);
}

// ---------------------------------------------------------------------------
// Duration / time helpers
// ---------------------------------------------------------------------------

export function parseDurationSec(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string") {
    const trimmed = v.trim();
    const secs = trimmed.match(/^(\d+)s?$/);
    if (secs) {
      const n = Number(secs[1]);
      if (n > 0) return n;
    }
    const mm = trimmed.match(/^(\d+):(\d{2})$/);
    if (mm) return Number(mm[1]) * 60 + Number(mm[2]);
  }
  return 60;
}

export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const m = Math.floor(s / 60).toString().padStart(2, "0");
  const r = (s % 60).toString().padStart(2, "0");
  return `${m}:${r}`;
}

// ---------------------------------------------------------------------------
// Title optimization
// ---------------------------------------------------------------------------

export function optimizeTitle(originalTitle: string, strategy: ContentStrategy): string {
  // Site-walker: walkthrough-specific title pattern
  if (strategy.pillar === "site-walker") {
    let hostname: string;
    try { hostname = new URL(strategy.topic).hostname.replace(/^www\./, ""); } catch { hostname = strategy.topic; }
    let title = originalTitle;
    if (!title.toLowerCase().includes("walkthrough") && !title.toLowerCase().includes("review")) {
      title = `Inside ${hostname} — Full Website Walkthrough & Review`;
    }
    const year = new Date().getFullYear().toString();
    if (!title.includes(year) && title.length < 70) title = `${title} (${year})`;
    if (title.length > 100) title = title.substring(0, 97) + "...";
    return titleCase(title);
  }

  // Script-v2: keep the script's honest title as written.
  let title = originalTitle.replace(/\s+/g, " ").trim();
  if (title.length <= 100) return title;
  const cut = title.slice(0, 99);
  const idx = cut.lastIndexOf(" ");
  const prefix = (idx >= 0 ? cut.slice(0, idx) : cut).trimEnd();
  return `${prefix}…`;
}

function titleCase(str: string): string {
  const small = new Set(["a", "an", "and", "as", "at", "but", "by", "for", "if", "in", "of", "on", "or", "the", "to", "via", "vs"]);
  return str
    .split(" ")
    .map((w, i) => {
      if (i === 0 || !small.has(w.toLowerCase())) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      }
      return w.toLowerCase();
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Description generation
// ---------------------------------------------------------------------------

export function generateDescription(script: ScriptData, strategy: ContentStrategy): string {
  // Site-walker: walkthrough-specific description
  if (strategy.pillar === "site-walker") {
    let hostname: string;
    try { hostname = new URL(strategy.topic).hostname.replace(/^www\./, ""); } catch { hostname = strategy.topic; }
    let desc = `${script.title} - A complete walkthrough and review of ${hostname}.\n\n`;
    desc += "IN THIS VIDEO:\n";
    if (script.mainContent?.sections) {
      for (const section of script.mainContent.sections.slice(0, 8)) {
        if (section.title) desc += `- ${section.title}\n`;
      }
    }
    desc += "\n";
    desc += "TIMESTAMPS:\n00:00 Introduction\n";
    let ts = 15;
    if (script.mainContent?.sections) {
      for (const section of script.mainContent.sections) {
        const m = Math.floor(ts / 60).toString().padStart(2, "0");
        const s = (ts % 60).toString().padStart(2, "0");
        desc += `${m}:${s} ${section.title || "Section"}\n`;
        ts += parseDurationSec(section.duration ?? 45);
      }
    }
    desc += "\n";
    desc += "ABOUT THIS VIDEO:\n";
    desc += `We walk through ${hostname} page by page, exploring its features, design, and what it offers. `;
    desc += `Perfect for anyone curious about ${hostname} or looking for honest website reviews.\n\n`;
    desc += "LINKS:\n";
    desc += `- ${strategy.topic}\n- tokns.fi\n- coherencedaddy.com\n- evntrace.com\n\n`;
    desc += "DISCLAIMER:\nThis video is for informational purposes only.\n\n";
    desc += `(c) ${new Date().getFullYear()} Coherence Daddy. All Rights Reserved.\n`;
    return desc;
  }

  let desc = `${script.title}\n`;
  if (typeof script.promise === "string" && script.promise.trim() !== "") {
    desc += `${script.promise.trim()}\n`;
  }
  desc += "\n";

  if (needsDisclosure(script)) {
    desc += `${DISCLOSURE_LINE}\n\n`;
  }

  desc += "WHAT YOU'LL LEARN:\n";
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections.slice(0, 5)) {
      if (section.title) desc += `- ${section.title}\n`;
    }
  }
  desc += "\n";

  // Timestamps
  desc += "TIMESTAMPS:\n";
  for (const c of generateChapters(script)) {
    desc += `${c.time} ${c.title}\n`;
  }
  desc += "\n";

  desc += "LINKS:\n";
  desc += "- tokns.fi\n- coherencedaddy.com\n- evntrace.com\n\n";

  desc += "DISCLAIMER:\n";
  desc += needsNotAdvice(script) ? "This is education, not financial advice.\n\n" : "This video is for educational purposes only.\n\n";
  desc += `(c) ${new Date().getFullYear()} Coherence Daddy. All Rights Reserved.\n`;

  return desc;
}

// ---------------------------------------------------------------------------
// Tag generation
// ---------------------------------------------------------------------------

const TAG_STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "doing", "for", "from", "has", "have", "how", "if", "in", "into", "is", "it",
  "its", "it's", "just", "means", "mean", "not", "of", "on", "or", "so", "than",
  "that", "the", "their", "them", "then", "there", "this", "to", "was", "what",
  "when", "where", "which", "who", "why", "will", "with", "you", "your",
  "actually", "really", "very", "about",
]);

export function generateTags(script: ScriptData, strategy: ContentStrategy): string[] {
  const tags = new Set<string>();
  for (const kw of strategy.keywords) {
    if (TAG_STOPWORDS.has(kw.toLowerCase()) || kw.length < 3) continue;
    tags.add(kw);
  }

  const topic = strategy.topic.toLowerCase();
  const topicWordCount = topic.trim().split(/\s+/).length;
  if (topicWordCount <= 5) {
    tags.add(topic);
    tags.add(topic.replace(/\s+/g, ""));
    tags.add(`${topic} ${new Date().getFullYear()}`);
  }

  const typeTagMap: Record<string, string[]> = {
    Tutorial: ["how to", "tutorial", "guide", "step by step"],
    Explainer: ["explained", "what is", "understanding"],
    Review: ["review", "comparison", "vs", "best"],
    List: ["top 10", "best", "list", "countdown"],
  };
  for (const t of typeTagMap[strategy.contentType] || []) tags.add(t);

  // Niche-specific
  if (strategy.pillar === "site-walker") {
    let hostname: string;
    try { hostname = new URL(strategy.topic).hostname.replace(/^www\./, ""); } catch { hostname = strategy.topic; }
    for (const t of ["website review", "website walkthrough", "site review", "web app review", hostname]) tags.add(t);
  }
  if (/crypto|bitcoin|blockchain|defi|altcoin/.test(topic)) {
    for (const t of ["crypto", "cryptocurrency", "blockchain", "bitcoin", "investing"]) tags.add(t);
  }
  if (/motivat|mindset|discipline|wealth/.test(topic)) {
    for (const t of ["motivation", "mindset", "self improvement", "success"]) tags.add(t);
  }

  tags.add("coherence daddy");
  if (needsDisclosure(script)) {
    tags.add("tokns");
    tags.add("TX ecosystem");
  }

  // a domain keyword ("tokns.fi") would be squashed to "toknsfi" by sanitizeTags: tag the name instead
  if (script.keywords) for (const kw of script.keywords) tags.add(kw.replace(/^([a-z0-9-]+)\.(fi|com|io|org|ai)$/i, "$1"));

  return Array.from(tags);
}

// ---------------------------------------------------------------------------
// Hashtags
// ---------------------------------------------------------------------------

function generateHashtags(strategy: ContentStrategy): string[] {
  const h: string[] = [];
  const topic = strategy.topic.toLowerCase();

  // Primary keyword hashtags from actual topic words
  for (const kw of strategy.keywords) {
    if (kw.length > 3) h.push(`#${kw.replace(/\s+/g, "")}`);
  }

  // Niche-specific hashtags based on content
  if (/crypto|bitcoin|btc/i.test(topic)) {
    h.push("#crypto", "#bitcoin", "#cryptoinvesting", "#btc");
  }
  if (/altcoin|defi|staking/i.test(topic)) {
    h.push("#altcoins", "#defi", "#cryptostaking");
  }
  if (/blockchain|tx.*ecosystem|tokns/i.test(topic)) {
    h.push("#blockchain", "#txecosystem", "#web3");
  }
  if (/portfolio|strategy|beginners|guide/i.test(topic)) {
    h.push("#cryptoportfolio", "#investingstrategy", "#cryptoforbeginners");
  }
  if (/price|prediction|bull|bear/i.test(topic)) {
    h.push("#cryptoprediction", "#priceanalysis", "#cryptotrading");
  }
  if (/motivat|mindset|discipline|wealth|freedom|success/i.test(topic)) {
    h.push("#motivation", "#mindsetshift", "#financialfreedom", "#wealthbuilding");
  }
  if (/procrastinat|morning|routine|habit/i.test(topic)) {
    h.push("#productivity", "#selfimprovement", "#dailyroutine");
  }
  if (/chart|technical|trading|read/i.test(topic)) {
    h.push("#technicalanalysis", "#cryptotrading", "#tradingforbeginners");
  }

  // Site-walker specific
  if (strategy.pillar === "site-walker") {
    h.push("#websitereview", "#walkthrough", "#sitereview", "#webreview", "#techreview");
  }

  // Channel branding
  h.push("#toknsfi", "#coherencedaddy");

  // Dedupe and limit
  const unique = [...new Set(h)];
  return unique.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

export function generateChapters(script: ScriptData): Array<{ time: string; title: string; seconds: number }> {
  const chapters: Array<{ time: string; title: string; seconds: number }> = [];
  chapters.push({ time: "00:00", title: "Introduction", seconds: 0 });
  let current = 20;
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections) {
      chapters.push({ time: fmtTime(current), title: section.title || "Section", seconds: current });
      current += parseDurationSec(section.duration);
    }
  }
  chapters.push({ time: fmtTime(current), title: "Conclusion & Next Steps", seconds: current });
  return chapters;
}

export function chaptersFromBeats(
  beats: Array<{ type: string; req?: { title?: string } }>,
  slideDurations: number[],
): Array<{ time: string; title: string; seconds: number }> {
  const candidates: Array<{ title: string; seconds: number }> = [{ title: "Introduction", seconds: 0 }];

  let start = 0;
  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i];
    if (beat.type === "section_title") {
      const title = beat.req?.title;
      if (typeof title === "string" && title.trim() !== "") {
        candidates.push({ title, seconds: Math.floor(start) });
      }
    } else if (beat.type === "conclusion") {
      candidates.push({ title: "Takeaways", seconds: Math.floor(start) });
    }
    start += slideDurations[i] || 0;
  }

  const kept: Array<{ time: string; title: string; seconds: number }> = [];
  for (const c of candidates) {
    const last = kept[kept.length - 1];
    if (last && c.seconds < last.seconds + 10) continue;
    kept.push({ time: fmtTime(c.seconds), title: c.title, seconds: c.seconds });
  }

  return kept.length < 3 ? [] : kept;
}

export function withChapters(
  description: string,
  chapters: Array<{ time: string; title: string }>,
): string {
  const marker = "TIMESTAMPS:\n";
  const i = description.indexOf(marker);
  if (i < 0) return description;

  const after = description.slice(i + marker.length);
  const end = after.indexOf("\n\n");
  const blockEnd = i + marker.length + (end < 0 ? after.length : end + "\n\n".length);

  if (chapters.length === 0) {
    return description.slice(0, i) + description.slice(blockEnd);
  }

  const lines = chapters.map((c) => `${c.time} ${c.title}\n`).join("");
  return description.slice(0, i) + marker + lines + "\n" + description.slice(blockEnd);
}

// ---------------------------------------------------------------------------
// SEO score
// ---------------------------------------------------------------------------

function calculateSEOScore(title: string, description: string, tags: string[]): number {
  let score = 0;
  if (title.length >= 60 && title.length <= 70) score += 10;
  else if (title.length >= 50 && title.length <= 100) score += 5;
  if (/\d/.test(title)) score += 5;
  if (title.includes(new Date().getFullYear().toString())) score += 5;
  if (["how", "what", "why", "best", "top"].some((w) => title.toLowerCase().includes(w))) score += 5;
  if (description.length >= 200) score += 10;
  if (description.length >= 500) score += 10;
  if (description.includes("TIMESTAMPS")) score += 5;
  if (tags.length >= 10) score += 10;
  if (tags.length >= 15) score += 5;
  if (tags.some((t) => t.split(" ").length > 2)) score += 5;
  if (new Set(tags).size === tags.length) score += 5;
  return Math.min(100, score);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function optimizeSEO(
  db: Db,
  script: ScriptData,
  strategy: ContentStrategy,
  brand?: string,
): Promise<SeoData> {
  const title = optimizeTitle(script.title, strategy);
  const baseDescription = generateDescription(script, strategy);
  const cta = getAeoCta(brand ?? 'cd');

  // Append the AEO CTA block before any trailing hashtag section
  const hashtagIndex = baseDescription.lastIndexOf('#');
  let description: string;
  if (hashtagIndex > 0 && hashtagIndex > baseDescription.length - 200) {
    // Insert CTA block before the hashtags section
    description = baseDescription.slice(0, hashtagIndex).trimEnd() + '\n\n' + cta.youtubeDescriptionBlock + '\n\n' + baseDescription.slice(hashtagIndex);
  } else {
    description = baseDescription.trimEnd() + '\n\n' + cta.youtubeDescriptionBlock;
  }

  const rawTags = generateTags(script, strategy);
  const tags = sanitizeTags(rawTags);
  const hashtags = generateHashtags(strategy);
  const chapters = generateChapters(script);
  const seoScore = calculateSEOScore(title, description, tags);

  const endScreen = {
    elements: [
      { type: "video", position: "left", title: "Recommended Video", duration: 20 },
      { type: "subscribe", position: "center-bottom", duration: 20 },
    ],
    startTime: -20,
    template: "standard",
  };

  const seoData: SeoData = {
    title,
    description,
    tags,
    hashtags,
    chapters,
    endScreen,
    seoScore,
    metadata: {
      primaryKeyword: strategy.keywords[0],
      secondaryKeywords: strategy.keywords.slice(1, 5),
      language: "en",
      category: 28, // Science & Technology
    },
    pinnedCommentText: cta.youtubePinnedComment,
  };

  // Save to database
  const [row] = await db
    .insert(ytSeoData)
    .values({
      companyId: COMPANY_ID,
      title: seoData.title,
      description: seoData.description,
      tags: seoData.tags,
      hashtags: seoData.hashtags,
      chapters: seoData.chapters,
      endScreen: seoData.endScreen,
      seoScore: seoData.seoScore,
      metadata: seoData.metadata,
    })
    .returning({ id: ytSeoData.id });

  seoData.id = row.id;
  logger.info({ title, seoScore, tagCount: tags.length }, "SEO optimization complete");
  return seoData;
}
