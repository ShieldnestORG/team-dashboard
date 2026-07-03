// The caption-style data shape the Content Hub picker consumes.
// Data lives in styles.generated.ts (synced from caption_clip.py's STYLES by
// `pnpm caption-styles:sync`); this file is hand-written and stable.

/** Raw preset parameters, verbatim from the tool (for introspection only —
 * the tool renders from its own STYLES, never from this mirror). */
export interface CaptionStyleParams {
  fill: string;
  stroke: string | null;
  strokewidth: number;
  /** #RRGGBB or #RRGGBBAA background box; null = no box. */
  box: string | null;
  caps: boolean;
  shadow: boolean;
}

export interface CaptionStyle {
  /** Preset key — exactly what `caption_clip.py --style <name>` accepts. */
  name: string;
  /** One-line description, verbatim from the tool's --list-styles menu. */
  desc: string;
  /** Public path of the pre-rendered thumbnail (ui/public/caption-previews). */
  preview: string;
  /** True for the preset a burn with no --style flag uses (classic). */
  isDefault: boolean;
  /** True for the Coherence Daddy coral (#FF6B4A) box style. */
  isBrand: boolean;
  params: CaptionStyleParams;
}

export interface CaptionStyleSyncMeta {
  /** caption_clip.py path on the machine that ran the sync. */
  sourcePath: string;
  /** sha256 (hex) of the canonical STYLES payload at sync time. */
  sha256: string;
  /** ISO timestamp of the last `pnpm caption-styles:sync` run. */
  syncedAt: string;
  /** The cue text rendered into every preview thumbnail. */
  sampleText: string;
}
