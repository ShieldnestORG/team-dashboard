// Caption style presets (Content Hub data module).
// Data is synced from caption_clip.py — see styles.generated.ts header for
// the refresh path (`pnpm caption-styles:sync` on a dev machine, then commit).
export { CAPTION_STYLES, CAPTION_STYLE_SYNC_META } from "./styles.generated";
export type {
  CaptionStyle,
  CaptionStyleParams,
  CaptionStyleSyncMeta,
} from "./types";
