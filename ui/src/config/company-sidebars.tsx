import {
  Activity,
  BarChart3,
  Boxes,
  Building2,
  CheckSquare,
  CircleDot,
  Clock,
  Coins,
  CreditCard,
  Database,
  DollarSign,
  Eye,
  Film,
  Filter,
  Gauge,
  GitBranch,
  GitPullRequest,
  Globe,
  Handshake,
  HeartPulse,
  Hexagon,
  History,
  Mail,
  MapPin,
  Megaphone,
  Network,
  Radar,
  Repeat,
  Settings,
  Share2,
  Target,
  UsersRound,
  Video,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * Per-company sidebar config, keyed by company issuePrefix (CONTRACT-5).
 *
 * The Sidebar component owns the structural top block (New Issue, Dashboard,
 * Inbox, plugin slots) — those are identical for every company and carry live
 * data (run counts, inbox badges). Everything below that block renders from
 * the config returned here: labeled item sections plus the Projects/Agents
 * structural slots, in order.
 *
 * The default config is today's CD layout. The TOK (Tokns) config is
 * intentionally minimal — marketing works cross-company from CD anyway.
 * Unknown prefixes get the default so a brand-new company is never left
 * with an empty sidebar.
 *
 * Every `to` path here must resolve onto a BOARD_ROUTE_MANIFEST root — the
 * route-walk test (lib/company-routes.test.ts) scans this file.
 */

export interface SidebarItem {
  to: string;
  label: string;
  icon: LucideIcon;
  textBadge?: string;
  textBadgeTone?: "default" | "amber";
}

export type SidebarSection =
  | {
      kind: "items";
      label: string;
      /** Tailwind text-color class to color-code the section header. */
      accentClassName?: string;
      items: SidebarItem[];
    }
  | { kind: "projects" }
  | { kind: "agents" };

const DEFAULT_SECTIONS: SidebarSection[] = [
  {
    kind: "items",
    label: "Work",
    items: [
      { to: "/issues", label: "Issues", icon: CircleDot },
      { to: "/routines", label: "Routines", icon: Repeat, textBadge: "Beta", textBadgeTone: "amber" },
      { to: "/goals", label: "Goals", icon: Target },
    ],
  },
  { kind: "projects" },
  { kind: "agents" },
  {
    kind: "items",
    label: "Agents & Org",
    accentClassName: "text-amber-400",
    items: [
      { to: "/activity", label: "Activity", icon: History },
      { to: "/agent-ops", label: "Agent Ops", icon: Radar },
      { to: "/org", label: "Org", icon: Building2 },
      { to: "/structure", label: "Structure", icon: GitBranch },
      { to: "/skills", label: "Skills", icon: Boxes },
    ],
  },
  {
    kind: "items",
    label: "Intel & Data",
    accentClassName: "text-sky-400",
    items: [
      { to: "/intel", label: "Intel", icon: Database },
      { to: "/knowledge-graph", label: "Knowledge Graph", icon: Network },
      { to: "/cities", label: "City Collector", icon: MapPin },
      { to: "/watchtower", label: "Watchtower", icon: Eye },
      { to: "/site-analytics", label: "Site Analytics", icon: BarChart3 },
    ],
  },
  {
    kind: "items",
    label: "Content & Socials",
    accentClassName: "text-violet-400",
    items: [
      { to: "/socials", label: "Socials & Content", icon: Share2 },
      { to: "/funnels", label: "Funnels", icon: Filter },
      { to: "/content-hub", label: "Content Hub", icon: Megaphone },
    ],
  },
  {
    kind: "items",
    label: "Products",
    accentClassName: "text-emerald-400",
    items: [
      { to: "/sessions", label: "Sessions", icon: Video },
      { to: "/university-emails", label: "University Emails", icon: Mail },
      { to: "/creditscore-review", label: "CreditScore Review", icon: Gauge },
      { to: "/video-edit", label: "Video Edit", icon: Film },
      // Tokns + TX Ecosystem moved to the TOK project (docs/tokns-project.md);
      // old /CD paths redirect there.
    ],
  },
  {
    kind: "items",
    label: "Monetization",
    accentClassName: "text-rose-400",
    items: [
      { to: "/affiliates", label: "Affiliates", icon: UsersRound },
      { to: "/partners", label: "Partners", icon: Handshake },
      { to: "/costs", label: "Costs", icon: DollarSign },
      { to: "/intel-billing", label: "Intel Billing", icon: CreditCard },
    ],
  },
  {
    kind: "items",
    label: "Ops & Admin",
    accentClassName: "text-slate-400",
    items: [
      { to: "/automation-health", label: "Automation Health", icon: Activity },
      { to: "/system-health", label: "System Health", icon: HeartPulse },
      { to: "/crons", label: "Cron Jobs", icon: Clock },
      { to: "/api-routes", label: "API Routes", icon: Globe },
      { to: "/approvals", label: "Approvals", icon: CheckSquare },
      { to: "/repo-updates", label: "Repo Updates", icon: GitPullRequest },
      { to: "/company/settings", label: "Settings", icon: Settings },
    ],
  },
];

const TOK_SECTIONS: SidebarSection[] = [
  {
    kind: "items",
    label: "Products",
    accentClassName: "text-emerald-400",
    items: [
      { to: "/tokns", label: "Tokns", icon: Hexagon },
      { to: "/tx-ecosystem", label: "TX Ecosystem", icon: Coins },
    ],
  },
  {
    kind: "items",
    label: "Content & Socials",
    accentClassName: "text-violet-400",
    items: [
      { to: "/socials", label: "Socials & Content", icon: Share2 },
    ],
  },
];

export function getSidebarConfig(issuePrefix: string): SidebarSection[] {
  if (issuePrefix.trim().toUpperCase() === "TOK") return TOK_SECTIONS;
  return DEFAULT_SECTIONS;
}

/** Section labels a marketing-only user keeps. */
const MARKETING_SECTION_LABELS = new Set(["Content & Socials"]);

/**
 * The sidebar a marketing-role user sees: Content & Socials — nothing else.
 * Sidebar also hides its structural block (New Issue, Dashboard, Inbox,
 * Search) for marketing users: those surfaces read APIs the server's
 * marketing-role gate blocks, so showing them would only produce 403s.
 * This filtering is cosmetic; the middleware is the real enforcement
 * (fail-closed path allowlist).
 */
export function filterSectionsForMarketing(sections: SidebarSection[]): SidebarSection[] {
  return sections.filter(
    (section) => section.kind === "items" && MARKETING_SECTION_LABELS.has(section.label),
  );
}
