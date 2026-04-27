/**
 * YouTube Pipeline — Script Writer service
 *
 * Generates structured YouTube scripts using Ollama.
 * Ported from agents/script-writer-agent.js — replaces Anthropic/Grok with Ollama.
 */

import { callOllamaChat } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";
import type { ContentStrategy } from "./content-strategy.js";

// ---------------------------------------------------------------------------
// Script structure types
// ---------------------------------------------------------------------------

export interface ScriptHook {
  type: string;
  text: string;
  duration: string;
}

export interface ScriptSection {
  type: string;
  title: string;
  content: string[];
  visuals?: string[];
  duration: number;
}

export interface ScriptData {
  title: string;
  hook: ScriptHook;
  introduction: {
    greeting: string;
    topicIntro: string;
    valueProposition: string;
    credibility: string;
    duration: string;
  };
  mainContent: {
    sections: ScriptSection[];
    totalDuration: number;
  };
  conclusion: {
    type: string;
    title: string;
    recap: string[];
    finalThought: string;
    duration: string;
  };
  callToAction: {
    type: string;
    subscribe: string;
    like: string;
    comment: string;
    nextVideo: string;
    duration: string;
  };
  tone: string;
  pacing: string;
  keywords: string[];
  duration: string;
  fullScript: string;
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, { tone: string; pacing: string }> = {
  tutorial: { tone: "educational", pacing: "moderate" },
  explainer: { tone: "informative", pacing: "steady" },
  list: { tone: "engaging", pacing: "quick" },
  review: { tone: "analytical", pacing: "detailed" },
  story: { tone: "narrative", pacing: "dynamic" },
};

// ---------------------------------------------------------------------------
// Pronunciation fixes for TTS
// ---------------------------------------------------------------------------

export function applyPronunciationFixes(text: string): string {
  const fixes: Record<string, string> = {
    "tokns.fi": "toe-kins dot fye",
    "Tokns.fi": "Toe-kins dot fye",
    "TOKNS.FI": "TOE-KINS DOT FYE",
    "coherencedaddy.com": "coherence daddy dot com",
    "HODL": "hoddle",
    "hodl": "hoddle",
    "altcoins": "alt coins",
    "stablecoin": "stable coin",
    "stablecoins": "stable coins",
  };
  for (const [word, replacement] of Object.entries(fixes)) {
    text = text.split(word).join(replacement);
  }
  // Regex-based fixes
  text = text.replace(/\bDeFi\b/g, "de-fi");
  text = text.replace(/\bdefi\b/gi, "de-fi");
  text = text.replace(/\btxecosystem\b/gi, "T-X ecosystem");
  text = text.replace(/\bTX ecosystem\b/g, "T-X ecosystem");
  text = text.replace(/\bTX Ecosystem\b/g, "T-X Ecosystem");
  text = text.replace(/\bTX blockchain\b/gi, "T-X blockchain");
  text = text.replace(/\bNFTs\b/g, "N-F-Tees");
  text = text.replace(/\bNFT\b/g, "N-F-T");
  text = text.replace(/\bDAOs\b/g, "dow-z");
  text = text.replace(/\bDAO\b/g, "dow");
  return text;
}

// ---------------------------------------------------------------------------
// Format script for TTS (plain text)
// ---------------------------------------------------------------------------

/**
 * Extract plain narration text from script (no pronunciation mangling).
 * Used for captions / display text.
 */
export function formatScriptPlainText(script: ScriptData): string {
  let text = "";
  if (script.hook) text += `${script.hook.text}\n\n`;
  if (script.introduction) {
    text += `${script.introduction.greeting}\n`;
    text += `${script.introduction.topicIntro}\n`;
    text += `${script.introduction.valueProposition}\n`;
    text += `${script.introduction.credibility}\n\n`;
  }
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections) {
      text += `${section.title}.\n`;
      if (Array.isArray(section.content)) {
        for (const line of section.content) {
          if (typeof line === "string" && !line.startsWith("[")) {
            text += `${line}\n`;
          }
        }
      }
      text += "\n";
    }
  }
  if (script.conclusion) {
    for (const line of script.conclusion.recap) {
      text += `${line}\n`;
    }
    text += `\n${script.conclusion.finalThought}\n\n`;
  }
  if (script.callToAction) {
    text += `${script.callToAction.subscribe}\n`;
    text += `${script.callToAction.like}\n`;
    text += `${script.callToAction.comment}\n`;
  }
  return text;
}

