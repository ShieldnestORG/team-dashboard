/**
 * YouTube Pipeline — Site Walker
 *
 * Browser agent that visits a target URL with Playwright, scrolls through it
 * detecting sections, captures 1920x1080 screenshots, and extracts text content.
 * Outputs data for the walkthrough-writer to generate a narrated script.
 */

import { mkdir } from "fs/promises";
import { join } from "path";
import { logger } from "../../middleware/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SiteSection {
  index: number;
  heading: string;
  textContent: string;
  screenshotPath: string;
}

export interface SiteWalkResult {
  url: string;
  pageTitle: string;
  metaDescription: string;
  sections: SiteSection[];
}

// ---------------------------------------------------------------------------
// Brand overlay constants (matches presentation-renderer.ts)
// ---------------------------------------------------------------------------

const BRAND = {
  primaryBg: "#0a0a2e",
  cyan: "#00d4ff",
  white: "#ffffff",
  channel: "TOKNS.FI",
};

const MAX_SECTIONS = 12;
const MIN_SECTIONS = 3;
const SCROLL_SETTLE_MS = 1200;
const VIEWPORT = { width: 1920, height: 1080 };

// Realistic user agent to reduce bot blocking
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function walkSite(url: string, outputDir: string): Promise<SiteWalkResult> {
  // Dynamic import — same pattern as presentation-renderer.ts
  let chromium: { launch: (opts: Record<string, unknown>) => Promise<unknown> };
  try {
    const pw = await (Function('return import("playwright")')() as Promise<{ chromium: typeof chromium }>);
    chromium = pw.chromium;
  } catch {
    throw new Error("Playwright not available. Install with: npx playwright install chromium");
  }

  await mkdir(outputDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-blink-features=AutomationControlled"],
  }) as {
    newPage: (opts?: Record<string, unknown>) => Promise<PlaywrightPage>;
    close: () => Promise<void>;
  };

  try {
    const page = await browser.newPage({ ignoreHTTPSErrors: true });
    await page.setViewportSize(VIEWPORT);
    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });

    // Navigate — try networkidle first, fall back to domcontentloaded for SPAs
    logger.info({ url }, "Site Walker: navigating to target URL");
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 20_000 });
    } catch {
      logger.info("Site Walker: networkidle timed out, trying domcontentloaded...");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // Give SPA extra time to render
      await page.waitForTimeout(5000);
    }

    // Dismiss cookie banners
    await dismissCookieBanners(page);

    // Hide sticky elements that would clutter every screenshot
    await hideStickyElements(page);

    // Extract page metadata
    const pageTitle = await page.evaluate("document.title") as string;
    const metaDescription = await page.evaluate(
      `document.querySelector('meta[name="description"]')?.getAttribute('content') || ""`,
    ) as string;

    // Detect sections
    let sectionData = await detectSections(page);

    // Enforce minimum — fall back to viewport chunks
    if (sectionData.length < MIN_SECTIONS) {
      logger.info("Site Walker: too few semantic sections, falling back to viewport chunks");
      sectionData = await viewportChunkFallback(page);
    }

    // Cap at maximum
    sectionData = sectionData.slice(0, MAX_SECTIONS);

    // Walk each section: scroll, overlay, screenshot, extract text
    const sections: SiteSection[] = [];
    for (let i = 0; i < sectionData.length; i++) {
      const sd = sectionData[i];
      const heading = sd.heading || (i === 0 ? "Hero" : `Section ${i + 1}`);
      const slug = heading
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 30);
      const filename = `walk_${String(i).padStart(3, "0")}_${slug || "section"}.png`;
      const screenshotPath = join(outputDir, filename);

      // Scroll to section
      if (sd.selector) {
        await page.evaluate(`document.querySelector('${sd.selector}')?.scrollIntoView({ behavior: 'smooth' })`);
      } else if (sd.scrollY !== undefined) {
        await page.evaluate(`window.scrollTo({ top: ${sd.scrollY}, behavior: 'smooth' })`);
      }
      await page.waitForTimeout(SCROLL_SETTLE_MS);

      // Inject branded overlay
      await injectOverlay(page, heading, i + 1, sectionData.length);

      // Screenshot
      await page.screenshot({ path: screenshotPath, type: "png" });

      // Remove overlay
      await page.evaluate(`document.getElementById('sw-overlay-top')?.remove(); document.getElementById('sw-overlay-bottom')?.remove();`);

      sections.push({
        index: i,
        heading,
        textContent: sd.textContent.slice(0, 2000), // cap text length
        screenshotPath,
      });

      logger.info({ section: i + 1, total: sectionData.length, heading }, "Site Walker: captured section");
    }

    logger.info({ url, sectionCount: sections.length }, "Site Walker: walk complete");
    return { url, pageTitle, metaDescription, sections };
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Section detection (3-tier fallback)
// ---------------------------------------------------------------------------

