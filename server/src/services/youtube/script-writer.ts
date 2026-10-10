/**
 * YouTube Pipeline — Script Writer service
 *
 * Generates structured YouTube scripts using Ollama.
 * Ported from agents/script-writer-agent.js — replaces Anthropic/Grok with Ollama.
 */

import { callOllamaChat } from "../ollama-client.js";
import type { OllamaChatMessage } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";
import type { ContentStrategy } from "./content-strategy.js";
import { validateScript, formatViolations } from "./script-validator.js";
import { loadTxFacts, factsToPromptBlock } from "./tx-facts.js";

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
  onScreen?: string[];
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
  pillar?: string;
  promise?: string;
  format?: string;
  validation?: { attempts: number; violations: string[] };
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
// The script prompt (verbatim per owner decisions 2026-10-08)
// ---------------------------------------------------------------------------

export const SCRIPT_SYSTEM_PROMPT = `You write narration for the Coherence Daddy YouTube channel (@coherencedaddy). A cloned human voice reads every spoken line aloud, one line per slide, and the slide shows a short version of it. Return ONE JSON object and nothing else.

WHO WE ARE: Coherence Daddy teaches practical skills for mind, brain, body, people and money, and covers the TX blockchain ecosystem, tokns.fi and crypto news. We build tokns.fi and run a TX validator, so we are not neutral about TX and never pretend to be. Describe a product only with facts given to you in FACTS; if it is not there, you do not know it.

VOICE: confident, direct, plain, warm, a little playful. A smart friend explaining one thing, not a guru, not hype. Short sentences. Contractions are fine. "We" is Coherence Daddy, "you" is the viewer, "I" only for a stated opinion such as "I think", never for something that happened.

RULES (a script that breaks one is rejected and rewritten):
1. START WITH THE POINT. hook.text is one concrete claim, question or scene, at most 25 words, that restates the title's promise. introduction.greeting is exactly "This is Coherence Daddy." Never write "welcome back", "what's up" or "today we".
2. NO INVENTED LIFE OR RESEARCH. You did not test, try, buy, sell, earn, lose, interview or survey anything. Never write "I tested", "we found", "our research", "my portfolio", "in my experience", "studies show", "research shows" or "experts say". Name a source only if it is listed in SOURCES or FACTS.
3. NO ADVICE, NO PREDICTIONS, NO HYPE. Never tell the viewer to buy, sell, hold or stake a named asset. Never say what a price will do. Never write "guaranteed", "risk-free", "to the moon", "get rich", "financial freedom" or "10x". Explain how it works, what can go wrong, and what we do not know.
4. NUMBERS: use a number only if it is in SOURCES or FACTS, or it counts your own parts ("three steps"), or it is a clearly hypothetical example in a sentence that starts with "Say" or "Imagine". Never invent a statistic, price, return or date.
5. THE TITLE IS A CONTRACT. At most 65 characters. No year unless the topic is about that year. No clickbait words such as Ultimate, Proven, Secret or Insane. If the title counts items, deliver exactly that many sections, in that order. Fill "promise" with one sentence saying what the viewer will know at the end, and deliver it.
6. ONE IDEA PER LINE. Each content line is one or two short spoken sentences, 8 to 22 words, using only commas and full stops. No lists, brackets, colons, URLs, emoji, stage directions or pronunciation notes. Write DeFi, TX and tokns.fi as normal text.
7. THE SCREEN IS NOT A TRANSCRIPT. For every content line write one onScreen entry of at most 7 words: the key idea or number, never the whole sentence.
8. Never mention evntrace and never write a disclosure or "not financial advice" line; the system adds those.
9. Do not reuse an opening or a title pattern from RECENT_TITLES.

PILLARS:
- tx_blockchain: the TX ecosystem, staking and tokns.fi features. Explain the mechanics and the risks plainly.
- crypto: news and education. Say what happened, naming the source from SOURCES, why it matters, and what we do not know yet.
- motivation: healthy, practical methods for mind, brain, body, people and coherence. Money mindset is welcome when it is honest about habits, patience and avoiding scams, never as a get-rich promise.`;

