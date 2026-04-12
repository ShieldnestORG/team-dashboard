/**
 * YouTube Pipeline — Walkthrough Script Writer
 *
 * Generates a narrated walkthrough ScriptData from extracted site sections.
 * Uses Ollama for AI-powered narration, with template fallback.
 * Output maps 1:1 to site-walker screenshots for video assembly.
 */

import { callOllamaChat } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";
import type { ScriptData, ScriptSection } from "./script-writer.js";
import { applyPronunciationFixes } from "./script-writer.js";
import type { SiteWalkResult } from "./site-walker.js";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function generateWalkthroughScript(walkResult: SiteWalkResult): Promise<ScriptData> {
  let script: ScriptData;

  try {
    script = await generateWithOllama(walkResult);
  } catch (err) {
    logger.warn({ err }, "Ollama walkthrough script failed, using template fallback");
    script = generateFromTemplate(walkResult);
  }

  // Sanitize all narration text for TTS before anything else
  sanitizeScriptForTTS(script);

  // Build full script text
  script.fullScript = formatFullWalkthroughScript(script);
  logger.info({ title: script.title, sections: script.mainContent.sections.length }, "Walkthrough script generated");
  return script;
}

// ---------------------------------------------------------------------------
// AI-powered generation via Ollama
// ---------------------------------------------------------------------------

async function generateWithOllama(walkResult: SiteWalkResult): Promise<ScriptData> {
  const hostname = extractHostname(walkResult.url);
  const year = new Date().getFullYear();

  const systemPrompt = `You are a professional YouTube scriptwriter for the channel Tokns.fi. You specialize in website walkthrough and review videos. Your narration describes what viewers see on screen as you walk through a website section by section. Be specific about UI elements, features, and design choices you observe. The tone is confident, engaging, and analytical — like a tech reviewer showing off a new platform. The current year is ${year}. Always output valid JSON.

CRITICAL TTS RULES — the script will be read aloud by a text-to-speech engine:
- NEVER include URLs, links, or web addresses in the narration text. Say the site name conversationally instead (e.g. "toe-kins dot fye" not "tokns.fi", "their website" not "https://tokns.fi")
- NEVER use abbreviations, acronyms, or symbols. Spell everything out (e.g. "N-F-T" not "NFT", "dollars" not "$", "percent" not "%", "and" not "&")
- Write in simple, natural spoken English. Use short sentences (under 20 words each)
- Avoid technical jargon, code snippets, or anything that sounds unnatural when spoken aloud
- Do NOT include markdown, bullet points, or formatting markers in the narration
- Numbers should be written as words (e.g. "over five hundred" not "500+")
- Each content line should be one complete spoken thought, 8-15 words long`;

  const sectionDescriptions = walkResult.sections
    .map(
      (s, i) =>
        `Section ${i + 1} — "${s.heading}"\nExtracted text: ${s.textContent.slice(0, 500)}`,
    )
    .join("\n\n");

  const userPrompt = `Write a website walkthrough video script for ${hostname} (${walkResult.url}).

Page title: "${walkResult.pageTitle}"
Meta description: "${walkResult.metaDescription}"

The video has exactly ${walkResult.sections.length} screenshot sections. You must write exactly ${walkResult.sections.length} mainContent sections, one per screenshot. Here are the sections:

${sectionDescriptions}

Return a JSON object with this structure:
{
  "title": "compelling video title about ${hostname} walkthrough",
  "hook": { "type": "question", "text": "opening 5-second hook about this website", "duration": "0:00-0:05" },
  "introduction": { "greeting": "opening greeting", "topicIntro": "what site we're looking at", "valueProposition": "what viewers will learn", "credibility": "why this matters", "duration": "0:05-0:15" },
  "mainContent": {
    "sections": [
      { "type": "walkthrough", "title": "section heading", "content": ["narration line 1", "narration line 2", "narration line 3"], "duration": 45 }
    ],
    "totalDuration": 300
  },
  "conclusion": { "type": "conclusion", "title": "Final Verdict", "recap": ["takeaway1", "takeaway2", "takeaway3"], "finalThought": "closing thought", "duration": "20 seconds" },
  "callToAction": { "type": "call_to_action", "subscribe": "subscribe prompt", "like": "like prompt", "comment": "what do you think of ${hostname}?", "nextVideo": "next video tease", "duration": "10 seconds" },
  "tone": "analytical",
  "pacing": "detailed",
  "keywords": ["${hostname}", "website review", "walkthrough"]
}

IMPORTANT: mainContent.sections must have EXACTLY ${walkResult.sections.length} entries. Each section narrates what the viewer sees in the corresponding screenshot. Reference specific features, design elements, and text visible on screen.`;

  const result = await callOllamaChat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    { temperature: 0.8, maxTokens: 8192, timeoutMs: 600_000 },
  );

  // Extract JSON
  let rawText = result.content;
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    rawText = rawText.slice(jsonStart, jsonEnd + 1);
  }

  const parsed = JSON.parse(rawText) as ScriptData;

  // Ensure section count matches screenshots
  const expected = walkResult.sections.length;
  while (parsed.mainContent.sections.length < expected) {
    const idx = parsed.mainContent.sections.length;
    const section = walkResult.sections[idx];
    parsed.mainContent.sections.push({
      type: "walkthrough",
      title: section.heading,
      content: [`Let's take a look at the ${section.heading.toLowerCase()} section.`, section.textContent.slice(0, 150)],
      duration: 40,
    });
  }
  parsed.mainContent.sections = parsed.mainContent.sections.slice(0, expected);

  // Calculate totals
  parsed.mainContent.totalDuration = parsed.mainContent.sections.reduce((t, s) => t + (s.duration || 45), 0);
  parsed.duration = estimateWalkthroughDuration(parsed);
  parsed.fullScript = "";

  return parsed;
}

