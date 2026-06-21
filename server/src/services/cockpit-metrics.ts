// ---------------------------------------------------------------------------
// Cockpit metrics — owner-dashboard reads over the University member class.
//
// Two pure read helpers used by routes/cockpit.ts:
//   - revenueSummary(db) — counts + MRR derived from university_subscriptions.
//   - listMembers(db, q?) — the member roster from university_members, with an
//     optional case-insensitive email/displayName search.
//
// No Stripe calls — these read the rows the webhook handler already wrote
// (services/university-stripe-handler.ts). MRR is computed from the live plan
// mix, not stored. Mirrors the email-join identity model the rest of University
// uses (see schema/university.ts).
// ---------------------------------------------------------------------------

import { or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { universityMembers, universitySubscriptions } from "@paperclipai/db";

const MONTHLY_PRICE_USD = 50;
const ANNUAL_PRICE_USD = 500;

export interface RevenueSummary {
  activeMembers: number;
  monthlyMembers: number;
  annualMembers: number;
  mrrUsd: number;
  newSubs30d: number;
  cancellations30d: number;
}

/**
 * Revenue rollup from university_subscriptions.
 *   activeMembers     — status in ('active','past_due')
 *   monthlyMembers    — active + plan = 'university_monthly'
 *   annualMembers     — active + plan = 'university_annual'
 *   newSubs30d        — created_at >= now - 30d
 *   cancellations30d  — status = 'cancelled' AND canceled_at >= now - 30d
 *   mrrUsd            — monthly*50 + annual*(500/12), rounded
 */
export async function revenueSummary(db: Db): Promise<RevenueSummary> {
  const isActive = sql`${universitySubscriptions.status} IN ('active', 'past_due')`;
  const since30d = sql`NOW() - INTERVAL '30 days'`;

  const [row] = await db
    .select({
      activeMembers: sql<number>`COUNT(*) FILTER (WHERE ${isActive})`.mapWith(Number),
      monthlyMembers: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${universitySubscriptions.plan} = 'university_monthly')`.mapWith(
        Number,
      ),
      annualMembers: sql<number>`COUNT(*) FILTER (WHERE ${isActive} AND ${universitySubscriptions.plan} = 'university_annual')`.mapWith(
        Number,
      ),
      newSubs30d: sql<number>`COUNT(*) FILTER (WHERE ${universitySubscriptions.createdAt} >= ${since30d})`.mapWith(
        Number,
      ),
      cancellations30d: sql<number>`COUNT(*) FILTER (WHERE ${universitySubscriptions.status} = 'cancelled' AND ${universitySubscriptions.canceledAt} >= ${since30d})`.mapWith(
        Number,
      ),
    })
    .from(universitySubscriptions);

  const activeMembers = row?.activeMembers ?? 0;
  const monthlyMembers = row?.monthlyMembers ?? 0;
  const annualMembers = row?.annualMembers ?? 0;
  const mrrUsd = Math.round(
    monthlyMembers * MONTHLY_PRICE_USD + annualMembers * (ANNUAL_PRICE_USD / 12),
  );

  return {
    activeMembers,
    monthlyMembers,
    annualMembers,
    mrrUsd,
    newSubs30d: row?.newSubs30d ?? 0,
    cancellations30d: row?.cancellations30d ?? 0,
  };
}

export interface CockpitMember {
  email: string;
  displayName: string | null;
  status: string | null;
  plan: string | null;
  founding: boolean;
  tier: "free" | "member";
  joinedAt: string | null;
}

/**
 * The member roster from university_members. If `q` is given, filter
 * case-insensitively on email OR display_name. Every row maps to tier:'member'
 * — the free tier is merged in route-side from the Brevo founding list.
 */
export async function listMembers(
  db: Db,
  q?: string,
): Promise<CockpitMember[]> {
  const search = q?.trim();
  const where = search
    ? or(
        sql`${universityMembers.email} ILIKE ${`%${search}%`}`,
        sql`${universityMembers.displayName} ILIKE ${`%${search}%`}`,
      )
    : undefined;

  const rows = await db
    .select({
      email: universityMembers.email,
      displayName: universityMembers.displayName,
      status: universityMembers.status,
      plan: universityMembers.plan,
      founding: universityMembers.founding,
      joinedAt: universityMembers.joinedAt,
    })
    .from(universityMembers)
    .where(where)
    .orderBy(sql`${universityMembers.joinedAt} desc nulls last`);

  return rows.map((r) => ({
    email: r.email,
    displayName: r.displayName ?? null,
    status: r.status ?? null,
    plan: r.plan ?? null,
    founding: r.founding ?? false,
    tier: "member" as const,
    joinedAt: r.joinedAt ? r.joinedAt.toISOString() : null,
  }));
}
