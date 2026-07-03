import type { MarketingKit } from "@/content/marketing-kits";
import type { ZernioGreenlightRow } from "@/api/socials";

// Pure helpers for the Content Hub pages — no React, no DOM. Tested
// env-free in kit-status.test.ts.

/**
 * Persona display names. NEVER show raw ElevenLabs voice names ("Michelle",
 * "Lison", ...) — they differ wildly from the personas and would confuse
 * marketing users.
 */
export const PERSONA_NAMES: Record<string, string> = {
  mark: "Mark",
  brianna: "Brianna",
  mami: "Mami",
  remy: "Remy",
  solene: "Solène",
};

export function personaName(voiceKey: string): string {
  return PERSONA_NAMES[voiceKey] ?? voiceKey;
}

/** "not reported" for nulls — never fake zeros (Zernio stats are opaque). */
export function formatStat(value: number | null): string {
  return value === null ? "not reported" : String(value);
}

export function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Plain-English one-liner for a green-light row's state. */
export function describeGreenlightRow(row: ZernioGreenlightRow): string {
  if (row.tone === "green") return "Live — safe to post.";
  if (row.tone === "red") return "Not live — don't post this keyword yet.";
  if (row.addonMissing) return "Live, but numbers unavailable — analytics add-on not active on this account.";
  return "Live, but the numbers may be out of date.";
}

/** The newest lastSyncedAt across rows, or null when nothing synced yet. */
export function latestSyncedAt(rows: ZernioGreenlightRow[]): string | null {
  let latest: string | null = null;
  for (const row of rows) {
    if (row.lastSyncedAt && (!latest || row.lastSyncedAt > latest)) {
      latest = row.lastSyncedAt;
    }
  }
  return latest;
}

export type KitLiveStatus =
  | { source: "live"; row: ZernioGreenlightRow }
  | { source: "plan"; staticStatus: "live" | "plan" | "defer" }
  | { source: "none" };

const TONE_RANK: Record<ZernioGreenlightRow["tone"], number> = { green: 0, amber: 1, red: 2 };

/**
 * Join a kit to its live green-light row by keyword (case-insensitive).
 * When the keyword runs on several accounts, show the healthiest row.
 * Falls back to the hand-maintained plan status — the UI must label that
 * fallback explicitly ("plan status — not live").
 */
export function kitLiveStatus(
  kit: Pick<MarketingKit, "keyword" | "staticStatus">,
  rows: ZernioGreenlightRow[],
): KitLiveStatus {
  if (kit.keyword) {
    const keyword = kit.keyword.toLowerCase();
    const matches = rows
      .filter((row) => row.keyword.toLowerCase() === keyword)
      .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
    if (matches.length > 0) return { source: "live", row: matches[0]! };
  }
  if (kit.staticStatus) return { source: "plan", staticStatus: kit.staticStatus };
  return { source: "none" };
}

/** Tailwind class for a status dot. */
export function toneDotClassName(tone: "green" | "amber" | "red"): string {
  if (tone === "green") return "bg-emerald-500";
  if (tone === "amber") return "bg-amber-400";
  return "bg-red-500";
}

/** Map the hand-maintained plan status onto a dot tone. */
export function staticStatusTone(status: "live" | "plan" | "defer"): "green" | "amber" | "red" {
  if (status === "live") return "green";
  if (status === "plan") return "amber";
  return "red";
}

/** Download filename for a generated voice snippet. */
export function snippetFileName(voiceKey: string, label: string): string {
  const slug = label
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `voice-${voiceKey}${slug ? `-${slug}` : ""}.mp3`;
}
