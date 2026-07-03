// CONTRACT-2 — the kit data shape the Content Hub UI consumes.
// Data lives in kits.generated.ts (synced from the marketing plan md by
// `pnpm kits:sync`); this file is hand-written and stable.

/** Persona key for the voice-snippet factory (server-side voice registry). */
export type KitVoiceKey = "mark" | "brianna" | "mami" | "remy" | "solene";

/** A best-effort labeled field parsed out of the kit block (copy buttons). */
export interface KitField {
  label: string;
  value: string;
}

/** A line meant to be read aloud — input for the voice chips. Never contains `{link}`. */
export interface KitSpokenLine {
  voiceKey: string;
  label: string;
  text: string;
}

export interface MarketingKit {
  /** KIT number from the plan (0–9). */
  id: number;
  /** Heading text after "KIT N — " (verbatim, including any trailing marker). */
  title: string;
  /** KIT 0 is Eagan's end-card pack; everything else is a keyword funnel. */
  kind: "endcard-pack" | "funnel";
  /**
   * The kit's fenced block, VERBATIM from the plan md (UTF-8/emoji byte-exact).
   * This is what "copy whole kit" copies — the fields below are best-effort.
   */
  raw: string;
  /** Primary trigger keyword (e.g. "ROOM"). Absent on the end-card pack. */
  keyword?: string;
  /** Account line up to the voice marker (e.g. "@coherencedaddy (IG)"). */
  account?: string;
  /** Which registered voice reads this kit's spoken lines. */
  voiceKey?: KitVoiceKey;
  /**
   * Every clickTag value found in the block. KIT 1 intentionally carries BOTH
   * "ig-room" (keyword doc line) and "room" (as-built live automation) — a
   * source-doc conflict surfaced, not averaged.
   */
  clickTags?: string[];
  fields: KitField[];
  spokenLines: KitSpokenLine[];
  /**
   * Hand-maintained buildability fallback mirroring the board's badges.
   * NEVER render this as live funnel status — live green/amber/red comes from
   * GET /api/socials/zernio/greenlight.
   */
  staticStatus?: "live" | "plan" | "defer";
  subtitle?: string;
}

export interface KitSyncMeta {
  sourcePath: string;
  /** sha256 (hex) of the plan's §6 slice at sync time. */
  sha256: string;
  /** ISO timestamp of the last `pnpm kits:sync` run. */
  syncedAt: string;
}