/** ContentStrategy plus the extra inputs the v2 prompt takes (do not edit content-strategy.ts). */
export type GenerateScriptStrategy = ContentStrategy & {
  recentTitles?: string[];
  sources?: Array<{ title: string; source: string; url?: string }>;
  format?: string;
};

function buildUserPrompt(strategy: GenerateScriptStrategy): string {
  const format = strategy.format || "explainer";
  const sections = strategy.contentType === "List" || strategy.contentType === "Tutorial" ? 4 : 3;
  const lines: string[] = [];
  const add = (label: string, value: string): void => {
    if (value !== "") lines.push(`${label}: ${value}`);
  };
  add("TOPIC", strategy.topic || "");
  add("ANGLE", strategy.angle || "");
  add("PILLAR", strategy.pillar || "");
  add("FORMAT", format);
  // TX scripts get the verified facts pack; the writer may not go outside it.
  if (strategy.pillar === "tx_blockchain") {
    const txFactsBlock = factsToPromptBlock(loadTxFacts());
    if (txFactsBlock !== "") lines.push(txFactsBlock);
  }
  lines.push(`LENGTH: ${sections} sections of 2 to 4 content lines each, about 450 spoken words in total.`);
  if (Array.isArray(strategy.sources) && strategy.sources.length > 0) {
    lines.push(
      `SOURCES:\n${strategy.sources
        .map((s) => `- ${s.title} (${s.source})${s.url ? ` ${s.url}` : ""}`)
        .join("\n")}`,
    );
  }
  if (Array.isArray(strategy.recentTitles) && strategy.recentTitles.length > 0) {
    lines.push(`RECENT_TITLES:\n${strategy.recentTitles.join("\n")}`);
  }
  lines.push(`Return JSON with exactly this shape:
{ "title": "", "promise": "", "hook": { "type": "question|number|myth|scenario|change", "text": "", "duration": "" },
  "introduction": { "greeting": "This is Coherence Daddy.", "topicIntro": "", "valueProposition": "", "credibility": "", "duration": "" },
  "mainContent": { "sections": [ { "type": "fact|step|myth|example|compare|risk|takeaway", "title": "", "content": [""], "onScreen": [""], "visuals": [""], "duration": 0 } ], "totalDuration": 0 },
  "conclusion": { "type": "conclusion", "title": "Takeaways", "recap": [""], "finalThought": "", "duration": "" },
  "callToAction": { "type": "call_to_action", "subscribe": "", "like": "", "comment": "", "nextVideo": "", "duration": "" },
  "tone": "", "pacing": "", "keywords": [""], "duration": "", "fullScript": "" }`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Pronunciation fixes for TTS
// ---------------------------------------------------------------------------

export function applyPronunciationFixes(text: string): string {
  const fixes: Record<string, string> = {
    // eleven_v3 spelled "fye" out as F-Y-E (2026-10-09); "phi" is the owner's pick of four voiced takes
    "tokns.fi": "tokens dot phi",
    "Tokns.fi": "Tokens dot phi",
    "TOKNS.FI": "TOKENS DOT PHI",
    "coherencedaddy.com": "coherence daddy dot com",
    "evntrace.com": "event trace dot com",
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
  text = text.replace(/\bevntrace\b/gi, "event trace");
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
  text = text.replace(/\b(m)eme(coin)?(s)?\b/gi, (_m, first: string, coin?: string, s?: string) =>
    `${first}eem${coin ? `-${coin.toLowerCase()}` : ""}${s ? "s" : ""}`,
  );
  return text;
}

// ---------------------------------------------------------------------------
// evntrace line + sanitizer
// ---------------------------------------------------------------------------

// The ONLY evntrace mention in a published video: fixed text, appended to the
// call to action by the system (the LLM is told not to mention evntrace, and
// sanitizeScript drops any sentence that does). CLAIM-FREE ON PURPOSE:
// evntrace's claims register (Digital Forensics repo, branch
// marketing/foundation, marketing/claims-register.md "Video gate") forbids any
// evntrace *claim* in a published video until its legal docs exist and counsel
// has read them. A name/URL mention is allowed — keep this line to the name and
// the URL.
export const EVNTRACE_CTA_LINE = "Also, check out evntrace.com.";

/** Append "." when the line does not already end in sentence punctuation. */
export function ensureTerminalPunctuation(text: string): string {
  const t = text.trim();
  if (!t) return t;
  return /[.!?]["'”’)\]]*$/.test(t) ? t : `${t}.`;
}

// A spoken pronunciation aside: `pronounced "de-fi"`, `pronounced dee-fye`,
// `is pronounced de-fi`, `sounds like dee-fi` — quoted (any quote style) or one
// or two bare words.
const QUOTE = String.raw`["“”'‘’]`;
const PRON_BODY = String.raw`(?:(?:is|are)\s+)?(?:pronounced|pronunciation\s*:?|sounds\s+like)\s*(?:(?:as|like)\s+)?(?:${QUOTE}[^"“”'‘’]*${QUOTE}|[A-Za-z][\w'-]*(?:\s+[A-Za-z][\w'-]*)?)`;
const DASH = String.raw`(?:[—–]|\s-\s)`;
const PRON_ASIDES: Array<[RegExp, string]> = [
  // DeFi (pronounced dee-fye) lets
  [new RegExp(String.raw`\s*[(\[]\s*${PRON_BODY}\s*[,.]?\s*[)\]]`, "gi"), ""],
  // DeFi—pronounced "de-fi"—allows   /   DeFi – pronounced de-fi – lets
  [new RegExp(String.raw`\s*${DASH}\s*${PRON_BODY}\s*${DASH}\s*`, "gi"), " "],
  // DeFi — pronounced de-fi.   (the aside runs to the end of the sentence)
  [new RegExp(String.raw`\s*${DASH}\s*${PRON_BODY}(?=\s*[.!?,;]|\s*$)`, "gi"), ""],
  // DeFi, pronounced "dee-fi," allows   /   DeFi, pronounced dee-fi, allows
  [new RegExp(String.raw`\s*,\s*${PRON_BODY}(?:\s*,)?`, "gi"), ""],
];

function stripPronunciationAsides(text: string): string {
  let out = text;
  for (const [re, replacement] of PRON_ASIDES) out = out.replace(re, replacement);
  if (out === text) return text;
  return out
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,!?;:])/g, "$1")
    .replace(/,{2,}/g, ",")
    .trim();
}

function dropEvntraceSentences(text: string): string {
  if (!/evntrace/i.test(text)) return text;
  // Split on whitespace that follows sentence punctuation, so "evntrace.com"
  // stays one token.
  return text
    .split(/(?<=[.!?]["')\]]*)\s+/)
    .filter((sentence) => !/evntrace/i.test(sentence))
    .join(" ")
    .trim();
}

const DEFAULT_GREETING = "This is Coherence Daddy.";

// Fixed disclosure lines the system adds itself — the model is told never to
// write either one (prompt rule 8), so they can only appear from here.
/** Below this many spoken words a script is sent back to be lengthened (about 2.5 min at v3's ~180 wpm).
 * YT_MIN_SCRIPT_WORDS overrides (read at call time; 0 turns the rule off). */
export function minScriptWords(): number {
  const n = Number(process.env.YT_MIN_SCRIPT_WORDS ?? 380);
  return Number.isFinite(n) && n >= 0 ? n : 380;
}

export const DISCLOSURE_LINE = "Quick honesty break: we run a TX validator and build tokns.fi, so we gain when you stake.";
export const NOT_ADVICE_LINE = "This is education, not financial advice.";

/** Every spoken string in the script (the same set the validator reads). */
function spokenStrings(script: ScriptData): string[] {
  const out: string[] = [];
  const push = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
  };
  if (script.hook) push(script.hook.text);
  if (script.introduction) {
    push(script.introduction.greeting);
    push(script.introduction.topicIntro);
    push(script.introduction.valueProposition);
    push(script.introduction.credibility);
  }
  for (const section of script.mainContent?.sections || []) {
    push(section.title);
    if (Array.isArray(section.content)) section.content.forEach(push);
  }
  if (Array.isArray(script.conclusion?.recap)) script.conclusion.recap.forEach(push);
  if (script.conclusion) push(script.conclusion.finalThought);
  if (script.callToAction) {
    push(script.callToAction.subscribe);
    push(script.callToAction.like);
    push(script.callToAction.comment);
  }
  return out;
}

/** True when the script talks about TX or tokns — needs the stake-disclosure line. */
export function needsDisclosure(script: ScriptData): boolean {
  if (script.pillar === "tx_blockchain") return true;
  return spokenStrings(script).some((s) => /\b(TX|tokns(\.fi)?)\b/i.test(s));
}

/** True when the script touches crypto — needs the "not financial advice" line. */
export function needsNotAdvice(script: ScriptData): boolean {
  if (script.pillar === "tx_blockchain" || script.pillar === "crypto") return true;
  return spokenStrings(script).some((s) =>
    /\b(crypto|bitcoin|ethereum|defi|staking|stake|token|tokens|portfolio|invest(ing|ment)?)\b/i.test(s),
  );
}

/**
 * Deterministic clean-up of LLM output before narration and slides are built:
 *  1. strip spoken pronunciation asides ("DeFi, pronounced de-fi, allows" -> "DeFi allows"),
 *  2. drop any sentence that mentions evntrace (the system adds its own fixed line),
 *  3. ALWAYS set the greeting to the fixed line, whatever the model wrote.
 * Returns a copy; the input is not mutated.
 */
export function sanitizeScript(script: ScriptData): ScriptData {
  const out = structuredClone(script);
  const spoken = (v: string): string =>
    typeof v === "string" ? dropEvntraceSentences(stripPronunciationAsides(v)) : v;
  const nonEmpty = (v: string): boolean => typeof v !== "string" || v.trim() !== "";

  if (typeof out.title === "string") out.title = stripPronunciationAsides(out.title);
  if (out.hook) out.hook.text = spoken(out.hook.text);
  if (out.introduction) {
    const intro = out.introduction;
    intro.greeting = spoken(intro.greeting);
    intro.topicIntro = spoken(intro.topicIntro);
    intro.valueProposition = spoken(intro.valueProposition);
    intro.credibility = spoken(intro.credibility);
    intro.greeting = DEFAULT_GREETING;
  }
  for (const section of out.mainContent?.sections || []) {
    section.title = spoken(section.title);
    if (Array.isArray(section.content)) {
      // "[...]" lines are stage directions: never spoken, never shown. Leave them as written.
      section.content = section.content
        .map((l) => (typeof l === "string" && l.startsWith("[") ? l : spoken(l)))
        .filter(nonEmpty);
    }
  }
  if (out.conclusion) {
    if (Array.isArray(out.conclusion.recap)) out.conclusion.recap = out.conclusion.recap.map(spoken).filter(nonEmpty);
    out.conclusion.finalThought = spoken(out.conclusion.finalThought);
  }
  if (out.callToAction) {
    out.callToAction.subscribe = spoken(out.callToAction.subscribe);
    out.callToAction.like = spoken(out.callToAction.like);
    out.callToAction.comment = spoken(out.callToAction.comment);
    out.callToAction.nextVideo = spoken(out.callToAction.nextVideo);
  }
  return out;
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
  if (script.hook) {
    text += `${script.hook.text}\n\n`;
    if (needsDisclosure(script)) text += `${DISCLOSURE_LINE}\n\n`;
  }
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
    if (needsNotAdvice(script)) text += `${NOT_ADVICE_LINE}\n`;
    text += `${script.callToAction.subscribe}\n`;
    text += `${script.callToAction.like}\n`;
    text += `${script.callToAction.comment}\n`;
    text += `${EVNTRACE_CTA_LINE}\n`;
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
// AI script generation via Ollama — generate, sanitize, validate, repair
// ---------------------------------------------------------------------------

/** First `{` to last `}` of the model output, parsed. Throws when unparseable. */
function parseScriptJson(content: string): Record<string, unknown> {
  let rawText = content;
  const jsonStart = rawText.indexOf("{");
  const jsonEnd = rawText.lastIndexOf("}");
  if (jsonStart !== -1 && jsonEnd !== -1) {
    rawText = rawText.slice(jsonStart, jsonEnd + 1);
  }
  return JSON.parse(rawText) as Record<string, unknown>;
}

// One first draft plus up to four repairs. It was 3 until 2026-10-10: measured on VPS4 with the TX facts rule
// live, 13 of 15 TX scripts passed and nearly every pass used the third attempt (TOO_SHORT first, then the facts
// rule), and 2 failed outright, which means no video that night. A try takes about 6 s on gemma4:31b.
const MAX_SCRIPT_ATTEMPTS = 5;

export async function generateScript(strategy: GenerateScriptStrategy): Promise<ScriptData> {
  const baseMessages: OllamaChatMessage[] = [
    { role: "system", content: SCRIPT_SYSTEM_PROMPT },
    { role: "user", content: buildUserPrompt(strategy) },
  ];
  const options = { temperature: 0.7, maxTokens: 8192, timeoutMs: 600_000 };

  let messages = baseMessages;
  let result: ReturnType<typeof validateScript> | null = null;
  const priorCodes: string[] = [];

  for (let attempts = 1; attempts <= MAX_SCRIPT_ATTEMPTS; attempts++) {
    // callOllamaChat: one retry on a failed call, then give up (no template).
    let content: string;
    try {
      content = (await callOllamaChat(messages, options)).content;
    } catch {
      try {
        content = (await callOllamaChat(messages, options)).content;
      } catch (err2) {
        throw new Error(`script_generation: ${err2 instanceof Error ? err2.message : String(err2)}`);
      }
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = parseScriptJson(content);
    } catch {
      try {
        content = (await callOllamaChat(messages, options)).content;
        parsed = parseScriptJson(content);
      } catch (err2) {
        throw new Error(`script_generation: ${err2 instanceof Error ? err2.message : String(err2)}`);
      }
    }

    const mainContent = (parsed as { mainContent?: { sections?: ScriptSection[] } }).mainContent;
    const script = sanitizeScript({
      ...parsed,
      pillar: strategy.pillar,
      format: strategy.format || "explainer",
      duration: estimateDuration({ sections: mainContent?.sections ?? [] }),
      fullScript: "",
    } as ScriptData);
    result = validateScript(script, {
      minSpokenWords: minScriptWords(),
      ...(strategy.pillar === "tx_blockchain" || needsDisclosure(script) ? { txFacts: loadTxFacts() } : {}),
    });

    if (result.ok) {
      const seenCodes = [...new Set(priorCodes)];
      script.validation = { attempts, violations: seenCodes };
      script.fullScript = formatFullScript(script);
      logger.info({ title: script.title, attempts }, "YouTube script generated");
      return script;
    }

    priorCodes.push(...result.violations.map((v) => v.code));

    if (attempts < MAX_SCRIPT_ATTEMPTS) {
      // Repair: show the model what it returned and what broke.
      messages = [
        ...messages,
        { role: "assistant", content },
        {
          role: "user",
          content:
            "Your script broke these rules:\n" +
            formatViolations(result) +
            "\nReturn the complete corrected JSON. Change only what is needed to fix these.",
        },
      ];
    }
  }

  throw new Error(`script_validation: ${result ? formatViolations(result) : "no result"}`);
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
