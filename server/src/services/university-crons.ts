// ---------------------------------------------------------------------------
// Coherent Ones University — time-delayed lifecycle emails (cron-driven).
//
// Daily jobs, each a thin wrapper over a queryable+testable send fn:
//   - university:onboarding-d1  — active members ~1 day post-join
//   - university:onboarding-d3  — active members ~3 days post-join
//   - university:winback        — cancelled members ~14 days after cancelling
//   - university:dunning-d3     — past_due subs ~3 days in (past_due touch=2)
//   - university:dunning-d7     — past_due subs ~7 days in (past_due touch=3 +
//                                 the final payment_failed warning before Stripe
//                                 auto-cancels)
//   - university:streak-nudge   — active members whose live streak is at risk
//                                 today (repped yesterday, not yet today)
//
// Most jobs select on joined_at/updated_at/status using a 1-DAY WINDOW so a
// daily cron hits each member exactly once. E.g. d1 selects members whose
// joined_at is in [now-2d, now-1d); the next day they've aged out of the
// window, so they aren't re-emailed. This mirrors the windowed dunning queries
// in affiliate-crons.ts. The streak-nudge job instead derives the at-risk set
// from university_progress rep-days in code (Rule 5), keyed on the UTC day.
//
// Event-driven sends (welcome/receipt/past_due touch=1/canceled) live in
// university-stripe-handler.ts. These crons cover the time-delayed touches.
//
// Owner agent: "mark" (University is Mark's product). Registered via the central
// cron-registry (cron-registry.ts); started from app.ts:startUniversityCrons.
// ---------------------------------------------------------------------------

import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universityProgress,
  universitySubscriptions,
} from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import { sendCreditscoreEmail } from "./creditscore-email-callback.js";
import {
  UNIVERSITY_PRESENCE_URL,
  UNIVERSITY_REJOIN_URL,
  UNIVERSITY_MANAGE_BILLING_URL,
  firstNameFromDisplayName,
} from "./university-email.js";
import { logger } from "../middleware/logger.js";

