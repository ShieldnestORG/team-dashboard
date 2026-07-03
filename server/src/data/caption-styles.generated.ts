// ============================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND. (scripts/import-caption-styles.py)
//
// Source: /Users/exe/Downloads/Claude/6-2026-new-youtube-automation/tools/caption_clip.py (STYLES)
// STYLES sha256: 96861c0e6ec36a82387ff4d4b473c5a074d215a0155a0240772904484ad3b794
// Synced: 2026-07-03T05:28:54.989Z
//
// Refresh path: edit STYLES in caption_clip.py → `pnpm caption-styles:sync`
// (regenerates BOTH data modules + the preview PNGs) → commit the whole diff.
// Verify drift: `pnpm caption-styles:sync --check` (exits 1 when the tool's
// STYLES and the committed modules differ; render-only changes need a re-run).
// ============================================================================
// Self-contained twin of ui/src/content/caption-styles (server and ui are
// separate TS projects). Served verbatim by GET /api/socials/caption-styles.

export interface CaptionStyleParams {
  fill: string;
  stroke: string | null;
  strokewidth: number;
  box: string | null;
  caps: boolean;
  shadow: boolean;
}

export interface CaptionStyle {
  name: string;
  desc: string;
  /** UI-origin public path (the API host does not serve these images). */
  preview: string;
  isDefault: boolean;
  isBrand: boolean;
  params: CaptionStyleParams;
}

export interface CaptionStyleSyncMeta {
  sourcePath: string;
  sha256: string;
  syncedAt: string;
  sampleText: string;
}

export const CAPTION_STYLE_SYNC_META: CaptionStyleSyncMeta = {
  "sourcePath": "/Users/exe/Downloads/Claude/6-2026-new-youtube-automation/tools/caption_clip.py",
  "sha256": "96861c0e6ec36a82387ff4d4b473c5a074d215a0155a0240772904484ad3b794",
  "syncedAt": "2026-07-03T05:28:54.989Z",
  "sampleText": "Comment ROOM to start"
};

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    "name": "beast",
    "desc": "Bold yellow ALL-CAPS, heavy outline — viral thumbnail energy",
    "preview": "/caption-previews/beast.png",
    "isDefault": false,
    "isBrand": false,
    "params": {
      "fill": "#FFD400",
      "stroke": "black",
      "strokewidth": 4,
      "box": null,
      "caps": true,
      "shadow": false
    }
  },
  {
    "name": "boxed",
    "desc": "White on a translucent black box — podcast/interview style",
    "preview": "/caption-previews/boxed.png",
    "isDefault": false,
    "isBrand": false,
    "params": {
      "fill": "white",
      "stroke": null,
      "strokewidth": 0,
      "box": "#000000B4",
      "caps": false,
      "shadow": false
    }
  },
  {
    "name": "classic",
    "desc": "White text, black outline — the default reels look",
    "preview": "/caption-previews/classic.png",
    "isDefault": true,
    "isBrand": false,
    "params": {
      "fill": "white",
      "stroke": "black",
      "strokewidth": 2,
      "box": null,
      "caps": false,
      "shadow": false
    }
  },
  {
    "name": "clean",
    "desc": "Plain white with a soft drop shadow — minimal/modern",
    "preview": "/caption-previews/clean.png",
    "isDefault": false,
    "isBrand": false,
    "params": {
      "fill": "white",
      "stroke": null,
      "strokewidth": 0,
      "box": null,
      "caps": false,
      "shadow": true
    }
  },
  {
    "name": "coral",
    "desc": "White on the brand coral (#FF6B4A) box — Coherence Daddy style",
    "preview": "/caption-previews/coral.png",
    "isDefault": false,
    "isBrand": true,
    "params": {
      "fill": "white",
      "stroke": null,
      "strokewidth": 0,
      "box": "#FF6B4AE6",
      "caps": false,
      "shadow": false
    }
  },
  {
    "name": "outline",
    "desc": "White with extra-thick black outline — for busy backgrounds",
    "preview": "/caption-previews/outline.png",
    "isDefault": false,
    "isBrand": false,
    "params": {
      "fill": "white",
      "stroke": "black",
      "strokewidth": 5,
      "box": null,
      "caps": false,
      "shadow": false
    }
  }
];
