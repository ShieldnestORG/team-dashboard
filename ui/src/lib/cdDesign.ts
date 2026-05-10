// Coherence Daddy design system tokens — mirrors coherencedaddy-landing/DESIGN.md
// Single source of truth for the affiliate-facing surfaces.
// If you change these, also update AffiliateLanding.tsx (which inlines them
// historically — kept in sync for now).
//
// Anti-patterns enforced:
//   - No #ff876d (peachy). Coral is #FF6B4A.
//   - No cyan, no purple, no neon — Rizz Coral is the ONLY accent.
//   - No h-screen — use min-h-[100dvh] via CDPage.
//   - No colored drop-shadow glows on buttons — use LIFT_SHADOW only.
//   - No circular spinners at page scale — use the inline text loader pattern.
//   - JetBrains Mono for numbers, timestamps, percentages, tier names.
//   - Geist Sans for everything else.

import { useEffect } from "react";

export const CD = {
  canvas: "#0E0E10",
  surface: "#18181B",
  surfaceAlt: "#1F1F22",
  ink: "#F2F1ED",
  muted: "#A1A1A6",
  mutedSoft: "rgba(255,255,255,0.45)",
  border: "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  accent: "#FF6B4A",
  accentPressed: "#E5553A",
  success: "#4A9D7C",
  danger: "#D94343",
} as const;

// Pinstripe — ambient page background (DESIGN.md textures.pinstripe).
// Apply as `backgroundImage` on the page root, beneath all section content.
export const PINSTRIPE =
  "repeating-linear-gradient(0deg, transparent 0px, transparent 3px, rgba(255,255,255,0.05) 3px, rgba(255,255,255,0.05) 4px)";

// Neutral "lift" shadow — mirrors .btn-lift in coherencedaddy-landing/app/globals.css.
// Dark drops + subtle inset top highlight. NO colored glow (DESIGN.md §4).
export const LIFT_SHADOW =
  "0 10px 24px -8px rgba(0,0,0,0.55), 0 2px 6px -1px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)";
export const LIFT_SHADOW_HOVER =
  "0 18px 36px -10px rgba(0,0,0,0.65), 0 4px 12px -2px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.22)";

export const FONT_SANS =
  '"Geist", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const FONT_MONO =
  '"Geist Mono", ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace';

// labelCaps style — DESIGN.md typography.labelCaps.
export const LABEL_CAPS_STYLE: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: "0.6875rem",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
};

// Format cents → "$1,234.56".
export function formatDollars(cents: number): string {
  const dollars = (cents || 0) / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// Compact dollar format for hero stats — "$12.4K".
export function formatDollarsCompact(cents: number): string {
  const dollars = (cents || 0) / 100;
  if (Math.abs(dollars) >= 1000) {
    return `$${(dollars / 1000).toLocaleString("en-US", {
      maximumFractionDigits: 1,
    })}K`;
  }
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

// Lazy-load Geist + Geist Mono once per page lifecycle.
export function useGeistFonts() {
  useEffect(() => {
    const id = "cd-geist-fonts";
    if (document.getElementById(id)) return;
    const pre1 = document.createElement("link");
    pre1.rel = "preconnect";
    pre1.href = "https://fonts.googleapis.com";
    const pre2 = document.createElement("link");
    pre2.rel = "preconnect";
    pre2.href = "https://fonts.gstatic.com";
    pre2.crossOrigin = "anonymous";
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@500;600&display=swap";
    document.head.append(pre1, pre2, link);
  }, []);
}
