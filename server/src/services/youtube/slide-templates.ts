/**
 * YouTube Pipeline — Slide Templates
 *
 * Brand-specific color palettes and prompt builders for presentation slides.
 * Each template maps to a channel/brand identity.
 */

// ---------------------------------------------------------------------------
// Template interface
// ---------------------------------------------------------------------------

export interface SlideTemplate {
  name: string;
  channel: string;
  primary: string;
  primaryLight: string;
  primaryDark: string;
  secondary: string;
  primaryBg: string;
  secondaryBg: string;
  darkBg: string;
  text: string;
  bodyText: string;
  muted: string;
  cardBg: string;
  cardBorder: string;
  font: string;
  /** Extra accent colors for decorative particles */
  particles: string[];
}

// ---------------------------------------------------------------------------
// Template definitions
// ---------------------------------------------------------------------------

const coherencedaddy: SlideTemplate = {
  name: "coherencedaddy",
  channel: "COHERENCE DADDY",
  primary: "#FF876D",
  primaryLight: "#ffaa90",
  primaryDark: "#e0604a",
  secondary: "#00d4ff",
  primaryBg: "#0c0c0e",
  secondaryBg: "#1e1e1e",
  darkBg: "#111113",
  text: "#E2E2E2",
  bodyText: "rgba(216,216,216,0.7)",
  muted: "#6B6B6B",
  cardBg: "#1e1e1e",
  cardBorder: "#333333",
  font: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  particles: ["#FF876D", "#00d4ff", "#ffaa90", "#e0604a"],
};

const tx: SlideTemplate = {
  name: "tx",
  channel: "TX",
  primary: "#c0fd2d",
  primaryLight: "#d4ff6b",
  primaryDark: "#9acc22",
  secondary: "#9b47ff",
  primaryBg: "#171718",
  secondaryBg: "#1d1d1e",
  darkBg: "#0d0d0c",
  text: "#ffffff",
  bodyText: "rgba(255,255,255,0.7)",
  muted: "#a1a1aa",
  cardBg: "#1d1d1e",
  cardBorder: "#2a2a2b",
  font: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
  particles: ["#c0fd2d", "#9b47ff", "#22c55e", "#f59e0b"],
};

export const TEMPLATES: Record<string, SlideTemplate> = {
  coherencedaddy,
  tx,
};

// ---------------------------------------------------------------------------
// Template selection
// ---------------------------------------------------------------------------

export function getTemplate(name?: string): SlideTemplate {
  const key = name || process.env.YT_SLIDE_TEMPLATE || "coherencedaddy";
  return TEMPLATES[key] || coherencedaddy;
}

// ---------------------------------------------------------------------------
// Dynamic system prompt builder
// ---------------------------------------------------------------------------

export function buildSystemPrompt(t: SlideTemplate): string {
  return `You are an expert presentation designer creating premium, high-end YouTube slides. Generate a single HTML page at 1920x1080.

BRAND (${t.channel} — premium, high-end):
- Dark backgrounds: ${t.primaryBg}, ${t.secondaryBg}, ${t.darkBg} — rich near-black
- PRIMARY accent: ${t.primary} — headlines, key numbers, CTAs
- Primary gradient: linear-gradient(135deg, ${t.primary}, ${t.primaryDark})
- Light variant: ${t.primaryLight} for subtle highlights
- SECONDARY accent: ${t.secondary} — data highlights, tech elements
- Text: ${t.text} headings, ${t.bodyText} body, ${t.muted} captions
- Cards: ${t.cardBg} bg, border: 1px solid ${t.cardBorder}, border-radius: 16px
- Font: ${t.font}
- Channel: ${t.channel}

DESIGN QUALITY:
- Generous whitespace — 60px+ padding, 40px+ between elements
- Clean type hierarchy — max 2 font sizes per slide
- Decorative elements: SUBTLE thin lines, small dots, gentle glows — not chunky
- For checkmarks: simple CSS (circle + rotated border trick) — not emoji or heavy icons
- Cards: 48px+ padding, 16px border-radius, breathing room
- Max 3 cards per slide, never overflow
- Max 100 chars per text line

OUTPUT: Only a complete HTML document. No markdown fences. No JS, fonts, images, SVG.
Body must be exactly 1920x1080px with overflow:hidden.`;
}

// ---------------------------------------------------------------------------
// Dynamic base CSS builder
// ---------------------------------------------------------------------------

export function buildBaseCss(t: SlideTemplate): string {
  return `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px; overflow: hidden;
    font-family: ${t.font};
    -webkit-font-smoothing: antialiased;
  }
  .slide {
    width: 1920px; height: 1080px; position: relative;
    display: flex; flex-direction: column; justify-content: center; align-items: center;
    overflow: hidden;
  }
  .bg-gradient { background: linear-gradient(135deg, ${t.primaryBg} 0%, ${t.secondaryBg} 50%, ${t.darkBg} 100%); }
  .bg-dark { background: linear-gradient(160deg, ${t.primaryBg} 0%, ${t.secondaryBg} 100%); }
  .bg-accent { background: linear-gradient(135deg, ${t.secondaryBg} 0%, ${t.primaryBg} 100%); }
  .corner-tl, .corner-br { position: absolute; width: 80px; height: 80px; }
  .corner-tl { top: 60px; left: 60px; border-top: 2px solid ${hexToRgba(t.primary, 0.4)}; border-left: 2px solid ${hexToRgba(t.primary, 0.4)}; }
  .corner-br { bottom: 60px; right: 60px; border-bottom: 2px solid ${hexToRgba(t.secondary, 0.3)}; border-right: 2px solid ${hexToRgba(t.secondary, 0.3)}; }
  .accent-line { width: 400px; height: 3px; border-radius: 1.5px; background: linear-gradient(90deg, ${t.primary}, ${t.primaryDark}); margin: 0 auto 40px; }
  .accent-line-short { width: 200px; height: 2px; border-radius: 1px; background: linear-gradient(90deg, ${t.primary}, ${t.secondary}); margin-top: 12px; }
  .particle { position: absolute; border-radius: 50%; opacity: 0.1; }
`;
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

export { hexToRgba };