/**
 * Format script for TTS — applies pronunciation fixes for the voice engine.
 * Do NOT use this for captions/display — use formatScriptPlainText() instead.
 */
export function formatScriptForTTS(script: ScriptData): string {
  return applyPronunciationFixes(formatScriptPlainText(script));
}

// ---------------------------------------------------------------------------
// AI script generation via Ollama
// ---------------------------------------------------------------------------

export async function generateScript(strategy: ContentStrategy): Promise<ScriptData> {
  const template = TEMPLATES[strategy.contentType.toLowerCase()] || TEMPLATES.explainer;
  let script: ScriptData;

  try {
    script = await generateScriptWithOllama(strategy, template);
  } catch (err) {
    logger.warn({ err }, "Ollama script generation failed, using template fallback");
    script = generateScriptFromTemplate(strategy, template);
  }

  script.fullScript = formatFullScript(script);
  logger.info({ title: script.title }, "YouTube script generated");
  return script;
}

async function generateScriptWithOllama(
  strategy: ContentStrategy,
  template: { tone: string; pacing: string },
): Promise<ScriptData> {
  const year = new Date().getFullYear();

  const systemPrompt = `You are a professional YouTube scriptwriter for the channel Tokns.fi — a crypto, motivation, and blockchain education channel. The channel covers Bitcoin, altcoins, and the TX blockchain ecosystem (social handle: @txecosystem). Related sites: tokns.fi and coherencedaddy.com.

CRITICAL — AUDIO-ONLY NARRATION:
This script is rendered as voiceover over text-and-bullet slides. There are NO charts, NO candlesticks, NO diagrams, NO photos, NO arrows pointing at things on screen. Write narration that lands as audio alone. Do NOT use phrases like:
- "as you can see", "notice this", "look at this", "see the chart", "here is the diagram"
- "this image shows", "in this graphic", "the picture above/below", "watch the line move"
- "point to", "highlighted in red", "the green candle", references to specific colors/shapes/positions on screen

Instead, describe ideas in words: "A breakout candle is one where..." rather than "Notice the breakout candle here." If a concept needs a visual to land, EXPLAIN it in words rather than referring to a missing image. Write so a listener with eyes closed gets 100% of the value.

CONVENTIONS: Always write "TX ecosystem" as two separate words. Always write "DeFi" to be pronounced "de-fi". Tone: confident, energetic, approachable. Occasionally reference tokns.fi or coherencedaddy.com naturally. Always output valid JSON. The current year is ${year}. Always use ${year} when referencing the current year.`;

  const userPrompt = `Write a complete YouTube video script for the following:

Topic: ${strategy.topic}
Angle: ${strategy.angle}
Content Type: ${strategy.contentType}
Target Audience: ${strategy.targetAudience}
Tone: ${template.tone}
Keywords to include: ${strategy.keywords.join(", ")}

Return a JSON object with this structure:
{
  "title": "compelling video title",
  "hook": { "type": "question|statistic|statement", "text": "first 5 seconds", "duration": "0:00-0:05" },
  "introduction": { "greeting": "opening", "topicIntro": "intro", "valueProposition": "value", "credibility": "credibility", "duration": "0:05-0:20" },
  "mainContent": {
    "sections": [{ "type": "section_type", "title": "Title", "content": ["line1", "line2"], "visuals": ["visual"], "duration": 60 }],
    "totalDuration": 300
  },
  "conclusion": { "type": "conclusion", "title": "Wrapping Up", "recap": ["point1", "point2"], "finalThought": "closing", "duration": "30 seconds" },
  "callToAction": { "type": "call_to_action", "subscribe": "sub prompt", "like": "like prompt", "comment": "comment prompt", "nextVideo": "tease", "duration": "15 seconds" },
  "tone": "${template.tone}",
  "pacing": "${template.pacing}",
  "keywords": ${JSON.stringify(strategy.keywords)}
}

Write 3-4 main content sections. Total video length should be 4-5 minutes.`;

  const result = await callOllamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.8, maxTokens: 8192, timeoutMs: 600_000 },
  );

  // Extract JSON from response
  let rawText = result.content;
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    rawText = rawText.slice(jsonStart, jsonEnd + 1);
  }

  const parsed = JSON.parse(rawText);
  return {
    ...parsed,
    duration: estimateDuration(parsed.mainContent),
    fullScript: "",
  };
}

// ---------------------------------------------------------------------------
// Template-based fallback
// ---------------------------------------------------------------------------