interface DetectedSection {
  heading: string;
  textContent: string;
  selector?: string;
  scrollY?: number;
}

async function detectSections(page: PlaywrightPage): Promise<DetectedSection[]> {
  // Tier 1: Semantic HTML sections
  const semantic = await page.evaluate(`
    (() => {
      const els = document.querySelectorAll('section, [role="region"], article, main > div');
      const results = [];
      for (const el of els) {
        if (el.offsetHeight < 100) continue;
        const heading = el.querySelector('h1, h2, h3')?.textContent?.trim() || '';
        const text = el.textContent?.trim().replace(/\\s+/g, ' ').slice(0, 2000) || '';
        if (text.length < 20) continue;
        // Build a unique selector
        let selector = '';
        if (el.id) selector = '#' + CSS.escape(el.id);
        else if (el.className && typeof el.className === 'string') {
          const cls = el.className.split(' ').filter(c => c.trim()).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
          selector = el.tagName.toLowerCase() + cls;
        } else {
          selector = el.tagName.toLowerCase();
        }
        results.push({ heading, textContent: text, selector });
      }
      return results;
    })()
  `) as DetectedSection[];

  if (semantic.length >= MIN_SECTIONS) {
    logger.info({ count: semantic.length }, "Site Walker: detected semantic sections");
    return deduplicateSections(semantic);
  }

  // Tier 2: Split by headings
  const headingSections = await page.evaluate(`
    (() => {
      const headings = document.querySelectorAll('h1, h2, h3');
      const results = [];
      for (const h of headings) {
        const heading = h.textContent?.trim() || '';
        if (!heading || heading.length < 2) continue;
        // Gather text content from siblings until next heading
        let text = '';
        let sibling = h.nextElementSibling;
        while (sibling && !['H1','H2','H3'].includes(sibling.tagName)) {
          text += (sibling.textContent?.trim() || '') + ' ';
          sibling = sibling.nextElementSibling;
        }
        let selector = '';
        if (h.id) selector = '#' + CSS.escape(h.id);
        else selector = h.tagName.toLowerCase() + ':nth-of-type(' + (Array.from(document.querySelectorAll(h.tagName)).indexOf(h) + 1) + ')';
        results.push({ heading, textContent: text.trim().slice(0, 2000), selector });
      }
      return results;
    })()
  `) as DetectedSection[];

  if (headingSections.length >= MIN_SECTIONS) {
    logger.info({ count: headingSections.length }, "Site Walker: detected heading-based sections");
    return deduplicateSections(headingSections);
  }

  // Tier 3 handled by caller (viewportChunkFallback)
  return semantic.length > headingSections.length ? semantic : headingSections;
}

async function viewportChunkFallback(page: PlaywrightPage): Promise<DetectedSection[]> {
  const totalHeight = await page.evaluate("document.body.scrollHeight") as number;
  const chunkHeight = VIEWPORT.height;
  const numChunks = Math.min(8, Math.max(MIN_SECTIONS, Math.ceil(totalHeight / chunkHeight)));
  const sections: DetectedSection[] = [];

  for (let i = 0; i < numChunks; i++) {
    const scrollY = i * chunkHeight;
    // Extract visible text around this scroll position
    const textContent = await page.evaluate(`
      (() => {
        window.scrollTo(0, ${scrollY});
        const viewportH = ${chunkHeight};
        const els = document.querySelectorAll('h1, h2, h3, p, li, span, td');
        let text = '';
        for (const el of els) {
          const rect = el.getBoundingClientRect();
          if (rect.top >= 0 && rect.bottom <= viewportH && rect.height > 0) {
            text += (el.textContent?.trim() || '') + ' ';
          }
        }
        return text.trim().replace(/\\s+/g, ' ').slice(0, 2000);
      })()
    `) as string;

    // Try to find a heading in this viewport
    const heading = await page.evaluate(`
      (() => {
        const viewportH = ${chunkHeight};
        const headings = document.querySelectorAll('h1, h2, h3');
        for (const h of headings) {
          const rect = h.getBoundingClientRect();
          if (rect.top >= -50 && rect.top <= viewportH) return h.textContent?.trim() || '';
        }
        return '';
      })()
    `) as string;

    sections.push({
      heading: heading || (i === 0 ? "Welcome" : `Page Section ${i + 1}`),
      textContent: textContent || "Visual content section",
      scrollY,
    });
  }

  logger.info({ chunks: sections.length }, "Site Walker: viewport chunk fallback");
  return sections;
}

