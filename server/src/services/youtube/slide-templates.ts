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

// Coherence Daddy canonical design system. Source of truth lives in the
// storefront repo at coherencedaddy-landing/app/globals.css (Tailwind v4
// `@theme inline` block) and in the public tutorial decks at
// github.com/Coherence-Daddy/{give-claude-a-workflow,
// give-claude-an-organized-brain, use-ollama-to-enhance-claude}/index.html.
// See docs/products/youtube-slide-design-system.md for the full reference.
//
// Banned per the brand: pure #000 / #fff (use Deep Canvas / Paper Ink),
// cyan #00d4ff (replaced with the canonical link-blue), Inter (replaced
// with Geist Sans), gradient text on headings.
const coherencedaddy: SlideTemplate = {
  name: "coherencedaddy",
  channel: "COHERENCE DADDY",
  primary: "#FF6B4A",        // Rizz Coral — THE accent
  primaryLight: "#FF8A6B",   // softer coral for subtle highlights
  primaryDark: "#E5553A",    // Pressed Coral (:active state)
  secondary: "#5B9DF9",      // canonical link blue (replaces banned cyan)
  primaryBg: "#0E0E10",      // Deep Canvas (off-black, pure #000 banned)
  secondaryBg: "#18181B",    // Raised Surface (cards, dialogs)
  darkBg: "#1D1D20",         // Surface-2 (elevated cards)
  text: "#F2F1ED",           // Paper Ink (warm off-white, pure #fff banned)
  bodyText: "rgba(242,241,237,0.7)",  // Paper Ink at 70%
  muted: "#A1A1A6",          // Muted Fog
  cardBg: "#18181B",
  cardBorder: "rgba(255,255,255,0.08)",  // Whisper Line
  // Geist is the canonical face. In the Puppeteer rendering environment
  // we depend on the @import in buildBaseCss to load it from Google Fonts;
  // the fallback chain lands on platform sans-serif if the network call
  // fails. Inter is intentionally absent from the cascade — banned per brand.
  font: "'Geist', 'Geist Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  particles: ["#FF6B4A", "#5B9DF9", "#FF8A6B", "#E5553A"],
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
  return `You are an expert presentation designer creating slides for the ${t.channel} ecosystem at 1920x1080. The brand is minimalist editorial with a single coral accent — calm, type-driven, faith-driven, intentionally not corporate, not "AI-slop premium".

BRAND TOKENS (${t.channel}):
- Deep Canvas: ${t.primaryBg} — primary background (off-black, pure #000 BANNED)
- Raised Surface: ${t.secondaryBg} — cards
- Surface-2: ${t.darkBg} — elevated cards
- Paper Ink: ${t.text} — primary text (warm off-white, pure #fff BANNED)
- Muted Fog: ${t.muted} — captions, metadata
- Body at 70%: ${t.bodyText}
- Rizz Coral: ${t.primary} — THE accent. Headlines emphasis, active state, key numbers
- Coral light: ${t.primaryLight}, pressed: ${t.primaryDark}
- Link Blue: ${t.secondary} — links, secondary accent ONLY (cyan #00d4ff is BANNED)
- Whisper Line: ${t.cardBorder} — 1px structural borders
- Font: ${t.font} (Geist Sans loaded via Google Fonts; Inter is BANNED)

DESIGN PRINCIPLES:
- Hierarchy from weight × color contrast × space — never massive font sizes (h1 ceiling 4.5rem)
- Generous whitespace: 60px+ padding, 40px+ between elements
- Cards: ${t.cardBg} fill, 1px ${t.cardBorder} border, 16px radius
- Eyebrow labels are uppercase mono, 0.18em letter-spacing, coral, with a 28px leading rule (::before width:28px height:1px background:coral)
- Subtle 1px coral left rail for visual rhythm — never chunky
- Numbers (3+ digits, percentages, scores): use a mono fallback like 'JetBrains Mono', monospace
- Glow on coral active states: box-shadow with rgba(255,107,74,0.35) — sparingly
- Letter-spacing -0.02em on body, -0.035em on headlines

BANNED: pure #000/#fff, cyan, Inter font, gradient text on headings, emoji, circular spinners, centered hero compositions.

OUTPUT: complete HTML document only. No markdown fences. No JS, no SVG.
Body exactly 1920x1080px with overflow:hidden.`;
}

// ---------------------------------------------------------------------------
// Dynamic base CSS builder
// ---------------------------------------------------------------------------

export function buildBaseCss(t: SlideTemplate): string {
  return `
  @import url('https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    width: 1920px; height: 1080px; overflow: hidden;
    font-family: ${t.font};
    background: ${t.primaryBg};
    color: ${t.text};
    -webkit-font-smoothing: antialiased;
    letter-spacing: -0.02em;
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