function generateScriptFromTemplate(
  strategy: ContentStrategy,
  template: { tone: string; pacing: string },
): ScriptData {
  return {
    title: `${strategy.angle}`,
    hook: {
      type: "statement",
      text: `${strategy.topic} is about to change everything, and here's why...`,
      duration: "0:00-0:05",
    },
    introduction: {
      greeting: "Hey everyone, welcome back to the channel!",
      topicIntro: `Today, we're diving deep into ${strategy.topic}.`,
      valueProposition: `By the end of this video, you'll understand everything about ${strategy.topic}.`,
      credibility: "Based on the latest research and data",
      duration: "0:05-0:20",
    },
    mainContent: {
      sections: [
        {
          type: "explanation",
          title: "What You Need to Know",
          content: [
            `Let's break down ${strategy.topic} into its core components.`,
            "First, we need to understand the fundamental principles.",
            `This is why ${strategy.topic} works so effectively.`,
          ],
          visuals: ["Diagrams", "Infographics"],
          duration: 90,
        },
        {
          type: "examples",
          title: "Real-World Applications",
          content: [
            `Let's look at some real examples of ${strategy.topic} in action.`,
            "Example 1: A practical case study",
            "Example 2: How this is being used today",
          ],
          visuals: ["Case study graphics"],
          duration: 90,
        },
        {
          type: "implications",
          title: "What This Means for You",
          content: [
            `The implications of ${strategy.topic} are far-reaching.`,
            "Early adopters will have a significant advantage.",
            "The potential for growth is enormous.",
          ],
          duration: 60,
        },
      ],
      totalDuration: 240,
    },
    conclusion: {
      type: "conclusion",
      title: "Wrapping Up",
      recap: [
        `So that's everything you need to know about ${strategy.topic}.`,
        "We covered the fundamentals and practical applications.",
        "Now you have the knowledge to take action.",
      ],
      finalThought: `Remember, ${strategy.topic} is a journey, not a destination. Keep learning!`,
      duration: "30 seconds",
    },
    callToAction: {
      type: "call_to_action",
      subscribe: "If you found this helpful, make sure to subscribe and hit the notification bell!",
      like: "Give this video a thumbs up if you learned something new.",
      comment: `Let me know in the comments: What's your experience with ${strategy.topic}?`,
      nextVideo: "Check out this related video for more insights.",
      duration: "15 seconds",
    },
    tone: template.tone,
    pacing: template.pacing,
    keywords: strategy.keywords,
    duration: "4:00",
    fullScript: "",
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function estimateDuration(mainContent: { sections: ScriptSection[] }): string {
  const totalSeconds = mainContent.sections.reduce((total, s) => total + (s.duration || 60), 0);
  const full = Math.min(totalSeconds + 65, 300); // hook+intro+conclusion+cta
  const minutes = Math.floor(full / 60);
  const secs = full % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatFullScript(script: ScriptData): string {
  let out = `TITLE: ${script.title}\n\n${"═".repeat(50)}\n\n`;
  out += `[${script.hook.duration}] HOOK\n${script.hook.text}\n\n`;
  out += `[${script.introduction.duration}] INTRODUCTION\n`;
  out += `${script.introduction.greeting}\n${script.introduction.topicIntro}\n`;
  out += `${script.introduction.valueProposition}\n${script.introduction.credibility}\n\n`;
  out += `MAIN CONTENT\n${"─".repeat(30)}\n\n`;
  for (const section of script.mainContent.sections) {
    out += `[${Math.floor(section.duration / 60)}:${(section.duration % 60).toString().padStart(2, "0")}] ${section.title.toUpperCase()}\n`;
    if (Array.isArray(section.content)) {
      for (const line of section.content) out += `${line}\n`;
    }
    if (section.visuals) out += `\n[VISUALS: ${section.visuals.join(", ")}]\n`;
    out += "\n";
  }
  out += `[${script.conclusion.duration}] CONCLUSION\n`;
  for (const line of script.conclusion.recap) out += `${line}\n`;
  out += `\n${script.conclusion.finalThought}\n\n`;
  out += `[${script.callToAction.duration}] CALL TO ACTION\n`;
  out += `${script.callToAction.subscribe}\n${script.callToAction.like}\n`;
  out += `${script.callToAction.comment}\n${script.callToAction.nextVideo}\n\n`;
  out += `${"═".repeat(50)}\nDURATION: ${script.duration}\nTONE: ${script.tone}\nPACING: ${script.pacing}\n`;
  out += `KEYWORDS: ${script.keywords.join(", ")}\n`;
  return out;
}
