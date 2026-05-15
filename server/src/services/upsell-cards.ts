// ---------------------------------------------------------------------------
// Portal upsell cards — contextual cross-sell catalog for logged-in customers.
//
// Selection logic is V1: tenure (account age in days) + entitlement-suppression
// only. We deliberately do NOT trigger upsells off of result-derived signals
// (e.g. "low mention count → upgrade") — that crossed an ethical line we are
// deferring to a Phase 2 decision. Keep this constraint in `eligibility(...)`
// when adding new cards.
//
// Audit V2 blocker #4 cross-sell rule: when result-derived triggers DO ship,
// they MUST NOT fire across a Watchtower prompt-version boundary. A prompt
// change resets the comparison baseline (see watchtower_prompt_versions +
// watchtower_runs.prompt_version_id, migration 0115). Concretely, the
// eligibility check should look up the latest run's prompt_version_id and the
// earliest run's prompt_version_id within the comparison window; if they
// differ, suppress the result-derived trigger. Today this is vacuously safe
// because the only signals here are tenure + entitlement.
//
// The catalog is hard-coded here because (a) it's small, (b) we want PR
// review on every change, and (c) the eligibility predicates need code. When
// the catalog crosses ~15 entries or starts needing per-customer overrides,
// promote to a `portal_upsell_cards` table + admin UI.
//
// All cta_href URLs MUST go through `withUtm(...)` so the storefront can
// attribute conversions to the portal channel.
// ---------------------------------------------------------------------------

export type UpsellContext =
  | "dashboard"
  | "watchtower"
  | "agents"
  | "credentials"
  | "billing";

export const UPSELL_CONTEXTS: readonly UpsellContext[] = [
  "dashboard",
  "watchtower",
  "agents",
  "credentials",
  "billing",
] as const;

export function isUpsellContext(s: string): s is UpsellContext {
  return (UPSELL_CONTEXTS as readonly string[]).includes(s);
}

// User signals consumed by eligibility predicates. Sourced from the customer
// portal entitlements resolver — keep this shape narrow so we don't accidentally
// branch on something result-derived.
export interface UpsellUserSignal {
  // Existing entitlements (presence = "they already own it, suppress upsell")
  hasWatchtower: boolean;
  hasCreditscore: boolean;
  hasAeoGrowthBundle: boolean;
  hasAeoScaleBundle: boolean;
  hasIntelApi: boolean;
  // Agents is a planned product; entitlement field doesn't exist on
  // CustomerEntitlements yet. We thread the flag through anyway so the
  // predicate can be flipped to true once shipped without touching this file.
  hasAgents: boolean;
  // Tenure: account age in days since signup. NEVER use as a proxy for
  // "did this account perform action X" — that's the result-derived line we
  // are not crossing.
  tenureDays: number;
}

export interface UpsellCardResponse {
  id: string;
  title: string;
  body: string;
  cta_label: string;
  cta_href: string;
  priority: number;
  product: string;
}

interface CatalogEntry {
  id: string;
  product: string;
  title: string;
  body: string;
  cta_label: string;
  baseUrl: string;
  // Context → priority. Missing entries default to `defaultPriority`.
  priorityByContext: Partial<Record<UpsellContext, number>>;
  defaultPriority: number;
  eligibility: (user: UpsellUserSignal, context: UpsellContext) => boolean;
}

// ---------------------------------------------------------------------------
// UTM helper
// ---------------------------------------------------------------------------

export function withUtm(
  baseUrl: string,
  cardId: string,
  context: UpsellContext,
): string {
  // Use URL so we don't double-encode existing query strings; the catalog
  // entries are bare URLs today but this keeps us safe if a campaign param
  // ever gets baked in.
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    // Should never happen with hard-coded catalog URLs, but fail open with
    // a query-string concat so a bad URL doesn't break the whole response.
    const sep = baseUrl.includes("?") ? "&" : "?";
    return (
      baseUrl +
      sep +
      `utm_source=portal-upsell&utm_campaign=${encodeURIComponent(cardId)}&utm_medium=${encodeURIComponent(context)}`
    );
  }
  u.searchParams.set("utm_source", "portal-upsell");
  u.searchParams.set("utm_campaign", cardId);
  u.searchParams.set("utm_medium", context);
  return u.toString();
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