// ---------------------------------------------------------------------------
// Template fallback (no AI needed)
// ---------------------------------------------------------------------------

function generateFromTemplate(walkResult: SiteWalkResult): ScriptData {
  const hostname = extractHostname(walkResult.url);

  const sections: ScriptSection[] = walkResult.sections.map((s, i) => {
    const content: string[] = [];
    if (i === 0) {
      content.push(`Alright, here we are on ${hostname}. Let's start at the top.`);
    } else {
      content.push(`Moving on, let's look at the ${s.heading.toLowerCase()} section.`);
    }

    // Summarize extracted text into narration
    const words = s.textContent.split(/\s+/).filter(Boolean);
    if (words.length > 10) {
      content.push(`Here we can see ${s.heading.toLowerCase()} — ${words.slice(0, 20).join(" ")}...`);
    }
    content.push(`This is a ${i === 0 ? "great first impression" : "solid section"} that shows what ${hostname} has to offer.`);

    return {
      type: "walkthrough",
      title: s.heading,
      content,
      duration: 40,
    };
  });

  const totalDuration = sections.reduce((t, s) => t + s.duration, 0);

  const script: ScriptData = {
    title: `Inside ${hostname} — Complete Website Walkthrough & Review`,
    hook: {
      type: "question",
      text: `Have you ever wondered what ${hostname} actually offers? Today we're going to walk through the entire site.`,
      duration: "0:00-0:05",
    },
    introduction: {
      greeting: "Hey everyone, welcome back to the channel!",
      topicIntro: `Today we're doing a complete walkthrough of ${hostname}.`,
      valueProposition: `By the end of this video, you'll know exactly what ${hostname} offers and whether it's worth your time.`,
      credibility: "Let's dive right in and see what we find.",
      duration: "0:05-0:15",
    },
    mainContent: {
      sections,
      totalDuration,
    },
    conclusion: {
      type: "conclusion",
      title: "Final Verdict",
      recap: [
        `So that's ${hostname} — we walked through every major section.`,
        `The site ${walkResult.sections.length > 5 ? "has a lot to offer" : "keeps things focused and clean"}.`,
        `Overall, it's worth checking out if you're interested in what they do.`,
      ],
      finalThought: `Head over to ${hostname} to explore it yourself!`,
      duration: "20 seconds",
    },
    callToAction: {
      type: "call_to_action",
      subscribe: "If you found this walkthrough helpful, make sure to subscribe!",
      like: "Give this video a thumbs up if you want more site reviews.",
      comment: `Let me know in the comments — have you used ${hostname} before?`,
      nextVideo: "Check out our other website walkthroughs for more.",
      duration: "10 seconds",
    },
    tone: "analytical",
    pacing: "detailed",
    keywords: [hostname, "website review", "walkthrough", "site review"],
    duration: estimateWalkthroughDuration({ mainContent: { sections, totalDuration } } as ScriptData),
    fullScript: "",
  };

  return script;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// TTS sanitizer — clean up all narration text so Chatterbox doesn't gibberish
// ---------------------------------------------------------------------------

function sanitizeTextForTTS(text: string): string {
  let t = text;

  // Strip URLs entirely — replace with "their website" or just remove
  t = t.replace(/https?:\/\/[^\s)]+/g, "their website");

  // Strip markdown formatting
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");  // bold
  t = t.replace(/\*([^*]+)\*/g, "$1");       // italic
  t = t.replace(/`([^`]+)`/g, "$1");         // inline code
  t = t.replace(/^[-*•]\s+/gm, "");          // bullet points
  t = t.replace(/^#+\s+/gm, "");             // heading markers

  // Expand common symbols
  t = t.replace(/&/g, " and ");
  t = t.replace(/%/g, " percent");
  t = t.replace(/\$/g, " dollars ");
  t = t.replace(/\+/g, " plus ");
  t = t.replace(/@/g, " at ");
  t = t.replace(/#(\w)/g, "number $1");
  t = t.replace(/\//g, " ");

  // Expand common abbreviations
  t = t.replace(/\bNFTs?\b/g, "N-F-T");
  t = t.replace(/\bDeFi\b/gi, "de-fi");
  t = t.replace(/\bDAOs?\b/g, (m) => m.endsWith("s") ? "dow-z" : "dow");
  t = t.replace(/\bAPR\b/g, "A-P-R");
  t = t.replace(/\bAPY\b/g, "A-P-Y");
  t = t.replace(/\bAPI\b/g, "A-P-I");
  t = t.replace(/\bUI\b/g, "U-I");
  t = t.replace(/\bUX\b/g, "U-X");
  t = t.replace(/\bAI\b/g, "A-I");
  t = t.replace(/\bETH\b/g, "E-T-H");
  t = t.replace(/\bBTC\b/g, "B-T-C");

  // Numbers: simple conversions for common patterns
  t = t.replace(/(\d+)\+/g, "over $1");
  t = t.replace(/\b(\d{1,3}),(\d{3})\b/g, "$1$2"); // strip commas in numbers

  // Clean up domain-like patterns (e.g. "app.tokns.fi")
  t = t.replace(/\b(\w+)\.(\w+)\.(\w+)\b/g, "$1 dot $2 dot $3");
  t = t.replace(/\b(\w+)\.(\w{2,6})\b/g, (match, name, tld) => {
    // Don't break normal sentences ending with period
    if (["com", "io", "fi", "org", "net", "co", "app", "dev", "xyz"].includes(tld.toLowerCase())) {
      return `${name} dot ${tld}`;
    }
    return match;
  });

  // Remove non-speakable characters
  t = t.replace(/[{}[\]<>|\\^~`]/g, "");
  t = t.replace(/[""]/g, '"');
  t = t.replace(/['']/g, "'");
  t = t.replace(/—/g, ", ");
  t = t.replace(/–/g, ", ");
  t = t.replace(/\.\.\./g, ". ");

  // Collapse excessive whitespace
  t = t.replace(/\s+/g, " ").trim();

  // Break up very long sentences (over 30 words) with natural pauses
  const sentences = t.split(/(?<=[.!?])\s+/);
  const cleaned = sentences.map((s) => {
    const words = s.split(/\s+/);
    if (words.length > 30) {
      // Insert a pause/period after ~15 words at a natural break
      const midpoint = Math.min(15, Math.floor(words.length / 2));
      // Find a comma or conjunction near midpoint
      for (let i = midpoint - 3; i <= midpoint + 3 && i < words.length; i++) {
        if (words[i].endsWith(",") || ["and", "but", "or", "which", "that", "where"].includes(words[i].toLowerCase())) {
          words[i] = words[i].replace(/,$/, ".") || words[i] + ".";
          break;
        }
      }
    }
    return words.join(" ");
  });
  t = cleaned.join(" ");

  return t;
}

