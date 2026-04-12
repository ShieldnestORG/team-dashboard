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

  const systemPrompt = `You are a professional YouTube scriptwriter for the channel Tokns.fi. You specialize in website walkthrough and review videos. Your narration describes what viewers see on screen as you walk through a website section by section. Be specific about UI elements, features, and design choices you observe. The tone is confident, engaging, and analytical — like a tech reviewer showing off a new platform. The current year is ${year}. Always output valid JSON.`;

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
      finalThought: `Head over to ${walkResult.url} to explore it yourself!`,
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