// All URLs are CD storefront destinations (per docs/OWNERSHIP.md — pricing
// pages live in coherencedaddy-landing).
const CATALOG: readonly CatalogEntry[] = [
  {
    id: "creditscore-upsell-v1",
    product: "creditscore",
    title: "Add CreditScore to your stack",
    body:
      "Watchtower tracks what AI says about you. CreditScore Starter ($49/mo) shows you the schema, content, and competitor gaps that move the needle.",
    cta_label: "Start CreditScore",
    baseUrl: "https://coherencedaddy.com/tools/creditscore",
    priorityByContext: { watchtower: 90, dashboard: 60 },
    defaultPriority: 50,
    eligibility: (user) =>
      user.hasWatchtower && !user.hasCreditscore,
  },
  {
    id: "aeo-growth-bundle-v1",
    product: "bundle-aeo-growth",
    title: "Bundle and save: AEO Growth",
    body:
      "Watchtower + CreditScore + Directory Listing + Partner Network. $499/mo — your current line items run higher separately.",
    cta_label: "See the AEO Growth bundle",
    baseUrl: "https://coherencedaddy.com/bundles/aeo-growth",
    priorityByContext: {},
    defaultPriority: 80,
    eligibility: (user) =>
      user.hasWatchtower &&
      user.hasCreditscore &&
      !user.hasAeoGrowthBundle &&
      !user.hasAeoScaleBundle &&
      user.tenureDays >= 14,
  },
  {
    id: "aeo-scale-bundle-v1",
    product: "bundle-aeo-scale",
    title: "Outgrowing Growth? Step up to Scale",
    body:
      "Multi-brand seats, priority data refresh, white-label reports. $1,299/mo for teams running CreditScore across 5+ properties.",
    cta_label: "See the AEO Scale bundle",
    baseUrl: "https://coherencedaddy.com/bundles/aeo-scale",
    priorityByContext: {},
    defaultPriority: 70,
    eligibility: (user) =>
      user.hasAeoGrowthBundle && !user.hasAeoScaleBundle && user.tenureDays >= 30,
  },
  {
    id: "intel-api-pro-v1",
    product: "intel-api",
    title: "Pipe AEO data into your stack",
    body:
      "Intel API Pro ($49/mo) gives you raw AEO answer feeds via REST + webhooks. Built for data teams already running Watchtower.",
    cta_label: "View Intel API",
    baseUrl: "https://coherencedaddy.com/tools/intel-api",
    priorityByContext: { watchtower: 70 },
    defaultPriority: 40,
    eligibility: (user) =>
      user.hasWatchtower && !user.hasIntelApi && user.tenureDays >= 7,
  },
  {
    id: "agents-founding-cohort-v1",
    product: "agents",
    title: "100 Agents — Founding Cohort",
    body:
      "Always-on AI agents that monitor mentions, draft responses, and ship content while you sleep. $79/mo, grandfathered for life.",
    cta_label: "Claim a founding seat",
    baseUrl: "https://coherencedaddy.com/agents",
    priorityByContext: {},
    defaultPriority: 60,
    eligibility: (user) => !user.hasAgents && user.tenureDays >= 7,
  },
];

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const MAX_CARDS = 3;

function entryPriority(entry: CatalogEntry, context: UpsellContext): number {
  const ctx = entry.priorityByContext[context];
  return typeof ctx === "number" ? ctx : entry.defaultPriority;
}

export function selectUpsellCards(
  user: UpsellUserSignal,
  context: UpsellContext,
): UpsellCardResponse[] {
  const eligible: Array<{ entry: CatalogEntry; priority: number }> = [];
  for (const entry of CATALOG) {
    if (!entry.eligibility(user, context)) continue;
    eligible.push({ entry, priority: entryPriority(entry, context) });
  }
  // Priority DESC; stable order within same priority via catalog order.
  eligible.sort((a, b) => b.priority - a.priority);
  const top = eligible.slice(0, MAX_CARDS);
  return top.map(({ entry, priority }) => ({
    id: entry.id,
    title: entry.title,
    body: entry.body,
    cta_label: entry.cta_label,
    cta_href: withUtm(entry.baseUrl, entry.id, context),
    priority,
    product: entry.product,
  }));
}

// Exposed for tests + admin tooling.
export function listCatalogIds(): string[] {
  return CATALOG.map((c) => c.id);
}
