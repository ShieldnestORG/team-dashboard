// Marketing kits (Content Hub data module).
// Data is synced from the marketing plan md — see kits.generated.ts header
// for the refresh path (`pnpm kits:sync` on a dev machine, then commit).
export { KITS, KIT_SYNC_META } from "./kits.generated";
export type {
  MarketingKit,
  KitField,
  KitSpokenLine,
  KitSyncMeta,
  KitVoiceKey,
} from "./types";
