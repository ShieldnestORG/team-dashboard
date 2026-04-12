/**
 * YouTube Pipeline — Presentation Renderer
 *
 * Two modes:
 *  1. AI-generated (default) — Ollama generates unique HTML/CSS per slide,
 *     content-aware layouts, branded Tokns.fi dark theme.
 *  2. Static fallback — fixed templates if Ollama is unavailable.
 *
 * Both render to 1920x1080 PNG via Playwright.
 */

import { mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../../middleware/logger.js";
import { callOllamaChat } from "../ollama-client.js";
import type { ScriptData } from "./script-writer.js";

// ---------------------------------------------------------------------------
// HTML escape
// ---------------------------------------------------------------------------

function esc(text: string | undefined): string {
  if (!text) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Brand constants (shared by AI prompt + static fallback)
// ---------------------------------------------------------------------------

const BRAND = {
  primaryBg: "#0A0A0A",
  secondaryBg: "#1A1A1A",
  darkBg: "#111111",
  gold: "#C9A84C",
  goldLight: "#E8D5A0",
  goldDim: "#9A7D35",
  purple: "#7B68AE",
  blue: "#4A7FD4",
  green: "#00C896",
  coral: "#FF876D",
  white: "#E2E2E2",
  muted: "#6B6B6B",
  cardBg: "#2A2A2A",
  font: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  channel: "COHERENCE DADDY",
};

// ---------------------------------------------------------------------------
// AI slide generation via Ollama
// ---------------------------------------------------------------------------

const SLIDE_SYSTEM_PROMPT = `You are an expert presentation designer. Generate a single HTML page that renders a 1920x1080 slide.

BRAND GUIDELINES (Coherence Daddy):
- Dark theme: backgrounds use deep blacks — ${BRAND.primaryBg}, ${BRAND.secondaryBg}, ${BRAND.darkBg}
- PRIMARY accent: Coherence Gold ${BRAND.gold} — use for headlines, key numbers, glows, gradient highlights
- Gold gradient: linear-gradient(135deg, ${BRAND.gold}, ${BRAND.goldDim}) for depth and richness
- Light gold ${BRAND.goldLight} for hover states and subtle highlights
- Secondary accent: Sage Purple ${BRAND.purple} — badges, decorative elements, borders
- Supporting colors: Shield Blue ${BRAND.blue}, Crypto Green ${BRAND.green}, Coral ${BRAND.coral} — use sparingly for variety
- Text: ${BRAND.white} for headings, rgba(216,216,216,0.7) for body, ${BRAND.muted} for captions
- Card surfaces: ${BRAND.cardBg} with subtle borders rgba(255,255,255,0.07)
- Glass effect: background rgba(255,255,255,0.035) with backdrop-filter blur(24px) for modern depth
- Font: ${BRAND.font}
- Channel branding: ${BRAND.channel} (subtle, bottom-right or top-left)

RULES:
- Output ONLY a complete HTML document: <!DOCTYPE html><html>...</html>
- The <body> must be exactly 1920x1080px with overflow:hidden
- All CSS must be inline in a <style> tag — no external resources
- No JavaScript, no external fonts, no images, no SVG — pure HTML/CSS only
- Use CSS gradients, borders, box-shadows, and shapes for visual interest
- Make it visually unique — vary layouts, use asymmetric compositions, creative spacing
- Text must be large enough to read on a phone (minimum 28px for body text, 48px+ for titles)
- Truncate any single text block to 120 characters max
- Add subtle decorative elements: corner accents, gradient lines, glowing dots, geometric shapes
- Do NOT wrap output in markdown code fences — output raw HTML only`;

interface SlideRequest {
  type: "title" | "hook" | "section_title" | "content" | "conclusion" | "cta";
  title?: string;
  subtitle?: string;
  content?: string[];
  badge?: string;
  highlightIndex?: number;
}

async function generateSlideHtml(req: SlideRequest): Promise<string | null> {
  let userPrompt: string;

  switch (req.type) {
    case "title":
      userPrompt = `Design a TITLE slide for a YouTube video called "${req.title}". Subtitle: "${req.subtitle || BRAND.channel}". Make it cinematic and bold — this is the first thing viewers see. Use a dramatic gradient background with decorative corner elements.`;
      break;
    case "hook":
      userPrompt = `Design a HOOK/QUOTE slide displaying this attention-grabbing statement: "${req.content?.[0] || ""}". Use large italic typography with a dramatic opening quotation mark. The quote should feel powerful and draw the viewer in.`;
      break;
    case "section_title":
      userPrompt = `Design a SECTION TITLE slide. Section name: "${req.title}". Category badge: "${req.badge || "TOPIC"}". This is a transition card — make it clean and impactful with the badge as a small pill above the title. Center-aligned.`;
      break;
    case "content": {
      const items = req.content || [];
      const highlight = req.highlightIndex ?? -1;
      if (highlight >= 0 && highlight < items.length) {
        userPrompt = `Design a CONTENT slide with title "${req.title}" and ${items.length} bullet points. The bullets are:\n${items.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n\nVisually EMPHASIZE bullet #${highlight + 1} (make it brighter, larger, or glowing). Dim the others. Use a left-aligned layout with a vertical accent line. Each bullet should have a dot or icon indicator.`;
      } else {
        userPrompt = `Design a CONTENT slide with title "${req.title}" and these points:\n${items.map((b, i) => `${i + 1}. ${b}`).join("\n")}\n\nAll points should be equally visible. Use creative layout — could be a grid, cards, timeline, or traditional bullets. Adapt the layout to the number of items (${items.length}).`;
      }
      break;
    }
    case "conclusion":
      userPrompt = `Design a CONCLUSION/KEY TAKEAWAYS slide with these recap points:\n${(req.content || []).map((p, i) => `${i + 1}. ${p}`).join("\n")}\n\nInclude a checkmark or summary icon. Make it feel like a satisfying wrap-up. Use a gradient background.`;
      break;
    case "cta":
      userPrompt = `Design a CALL TO ACTION slide for the ${BRAND.channel} YouTube channel. Include a prominent red SUBSCRIBE button (not clickable, just visual). Add "LIKE & COMMENT FOR MORE CONTENT" below. Include the channel name prominently. Make it eye-catching.`;
      break;
    default:
      return null;
  }

  try {
    const result = await callOllamaChat(
      [
        { role: "system", content: SLIDE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.85, maxTokens: 4096, timeoutMs: 120_000 },
    );

    let html = result.content.trim();

    // Strip markdown fences if the model wraps output
    const fenceMatch = html.match(/```(?:html)?\s*([\s\S]*?)```/);
    if (fenceMatch) html = fenceMatch[1].trim();

    // Validate it looks like HTML
    if (!html.includes("<!DOCTYPE") && !html.includes("<html")) {
      if (html.includes("<div") || html.includes("<body")) {
        html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{margin:0;padding:0;box-sizing:border-box}body{width:1920px;height:1080px;overflow:hidden;font-family:${BRAND.font}}</style></head><body>${html}</body></html>`;
      } else {
        logger.warn({ type: req.type }, "Ollama returned non-HTML for slide");
        return null;
      }
    }

    return html;
  } catch (err) {
    logger.warn({ err, type: req.type }, "Ollama slide generation failed");
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slide type
// ---------------------------------------------------------------------------

export interface Slide {
  type: string;
  html: string;
  /** Approximate spoken text this slide covers (for duration weighting) */
  spokenText?: string;
}

// ---------------------------------------------------------------------------
// AI-powered slide builder (primary)
// ---------------------------------------------------------------------------

export async function buildSlidesFromScriptAI(script: ScriptData): Promise<Slide[]> {
  const slides: Slide[] = [];

  // Title
  const titleHtml = await generateSlideHtml({ type: "title", title: script.title, subtitle: BRAND.channel });
  slides.push({
    type: "title",
    html: titleHtml || staticTemplateTitle(script.title || "Untitled"),
    spokenText: script.title || "",
  });

  // Hook
  if (script.hook?.text) {
    const hookHtml = await generateSlideHtml({ type: "hook", content: [script.hook.text] });
    slides.push({
      type: "hook",
      html: hookHtml || staticTemplateQuote(script.hook.text),
      spokenText: script.hook.text,
    });
  }

  // Main sections
  for (const section of script.mainContent?.sections || []) {
    const sectionHtml = await generateSlideHtml({
      type: "section_title",
      title: section.title,
      badge: (section.type || "topic").toUpperCase(),
    });
    slides.push({
      type: "section_title",
      html: sectionHtml || staticTemplateSectionTitle(section.title || "Section", (section.type || "topic").toUpperCase()),
      spokenText: section.title || "",
    });

    const bullets = Array.isArray(section.content) ? section.content : [section.content].filter(Boolean);
    const bulletTexts = bullets.map((b) => (typeof b === "string" ? b : String(b)));

    for (let c = 0; c < bulletTexts.length; c += 3) {
      const chunk = bulletTexts.slice(c, c + 3);
      for (let h = 0; h < chunk.length; h++) {
        const contentHtml = await generateSlideHtml({
          type: "content",
          title: section.title || "Details",
          content: chunk,
          highlightIndex: h,
        });
        slides.push({
          type: "content",
          html: contentHtml || staticTemplateBullets(section.title || "Details", chunk, h),
          spokenText: chunk[h],
        });
      }
    }
  }

  // Conclusion
  if (script.conclusion?.recap) {
    const recap = script.conclusion.recap.map((r) => (typeof r === "string" ? r : String(r)));
    const conclusionHtml = await generateSlideHtml({ type: "conclusion", content: recap });
    slides.push({
      type: "conclusion",
      html: conclusionHtml || staticTemplateConclusion(recap),
      spokenText: recap.join(". "),
    });
  }

  // CTA
  const ctaHtml = await generateSlideHtml({ type: "cta" });
  const ctaText = [
    script.callToAction?.subscribe,
    script.callToAction?.like,
    script.callToAction?.comment,
  ].filter(Boolean).join(". ");
  slides.push({
    type: "cta",
    html: ctaHtml || staticTemplateCTA(script.callToAction?.subscribe || "Subscribe for more!"),
    spokenText: ctaText || "Subscribe for more content!",
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Static fallback builder (original templates, no AI needed)
// ---------------------------------------------------------------------------

export function buildSlidesFromScript(script: ScriptData): Slide[] {
  const slides: Slide[] = [];

  slides.push({
    type: "title",
    html: staticTemplateTitle(script.title || "Untitled"),
    spokenText: script.title || "",
  });

  if (script.hook?.text) {
    slides.push({
      type: "quote",
      html: staticTemplateQuote(script.hook.text),
      spokenText: script.hook.text,
    });
  }

  for (const section of script.mainContent?.sections || []) {
    slides.push({
      type: "section_title",
      html: staticTemplateSectionTitle(section.title || "Section", (section.type || "topic").toUpperCase()),
      spokenText: section.title || "",
    });

    const bullets = Array.isArray(section.content) ? section.content : [section.content].filter(Boolean);
    const bulletTexts = bullets.map((b) => (typeof b === "string" ? b : String(b)));

    for (let c = 0; c < bulletTexts.length; c += 3) {
      const chunk = bulletTexts.slice(c, c + 3);
      for (let h = 0; h < chunk.length; h++) {
        slides.push({
          type: "bullets",
          html: staticTemplateBullets(section.title || "Details", chunk, h),
          spokenText: chunk[h],
        });
      }
    }
  }

  if (script.conclusion?.recap) {
    const recap = script.conclusion.recap.map((r) => (typeof r === "string" ? r : String(r)));
    slides.push({
      type: "conclusion",
      html: staticTemplateConclusion(recap),
      spokenText: recap.join(". "),
    });
  }

  const ctaText = [
    script.callToAction?.subscribe,
    script.callToAction?.like,
    script.callToAction?.comment,
  ].filter(Boolean).join(". ");
  slides.push({
    type: "cta",
    html: staticTemplateCTA(script.callToAction?.subscribe || "Subscribe for more!"),
    spokenText: ctaText || "Subscribe for more content!",
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Static HTML templates (fallback when Ollama is unavailable)
// ---------------------------------------------------------------------------

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px; overflow: hidden;
    font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .slide {
    width: 1920px; height: 1080px; position: relative;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    overflow: hidden;
  }
  .bg-gradient { background: linear-gradient(135deg, #0A0A0A 0%, #1A1A1A 50%, #111111 100%); }
  .bg-dark { background: linear-gradient(160deg, #0A0A0A 0%, #1A1A1A 100%); }
  .bg-accent { background: linear-gradient(135deg, #1A1A1A 0%, #0A0A0A 100%); }
  .corner-tl, .corner-br { position: absolute; width: 80px; height: 80px; }
  .corner-tl { top: 60px; left: 60px; border-top: 3px solid rgba(201, 168, 76, 0.5); border-left: 3px solid rgba(201, 168, 76, 0.5); }
  .corner-br { bottom: 60px; right: 60px; border-bottom: 3px solid rgba(123, 104, 174, 0.5); border-right: 3px solid rgba(123, 104, 174, 0.5); }
  .accent-line { width: 400px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #C9A84C, #9A7D35); margin: 0 auto 40px; }
  .accent-line-short { width: 200px; height: 3px; border-radius: 1.5px; background: linear-gradient(90deg, #7B68AE, #C9A84C); margin-top: 12px; }
  .particle { position: absolute; border-radius: 50%; opacity: 0.15; }
`;

function wrapHtml(bodyContent: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${bodyContent}</body></html>`;
}

function particles(count = 8): string {
  const colors = ["#C9A84C", "#7B68AE", "#4A7FD4", "#00C896"];
  return Array.from({ length: count }, (_, i) => {
    const x = Math.floor(Math.random() * 1800) + 60;
    const y = Math.floor(Math.random() * 960) + 60;
    const size = Math.floor(Math.random() * 6) + 3;
    const color = colors[i % colors.length];
    return `<div class="particle" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color}"></div>`;
  }).join("");
}

function staticTemplateTitle(title: string, subtitle = "COHERENCE DADDY"): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      <div class="corner-tl"></div><div class="corner-br"></div>
      ${particles(10)}
      <div class="accent-line"></div>
      <h1 style="color:#E2E2E2;font-size:62px;font-weight:900;text-align:center;max-width:1400px;line-height:1.2;letter-spacing:-1px">${esc(title)}</h1>
      <p style="color:#C9A84C;font-size:28px;letter-spacing:8px;margin-top:40px;font-weight:400">${esc(subtitle)}</p>
    </div>
  `);
}

function staticTemplateSectionTitle(title: string, badge = "TOPIC"): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div style="background:rgba(123,104,174,0.8);border-radius:18px;padding:6px 28px;margin-bottom:30px">
        <span style="color:white;font-size:18px;font-weight:700;letter-spacing:3px">${esc(badge)}</span>
      </div>
      <h2 style="color:#E2E2E2;font-size:72px;font-weight:900;text-align:center;max-width:1400px;line-height:1.15">${esc(title)}</h2>
      <div class="accent-line-short" style="margin-top:24px;width:300px;margin-left:auto;margin-right:auto"></div>
    </div>
  `);
}

function staticTemplateBullets(title: string, bullets: string[], highlightIndex = -1): string {
  const bulletHtml = bullets
    .map((b, i) => {
      const text = b.length > 120 ? b.slice(0, 117) + "..." : b;
      const isActive = highlightIndex === -1 || i === highlightIndex;
      const isPast = highlightIndex !== -1 && i < highlightIndex;
      const textColor = isActive ? "#E2E2E2" : isPast ? "rgba(226,226,226,0.45)" : "rgba(226,226,226,0.2)";
      const dotColor = isActive ? "#C9A84C" : isPast ? "rgba(201,168,76,0.4)" : "rgba(201,168,76,0.15)";
      const fontWeight = isActive ? "600" : "400";
      const glowBar = isActive
        ? '<div style="position:absolute;left:-28px;top:0;bottom:0;width:4px;border-radius:2px;background:#C9A84C;box-shadow:0 0 12px rgba(201,168,76,0.6)"></div>'
        : "";
      return `
        <div style="display:flex;align-items:flex-start;margin-bottom:40px;position:relative">
          ${glowBar}
          <div style="min-width:16px;height:16px;border-radius:50%;background:${dotColor};margin-top:10px;margin-right:24px;flex-shrink:0"></div>
          <p style="color:${textColor};font-size:34px;line-height:1.4;font-weight:${fontWeight}">${esc(text)}</p>
        </div>`;
    })
    .join("");

  return wrapHtml(`
    <div class="slide bg-dark">
      <div style="position:absolute;left:120px;top:200px;bottom:200px;width:4px;background:rgba(201,168,76,0.3);border-radius:2px"></div>
      <div style="position:absolute;top:200px;left:180px;right:200px;text-align:left">
        <h3 style="color:#C9A84C;font-size:46px;font-weight:900;margin-bottom:8px">${esc(title)}</h3>
        <div class="accent-line-short" style="margin-left:0;margin-bottom:50px;width:200px"></div>
        ${bulletHtml}
      </div>
    </div>
  `);
}

function staticTemplateConclusion(recapPoints: string[]): string {
  const pointsHtml = recapPoints
    .map(
      (p) => `
      <div style="display:flex;align-items:center;margin-bottom:36px">
        <div style="min-width:10px;height:10px;border-radius:2px;background:#7B68AE;margin-right:20px;transform:rotate(45deg);flex-shrink:0"></div>
        <p style="color:#D8D8D8;font-size:32px;line-height:1.35;font-weight:400">${esc(p.length > 100 ? p.slice(0, 97) + "..." : p)}</p>
      </div>`,
    )
    .join("");

  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div style="position:absolute;top:220px;left:240px;right:240px;text-align:left">
        <div style="display:flex;align-items:center;margin-bottom:40px">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#C9A84C,#7B68AE);display:flex;align-items:center;justify-content:center;margin-right:20px">
            <span style="color:white;font-size:24px;font-weight:900">&#10003;</span>
          </div>
          <h3 style="color:#E2E2E2;font-size:48px;font-weight:900">Key Takeaways</h3>
        </div>
        <div class="accent-line-short" style="margin-left:0;margin-bottom:40px;width:260px"></div>
        ${pointsHtml}
      </div>
    </div>
  `);
}

function staticTemplateCTA(subscribeText: string): string {
  return wrapHtml(`
    <div class="slide bg-accent">
      ${particles(8)}
      <p style="color:#C9A84C;font-size:28px;letter-spacing:6px;font-weight:400;margin-bottom:40px">COHERENCE DADDY</p>
      <div style="background:#C9A84C;border-radius:40px;padding:16px 80px;box-shadow:0 0 30px rgba(201,168,76,0.4)">
        <span style="color:#0A0A0A;font-size:36px;font-weight:900;letter-spacing:1px">SUBSCRIBE</span>
      </div>
      <p style="color:#6B6B6B;font-size:24px;margin-top:50px">LIKE &amp; COMMENT FOR MORE CONTENT</p>
    </div>
  `);
}

function staticTemplateQuote(quote: string): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div class="corner-tl"></div><div class="corner-br"></div>
      <div style="max-width:1200px;text-align:center">
        <div style="color:rgba(201,168,76,0.3);font-size:160px;font-weight:900;line-height:0.6;margin-bottom:20px">&ldquo;</div>
        <p style="color:#E2E2E2;font-size:44px;font-weight:600;line-height:1.45;font-style:italic">${esc(quote)}</p>
      </div>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// Render slides to PNG via Playwright
// ---------------------------------------------------------------------------

export async function renderSlidesToImages(slides: Slide[], outputDir: string): Promise<string[]> {
  let chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> };
  try {
    const pw = await (Function('return import("playwright")')() as Promise<{ chromium: typeof chromium }>);
    chromium = pw.chromium;
  } catch {
    throw new Error("Playwright not available. Install with: npx playwright install chromium");
  }

  await mkdir(outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: true }) as {
    newPage: () => Promise<{
      setViewportSize: (s: { width: number; height: number }) => Promise<void>;
      setContent: (html: string, opts: { waitUntil: string }) => Promise<void>;
      waitForTimeout: (ms: number) => Promise<void>;
      screenshot: (opts: { path: string; type: string }) => Promise<void>;
    }>;
    close: () => Promise<void>;
  };
  const page = await browser.newPage();
  await page.setViewportSize({ width: 1920, height: 1080 });

  const framePaths: string[] = [];
  for (let i = 0; i < slides.length; i++) {
    await page.setContent(slides[i].html, { waitUntil: "load" });
    await page.waitForTimeout(800);
    const outPath = join(outputDir, `pres_${String(i).padStart(3, "0")}_${slides[i].type}.png`);
    await page.screenshot({ path: outPath, type: "png" });
    framePaths.push(outPath);
  }

  await browser.close();
  logger.info({ slideCount: slides.length }, "Presentation slides rendered to PNG");
  return framePaths;
}