// ---------------------------------------------------------------------------
// Cookie banner dismissal
// ---------------------------------------------------------------------------

async function dismissCookieBanners(page: PlaywrightPage): Promise<void> {
  try {
    const dismissed = await page.evaluate(`
      (() => {
        const patterns = [
          'Accept all', 'Accept All', 'Accept cookies', 'Accept Cookies',
          'Accept', 'OK', 'Got it', 'Got It', 'I agree', 'I Agree',
          'Allow all', 'Allow All', 'Agree', 'Close',
        ];
        const buttons = document.querySelectorAll('button, a[role="button"], [class*="cookie"] button, [class*="consent"] button, [id*="cookie"] button');
        for (const btn of buttons) {
          const text = btn.textContent?.trim() || '';
          if (patterns.some(p => text === p || text.startsWith(p))) {
            (btn as HTMLElement).click();
            return true;
          }
        }
        return false;
      })()
    `) as boolean;
    if (dismissed) {
      await page.waitForTimeout(500);
      logger.info("Site Walker: dismissed cookie banner");
    }
  } catch {
    // Non-blocking — cookie banners are optional
  }
}

// ---------------------------------------------------------------------------
// Hide sticky elements
// ---------------------------------------------------------------------------

async function hideStickyElements(page: PlaywrightPage): Promise<void> {
  try {
    await page.evaluate(`
      (() => {
        const all = document.querySelectorAll('*');
        let hidden = 0;
        for (const el of all) {
          const style = window.getComputedStyle(el);
          if ((style.position === 'fixed' || style.position === 'sticky') && el.tagName !== 'HTML' && el.tagName !== 'BODY') {
            const rect = el.getBoundingClientRect();
            // Only hide navbars/banners (top or bottom of viewport)
            if (rect.height < 200 && (rect.top < 100 || rect.bottom > window.innerHeight - 100)) {
              (el as HTMLElement).style.display = 'none';
              hidden++;
            }
          }
        }
        return hidden;
      })()
    `);
  } catch {
    // Non-blocking
  }
}

// ---------------------------------------------------------------------------
// Branded overlay injection
// ---------------------------------------------------------------------------

async function injectOverlay(
  page: PlaywrightPage,
  heading: string,
  current: number,
  total: number,
): Promise<void> {
  const escapedHeading = heading.replace(/'/g, "\\'").replace(/"/g, '\\"');
  await page.evaluate(`
    (() => {
      // Top bar
      const top = document.createElement('div');
      top.id = 'sw-overlay-top';
      top.style.cssText = 'position:fixed;top:0;left:0;right:0;height:64px;background:linear-gradient(180deg,rgba(10,10,46,0.92),rgba(10,10,46,0.6));display:flex;align-items:center;padding:0 40px;z-index:999999;backdrop-filter:blur(4px)';
      top.innerHTML = '<span style="color:#00d4ff;font-size:26px;font-weight:700;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif;letter-spacing:0.5px">${escapedHeading}</span>';
      document.body.appendChild(top);

      // Bottom bar
      const bottom = document.createElement('div');
      bottom.id = 'sw-overlay-bottom';
      bottom.style.cssText = 'position:fixed;bottom:0;left:0;right:0;height:48px;background:linear-gradient(0deg,rgba(10,10,46,0.92),rgba(10,10,46,0.6));display:flex;align-items:center;justify-content:space-between;padding:0 40px;z-index:999999;backdrop-filter:blur(4px)';
      bottom.innerHTML = '<span style="color:#00d4ff;font-size:18px;font-weight:600;letter-spacing:4px;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif">TOKNS.FI</span><span style="color:rgba(255,255,255,0.7);font-size:16px;font-family:Segoe UI,Helvetica Neue,Arial,sans-serif">${current} / ${total}</span>';
      document.body.appendChild(bottom);
    })()
  `);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deduplicateSections(sections: DetectedSection[]): DetectedSection[] {
  const seen = new Set<string>();
  return sections.filter((s) => {
    const key = s.heading.toLowerCase().trim();
    if (key && seen.has(key)) return false;
    if (key) seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Playwright page type (minimal interface to avoid import issues)
// ---------------------------------------------------------------------------

interface PlaywrightPage {
  setViewportSize(size: { width: number; height: number }): Promise<void>;
  setExtraHTTPHeaders(headers: Record<string, string>): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  screenshot(opts: { path: string; type: string }): Promise<void>;
}
