import {
  Instagram,
  Music2,
  Youtube,
  Twitter,
  Cloud,
  MessageCircle,
  Hash,
  Linkedin,
  type LucideIcon,
} from "lucide-react";

/**
 * Canonical status & priority color definitions.
 *
 * Every component that renders a status indicator (StatusIcon, StatusBadge,
 * agent status dots, etc.) should import from here so colors stay consistent.
 */

// ---------------------------------------------------------------------------
// Issue status colors
// ---------------------------------------------------------------------------

/** StatusIcon circle: text + border classes */
export const issueStatusIcon: Record<string, string> = {
  backlog: "text-muted-foreground border-muted-foreground",
  todo: "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400",
  in_progress: "text-yellow-600 border-yellow-600 dark:text-yellow-400 dark:border-yellow-400",
  in_review: "text-violet-600 border-violet-600 dark:text-violet-400 dark:border-violet-400",
  done: "text-green-600 border-green-600 dark:text-green-400 dark:border-green-400",
  cancelled: "text-neutral-500 border-neutral-500",
  blocked: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
};

export const issueStatusIconDefault = "text-muted-foreground border-muted-foreground";

/** Text-only color for issue statuses (dropdowns, labels) */
export const issueStatusText: Record<string, string> = {
  backlog: "text-muted-foreground",
  todo: "text-blue-600 dark:text-blue-400",
  in_progress: "text-yellow-600 dark:text-yellow-400",
  in_review: "text-violet-600 dark:text-violet-400",
  done: "text-green-600 dark:text-green-400",
  cancelled: "text-neutral-500",
  blocked: "text-red-600 dark:text-red-400",
};

export const issueStatusTextDefault = "text-muted-foreground";

// ---------------------------------------------------------------------------
// Badge colors — used by StatusBadge for all entity types
// ---------------------------------------------------------------------------

export const statusBadge: Record<string, string> = {
  // Agent statuses
  active: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  running: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  // Idle is NOT a healthy green — a slate treatment makes "not working" legible.
  idle: "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200",
  // Stale = heartbeat overdue. Failure-adjacent, so amber not gray.
  stale: "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300",
  archived: "bg-muted text-muted-foreground",

  // Goal statuses
  planned: "bg-muted text-muted-foreground",
  achieved: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  completed: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",

  // Run statuses
  failed: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  timed_out: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  error: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  terminated: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",

  // Approval statuses
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  revision_requested: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300",
  approved: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  rejected: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",

  // Issue statuses — consistent hues with issueStatusIcon above
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  in_progress: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300",
  in_review: "bg-violet-100 text-violet-700 dark:bg-violet-900/50 dark:text-violet-300",
  blocked: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  done: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  cancelled: "bg-muted text-muted-foreground",

  // Social post statuses (SocialPost.status)
  draft: "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200",
  scheduled: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  publishing: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  posted: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  published: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  // One-L "canceled" is what socials post status + funnel status actually use
  // (server: api/socials.ts). Two-L "cancelled" above is the issue-status
  // spelling — both point at the same neutral treatment so neither falls
  // through to a bare default.
  canceled: "bg-muted text-muted-foreground",

  // Funnel Library statuses (draft/rejected already covered above)
  ready: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  live: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
  retired: "bg-neutral-200 text-neutral-600 dark:bg-neutral-700/50 dark:text-neutral-300",

  // Social account statuses (SocialAccount.status — active/paused covered above)
  dormant: "bg-slate-200 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200",
  deprecated: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",

  // Inspiration item statuses (archived already covered above)
  new: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
  reviewed: "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300",
};

export const statusBadgeDefault = "bg-muted text-muted-foreground";

// ---------------------------------------------------------------------------
// Agent status dot — solid background for small indicator dots
// ---------------------------------------------------------------------------

export const agentStatusDot: Record<string, string> = {
  running: "bg-cyan-400 animate-pulse",
  active: "bg-green-400",
  paused: "bg-orange-400",
  // Idle is distinct from a healthy green — slate signals "not working".
  idle: "bg-slate-400",
  // Failure-adjacent statuses get a non-gray, attention-drawing treatment.
  stale: "bg-amber-400",
  failed: "bg-red-400",
  timed_out: "bg-orange-400",
  pending_approval: "bg-amber-400",
  error: "bg-red-400",
  archived: "bg-neutral-400",
};

export const agentStatusDotDefault = "bg-neutral-400";

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const priorityColor: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-blue-600 dark:text-blue-400",
};

export const priorityColorDefault = "text-yellow-600 dark:text-yellow-400";

// ---------------------------------------------------------------------------
// Platform colors — used by PlatformBadge everywhere a social platform
// renders (Compose, Queue, Funnels, ContentReview). Promotes the palette
// ContentReview already used ad-hoc (platformColor/visualPlatformColor) to
// the one canonical map, instead of leaving three parallel definitions.
// ---------------------------------------------------------------------------

export const platformBadge: Record<string, string> = {
  instagram: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/50 dark:text-fuchsia-300",
  tiktok: "bg-pink-100 text-pink-700 dark:bg-pink-900/50 dark:text-pink-300",
  youtube: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300",
  // Legacy Twitter blue — see docs/products/socials-hub.md for the X-brand-black risk note.
  x: "bg-sky-100 text-sky-700 dark:bg-sky-900/50 dark:text-sky-300",
  bluesky: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/50 dark:text-cyan-300",
  discord: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300",
  reddit: "bg-orange-100 text-orange-700 dark:bg-orange-900/50 dark:text-orange-300",
  linkedin: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300",
};

export const platformBadgeDefault = "bg-muted text-muted-foreground";

// Icon + display name + canonical ordering for platform chip groups.
// lucide has no true TikTok/Bluesky/Discord brand marks — Music2/Cloud/
// MessageCircle are stand-ins, matching the choices already made in
// ContentReview's icon usage.
export const PLATFORM_META: Record<string, { label: string; icon: LucideIcon }> = {
  instagram: { label: "Instagram", icon: Instagram },
  tiktok: { label: "TikTok", icon: Music2 },
  youtube: { label: "YouTube", icon: Youtube },
  x: { label: "X", icon: Twitter },
  bluesky: { label: "Bluesky", icon: Cloud },
  discord: { label: "Discord", icon: MessageCircle },
  reddit: { label: "Reddit", icon: Hash },
  linkedin: { label: "LinkedIn", icon: Linkedin },
};

export const PLATFORM_ORDER = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "bluesky",
  "discord",
  "reddit",
  "linkedin",
];

/** Normalize free-string platform spellings so e.g. "twitter" and "x" collapse to one color/icon. */
export function normalizePlatform(p: string): string {
  const k = p.toLowerCase();
  if (k === "twitter" || k === "twitter_video") return "x";
  if (k === "instagram_reels" || k === "ig") return "instagram";
  if (k === "youtube_shorts") return "youtube";
  return k;
}
