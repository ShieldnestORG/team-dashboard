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
import type { ScriptData } from "./script-writer.js";

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
// Title optimization
// ---------------------------------------------------------------------------

function optimizeTitle(originalTitle: string, strategy: ContentStrategy): string {
  let title = originalTitle;
  const powerWords = ["Ultimate", "Complete", "Essential", "Proven", "Secret", "Amazing", "Powerful"];
  const hasPowerWord = powerWords.some((w) => title.toLowerCase().includes(w.toLowerCase()));

  if (!hasPowerWord && title.length < 60) {
    const pw = powerWords[Math.floor(Math.random() * powerWords.length)];
    title = `${pw} ${title}`;
  }

  const year = new Date().getFullYear().toString();
  if (!title.includes(year) && title.length < 70) {
    title = `${title} (${year})`;
  }

  const pk = strategy.keywords[0];
  if (pk && !title.toLowerCase().includes(pk.toLowerCase())) {
    title = `${title} - ${pk}`;
  }

  if (title.length > 100) title = title.substring(0, 97) + "...";
  return titleCase(title);
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

function generateDescription(script: ScriptData, strategy: ContentStrategy): string {
  let desc = `${script.title} - In this video, you'll discover ${strategy.angle.toLowerCase()}.\n\n`;

  desc += "WHAT YOU'LL LEARN:\n";
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections.slice(0, 5)) {
      if (section.title) desc += `- ${section.title}\n`;
    }
  }
  desc += "\n";

  // Timestamps
  desc += "TIMESTAMPS:\n00:00 Introduction\n";
  let ts = 20;
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections) {
      const m = Math.floor(ts / 60).toString().padStart(2, "0");
      const s = (ts % 60).toString().padStart(2, "0");
      desc += `${m}:${s} ${section.title || "Section"}\n`;
      ts += section.duration || 60;
    }
  }
  desc += "\n";

  desc += "ABOUT THIS VIDEO:\n";
  desc += `This comprehensive guide on ${strategy.topic} covers everything you need to know. `;
  desc += `Whether you're a beginner or advanced, you'll find valuable insights about ${strategy.keywords.slice(0, 3).join(", ")}. `;
  desc += `Perfect for ${strategy.targetAudience}.\n\n`;

  desc += "LINKS:\n";
  desc += "- tokns.fi\n- coherencedaddy.com\n\n";

  desc += "DISCLAIMER:\nThis video is for educational purposes only.\n\n";
  desc += `(c) ${new Date().getFullYear()} Tokns.fi. All Rights Reserved.\n`;

  return desc;
}

// ---------------------------------------------------------------------------
// Tag generation
// ---------------------------------------------------------------------------

function generateTags(script: ScriptData, strategy: ContentStrategy): string[] {
  const tags = new Set<string>();
  for (const kw of strategy.keywords) tags.add(kw);
  tags.add(strategy.topic.toLowerCase());
  tags.add(strategy.topic.toLowerCase().replace(/\s+/g, ""));

  const typeTagMap: Record<string, string[]> = {
    Tutorial: ["how to", "tutorial", "guide", "step by step"],
    Explainer: ["explained", "what is", "understanding"],
    Review: ["review", "comparison", "vs", "best"],
    List: ["top 10", "best", "list", "countdown"],
  };
  for (const t of typeTagMap[strategy.contentType] || []) tags.add(t);

  const year = new Date().getFullYear().toString();
  tags.add(year);
  tags.add(`${strategy.topic.toLowerCase()} ${year}`);

  // Niche-specific
  const topic = strategy.topic.toLowerCase();
  if (/crypto|bitcoin|blockchain|defi|altcoin/.test(topic)) {
    for (const t of ["crypto", "cryptocurrency", "blockchain", "bitcoin", "investing"]) tags.add(t);
  }
  if (/motivat|mindset|discipline|wealth/.test(topic)) {
    for (const t of ["motivation", "mindset", "self improvement", "success"]) tags.add(t);
  }
  tags.add("tokns.fi");
  tags.add("TX ecosystem");

  if (script.keywords) for (const kw of script.keywords) tags.add(kw);

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

  // Channel branding
  h.push("#toknsfi", "#coherencedaddy");

  // Dedupe and limit
  const unique = [...new Set(h)];
  return unique.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Chapters
// ---------------------------------------------------------------------------

function generateChapters(script: ScriptData): Array<{ time: string; title: string; seconds: number }> {
  const chapters: Array<{ time: string; title: string; seconds: number }> = [];
  chapters.push({ time: "00:00", title: "Introduction", seconds: 0 });
  let current = 20;
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections) {
      const m = Math.floor(current / 60).toString().padStart(2, "0");
      const s = (current % 60).toString().padStart(2, "0");
      chapters.push({ time: `${m}:${s}`, title: section.title || "Section", seconds: current });
      current += section.duration || 60;
    }
  }
  const cm = Math.floor(current / 60).toString().padStart(2, "0");
  const cs = (current % 60).toString().padStart(2, "0");
  chapters.push({ time: `${cm}:${cs}`, title: "Conclusion & Next Steps", seconds: current });
  return chapters;
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
): Promise<SeoData> {
  const title = optimizeTitle(script.title, strategy);
  const description = generateDescription(script, strategy);
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
