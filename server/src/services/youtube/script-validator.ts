import type { ScriptData } from "./script-writer.js";

export type ViolationCode =
  | "GREETING" | "OPENER_FILLER" | "INVENTED" | "PRONUNCIATION_NOTE" | "ADVICE_OR_HYPE" | "BANNED_PHRASE"
  | "UNSUPPORTED_CLAIM" | "EVNTRACE_MENTION" | "NOT_SPEAKABLE" | "LINE_TOO_LONG" | "ONSCREEN_SHAPE"
  | "TITLE_TOO_LONG" | "TITLE_FALSE_CLAIM" | "TITLE_INCOME_PROMISE" | "TITLE_JUNK" | "COUNT_MISMATCH" | "STRUCTURE";

export interface Violation { code: ViolationCode; field: string; message: string; excerpt: string }
export interface ValidationResult { ok: boolean; violations: Violation[]; warnings: Violation[] }

// --- regexes (all case-insensitive) ---
const GREETING_RE = /^this is coherence daddy\.?$/i;
const OPENER_FILLER_RE = /welcome back|what'?s up|\btoday,? we\b|in this video,? (i|we)('?ll| will)/i;
const INVENTED_RE = /\b(i|we) (tested|tried|made|earned|lost|bought|sold|interviewed|surveyed)\b|\b(our research|we found|my portfolio|in my experience|studies show|research shows|experts say)\b/i;
const PRONUNCIATION_NOTE_RE = /\bpronounced\b/i;
const ADVICE_OR_HYPE_RE = /\bwill (explode|moon|skyrocket|double|triple)\b|\bguaranteed?\b|\b\d+x\b|\bget rich\b|\bfinancial freedom\b|\bwealth cycle\b|\byou should (buy|sell|stake|hold)\b|\bbuy now\b|\bto the moon\b|\brisk[- ]free\b|\bwithout risking\b/i;
const BANNED_PHRASE_RES = [
  /\b(elevate|unleash|seamless(ly)?|revolutioni[sz]e|cutting[- ]edge|next[- ]gen|game[- ]changer)\b/i,
  /in today'?s fast[- ]paced world/i,
  /\bthe future of\b/i,
];
const UNSUPPORTED_CLAIM_RE = /\bthe top\b|\bencrypted\b|\banonymous\b/i;
const EVNTRACE_MENTION_RE = /\bevntrace\b|\bevent ?trace\b/i;
const EMOJI_RE = /\p{Extended_Pictographic}/u;
const TITLE_INCOME_PROMISE_RE = /\$\s?\d|paid my rent|make (you )?rich|makes you rich|quit your job|per day passive|passive income that/i;
const TITLE_JUNK_END_RE = / - [A-Za-z]+$/;
const TITLE_JUNK_PREFIX_RE = /^(Ultimate|Proven|Secret|Amazing|Powerful|Essential|Complete) /i;
const TITLE_YEAR_RE = /\(\d{4}\)/;
const COUNT_RE = /\b(2|3|4|5|6|7|8|9|10|two|three|four|five|six|seven|eight|nine|ten)\s+[a-z-]*\s*[a-z]+s\b/gi;

const WORD_NUMBERS: Record<string, number> = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

function clip(text: string): string {
  return text.length <= 80 ? text : text.slice(0, 80);
}

