/**
 * Single authoritative list of board route roots (the first path segment of every
 * route rendered under `/:companyPrefix` in App.tsx boardRoutes()).
 *
 * This list is a FALLBACK classifier only: while the companies list is still loading,
 * it is how we tell "board path missing its prefix" apart from "path that already
 * starts with a company prefix". Once companies are loaded, callers pass the real
 * company issuePrefixes and classification validates against those instead — which
 * also covers dynamic plugin routes that can never appear in a static list.
 *
 * When you add a new top-level board route in App.tsx, append its root here.
 * The route-walk test (company-routes.test.ts) consumes this manifest.
 */
export const BOARD_ROUTE_MANIFEST: readonly string[] = [
  "dashboard",
  "companies",
  "company",
  "skills",
  "org",
  "agents",
  "projects",
  "issues",
  "routines",
  "goals",
  "approvals",
  "costs",
  "activity",
  "members",
  "inbox",
  "design-guide",
  "structure",
  "twitter",
  "discord",
  "tokns",
  "auto-reply",
  "api-routes",
  "agent-ops",
  "tx-ecosystem",
  "system-health",
  "content-review",
  "content-analytics",
  "affiliates",
  "intel",
  "onboarding",
  "plugins",
  "execution-workspaces",
  "settings",
  "tests",
  "crons",
  "partners",
  "youtube",
  "marketing-pushes",
  "intel-billing",
  "knowledge-graph",
  "cities",
  "repo-updates",
  "automation-health",
  "socials",
  "funnels",
  "launch-monitor",
  "house-ads",
  "creditscore-review",
  "topic-takeover",
  "site-analytics",
  "owned-sites",
  "shop-sharers",
  "video-edit",
  "watchtower",
  "community-agents",
  "sessions",
  "university-emails",
  "content-hub",
];

const BOARD_ROUTE_ROOTS = new Set(BOARD_ROUTE_MANIFEST);

const GLOBAL_ROUTE_ROOTS = new Set([
  "auth",
  "invite",
  "board-claim",
  "cli-auth",
  "docs",
  "instance",
  "partner-dashboard",
]);

export function normalizeCompanyPrefix(prefix: string): string {
  return prefix.trim().toUpperCase();
}

function splitPath(path: string): { pathname: string; search: string; hash: string } {
  const match = path.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
  return {
    pathname: match?.[1] ?? path,
    search: match?.[2] ?? "",
    hash: match?.[3] ?? "",
  };
}

function getRootSegment(pathname: string): string | null {
  const segment = pathname.split("/").filter(Boolean)[0];
  return segment ?? null;
}

function matchesKnownPrefix(segment: string, knownCompanyPrefixes: readonly string[]): boolean {
  const normalized = normalizeCompanyPrefix(segment);
  return knownCompanyPrefixes.some((prefix) => normalizeCompanyPrefix(prefix) === normalized);
}

function hasKnownPrefixes(
  knownCompanyPrefixes: readonly string[] | undefined,
): knownCompanyPrefixes is readonly string[] {
  return Boolean(knownCompanyPrefixes && knownCompanyPrefixes.length > 0);
}

export function isGlobalPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const root = getRootSegment(pathname);
  if (!root) return true;
  return GLOBAL_ROUTE_ROOTS.has(root.toLowerCase());
}

/**
 * Is this a board path whose company prefix is missing (so Layout should auto-correct
 * by prepending the active company's prefix)?
 *
 * With `knownCompanyPrefixes` (companies loaded), any non-global root that is not a
 * real company prefix counts — this is what makes bare plugin routes auto-correct.
 * The one exception: an unknown root followed by a board root (e.g. /XYZ/dashboard)
 * looks like an INVALID company prefix, not a missing one — leave it for the
 * invalid-prefix 404. Without known prefixes we fall back to the static manifest.
 */
export function isBoardPathWithoutPrefix(
  pathname: string,
  knownCompanyPrefixes?: readonly string[],
): boolean {
  const segments = pathname.split("/").filter(Boolean);
  const root = segments[0];
  if (!root) return false;
  const rootLower = root.toLowerCase();
  if (GLOBAL_ROUTE_ROOTS.has(rootLower)) return false;

  if (hasKnownPrefixes(knownCompanyPrefixes)) {
    if (matchesKnownPrefix(root, knownCompanyPrefixes)) return false;
    if (BOARD_ROUTE_ROOTS.has(rootLower)) return true;
    const second = segments[1]?.toLowerCase();
    if (second && BOARD_ROUTE_ROOTS.has(second)) return false;
    return true;
  }

  return BOARD_ROUTE_ROOTS.has(rootLower);
}

/**
 * Returns the company prefix a path starts with, or null when it has none.
 *
 * With `knownCompanyPrefixes` (companies loaded), the first segment counts as a
 * prefix ONLY if it matches a real company issuePrefix — unknown segments (missing
 * roots, plugin routes) are no longer misclassified as prefixes. Without them
 * (companies still loading), falls back to "not a global root and not a board root".
 */
export function extractCompanyPrefixFromPath(
  pathname: string,
  knownCompanyPrefixes?: readonly string[],
): string | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) return null;
  const first = segments[0]!;
  const firstLower = first.toLowerCase();
  if (GLOBAL_ROUTE_ROOTS.has(firstLower)) return null;

  if (hasKnownPrefixes(knownCompanyPrefixes)) {
    return matchesKnownPrefix(first, knownCompanyPrefixes) ? normalizeCompanyPrefix(first) : null;
  }

  if (BOARD_ROUTE_ROOTS.has(firstLower)) return null;
  return normalizeCompanyPrefix(first);
}

export function applyCompanyPrefix(
  path: string,
  companyPrefix: string | null | undefined,
  knownCompanyPrefixes?: readonly string[],
): string {
  const { pathname, search, hash } = splitPath(path);
  if (!pathname.startsWith("/")) return path;
  if (isGlobalPath(pathname)) return path;
  if (!companyPrefix) return path;

  const prefix = normalizeCompanyPrefix(companyPrefix);
  // The active prefix always counts as known, so already-prefixed paths stay untouched
  // even if the companies list is momentarily out of sync with it.
  const known = hasKnownPrefixes(knownCompanyPrefixes)
    ? [...knownCompanyPrefixes, companyPrefix]
    : undefined;
  const activePrefix = extractCompanyPrefixFromPath(pathname, known);
  if (activePrefix) return path;

  return `/${prefix}${pathname}${search}${hash}`;
}

export function toCompanyRelativePath(path: string, knownCompanyPrefixes?: readonly string[]): string {
  const { pathname, search, hash } = splitPath(path);
  const segments = pathname.split("/").filter(Boolean);

  if (segments.length >= 1) {
    const first = segments[0]!;
    const stripKnownPrefix =
      hasKnownPrefixes(knownCompanyPrefixes) && matchesKnownPrefix(first, knownCompanyPrefixes);
    const stripHeuristicPrefix =
      segments.length >= 2 &&
      !GLOBAL_ROUTE_ROOTS.has(first.toLowerCase()) &&
      BOARD_ROUTE_ROOTS.has(segments[1]!.toLowerCase());
    if (stripKnownPrefix || stripHeuristicPrefix) {
      return `/${segments.slice(1).join("/")}${search}${hash}`;
    }
  }

  return `${pathname}${search}${hash}`;
}