/**
 * Sanitize all narration fields in a ScriptData for TTS.
 * Mutates the script in-place.
 */
function sanitizeScriptForTTS(script: ScriptData): void {
  if (script.hook) script.hook.text = sanitizeTextForTTS(script.hook.text);
  if (script.introduction) {
    script.introduction.greeting = sanitizeTextForTTS(script.introduction.greeting);
    script.introduction.topicIntro = sanitizeTextForTTS(script.introduction.topicIntro);
    script.introduction.valueProposition = sanitizeTextForTTS(script.introduction.valueProposition);
    script.introduction.credibility = sanitizeTextForTTS(script.introduction.credibility);
  }
  if (script.mainContent?.sections) {
    for (const section of script.mainContent.sections) {
      section.title = sanitizeTextForTTS(section.title);
      if (Array.isArray(section.content)) {
        section.content = section.content.map(sanitizeTextForTTS);
      }
    }
  }
  if (script.conclusion) {
    script.conclusion.recap = script.conclusion.recap.map(sanitizeTextForTTS);
    script.conclusion.finalThought = sanitizeTextForTTS(script.conclusion.finalThought);
  }
  if (script.callToAction) {
    script.callToAction.subscribe = sanitizeTextForTTS(script.callToAction.subscribe);
    script.callToAction.like = sanitizeTextForTTS(script.callToAction.like);
    script.callToAction.comment = sanitizeTextForTTS(script.callToAction.comment);
    script.callToAction.nextVideo = sanitizeTextForTTS(script.callToAction.nextVideo);
  }
}

function estimateWalkthroughDuration(script: ScriptData): string {
  const sectionTime = script.mainContent.sections.reduce((t, s) => t + (s.duration || 45), 0);
  const total = Math.min(sectionTime + 45, 600); // hook+intro+conclusion+cta overhead
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

function formatFullWalkthroughScript(script: ScriptData): string {
  let out = `TITLE: ${script.title}\n\n${"═".repeat(50)}\n\n`;
  out += `[${script.hook.duration}] HOOK\n${script.hook.text}\n\n`;
  out += `[${script.introduction.duration}] INTRODUCTION\n`;
  out += `${script.introduction.greeting}\n${script.introduction.topicIntro}\n`;
  out += `${script.introduction.valueProposition}\n${script.introduction.credibility}\n\n`;
  out += `WALKTHROUGH\n${"─".repeat(30)}\n\n`;
  for (const section of script.mainContent.sections) {
    const dur = section.duration || 45;
    out += `[${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, "0")}] ${section.title.toUpperCase()}\n`;
    if (Array.isArray(section.content)) {
      for (const line of section.content) out += `${line}\n`;
    }
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