function countWords(text: string): number {
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function numberToInt(word: string): number {
  const w = word.toLowerCase();
  return WORD_NUMBERS[w] ?? parseInt(w, 10);
}

function notSpeakableExcerpt(text: string): string | null {
  if (text.includes("[")) return "[";
  if (text.includes("]")) return "]";
  const url = text.match(/https?:\/\//i);
  if (url) return url[0].toLowerCase();
  if (/www\./i.test(text)) return "www.";
  const emoji = text.match(EMOJI_RE);
  if (emoji) return emoji[0];
  return null;
}

// Report each (code, field) pair at most once across violations and warnings.
function makeReporter() {
  const seen = new Set<string>();
  return function report(
    list: Violation[],
    code: ViolationCode,
    field: string,
    message: string,
    excerpt: string,
  ): void {
    const key = `${code}|${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    list.push({ code, field, message, excerpt: clip(excerpt) });
  };
}

export function validateScript(script: ScriptData): ValidationResult {
  const violations: Violation[] = [];
  const warnings: Violation[] = [];
  const report = makeReporter();

  const sections = script.mainContent?.sections ?? [];
  const title = typeof script.title === "string" ? script.title : "";

  // Collect every spoken string with its field path.
  const spoken: Array<{ field: string; text: string }> = [];
  const push = (field: string, text: unknown): void => {
    if (typeof text === "string") spoken.push({ field, text });
  };
  push("hook.text", script.hook?.text);
  if (script.introduction) {
    push("introduction.greeting", script.introduction.greeting);
    push("introduction.topicIntro", script.introduction.topicIntro);
    push("introduction.valueProposition", script.introduction.valueProposition);
    push("introduction.credibility", script.introduction.credibility);
  }
  sections.forEach((section, i) => {
    push(`mainContent.sections[${i}].title`, section.title);
    if (Array.isArray(section.content)) {
      section.content.forEach((line, j) => push(`mainContent.sections[${i}].content[${j}]`, line));
    }
  });
  if (Array.isArray(script.conclusion?.recap)) {
    script.conclusion.recap.forEach((line, i) => push(`conclusion.recap[${i}]`, line));
  }
  push("conclusion.finalThought", script.conclusion?.finalThought);
  if (script.callToAction) {
    push("callToAction.subscribe", script.callToAction.subscribe);
    push("callToAction.like", script.callToAction.like);
    push("callToAction.comment", script.callToAction.comment);
  }

  // 1. GREETING
  const greeting = typeof script.introduction?.greeting === "string" ? script.introduction.greeting.trim() : "";
  if (greeting !== "" && !GREETING_RE.test(greeting)) {
    report(violations, "GREETING", "introduction.greeting", "greeting must be empty or 'This is Coherence Daddy.'", greeting);
  }

  // 2. OPENER_FILLER (hook + introduction only)
  for (const { field, text } of spoken) {
    if (field === "hook.text" || field.startsWith("introduction.")) {
      const m = text.match(OPENER_FILLER_RE);
      if (m) report(violations, "OPENER_FILLER", field, "filler opener", m[0]);
    }
  }

  // 3-9. Spoken-string content rules.
  for (const { field, text } of spoken) {
    const inv = text.match(INVENTED_RE);
    if (inv) report(violations, "INVENTED", field, "invented experience or unsupported claim", inv[0]);

    const pron = text.match(PRONUNCIATION_NOTE_RE);
    if (pron) report(violations, "PRONUNCIATION_NOTE", field, "read-aloud pronunciation note", pron[0]);

    const hype = text.match(ADVICE_OR_HYPE_RE);
    if (hype) report(violations, "ADVICE_OR_HYPE", field, "advice, prediction, or hype", hype[0]);

    for (const re of BANNED_PHRASE_RES) {
      const m = text.match(re);
      if (m) { report(violations, "BANNED_PHRASE", field, "banned marketing phrase", m[0]); break; }
    }

    const claim = text.match(UNSUPPORTED_CLAIM_RE);
    if (claim) report(violations, "UNSUPPORTED_CLAIM", field, "unsupported claim", claim[0]);

    const evn = text.match(EVNTRACE_MENTION_RE);
    if (evn) report(violations, "EVNTRACE_MENTION", field, "evntrace must not be mentioned", evn[0]);

    const ns = notSpeakableExcerpt(text);
    if (ns) report(violations, "NOT_SPEAKABLE", field, "not speakable as written", ns);
  }

  // 10. LINE_TOO_LONG (content lines only)
  sections.forEach((section, i) => {
    if (!Array.isArray(section.content)) return;
    section.content.forEach((line, j) => {
      if (typeof line !== "string") return;
      const words = countWords(line);
      const field = `mainContent.sections[${i}].content[${j}]`;
      if (words > 30) {
        report(violations, "LINE_TOO_LONG", field, `line has ${words} words (max 30)`, line);
      } else if (words >= 23) {
        report(warnings, "LINE_TOO_LONG", field, `line has ${words} words (keep under 23)`, line);
      }
    });
  });

  // 11. ONSCREEN_SHAPE
  sections.forEach((section, i) => {
    const onScreen = (section as { onScreen?: unknown }).onScreen;
    if (onScreen === undefined) return;
    const field = `mainContent.sections[${i}].onScreen`;
    const contentLen = Array.isArray(section.content) ? section.content.length : 0;
    if (!Array.isArray(onScreen)) {
      report(violations, "ONSCREEN_SHAPE", field, "onScreen must be an array", "");
      return;
    }
    if (onScreen.length !== contentLen) {
      report(violations, "ONSCREEN_SHAPE", field, `onScreen has ${onScreen.length} entries but content has ${contentLen}`, "");
      return;
    }
    for (const entry of onScreen) {
      if (typeof entry !== "string" || entry.trim() === "") {
        report(violations, "ONSCREEN_SHAPE", field, "onScreen entries must be non-empty strings", "");
        return;
      }
      if (countWords(entry) > 7) {
        report(violations, "ONSCREEN_SHAPE", field, "onScreen entry exceeds 7 words", entry);
        return;
      }
    }
  });

  // 12. TITLE_TOO_LONG
  if (title.length > 70) {
    report(violations, "TITLE_TOO_LONG", "title", `title is ${title.length} chars (max 70)`, title);
  }

  // 13. TITLE_FALSE_CLAIM (rule 3's regexes on the title)
  const falseClaim = title.match(INVENTED_RE);
  if (falseClaim) report(violations, "TITLE_FALSE_CLAIM", "title", "title makes an invented claim", falseClaim[0]);

  // 14. TITLE_INCOME_PROMISE
  const income = title.match(TITLE_INCOME_PROMISE_RE);
  if (income) report(violations, "TITLE_INCOME_PROMISE", "title", "title promises income", income[0]);

  // 15. TITLE_JUNK
  if (TITLE_JUNK_END_RE.test(title) || TITLE_JUNK_PREFIX_RE.test(title)) {
    const junk = title.match(TITLE_JUNK_END_RE) || title.match(TITLE_JUNK_PREFIX_RE);
    report(violations, "TITLE_JUNK", "title", "title uses clickbait junk", junk ? junk[0] : title);
  }

  // 16. COUNT_MISMATCH
  const totalContentLines = sections.reduce((sum, s) => sum + (Array.isArray(s.content) ? s.content.length : 0), 0);
  for (const m of title.matchAll(COUNT_RE)) {
    const n = numberToInt(m[1]);
    if (n !== sections.length && n !== totalContentLines) {
      report(violations, "COUNT_MISMATCH", "title", `title promises ${n} but script has ${sections.length} sections / ${totalContentLines} lines`, m[0]);
    }
  }

  // 12b. TITLE_JUNK warning for a parenthesised year.
  if (TITLE_YEAR_RE.test(title)) {
    const year = title.match(TITLE_YEAR_RE)!;
    report(warnings, "TITLE_JUNK", "title", "title contains a parenthesised year", year[0]);
  }

  // 17. STRUCTURE
  if (typeof script.hook?.text !== "string" || script.hook.text.trim() === "") {
    report(violations, "STRUCTURE", "hook.text", "hook is empty", "");
  }
  if (sections.length < 2) {
    report(violations, "STRUCTURE", "mainContent.sections", "fewer than 2 sections", String(sections.length));
  }
  sections.forEach((section, i) => {
    if (!Array.isArray(section.content) || section.content.length < 1) {
      report(violations, "STRUCTURE", `mainContent.sections[${i}].content`, "section has no content lines", "");
    }
  });

  return { ok: violations.length === 0, violations, warnings };
}

export function formatViolations(result: ValidationResult): string {
  return result.violations
    .map((v) => `${v.code} ${v.field}: ${v.message} — "${v.excerpt}"`)
    .join("\n");
}
