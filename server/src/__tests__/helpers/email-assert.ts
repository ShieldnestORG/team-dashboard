// Shared assertions for the branded-email tests. The house email look is a
// closed palette, PNG-only images, ink labels on coral and ink underlined links;
// these helpers check a rendered HTML string against exactly those rules.

import { expect } from "vitest";
import { CORAL, INK, MONOGRAM_URL, CORAL_RULE_URL } from "../../services/email-theme.js";

// Palette from coherencedaddy-landing emails/theme.ts (+ its DARK_MODE_CSS
// counterparts). Any other hex in a rendered email is a drift from the kit.
export const ALLOWED_HEX = new Set(
  [
    "#F8F7F4", // PAPER
    "#0E0E10", // INK
    "#57554F", // MUTED
    "#8A8780", // FAINT
    "#E5E2DC", // HAIRLINE
    "#FFFFFF", // CARD
    "#FF6B4A", // CORAL
    // dark-mode counterparts (inside the prefers-color-scheme block only)
    "#101017",
    "#191927",
    "#F2F1EE",
    "#C7C5BF",
    "#8E8C86",
    "#34343F", // dark-mode hairline
  ].map((s) => s.toUpperCase()),
);

export function hexColours(html: string): string[] {
  return [...html.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toUpperCase());
}

/** Every `style="..."` colour value must come from the kit; white is only ever the card surface. */
export function expectKitPaletteOnly(html: string): void {
  const stray = hexColours(html).filter((c) => !ALLOWED_HEX.has(c));
  expect(stray, `colours outside the house palette: ${[...new Set(stray)].join(", ")}`).toEqual([]);
  expect(html).not.toMatch(/rgba?\(/i);
  // Text colour is never white: a label on coral is ink, body text is ink/muted/faint.
  expect(html).not.toMatch(/[^-]color\s*:\s*(#fff(fff)?\b|white\b)/i);
}

/** Images are PNG (or the sharer QR's cid:), never SVG. */
export function expectPngImagesOnly(html: string): void {
  expect(html).not.toMatch(/<svg/i);
  const srcs = [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)].map((m) => m[1]);
  for (const s of srcs) {
    expect(s.startsWith("cid:") || /^https:\/\/coherencedaddy\.com\/brand\/.+\.png$/.test(s), `image src ${s}`).toBe(true);
  }
}

export function expectBrandHeader(html: string): void {
  expect(html).toContain(`src="${MONOGRAM_URL}"`);
  expect(html).toContain(`src="${CORAL_RULE_URL}"`);
  expect(html).toMatch(/alt="Coherence Daddy"/);
  expect(html).toMatch(/<html lang="en"/);
  expect(html).toMatch(/name="color-scheme" content="light dark"/);
}

/** Every coral surface carries an ink label. */
export function expectInkOnCoral(html: string): void {
  const coralCells = [...html.matchAll(/<td\b[^>]*bgcolor="#FF6B4A"[^>]*>([\s\S]*?)<\/td>/gi)];
  for (const m of coralCells) {
    const anchor = m[1].match(/<a\b[^>]*style="([^"]*)"/i);
    expect(anchor, "a coral cell holds a link").not.toBeNull();
    expect(anchor![1]).toContain(`color:${INK}`);
  }
  // Nothing else may paint coral behind text.
  const coralBackgrounds = [...html.matchAll(/background(?:-color)?\s*:\s*#FF6B4A/gi)].length;
  expect(coralBackgrounds).toBe(coralCells.length);
  expect(CORAL).toBe("#FF6B4A");
}

/** Body links are ink + underlined (the coral button anchor is the one exception). */
export function expectInkUnderlinedLinks(html: string): void {
  const anchors = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => m[0]);
  for (const a of anchors) {
    const style = a.match(/style="([^"]*)"/i)?.[1] ?? "";
    const isButton = /display:inline-block/.test(style) && /padding:14px 26px/.test(style);
    if (isButton) {
      expect(style).toContain(`color:${INK}`);
      continue;
    }
    expect(style, a).toContain(`color:${INK}`);
    expect(style, a).toContain("text-decoration:underline");
  }
}
