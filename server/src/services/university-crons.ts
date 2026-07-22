// ---------------------------------------------------------------------------
// Coherent Ones University — time-delayed lifecycle emails (cron-driven).
//
// Daily jobs, each a thin wrapper over a queryable+testable send fn:
//   - university:onboarding-d1  — active members ~1 day post-join
//   - university:onboarding-d3  — active members ~3 days post-join
//   - university:winback        — cancelled members ~14 days after cancelling
//   - university:streak-nudge   — active members whose live streak is at risk
//                                 today (repped yesterday, not yet today).
//                                 Capped to once per 7 days per member.
//   - university:reengage       — active members gone quiet: last activity was
//                                 EXACTLY 7 / 14 / 30 UTC-days ago
//   - university:dunning-d3     — past_due subs ~3 days in (past_due touch=2)
//   - university:dunning-d7     — past_due subs ~7 days in (past_due touch=3 +
//                                 the final payment_failed warning before Stripe
//                                 auto-cancels)
//
// Most jobs select on joined_at/status (and, for winback, the updated_at
// timestamp the cancel handlers stamp) using a 1-DAY WINDOW so a daily cron hits
// each member exactly once. E.g. d1 selects members whose joined_at is in
// [now-2d, now-1d); the next day they've aged out of the window, so they aren't
// re-emailed. This mirrors the windowed dunning queries in affiliate-crons.ts.
// The streak-nudge job instead derives the at-risk set from university_progress
// rep-days in code (Rule 5), keyed on the UTC day.
//
// Event-driven sends (welcome/receipt/past_due/canceled) live in
// university-stripe-handler.ts. These crons cover only the time-delayed touches.
//
// Owner agent: "mark" (University is Mark's product). Registered via the central
// cron-registry (cron-registry.ts); started from app.ts:startUniversityCrons.
// ---------------------------------------------------------------------------

import { and, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universityProgress,
  universityCheckins,
  universitySessions,
  universitySessionRsvps,
  universityEmailLog,
  universitySubscriptions,
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
  UNIVERSITY_MANAGE_BILLING_URL,
  firstNameFromDisplayName,
} from "./university-email.js";
import { JOIN_GRACE_AFTER_MINUTES } from "./university-sessions.js";
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

// Re-engagement tiers: how many quiet days maps to which email kind. daysAway is
// passed straight into the payload so the storefront template can render it.
const REENGAGE_TIERS: ReadonlyArray<{
  daysAway: number;
  kind: CreditscoreEmailKind;
}> = [
  { daysAway: 7, kind: "university_reengage_d7" },
  { daysAway: 14, kind: "university_reengage_d14" },
  { daysAway: 30, kind: "university_reengage_d30" },
];
const REENGAGE_KINDS: CreditscoreEmailKind[] = REENGAGE_TIERS.map((t) => t.kind);

// Per-touch dunning dedup markers written to university_email_log. LOG-ONLY:
// never passed to sendCreditscoreEmail. The dunning email actually sent keeps
// kind 'university_past_due' (+ touch) so the existing storefront template
// renders it; these markers exist only so the (email, kind) log-dedup can tell
// the day-3 touch from the day-7 touch. Kept OUT of CreditscoreEmailKind (the
// team-dashboard → storefront kind contract) on purpose — they are never sent.
// See the dunning section below.
type DunningLogMarker = "university_past_due_d3" | "university_past_due_d7";

