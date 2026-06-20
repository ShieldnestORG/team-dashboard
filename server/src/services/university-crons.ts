// ---------------------------------------------------------------------------
// Coherent Ones University — time-delayed lifecycle emails (cron-driven).
//
// Three daily jobs, each a thin wrapper over a queryable+testable send fn:
//   - university:onboarding-d1  — active members ~1 day post-join
//   - university:onboarding-d3  — active members ~3 days post-join
//   - university:winback        — cancelled members ~14 days after cancelling
//
// No progress table (not built yet): we select on joined_at/status (and, for
// winback, the updated_at timestamp the cancel handlers stamp) using a 1-DAY
// WINDOW so a daily cron hits each member exactly once. E.g. d1 selects members
// whose joined_at is in [now-2d, now-1d); the next day they've aged out of the
// window, so they aren't re-emailed. This mirrors the windowed dunning queries
// in affiliate-crons.ts.
//
// Event-driven sends (welcome/receipt/past_due/canceled) live in
// university-stripe-handler.ts. These crons cover only the time-delayed touches.
//
// Owner agent: "mark" (University is Mark's product). Registered via the central
// cron-registry (cron-registry.ts); started from app.ts:startUniversityCrons.
// ---------------------------------------------------------------------------

import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universitySessions,
  universitySessionRsvps,
} from "@paperclipai/db";
import { registerCronJob } from "./cron-registry.js";
import {
  sendCreditscoreEmail,
  type CreditscoreEmailKind,
} from "./creditscore-email-callback.js";
import {
  UNIVERSITY_PRESENCE_URL,
  UNIVERSITY_REJOIN_URL,
  UNIVERSITY_SESSIONS_URL,
  firstNameFromDisplayName,
} from "./university-email.js";
import { logger } from "../middleware/logger.js";

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
// Live-session reminders — windowed on the SESSION start time (not joined_at).
//
// Unlike the onboarding crons (day-wide windows, daily sweep), session
// reminders use a 1-HOUR window swept HOURLY so each session fires its T-24h
// and T-1h reminder exactly once. The window IS the idempotency (same design as
// onboarding-d1's [now-2d,now-1d)): a session is in the 24h window only during
// the single hour its start is ~24h out, so the hourly cron hits it once.
//
//   T-24h: starts_at ∈ [now+23h, now+24h)
//   T-1h:  starts_at ∈ [now+1h,  now+2h)
//
// For each due session we fan out to its `going` RSVPs, resolving the optional
// firstName from the member's display_name (LEFT JOIN — a member may not have a
// university_members row matched yet). Canceled sessions are excluded. Per-send
// failures are caught and logged non-fatally so one bad address doesn't sink
// the batch.
// ---------------------------------------------------------------------------

async function runSessionReminderWindow(
  db: Db,
  opts: {
    windowStart: string; // SQL interval, e.g. "23 hours"
    windowEnd: string; // SQL interval, e.g. "24 hours"
    kind: CreditscoreEmailKind;
    jobLabel: string;
  },
): Promise<number> {
  // Due RSVPs: `going` rows whose session is `scheduled` and starts inside the
  // window. We join the member row (email match, lowercased) to pull the
  // display name for personalization — LEFT JOIN so a recipient without a
  // matched member row still gets the email (firstName just falls back).
  const due = await db
    .select({
      email: universitySessionRsvps.email,
      displayName: universityMembers.displayName,
      title: universitySessions.title,
      startsAt: universitySessions.startsAt,
    })
    .from(universitySessionRsvps)
    .innerJoin(
      universitySessions,
      eq(universitySessionRsvps.sessionId, universitySessions.id),
    )
    .leftJoin(
      universityMembers,
      sql`LOWER(${universityMembers.email}) = LOWER(${universitySessionRsvps.email})`,
    )
    .where(
      and(
        eq(universitySessionRsvps.status, "going"),
        eq(universitySessions.status, "scheduled"),
        gte(
          universitySessions.startsAt,
          sql`now() + interval '${sql.raw(opts.windowStart)}'`,
        ),
        lt(
          universitySessions.startsAt,
          sql`now() + interval '${sql.raw(opts.windowEnd)}'`,
        ),
      ),
    );

  let sent = 0;
  for (const r of due) {
    try {
      await sendCreditscoreEmail({
        kind: opts.kind,
        to: r.email,
        data: {
          firstName: firstNameFromDisplayName(r.displayName),
          title: r.title,
          startsAtIso: r.startsAt.toISOString(),
          sessionsUrl: UNIVERSITY_SESSIONS_URL,
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: r.email, kind: opts.kind },
        `${opts.jobLabel} — send failed for RSVP (non-fatal)`,
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    `${opts.jobLabel} — cycle complete`,
  );
  return sent;
}

export async function runUniversitySessionReminder24h(db: Db): Promise<number> {
  return runSessionReminderWindow(db, {
    windowStart: "23 hours",
    windowEnd: "24 hours",
    kind: "university_session_reminder_24h",
    jobLabel: "university:session-reminder-24h",
  });
}

export async function runUniversitySessionReminder1h(db: Db): Promise<number> {
  return runSessionReminderWindow(db, {
    windowStart: "1 hour",
    windowEnd: "2 hours",
    kind: "university_session_reminder_1h",
    jobLabel: "university:session-reminder-1h",
  });
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

  // Session reminders run HOURLY (not daily) — the 1-hour start-time window
  // must be swept every hour for exactly-once delivery. Staggered minutes (:05
  // / :10) so they don't collide with each other or the :00/:15/:30 daily slots.
  registerCronJob({
    jobName: "university:session-reminder-24h",
    schedule: "5 * * * *", // hourly at :05
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversitySessionReminder24h(db),
  });

  registerCronJob({
    jobName: "university:session-reminder-1h",
    schedule: "10 * * * *", // hourly at :10
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversitySessionReminder1h(db),
  });
}
