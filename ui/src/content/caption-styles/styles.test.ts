// Validates the committed caption-style module (synced by
// `pnpm caption-styles:sync`) against what the picker + agent endpoint depend
// on. Pure data — node env. The preview PNGs themselves are asserted by
// existsSync so a sync that forgot to commit the images fails here.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CAPTION_STYLES, CAPTION_STYLE_SYNC_META } from "./index";

const PUBLIC_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../public",
);

describe("caption-styles committed data", () => {
  it("contains the six tool presets, sorted like --list-styles", () => {
    const names = CAPTION_STYLES.map((style) => style.name);
    expect(names).toEqual(["beast", "boxed", "classic", "clean", "coral", "outline"]);
  });

  it("every style satisfies the basic shape", () => {
    for (const style of CAPTION_STYLES) {
      // The name is passed verbatim as `--style <name>` — keep it shell-safe.
      expect(style.name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(style.desc.length).toBeGreaterThan(10);
      expect(style.preview).toBe(`/caption-previews/${style.name}.png`);
      expect(style.params.strokewidth).toBeGreaterThanOrEqual(0);
      if (style.params.box !== null) {
        expect(style.params.box).toMatch(/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/);
      }
    }
  });

  it("exactly one default (classic — the tool's no-flag behavior)", () => {
    const defaults = CAPTION_STYLES.filter((style) => style.isDefault);
    expect(defaults.map((style) => style.name)).toEqual(["classic"]);
  });

  it("exactly one brand style (coral on the #FF6B4A box)", () => {
    const brand = CAPTION_STYLES.filter((style) => style.isBrand);
    expect(brand.map((style) => style.name)).toEqual(["coral"]);
    expect(brand[0].params.box?.toUpperCase().startsWith("#FF6B4A")).toBe(true);
  });

  it("every preview PNG is committed next to the module", () => {
    for (const style of CAPTION_STYLES) {
      expect(
        existsSync(path.join(PUBLIC_DIR, style.preview)),
        `missing ${style.preview} — run \`pnpm caption-styles:sync\` and commit`,
      ).toBe(true);
    }
  });

  it("sync meta is well-formed and the sample fits one cue", () => {
    expect(CAPTION_STYLE_SYNC_META.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isNaN(Date.parse(CAPTION_STYLE_SYNC_META.syncedAt))).toBe(false);
    // caption_clip groups cues at max 4 words / 26 chars — the preview line
    // must be a realistic single cue, not a paragraph.
    expect(CAPTION_STYLE_SYNC_META.sampleText.length).toBeLessThanOrEqual(26);
    expect(CAPTION_STYLE_SYNC_META.sampleText.split(/\s+/).length).toBeLessThanOrEqual(4);
  });
});