// Records one lifecycle-email send in university_email_log for frequency-cap /
// dedup lookups. Stores the lowercased email. Self-contained failure handling:
// the send already happened, so a log-write failure is logged non-fatally
// (degrades to a possible re-send next cycle) rather than masking the send.
async function logUniversityEmail(
  db: Db,
  email: string,
  kind: CreditscoreEmailKind | DunningLogMarker,
  // ESP messageId returned by the storefront send route (null when the
  // storefront didn't report one) — joins engagement events to this send.
  messageId: string | null = null,
): Promise<void> {
  try {
    await db
      .insert(universityEmailLog)
      .values({ email: email.toLowerCase(), kind, messageId });
  } catch (err) {
    logger.error(
      { err, email, kind },
      "university:email-log — insert failed (non-fatal)",
    );
  }
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
// "We are live now" — sent at start time to going RSVPs WITH the real join_url.
//
// CADENCE: this is the finest-cadence cron in the file. The shared cron
// scheduler supports standard 5-field cron with PER-MINUTE granularity
// (cron.ts parses `* * * * *` / `*/N`; the registry ticks every 30s), so this
// runs EVERY MINUTE. The scheduler advances each job's nextRun to the NEXT
// whole minute after every fire (cron.ts nextCronTick floors to the minute),
// so a `* * * * *` job's handler runs EXACTLY ONCE per wall-clock minute —
// never twice — but a few seconds INTO that minute (tick jitter).
//
// WINDOW (minute-aligned, disjoint, exactly-once): we floor `now` to the
// current minute boundary M = date_trunc('minute', now()) and use a 1-minute
// slice keyed off M, NOT off jittery now():
//
//   starts_at ∈ [M, M + 1 minute)
//
// Because every fire-instant within a wall-clock minute (12:00:01 … 12:00:59)
// floors to the SAME M, the window is identical regardless of sub-minute
// jitter. Consecutive minutes' windows tile perfectly — [M, M+1m), [M+1m,
// M+2m), … — disjoint and adjacent, no gap, no overlap. A session falls into
// EXACTLY ONE slice (the minute its start lands in), so its "live now" email
// fires exactly once. The room is already live at T-0 (the join window opens at
// T-JOIN_OPENS_BEFORE_MINUTES), so join_url is valid to hand out here.
//
// CORRECTNESS DOES NOT DEPEND ON DOWNSTREAM DEDUP. The landing email receiver
// does NOT de-duplicate by messageId, so exactly-once must be — and is —
// guaranteed by the disjoint windows alone. The messageId below is kept for
// tracing only; do NOT reintroduce an overlapping window on the assumption that
// the storefront will drop duplicates (it won't).
//
// DE-DUP vs the T-1h reminder: that cron's window is starts_at ∈ [now+1h,
// now+2h); this one is the T-0 minute slice. The windows do not overlap, so a
// session never gets both in the same sweep. Unlike the reminders this sweeps
// every minute (not hourly), because a 1-hour window at T-0 would mean blasting
// the join link up to an hour early.
// ---------------------------------------------------------------------------

export async function runUniversitySessionStartingNow(
  db: Db,
  // Optional reference instant, floored to the minute boundary M. Defaults to
  // the DB clock (now()). Tests pass a fixed instant so the JS-computed M used
  // to seed sessions and the SQL-computed M used here are derived from the SAME
  // instant — eliminating the wall-clock-boundary race that flakes under load.
  // Production never passes this; behavior is identical to now().
  now?: Date,
): Promise<number> {
  // Minute-aligned slice immune to sub-minute tick jitter: floor now() to the
  // minute boundary M, then match starts_at ∈ [M, M+1m). Each start minute is
  // hit by exactly one sweep. We pull join_url here (the room is live at T-0) —
  // this is the one session email that carries it.
  const minuteBoundary = now
    ? sql`date_trunc('minute', ${now.toISOString()}::timestamptz)`
    : sql`date_trunc('minute', now())`;
  const due = await db
    .select({
      email: universitySessionRsvps.email,
      displayName: universityMembers.displayName,
      sessionId: universitySessions.id,
      title: universitySessions.title,
      hostName: universitySessions.hostName,
      joinUrl: universitySessions.joinUrl,
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
        gte(universitySessions.startsAt, minuteBoundary),
        lt(universitySessions.startsAt, sql`${minuteBoundary} + interval '1 minute'`),
      ),
    );

  let sent = 0;
  for (const r of due) {
    try {
      await sendCreditscoreEmail({
        kind: "university_session_starting_now",
        to: r.email,
        // Trace-only. Exactly-once is guaranteed by the disjoint minute window
        // above — the landing receiver does NOT dedup by messageId.
        messageId: `starting-now:${r.sessionId}:${r.email.trim().toLowerCase()}`,
        data: {
          sessionId: r.sessionId,
          sessionTitle: r.title,
          hostName: r.hostName,
          joinUrl: r.joinUrl,
          sessionsUrl: UNIVERSITY_SESSIONS_URL,
          // firstName isn't in the landing contract for this kind, but the
          // template can ignore extra fields; keep payloads consistent.
          firstName: firstNameFromDisplayName(r.displayName),
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: r.email, kind: "university_session_starting_now" },
        "university:session-starting-now — send failed for RSVP (non-fatal)",
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    "university:session-starting-now — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// Post-session recap — sent shortly AFTER a session ends to going RSVPs.
//
// CADENCE: per-minute, same as starting-now (the scheduler runs a `* * * * *`
// job exactly once per wall-clock minute — see runUniversitySessionStartingNow
// above). The "ended" instant is computed per-row as starts_at +
// duration_minutes + JOIN_GRACE_AFTER_MINUTES (the same boundary the live
// window + member list use).
//
// WINDOW (minute-aligned, disjoint, exactly-once): floor now() to the current
// minute boundary M = date_trunc('minute', now()) and match the PRECEDING
// 1-minute slice keyed off M, NOT off jittery now():
//
//   ended_at ∈ [M - 1 minute, M)
//
// As with starting-now, every fire-instant within a wall-clock minute floors to
// the same M, so the window is immune to sub-minute tick jitter. Consecutive
// minutes' windows tile perfectly — …, [M-1m, M), [M, M+1m), … — disjoint and
// adjacent, no gap, no overlap. A session's computed ended_at falls into
// EXACTLY ONE slice, so its recap fires once, in the minute just after its live
// window closes.
//
// CORRECTNESS DOES NOT DEPEND ON DOWNSTREAM DEDUP. The landing email receiver
// does NOT de-duplicate by messageId, so exactly-once is guaranteed by the
// disjoint windows alone. The messageId below is trace-only; do NOT reintroduce
// an overlapping window assuming the storefront drops duplicates (it won't).
//
// recordingUrl carries the session's manual recording link (v1) when an admin
// has pasted one (Zoom-cloud / unlisted YouTube), or null otherwise. The
// landing template handles the null gracefully ("recording not posted").
// ---------------------------------------------------------------------------

export async function runUniversitySessionRecap(
  db: Db,
  // See runUniversitySessionStartingNow: optional fixed reference instant for
  // deterministic tests; defaults to the DB clock. Production never passes it.
  now?: Date,
): Promise<number> {
  // ended_at = starts_at + (duration + grace) minutes. Minute-aligned slice
  // immune to tick jitter: floor now() to the minute boundary M, then match
  // ended_at ∈ [M-1m, M) — the single minute just after the session ended.
  // Canceled sessions are excluded.
  const minuteBoundary = now
    ? sql`date_trunc('minute', ${now.toISOString()}::timestamptz)`
    : sql`date_trunc('minute', now())`;
  const endedAt = sql`${universitySessions.startsAt} + make_interval(mins => ${universitySessions.durationMinutes} + ${JOIN_GRACE_AFTER_MINUTES})`;

  const due = await db
    .select({
      email: universitySessionRsvps.email,
      displayName: universityMembers.displayName,
      sessionId: universitySessions.id,
      title: universitySessions.title,
      hostName: universitySessions.hostName,
      recordingUrl: universitySessions.recordingUrl,
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
        gte(endedAt, sql`${minuteBoundary} - interval '1 minute'`),
        lt(endedAt, minuteBoundary),
      ),
    );

  let sent = 0;
  for (const r of due) {
    try {
      await sendCreditscoreEmail({
        kind: "university_session_recap",
        to: r.email,
        // Trace-only. Exactly-once is guaranteed by the disjoint minute window
        // above — the landing receiver does NOT dedup by messageId.
        messageId: `recap:${r.sessionId}:${r.email.trim().toLowerCase()}`,
        data: {
          sessionId: r.sessionId,
          sessionTitle: r.title,
          hostName: r.hostName,
          // The manual recording link (v1) if the admin pasted one; null
          // otherwise — the landing template renders an honest "recording not
          // posted" in the null case.
          recordingUrl: r.recordingUrl ?? null,
          sessionsUrl: UNIVERSITY_SESSIONS_URL,
          firstName: firstNameFromDisplayName(r.displayName),
        },
      });
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: r.email, kind: "university_session_recap" },
        "university:session-recap — send failed for RSVP (non-fatal)",
      );
    }
  }
  logger.info(
    { considered: due.length, sent },
    "university:session-recap — cycle complete",
  );
  return sent;
}

// ---------------------------------------------------------------------------
// Streak nudge — ACTIVE members whose streak is alive but at risk today.
//
// The streak is a UNION (F2 "Today's Three"): a day counts if it has a rep OR a
// stand-alone check-in (matching customer-portal.ts getProgressSummary). So
// "at risk" = the member had a day-signal (rep OR check-in) YESTERDAY (UTC) and
// has NONE today. That's exactly the window where a single missed day breaks the
// chain (see computeStreak: a streak survives on yesterday's signal but resets
// once a full day is missed). Nudging them today, before the UTC day closes, is
// the highest-leverage single touch.
//
// CRITICAL: the union MUST be applied here identically to getProgressSummary —
// a member who already checked in today is NOT at risk and must never be sent a
// "your streak is at risk" email (that would be a false, outcome-adjacent lie;
// see university-crons.test.ts). We union two grouped scans (university_progress
// rep_days + university_checkins checkin_days) into a per-email day set; members
// whose set has yesterday but NOT today are at-risk. We then keep only those
// joined to an ACTIVE member row. Streak length for the email copy is derived
// from that member's union day-set walked backward from yesterday — computed in
// code (Rule 5), not by the model.
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

  // Group day-signals per (lowercased) email — reps FIRST, then check-ins folded
  // in, so the set is the UNION that drives the streak.
  const byEmail = new Map<string, Set<string>>();
  const addDay = (emailRaw: string, dayRaw: unknown) => {
    const email = emailRaw.toLowerCase();
    const day = String(dayRaw);
    const set = byEmail.get(email) ?? new Set<string>();
    set.add(day);
    byEmail.set(email, set);
  };
  for (const r of rows) addDay(r.email, r.repDay);

  // Fold in stand-alone check-ins over the same window (F2). A member who only
  // checked in (no rep) today is thereby marked safe, not at risk.
  const checkinRows = await db
    .select({
      email: universityCheckins.email,
      checkinDay: universityCheckins.checkinDay,
    })
    .from(universityCheckins)
    .where(gte(universityCheckins.checkinDay, windowStart));
  for (const r of checkinRows) addDay(r.email, r.checkinDay);

  // At-risk = a day-signal yesterday but none today. Compute the live streak
  // length walking back from yesterday (over the union) for the email copy.
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
        sql`LOWER(${universityMembers.email}) = ANY(ARRAY[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[])`,
      ),
    );

  const memberByEmail = new Map<string, string | null>();
  for (const m of members) {
    memberByEmail.set(m.email.toLowerCase(), m.displayName);
  }

  // Weekly frequency cap: skip anyone already nudged in the last 7 days. Backed
  // by university_email_log (survives restarts), so a member gets at most one
  // streak nudge per rolling 7-day window even while their streak stays at risk.
  const recentNudges = await db
    .select({ email: universityEmailLog.email })
    .from(universityEmailLog)
    .where(
      and(
        eq(universityEmailLog.kind, "university_streak_nudge"),
        gte(universityEmailLog.sentAt, sql`now() - interval '7 days'`),
        sql`LOWER(${universityEmailLog.email}) = ANY(ARRAY[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[])`,
      ),
    );
  const cappedEmails = new Set<string>();
  for (const r of recentNudges) cappedEmails.add(r.email.toLowerCase());

  let sent = 0;
  for (const a of atRisk) {
    if (!memberByEmail.has(a.email)) continue; // not an active member
    if (cappedEmails.has(a.email)) continue; // nudged within the last 7 days
    const displayName = memberByEmail.get(a.email) ?? null;
    try {
      const messageId = await sendCreditscoreEmail({
        kind: "university_streak_nudge",
        to: a.email,
        data: {
          firstName: firstNameFromDisplayName(displayName),
          streakDays: a.streakDays,
          repUrl: UNIVERSITY_PRESENCE_URL,
        },
      });
      await logUniversityEmail(
        db,
        a.email,
        "university_streak_nudge",
        messageId ?? null,
      );
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
// Re-engagement check-in — ACTIVE members who have gone quiet, at fixed
// milestones. A member's "last activity day" is the max of their rep-days (UTC),
// or their join date (UTC) if they never repped. We fire a single check-in when
// that day is EXACTLY 7 / 14 / 30 days ago — one touch per milestone.
//
// The day-bucket match IS the primary once-per-tier idempotency (a member sits
// in a given bucket for exactly one UTC day, so a daily sweep hits it once),
// backed by a belt-and-suspenders dedup against university_email_log (skip the
// same kind for the same email within 30 days) in case the activity signal
// flaps across a boundary.
//
// Mutual exclusion vs streak-nudge holds by construction: a streak-eligible
// member repped YESTERDAY (last activity = today-1), which is never 7/14/30
// days ago — so the two crons can never target the same member on the same day.
//
// Last-activity is derived in code (Rule 5) from a bounded 30-day rep scan. That
// window is safe: reps can't predate joined_at, so a member whose only reps are
// >30 days old necessarily joined >30 days ago too — placing their fallback
// join-date before every bucket, never a false positive.
// ---------------------------------------------------------------------------

export async function runUniversityReengage(
  db: Db,
  now: Date = new Date(),
): Promise<number> {
  const today = utcDayString(now);

  // day-bucket → tier. Each tier occupies exactly one UTC day.
  const tierByDay = new Map<string, { daysAway: number; kind: CreditscoreEmailKind }>();
  for (const t of REENGAGE_TIERS) {
    tierByDay.set(addUtcDays(today, -t.daysAway), t);
  }

  // Active members + their join date (the last-activity fallback for members
  // who have never logged a rep).
  const members = await db
    .select({
      email: universityMembers.email,
      displayName: universityMembers.displayName,
      joinedAt: universityMembers.joinedAt,
    })
    .from(universityMembers)
    .where(eq(universityMembers.status, "active"));

  if (members.length === 0) {
    logger.info({ considered: 0, sent: 0 }, "university:reengage — cycle complete");
    return 0;
  }

  // Max rep-day per (lowercased) email over a bounded 30-day scan (see header:
  // the window can't produce a false positive).
  const windowStart = addUtcDays(today, -30);
  const progressRows = await db
    .select({
      email: universityProgress.email,
      repDay: universityProgress.repDay,
    })
    .from(universityProgress)
    .where(gte(universityProgress.repDay, windowStart));

  const maxRepByEmail = new Map<string, string>();
  for (const r of progressRows) {
    const email = r.email.toLowerCase();
    const day = String(r.repDay);
    const prev = maxRepByEmail.get(email);
    if (!prev || day > prev) maxRepByEmail.set(email, day); // ISO dates sort lexically
  }

  // Resolve each active member to a tier (if their quiet-day lands on a bucket).
  const eligible: Array<{
    email: string;
    displayName: string | null;
    daysAway: number;
    kind: CreditscoreEmailKind;
  }> = [];
  for (const m of members) {
    const email = m.email.toLowerCase();
    const lastActivity =
      maxRepByEmail.get(email) ?? (m.joinedAt ? utcDayString(m.joinedAt) : null);
    if (!lastActivity) continue; // no reps and no join date — can't bucket
    const tier = tierByDay.get(lastActivity);
    if (!tier) continue; // not exactly 7 / 14 / 30 days quiet
    eligible.push({
      email,
      displayName: m.displayName,
      daysAway: tier.daysAway,
      kind: tier.kind,
    });
  }

  if (eligible.length === 0) {
    logger.info({ considered: 0, sent: 0 }, "university:reengage — cycle complete");
    return 0;
  }

  // Belt-and-suspenders dedup: skip anyone already sent the SAME kind in the
  // last 30 days (log-backed).
  const emails = eligible.map((e) => e.email);
  const recent = await db
    .select({
      email: universityEmailLog.email,
      kind: universityEmailLog.kind,
    })
    .from(universityEmailLog)
    .where(
      and(
        inArray(universityEmailLog.kind, REENGAGE_KINDS),
        gte(universityEmailLog.sentAt, sql`now() - interval '30 days'`),
        sql`LOWER(${universityEmailLog.email}) = ANY(ARRAY[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[])`,
      ),
    );
  const alreadySent = new Set<string>();
  for (const r of recent) alreadySent.add(`${r.email.toLowerCase()}|${r.kind}`);

  let sent = 0;
  for (const e of eligible) {
    if (alreadySent.has(`${e.email}|${e.kind}`)) continue; // already sent this tier
    try {
      const messageId = await sendCreditscoreEmail({
        kind: e.kind,
        to: e.email,
        data: {
          firstName: firstNameFromDisplayName(e.displayName),
          daysAway: e.daysAway,
        },
      });
      await logUniversityEmail(db, e.email, e.kind, messageId ?? null);
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email: e.email, kind: e.kind },
        "university:reengage — send failed for member (non-fatal)",
      );
    }
  }

  logger.info(
    { considered: eligible.length, sent },
    "university:reengage — cycle complete",
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
// SELECTION — a THRESHOLD, not a 1-day window. We select subscriptions still in
// status='past_due' whose updated_at is at least `dayMark` days old
// (updated_at <= now - dayMark days). The old [now-(N+1)d, now-Nd) window was
// broken: handleUniversitySubscriptionUpdated re-stamps updated_at on EVERY
// Stripe smart-retry event, so a member could slide out of a 1-day window
// between daily sweeps and silently never be nudged. With a threshold the
// member stays selected every day until they leave past_due, and the email-log
// dedup below (NOT the window) guarantees exactly-once per touch.
//
// A member who fixes their card transitions OUT of past_due (handler flips
// status), so they drop out of the status filter and are never nudged again —
// recovery cancels the ladder naturally.
//
// DEDUP — per-touch, log-backed, mirroring the streak/reengage siblings'
// (email, kind) log dedup (and the (email, kind, sent_at) index built for it).
// Each touch writes a distinct LOG-ONLY marker kind (university_past_due_d3 /
// _d7) to university_email_log; before sending we skip any member who already
// has that marker inside the horizon. The marker is log-only: the email SENT
// stays kind=university_past_due (+ touch) so the existing storefront template
// renders it — we introduce no new storefront kinds. (The log has no data-JSON
// column, and analytics groups the log by `kind`, so distinct kinds — not a
// data field — are what the existing query patterns support.)
//
// HORIZON — 30 days, mirroring reengage's belt-and-suspenders log lookback. An
// episode that recovers and later re-lapses re-stamps updated_at; a marker from
// a PRIOR episode older than 30d must NOT block the new episode's touch, so we
// only count markers newer than now-30d. A past_due episode resolves (recovery
// or Stripe auto-cancel) well within 30d, so within an episode each touch still
// fires exactly once; a re-lapse INSIDE 30d suppresses a near-duplicate nudge —
// erring toward fewer sends, consistent with reengage.
// ---------------------------------------------------------------------------

/**
 * Shared past_due dunning runner. Selects past_due subscriptions whose
 * updated_at is at least `dayMark` days old and fires a university_past_due
 * email at the given touch level, deduped per-touch against university_email_log
 * (the `logMarker` kind, 30-day horizon). When `final` is set (day-7), ALSO
 * fires the university_payment_failed_final warning. Each send is logged (with
 * its messageId, for open/click joins) and independently non-fatal. Returns the
 * count of past_due nudges sent.
 */
async function runUniversityDunning(
  db: Db,
  opts: {
    dayMark: number;
    touch: number;
    final: boolean;
    logMarker: DunningLogMarker;
  },
): Promise<number> {
  const { dayMark, touch, final, logMarker } = opts;

  const due = await db
    .select({
      id: universitySubscriptions.id,
      email: universitySubscriptions.email,
    })
    .from(universitySubscriptions)
    .where(
      and(
        eq(universitySubscriptions.status, "past_due"),
        lte(
          universitySubscriptions.updatedAt,
          sql`now() - interval '${sql.raw(String(dayMark))} days'`,
        ),
      ),
    );

  // Per-touch, log-backed dedup: skip anyone already sent THIS touch inside the
  // 30-day horizon (see header). Emails lowercased to match the log's stored
  // form. Same shape as the reengage/streak dedup queries.
  const emails = due
    .map((s) => s.email?.toLowerCase())
    .filter((e): e is string => !!e);

  const alreadySent = new Set<string>();
  if (emails.length > 0) {
    const recent = await db
      .select({ email: universityEmailLog.email })
      .from(universityEmailLog)
      .where(
        and(
          eq(universityEmailLog.kind, logMarker),
          gte(universityEmailLog.sentAt, sql`now() - interval '30 days'`),
          sql`LOWER(${universityEmailLog.email}) = ANY(ARRAY[${sql.join(emails.map((e) => sql`${e}`), sql`, `)}]::text[])`,
        ),
      );
    for (const r of recent) alreadySent.add(r.email.toLowerCase());
  }

  let sent = 0;
  for (const s of due) {
    if (!s.email) continue;
    const email = s.email;
    if (alreadySent.has(email.toLowerCase())) continue; // already sent this touch

    try {
      const messageId = await sendCreditscoreEmail({
        kind: "university_past_due",
        to: email,
        data: {
          manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
          touch,
        },
      });
      // Log the per-touch marker (with the real messageId for open/click joins)
      // so this touch dedups on re-run and the analytics rollup sees the send.
      await logUniversityEmail(db, email, logMarker, messageId ?? null);
      sent += 1;
    } catch (err) {
      logger.error(
        { err, email, kind: "university_past_due", touch },
        `university:dunning-d${dayMark} — past_due send failed (non-fatal)`,
      );
    }

    if (final) {
      // Last warning before Stripe auto-cancels. Transactional storefront-side
      // (NOT suppressed) — a lapsing paying member must receive it.
      try {
        const finalMessageId = await sendCreditscoreEmail({
          kind: "university_payment_failed_final",
          to: email,
          data: {
            manageBillingUrl: UNIVERSITY_MANAGE_BILLING_URL,
          },
        });
        await logUniversityEmail(
          db,
          email,
          "university_payment_failed_final",
          finalMessageId ?? null,
        );
      } catch (err) {
        logger.error(
          { err, email, kind: "university_payment_failed_final" },
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
  return runUniversityDunning(db, {
    dayMark: 3,
    touch: 2,
    final: false,
    logMarker: "university_past_due_d3",
  });
}

/** Day-7 past_due nudge (touch=3) + final pre-cancellation warning. */
export async function runUniversityDunningD7(db: Db): Promise<number> {
  return runUniversityDunning(db, {
    dayMark: 7,
    touch: 3,
    final: true,
    logMarker: "university_past_due_d7",
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

  // Re-engagement check-in — active members whose last activity was EXACTLY
  // 7 / 14 / 30 UTC-days ago. Daily sweep; the day-bucket match is the primary
  // once-per-tier idempotency (backed by the email log for belt-and-suspenders
  // dedup). Slotted at :45 after the other daily lifecycle jobs (:00/:15/:30).
  registerCronJob({
    jobName: "university:reengage",
    schedule: "45 14 * * *", // daily 14:45 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityReengage(db),
  });

  // Dunning — day-3 (touch=2) and day-7 (touch=3 + final warning) past_due
  // nudges. Daily sweep; selection is an updated_at THRESHOLD (>= dayMark days
  // past_due) and idempotency is per-touch email-log dedup (NOT a 1-day window
  // — smart-retry re-stamps updated_at). Slotted after the 14:xx lifecycle jobs
  // (reengage is :45) to avoid collisions.
  registerCronJob({
    jobName: "university:dunning-d3",
    schedule: "0 15 * * *", // daily 15:00 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityDunningD3(db),
  });

  registerCronJob({
    jobName: "university:dunning-d7",
    schedule: "15 15 * * *", // daily 15:15 UTC
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversityDunningD7(db),
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

  // "We are live now" + recap run EVERY MINUTE — both use a 1-minute window
  // aligned to start time (T-0) / end time, which must be swept per-minute for
  // exactly-once delivery. The scheduler supports per-minute cron (cron.ts) and
  // ticks every 30s, so `* * * * *` is the finest cadence available and is the
  // right one here. The 1-minute window IS the idempotency (same design as the
  // hourly reminders, just a tighter slice).
  registerCronJob({
    jobName: "university:session-starting-now",
    schedule: "* * * * *", // every minute
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversitySessionStartingNow(db),
  });

  registerCronJob({
    jobName: "university:session-recap",
    schedule: "* * * * *", // every minute
    ownerAgent: "mark",
    sourceFile: "university-crons.ts",
    handler: () => runUniversitySessionRecap(db),
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
