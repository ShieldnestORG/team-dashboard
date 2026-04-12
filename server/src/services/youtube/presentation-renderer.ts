/**
 * YouTube Pipeline — Presentation Renderer
 *
 * Converts scripts into branded HTML/CSS slides (Tokns.fi dark theme with
 * cyan/purple accents). Renders to PNG images via Playwright.
 *
 * Ported from youtube-automation/utils/presentation-renderer.js
 */

import { mkdir, readdir } from "fs/promises";
import { join } from "path";
import { logger } from "../../middleware/logger.js";
import type { ScriptData, ScriptSection } from "./script-writer.js";

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
// Shared CSS
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
  .bg-gradient { background: linear-gradient(135deg, #0a0a2e 0%, #1a0a3e 50%, #0a1628 100%); }
  .bg-dark { background: linear-gradient(160deg, #0d1117 0%, #161b22 100%); }
  .bg-accent { background: linear-gradient(135deg, #1a0a3e 0%, #0a0a2e 100%); }

  .corner-tl, .corner-br { position: absolute; width: 80px; height: 80px; }
  .corner-tl { top: 60px; left: 60px; border-top: 3px solid rgba(0, 212, 255, 0.5); border-left: 3px solid rgba(0, 212, 255, 0.5); }
  .corner-br { bottom: 60px; right: 60px; border-bottom: 3px solid rgba(123, 47, 255, 0.5); border-right: 3px solid rgba(123, 47, 255, 0.5); }

  .accent-line { width: 400px; height: 4px; border-radius: 2px; background: linear-gradient(90deg, #00d4ff, #7b2fff); margin: 0 auto 40px; }
  .accent-line-short { width: 200px; height: 3px; border-radius: 1.5px; background: linear-gradient(90deg, #7b2fff, #00d4ff); margin-top: 12px; }

  .particle { position: absolute; border-radius: 50%; opacity: 0.15; }
`;

function wrapHtml(bodyContent: string, extraCss = ""): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${BASE_CSS}${extraCss}</style></head><body>${bodyContent}</body></html>`;
}

function particles(count = 8): string {
  const colors = ["#00d4ff", "#7b2fff", "#ff6b6b", "#ffd93d"];
  return Array.from({ length: count }, (_, i) => {
    const x = Math.floor(Math.random() * 1800) + 60;
    const y = Math.floor(Math.random() * 960) + 60;
    const size = Math.floor(Math.random() * 6) + 3;
    const color = colors[i % colors.length];
    return `<div class="particle" style="left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${color}"></div>`;
  }).join("");
}

// ---------------------------------------------------------------------------
// Slide templates
// ---------------------------------------------------------------------------

function templateTitle(title: string, subtitle = "TOKNS.FI"): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      <div class="corner-tl"></div><div class="corner-br"></div>
      ${particles(10)}
      <div class="accent-line"></div>
      <h1 style="color:white;font-size:62px;font-weight:900;text-align:center;max-width:1400px;line-height:1.2;letter-spacing:-1px">${esc(title)}</h1>
      <p style="color:#00d4ff;font-size:28px;letter-spacing:8px;margin-top:40px;font-weight:400">${esc(subtitle)}</p>
    </div>
  `);
}

function templateSectionTitle(title: string, badge = "TOPIC"): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div style="background:rgba(123,47,255,0.8);border-radius:18px;padding:6px 28px;margin-bottom:30px">
        <span style="color:white;font-size:18px;font-weight:700;letter-spacing:3px">${esc(badge)}</span>
      </div>
      <h2 style="color:white;font-size:72px;font-weight:900;text-align:center;max-width:1400px;line-height:1.15">${esc(title)}</h2>
      <div class="accent-line-short" style="margin-top:24px;width:300px;margin-left:auto;margin-right:auto"></div>
    </div>
  `);
}

function templateBullets(title: string, bullets: string[], highlightIndex = -1): string {
  const bulletHtml = bullets
    .map((b, i) => {
      const text = b.length > 120 ? b.slice(0, 117) + "..." : b;
      const isActive = highlightIndex === -1 || i === highlightIndex;
      const isPast = highlightIndex !== -1 && i < highlightIndex;
      const textColor = isActive ? "white" : isPast ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)";
      const dotColor = isActive ? "#00d4ff" : isPast ? "rgba(0,212,255,0.4)" : "rgba(0,212,255,0.15)";
      const fontWeight = isActive ? "600" : "400";
      const glowBar = isActive
        ? '<div style="position:absolute;left:-28px;top:0;bottom:0;width:4px;border-radius:2px;background:#00d4ff;box-shadow:0 0 12px rgba(0,212,255,0.6)"></div>'
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
      <div style="position:absolute;left:120px;top:200px;bottom:200px;width:4px;background:rgba(0,212,255,0.3);border-radius:2px"></div>
      <div style="position:absolute;top:200px;left:180px;right:200px;text-align:left">
        <h3 style="color:#00d4ff;font-size:46px;font-weight:900;margin-bottom:8px">${esc(title)}</h3>
        <div class="accent-line-short" style="margin-left:0;margin-bottom:50px;width:200px"></div>
        ${bulletHtml}
      </div>
    </div>
  `);
}

function templateSteps(title: string, steps: string[], highlightIndex = -1): string {
  const stepsHtml = steps
    .map((step, i) => {
      const text = step.length > 100 ? step.slice(0, 97) + "..." : step;
      const isActive = highlightIndex === -1 || i === highlightIndex;
      const isPast = highlightIndex !== -1 && i < highlightIndex;
      const textColor = isActive ? "white" : isPast ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.2)";
      const circleBg = isActive
        ? "linear-gradient(135deg,#00d4ff,#7b2fff)"
        : isPast
          ? "linear-gradient(135deg,rgba(0,212,255,0.4),rgba(123,47,255,0.4))"
          : "linear-gradient(135deg,rgba(0,212,255,0.15),rgba(123,47,255,0.15))";
      const glow = isActive ? "box-shadow:0 0 16px rgba(0,212,255,0.4);" : "";
      return `
        <div style="display:flex;align-items:center;margin-bottom:36px">
          <div style="min-width:56px;height:56px;border-radius:50%;background:${circleBg};display:flex;align-items:center;justify-content:center;margin-right:28px;flex-shrink:0;${glow}">
            <span style="color:${isActive ? "white" : "rgba(255,255,255,0.5)"};font-size:24px;font-weight:900">${i + 1}</span>
          </div>
          <p style="color:${textColor};font-size:32px;line-height:1.35;font-weight:${isActive ? "600" : "400"}">${esc(text)}</p>
        </div>`;
    })
    .join("");

  return wrapHtml(`
    <div class="slide bg-dark">
      ${particles(4)}
      <div style="position:absolute;top:180px;left:200px;right:200px;text-align:left">
        <h3 style="color:#00d4ff;font-size:44px;font-weight:900;margin-bottom:8px">${esc(title)}</h3>
        <div class="accent-line-short" style="margin-left:0;margin-bottom:44px;width:200px"></div>
        ${stepsHtml}
      </div>
    </div>
  `);
}

function templateConclusion(recapPoints: string[]): string {
  const pointsHtml = recapPoints
    .map(
      (p) => `
      <div style="display:flex;align-items:center;margin-bottom:36px">
        <div style="min-width:10px;height:10px;border-radius:2px;background:#7b2fff;margin-right:20px;transform:rotate(45deg);flex-shrink:0"></div>
        <p style="color:#e0e0e0;font-size:32px;line-height:1.35;font-weight:400">${esc(p.length > 100 ? p.slice(0, 97) + "..." : p)}</p>
      </div>`,
    )
    .join("");

  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div style="position:absolute;top:220px;left:240px;right:240px;text-align:left">
        <div style="display:flex;align-items:center;margin-bottom:40px">
          <div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#00d4ff,#7b2fff);display:flex;align-items:center;justify-content:center;margin-right:20px">
            <span style="color:white;font-size:24px;font-weight:900">&#10003;</span>
          </div>
          <h3 style="color:white;font-size:48px;font-weight:900">Key Takeaways</h3>
        </div>
        <div class="accent-line-short" style="margin-left:0;margin-bottom:40px;width:260px"></div>
        ${pointsHtml}
      </div>
    </div>
  `);
}

function templateCTA(subscribeText: string): string {
  return wrapHtml(`
    <div class="slide bg-accent">
      ${particles(8)}
      <p style="color:#00d4ff;font-size:28px;letter-spacing:6px;font-weight:400;margin-bottom:40px">TOKNS.FI</p>
      <div style="background:#ff0000;border-radius:40px;padding:16px 80px;box-shadow:0 0 30px rgba(255,0,0,0.4)">
        <span style="color:white;font-size:36px;font-weight:900;letter-spacing:1px">SUBSCRIBE</span>
      </div>
      <p style="color:#888;font-size:24px;margin-top:50px">LIKE &amp; COMMENT FOR MORE CONTENT</p>
    </div>
  `);
}

function templateQuote(quote: string): string {
  return wrapHtml(`
    <div class="slide bg-gradient">
      ${particles(6)}
      <div class="corner-tl"></div><div class="corner-br"></div>
      <div style="max-width:1200px;text-align:center">
        <div style="color:rgba(0,212,255,0.3);font-size:160px;font-weight:900;line-height:0.6;margin-bottom:20px">&ldquo;</div>
        <p style="color:white;font-size:44px;font-weight:600;line-height:1.45;font-style:italic">${esc(quote)}</p>
      </div>
    </div>
  `);
}

// ---------------------------------------------------------------------------
// Build slides from script
// ---------------------------------------------------------------------------

export interface Slide {
  type: string;
  html: string;
  /** Approximate spoken text this slide covers (for duration weighting) */
  spokenText?: string;
}

export function buildSlidesFromScript(script: ScriptData): Slide[] {
  const slides: Slide[] = [];

  // Title — short pause, just the title on screen
  slides.push({
    type: "title",
    html: templateTitle(script.title || "Untitled"),
    spokenText: script.title || "",
  });

  // Hook — the opening hook text
  if (script.hook?.text) {
    slides.push({
      type: "quote",
      html: templateQuote(script.hook.text),
      spokenText: script.hook.text,
    });
  }

  // Main sections
  for (const section of script.mainContent?.sections || []) {
    // Section title card — brief transition
    slides.push({
      type: "section_title",
      html: templateSectionTitle(section.title || "Section", (section.type || "topic").toUpperCase()),
      spokenText: section.title || "",
    });

    const bullets = Array.isArray(section.content) ? section.content : [section.content].filter(Boolean);
    const bulletTexts = bullets.map((b) => (typeof b === "string" ? b : String(b)));

    // Each highlighted bullet gets the text for that specific bullet
    for (let c = 0; c < bulletTexts.length; c += 3) {
      const chunk = bulletTexts.slice(c, c + 3);
      for (let h = 0; h < chunk.length; h++) {
        slides.push({
          type: "bullets",
          html: templateBullets(section.title || "Details", chunk, h),
          spokenText: chunk[h], // only the active bullet's text
        });
      }
    }
  }

  // Conclusion — all recap points
  if (script.conclusion?.recap) {
    const recap = script.conclusion.recap.map((r) => (typeof r === "string" ? r : String(r)));
    slides.push({
      type: "conclusion",
      html: templateConclusion(recap),
      spokenText: recap.join(". "),
    });
  }

  // CTA — subscribe prompt + like/comment
  const ctaText = [
    script.callToAction?.subscribe,
    script.callToAction?.like,
    script.callToAction?.comment,
  ].filter(Boolean).join(". ");
  slides.push({
    type: "cta",
    html: templateCTA(script.callToAction?.subscribe || "Subscribe for more!"),
    spokenText: ctaText || "Subscribe for more content!",
  });

  return slides;
}

// ---------------------------------------------------------------------------
// Render slides to PNG via Playwright
// ---------------------------------------------------------------------------

export async function renderSlidesToImages(slides: Slide[], outputDir: string): Promise<string[]> {
  // Dynamic import — playwright may not be installed in all environments
  let chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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
