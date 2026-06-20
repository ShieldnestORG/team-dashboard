// ---------------------------------------------------------------------------
// Coherent Ones University — founding-member price-lock + plan-key resolution.
//
// Two small, pure-where-possible concerns the checkout route + webhook share:
//
//   FOUNDING-MEMBER PRICE-LOCK. The first N members (env
//   UNIVERSITY_FOUNDING_CAP, default 100) are "founding members" whose rate is
//   locked for life. The eligibility test is intentionally a PURE function of
//   (existing count, cap) so it's trivially testable and has no DB/Stripe
//   coupling — the DB count is read separately (countUniversityMembers) and
//   passed in. Once stamped true on a member row it stays true forever (see
//   migration 0129 / schema/university.ts), so this gate only ever runs at the
//   moment of activation.
//
//   PLAN-KEY RESOLUTION. The storefront sends a 'plan' selector ('monthly' |
//   'annual'); we normalize it to a stable plan key written onto the member +
//   subscription rows and the Stripe metadata. Unknown values fail safe to the
//   cheaper monthly plan so a malformed param can never silently upsell.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityMembers } from "@paperclipai/db";

/** Default founding cap when UNIVERSITY_FOUNDING_CAP is unset/invalid. */
export const DEFAULT_FOUNDING_CAP = 100;

/** Stable plan keys stored on member/subscription rows + Stripe metadata. */
export const PLAN_MONTHLY = "university_monthly";
export const PLAN_ANNUAL = "university_annual";
export type UniversityPlanKey = typeof PLAN_MONTHLY | typeof PLAN_ANNUAL;

/**
 * Whether a NEW member joining now qualifies as a founder.
 *
 * `existingCount` is the number of members BEFORE this one, so the gate is
 * `existingCount < cap`: the Nth member (existingCount = N-1) is the last
 * founder, the (N+1)th (existingCount = N) is not. A cap <= 0 disables the
 * offer entirely (no founders).
 */
export function isFoundingEligible(existingCount: number, cap: number): boolean {
  if (!Number.isFinite(cap) || cap <= 0) return false;
  return existingCount < cap;
}

/**
 * The configured founding cap. Reads UNIVERSITY_FOUNDING_CAP as a non-negative
 * integer; falls back to DEFAULT_FOUNDING_CAP on missing/junk/negative input.
 * `0` is honored (a deliberate way to turn the founding offer off).
 */
export function foundingCap(): number {
  const raw = process.env.UNIVERSITY_FOUNDING_CAP?.trim();
  if (!raw) return DEFAULT_FOUNDING_CAP;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return DEFAULT_FOUNDING_CAP;
  return n;
}

/**
 * Normalizes the storefront 'plan' selector to a stable plan key. Accepts the
 * short selectors ('annual'/'monthly', 'year'/'yearly') and the canonical keys
 * ('university_annual'/'university_monthly'), case-insensitively. Anything
 * unrecognized (incl. undefined/empty) fails safe to monthly.
 */
export function resolvePlanKey(plan: string | undefined | null): UniversityPlanKey {
  const v = (plan ?? "").trim().toLowerCase();
  switch (v) {
    case "annual":
    case "yearly":
    case "year":
    case "university_annual":
      return PLAN_ANNUAL;
    default:
      return PLAN_MONTHLY;
  }
}

/**
 * Counts existing University members. Used at activation to decide founding
 * eligibility (count < cap). Counts ALL members regardless of status — a
 * cancelled member still "used up" a founding slot, which keeps the founder
 * set monotonic and the promise honest (we never re-open a slot).
 */
export async function countUniversityMembers(db: Db): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(universityMembers);
  return rows[0]?.n ?? 0;
}
