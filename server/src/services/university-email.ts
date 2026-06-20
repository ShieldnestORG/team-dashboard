// ---------------------------------------------------------------------------
// Coherent Ones University — shared email contract constants + helpers.
//
// Resend templates live storefront-side (docs/OWNERSHIP.md); team-dashboard
// only posts the {kind, to, data} envelope via sendCreditscoreEmail. This file
// is the single source of truth for the URLs and small derivations that BOTH
// the event-driven sends (university-stripe-handler.ts) and the time-delayed
// sends (university-crons.ts) pass into those payloads, so the two never drift.
//
// FROM, subject, body, and "— Mark" voice are all owned by the storefront
// template; we never set them here.
// ---------------------------------------------------------------------------

// Deep-links into the portal / storefront. Fixed per the email contract.
export const UNIVERSITY_LOGIN_URL =
  "https://app.coherencedaddy.com/login";
export const UNIVERSITY_LESSON_URL =
  "https://app.coherencedaddy.com/university/curriculum/presence/the-leak";
// listenUrl (d1) and nextDrillUrl (d3) share the presence-curriculum landing.
export const UNIVERSITY_PRESENCE_URL =
  "https://app.coherencedaddy.com/university/curriculum/presence";
export const UNIVERSITY_MANAGE_BILLING_URL =
  "https://app.coherencedaddy.com/billing";
export const UNIVERSITY_REJOIN_URL =
  "https://coherencedaddy.com/university";
// The Sessions tab — shared by the reminder crons (university-crons.ts) and the
// event-driven cancel notice (the admin cancel route) so both deep-link to one
// source of truth.
export const UNIVERSITY_SESSIONS_URL =
  "https://app.coherencedaddy.com/university/sessions";

// Receipt display values, per plan. Monthly is $50/mo; annual is $500/yr
// (two months free). The plan key is the stable 'university_monthly' /
// 'university_annual' set at checkout.
export const UNIVERSITY_PLAN_LABEL = "Monthly";
export const UNIVERSITY_PRICE_DISPLAY = "$50.00";
export const UNIVERSITY_ANNUAL_PLAN_LABEL = "Annual";
export const UNIVERSITY_ANNUAL_PRICE_DISPLAY = "$500.00";

/** Human plan label for the receipt email, by plan key. */
export function planLabel(plan: string | null | undefined): string {
  return plan === "university_annual"
    ? UNIVERSITY_ANNUAL_PLAN_LABEL
    : UNIVERSITY_PLAN_LABEL;
}

/** Charged-amount display for the receipt email, by plan key. */
export function priceDisplay(plan: string | null | undefined): string {
  return plan === "university_annual"
    ? UNIVERSITY_ANNUAL_PRICE_DISPLAY
    : UNIVERSITY_PRICE_DISPLAY;
}

/**
 * Derives the optional `firstName` token for the email payload from the
 * member's stored display name. The contract marks firstName as optional, so
 * we return undefined when there's no usable name and let the template fall
 * back to its no-name copy.
 */
export function firstNameFromDisplayName(
  displayName: string | null | undefined,
): string | undefined {
  const first = displayName?.trim().split(/\s+/)[0];
  return first || undefined;
}