// A "rep day" comes back from the Postgres `date` column as 'YYYY-MM-DD'. The
// streak-nudge cron reasons in UTC day buckets, matching customer-portal.ts.
function utcDayString(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addUtcDays(day: string, n: number): string {
  const ms = Date.parse(`${day}T00:00:00.000Z`);
  return utcDayString(new Date(ms + n * 24 * 60 * 60 * 1000));
}

// ---------------------------------------------------------------------------
// onboarding day 1 — active members who joined ~1 day ago.
// Window: joined_at in [now-2d, now-1d).
// ---------------------------------------------------------------------------

export async function runUniversityOnboardingD1(db: Db): Promise<number> {
  const due = await db
    .select({
      id: universityMembers.id,
      email: universityMembers.email,
      displayName: universityMembers.displayName,
    })
    .from(universityMembers)
    .where(
      and(
        eq(universityMembers.status, "active"),
        gte(universityMembers.joinedAt, sql`now() - interval '2 days'`),
        lt(universityMembers.joinedAt, sql`now() - interval '1 day'`),
      ),
    );

  let sent = 0;
  for (const m of due) {
    try {
      await sendCreditscoreEmail({
        kind: "university_onboarding_d1",
        to: m.email,
        data: {
          firstName: firstNameFromDisplayName(m.displayName),
          listenUrl: UNIVERSITY_PRESENCE_URL,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: m.email, kind: "university_onboarding_d1" },
        "university:onboarding-d1 — send failed for member (non-fatal)",
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    "university:onboarding-d1 — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// onboarding day 3 — active members who joined ~3 days ago.
// Window: joined_at in [now-4d, now-3d).
// ---------------------------------------------------------------------------

export async function runUniversityOnboardingD3(db: Db): Promise<number> {
  const due = await db
    .select({
      id: universityMembers.id,
      email: universityMembers.email,
      displayName: universityMembers.displayName,
    })
    .from(universityMembers)
    .where(
      and(
        eq(universityMembers.status, "active"),
        gte(universityMembers.joinedAt, sql`now() - interval '4 days'`),
        lt(universityMembers.joinedAt, sql`now() - interval '3 days'`),
      ),
    );

  let sent = 0;
  for (const m of due) {
    try {
      await sendCreditscoreEmail({
        kind: "university_onboarding_d3",
        to: m.email,
        data: {
          firstName: firstNameFromDisplayName(m.displayName),
          nextDrillUrl: UNIVERSITY_PRESENCE_URL,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: m.email, kind: "university_onboarding_d3" },
        "university:onboarding-d3 — send failed for member (non-fatal)",
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    "university:onboarding-d3 — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// winback — members cancelled ~14 days ago. The cancel handlers stamp
// updated_at when flipping status to 'cancelled', so we window on updated_at
// in [now-15d, now-14d) to fire a single touch at the ~14-day mark.
// ---------------------------------------------------------------------------

export async function runUniversityWinback(db: Db): Promise<number> {
  const due = await db
    .select({
      id: universityMembers.id,
      email: universityMembers.email,
    })
    .from(universityMembers)
    .where(
      and(
        eq(universityMembers.status, "cancelled"),
        gte(universityMembers.updatedAt, sql`now() - interval '15 days'`),
        lt(universityMembers.updatedAt, sql`now() - interval '14 days'`),
      ),
    );

  let sent = 0;
  for (const m of due) {
    try {
      await sendCreditscoreEmail({
        kind: "university_winback",
        to: m.email,
        data: {
          rejoinUrl: UNIVERSITY_REJOIN_URL,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: m.email, kind: "university_winback" },
        "university:winback — send failed for member (non-fatal)",
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    "university:winback — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// Dunning — day-3 and day-7 past_due nudges.
//
// touch=1 fires event-driven in university-stripe-handler.ts on the past_due
// transition (which stamps university_subscriptions.updated_at). These two
// time-delayed crons complete the dunning ladder:
//   - day 3 → touch=2 (second knock)
//   - day 7 → touch=3 (final past_due nudge) PLUS the dedicated
//             university_payment_failed_final warning, fired before Stripe's
//             own auto-cancel (typically ~the end of the smart-retry window).
//
// We window on updated_at (mirroring winback), selecting subscriptions still in
// status='past_due'. A member who fixes their card transitions OUT of past_due
// (handler flips status + re-stamps updated_at), so they naturally fall out of
// the window and are never nudged again. Caveat: updated_at is the LAST status
// write, so if some other event re-stamps it mid-dunning the window resets — an
// accepted approximation consistent with the existing winback cron, and erring
// toward fewer (not duplicate) nudges.
//
// Idempotency across the daily run is the 1-DAY window: a member sits in the
// [now-(N+1)d, now-Nd) bucket for exactly one daily fire.
// ---------------------------------------------------------------------------

/**
 * Shared past_due dunning runner. Selects past_due subscriptions whose
 * updated_at lands in [now-(dayMark+1)d, now-dayMark d) and fires a
 * university_past_due email at the given touch level. When `final` is set
 * (day-7), ALSO fires the university_payment_failed_final warning. Each send is
 * independently non-fatal. Returns the count of past_due nudges sent.
 */
async function runUniversityDunning(
  db: Db,
  opts: { dayMark: number; touch: number; final: boolean },
): Promise<number> {
  const { dayMark, touch, final } = opts;
  const olderThan = `now() - interval '${dayMark + 1} days'`;
  const newerThan = `now() - interval '${dayMark} days'`;

  const due = await db
    .select({
      id: universitySubscriptions.id,
      email: universitySubscriptions.email,
    })
    .from(universitySubscriptions)
    .where(
      and(
        eq(universitySubscriptions.status, "past_due"),
        gte(universitySubscriptions.updatedAt, sql.raw(olderThan)),
        lt(universitySubscriptions.updatedAt, sql.raw(newerThan)),
      ),
    );

  let sent = 0;
  for (const s of due) {
    if (!s.email) continue;
    try {
      await sendCreditscoreEmail({
        kind: "university_past_due",
        to: s.email,
        data: {
          manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
          touch,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: s.email, kind: "university_past_due", touch },
        `university:dunning-d${dayMark} — past_due send failed (non-fatal)`,
      );
    }

    if (final) {
      // Last warning before Stripe auto-cancels. Transactional storefront-side
      // (NOT suppressed) — a lapsing paying member must receive it.
      try {
        await sendCreditscoreEmail({
          kind: "university_payment_failed_final",
          to: s.email,
          data: {
            manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
          },
        });
      } catch (err) {
        logger.error(
          { err, email: s.email, kind: "university_payment_failed_final" },
          `university:dunning-d${dayMark} — final-warning send failed (non-fatal)`,
        );
      }
    }
  }

  logger.info(
    { considered: due.length, sent, dayMark, touch, final },
    `university:dunning-d${dayMark} — cycle complete`,
  );
  return sent;
}

/** Day-3 past_due nudge (touch=2). */
export async function runUniversityDunningD3(db: Db): Promise<number> {
  return runUniversityDunning(db, { dayMark: 3, touch: 2, final: false });
}

/** Day-7 past_due nudge (touch=3) + final pre-cancellation warning. */
export async function runUniversityDunningD7(db: Db): Promise<number> {
  return runUniversityDunning(db, { dayMark: 7, touch: 3, final: true });
}

// ---------------------------------------------------------------------------
// Streak nudge — ACTIVE members whose streak is alive but at risk today.
//
// "At risk" = the member logged a rep YESTERDAY (UTC) and has NOT logged one
// TODAY. That's exactly the window where a single missed day breaks the chain
// (see customer-portal.ts computeStreak: a streak survives on yesterday's rep
// but resets once a full day is missed). Nudging them today, before the UTC day
// closes, is the highest-leverage single touch.
//
// We compute the at-risk set in ONE grouped query over university_progress:
// per email, the max rep_day. Members whose latest rep_day == yesterday are
// at-risk (repped yesterday, not today). We then keep only those joined to an
// ACTIVE member row. Streak length for the email copy is derived from a count
// of that member's recent distinct rep-days walked backward from yesterday —
// computed in code (Rule 5), not by the model.
// ---------------------------------------------------------------------------

export async function runUniversityStreakNudge(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const today = utcDayString(now);
  const yesterday = addUtcDays(today, -1);

  // Per-member rep-day rollup. We only need members active enough to plausibly
  // hold a streak, so we look back a bounded window (30 days) — far more than
  // any streak the copy cares about, and it keeps the scan cheap.
  const windowStart = addUtcDays(today, -30);

  const rows = await db
    .select({
      email: universityProgress.email,
      repDay: universityProgress.repDay,
    })
    .from(universityProgress)
    .where(gte(universityProgress.repDay, windowStart));

  // Group rep-days per (lowercased) email.
  const byEmail = new Map<string, Set<string>>();
  for (const r of rows) {
    const email = r.email.toLowerCase();
    const day = String(r.repDay);
    const set = byEmail.get(email) ?? new Set<string>();
    set.add(day);
    byEmail.set(email, set);
  }

  // At-risk = latest rep is yesterday (repped yesterday, none today). Compute
  // the live streak length walking back from yesterday for the email copy.
  const atRisk: Array<{ email: string; streakDays: number }> = [];
  for (const [email, days] of byEmail) {
    if (days.has(today)) continue; // already did today's rep — safe
    if (!days.has(yesterday)) continue; // streak already broken — not at risk
    let streakDays = 0;
    let cursor = yesterday;
    while (days.has(cursor)) {
      streakDays += 1;
      cursor = addUtcDays(cursor, -1);
    }
    atRisk.push({ email, streakDays });
  }

  if (atRisk.length === 0) {
    logger.info({ considered: 0, sent: 0 }, "university:streak-nudge — cycle complete");
    return 0;
  }

  // Keep only ACTIVE members, and grab the display name for the greeting.
  const emails = atRisk.map((a) => a.email);
  const members = await db
    .select({
      email: universityMembers.email,
      displayName: universityMembers.displayName,
    })
    .from(universityMembers)
    .where(
      and(
        eq(universityMembers.status, "active"),
        sql`LOWER(${universityMembers.email}) = ANY(${emails})`,
      ),
    );

  const memberByEmail = new Map<string, string | null>();
  for (const m of members) {
    memberByEmail.set(m.email.toLowerCase(), m.displayName);
  }

  let sent = 0;
  for (const a of atRisk) {
    if (!memberByEmail.has(a.email)) continue; // not an active member
    const displayName = memberByEmail.get(a.email) ?? null;
    try {
      await sendCreditscoreEmail({
        kind: "university_streak_nudge",
        to: a.email,
        data: {
          firstName: firstNameFromDisplayName(displayName),
          streakDays: a.streakDays,
          repUrl: UNIVERSITY_PRESENCE_URL,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: a.email, kind: "university_streak_nudge" },
        "university:streak-nudge — send failed for member (non-fatal)",
      );
    }
  }

  logger.info(
    { considered: atRisk.length, activeMatched: members.length, sent },
    "university:streak-nudge — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// Registration. Staggered early-UTC daily slots so they don't collide with the
// 6-hourly creditscore:scan or the 1st-of-month fulfillment jobs.
// ---------------------------------------------------------------------------

export function startUniversityCrons(db: Db): void {
  registerCronJob({
    jobName: "university:onboarding-d1",
    schedule: "0 14 * * *", // daily 14:00 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityOnboardingD1(db),
  });

  registerCronJob({
    jobName: "university:onboarding-d3",
    schedule: "15 14 * * *", // daily 14:15 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityOnboardingD3(db),
  });

  registerCronJob({
    jobName: "university:winback",
    schedule: "30 14 * * *", // daily 14:30 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityWinback(db),
  });

  registerCronJob({
    jobName: "university:dunning-d3",
    schedule: "45 14 * * *", // daily 14:45 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityDunningD3(db),
  });

  registerCronJob({
    jobName: "university:dunning-d7",
    schedule: "0 15 * * *", // daily 15:00 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityDunningD7(db),
  });

  // Streak nudge runs LATE in the UTC day so members have had the whole day to
  // log today's rep before we nudge — minimizing "you missed it" sends to
  // members who simply rep in the evening.
  registerCronJob({
    jobName: "university:streak-nudge",
    schedule: "0 22 * * *", // daily 22:00 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityStreakNudge(db),
  });
}
