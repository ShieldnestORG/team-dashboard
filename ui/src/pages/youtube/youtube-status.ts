// One table from the YouTube queue status the server sends to the plain label
// the owner sees and the StatusBadge kind used to colour it. No view defines
// its own colours or labels: every YouTube view reads from here (docs/ux/
// youtube-area-spec.md §4 "One video, one status, one label, one colour").
import type { statusBadge } from "../../lib/status-colors";

export interface YoutubeStatus {
  label: string;
  /** A key in `statusBadge` (ui/src/lib/status-colors.ts). */
  kind: keyof typeof statusBadge;
}

export const YOUTUBE_STATUS: Record<string, YoutubeStatus> = {
  pending_review: { label: "Needs your OK", kind: "pending_review" },
  scheduled: { label: "Scheduled", kind: "scheduled" },
  publishing: { label: "Posting now", kind: "publishing" },
  published: { label: "Posted", kind: "published" },
  failed: { label: "Did not post", kind: "failed" },
  paused: { label: "On hold", kind: "paused" },
};

/** The plain label for a queue status; falls back to the raw key when unknown. */
export function youtubeStatusLabel(status: string): string {
  return YOUTUBE_STATUS[status]?.label ?? status;
}

/** The StatusBadge kind for a queue status; unknown keys fall back to neutral. */
export function youtubeStatusKind(status: string): keyof typeof statusBadge {
  return YOUTUBE_STATUS[status]?.kind ?? "archived";
}
