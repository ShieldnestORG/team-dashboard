// ---------------------------------------------------------------------------
// Coherent Ones University — LIVE SESSIONS service (scheduling + RSVP).
//
// The "Practice together" leg of the Coherent Loop. Holds all DB logic for the
// /api/portal/university/sessions/* routes (routes stay validation + shape
// only), mirroring how recordRep/getNotes/upsertNote are service methods on the
// customer-portal svc. Operates on `db` directly, like university-crons.ts.
//
// Member identity follows the rest of University EXACTLY: the durable join key
// is the lowercased `email` (resolved from the account), with `account_id`
// carried for convenience once the customer-account-linker resolves it. RSVP
// rows are keyed UNIQUE(session_id, email); re-RSVPing upserts in place.
//
// Lifecycle (upcoming → live → ended) is COMPUTED from the clock against
// `starts_at`, never stored. The external video room (`join_url`) is returned
// ONLY when the session is live AND the caller RSVP'd `going` — never leaked
// before the join window or to non-RSVPs.
// ---------------------------------------------------------------------------

import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  customerAccounts,
  universitySessions,
  universitySessionRsvps,
} from "@paperclipai/db";

// Join opens this many minutes BEFORE starts_at so nobody is locked out at T-0.
export const JOIN_OPENS_BEFORE_MINUTES = 10;
// Grace AFTER the nominal end (starts_at + duration) the room stays "live".
export const JOIN_GRACE_AFTER_MINUTES = 15;
// Past-sessions list cap.
const PAST_LIMIT = 50;

const MINUTE_MS = 60_000;

export type SessionScope = "upcoming" | "past";
export type RsvpStatus = "going" | "canceled";

// The serialized shape returned to the portal. Timestamps are ISO strings.
// `joinUrl` is present ONLY when isLive && myRsvp === "going".
export interface SessionView {
  id: string;
  title: string;
  description: string | null;
  hostName: string;
  startsAt: string;
  durationMinutes: number;
  status: string; // scheduled | canceled
  capacity: number | null;
  goingCount: number;
  myRsvp: RsvpStatus | null;
  isLive: boolean;
  joinUrl?: string;
}

export interface CreateSessionInput {
  title: string;
  description?: string | null;
  hostName: string;
  hostEmail?: string | null;
  startsAt: Date;
  durationMinutes?: number;
  joinUrl: string;
  capacity?: number | null;
  createdByAccount?: string | null;
}

export interface PatchSessionInput {
  title?: string;
  description?: string | null;
  hostName?: string;
  hostEmail?: string | null;
  startsAt?: Date;
  durationMinutes?: number;
  joinUrl?: string;
  capacity?: number | null;
}

interface MemberIdentity {
  email: string;
  accountId: string;
}

export type RsvpResult =
  | { ok: true; session: SessionView }
  | { ok: false; code: "not_found" | "canceled" | "ended" | "full" };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True when `now` falls inside the join window:
 *   [starts_at − JOIN_OPENS_BEFORE, starts_at + duration + JOIN_GRACE).
 * Canceled sessions are never live.
 */
export function isSessionLive(
  session: { startsAt: Date; durationMinutes: number; status: string },
  now: Date,
): boolean {
  if (session.status !== "scheduled") return false;
  const start = session.startsAt.getTime();
  const openFrom = start - JOIN_OPENS_BEFORE_MINUTES * MINUTE_MS;
  const liveUntil =
    start + session.durationMinutes * MINUTE_MS + JOIN_GRACE_AFTER_MINUTES * MINUTE_MS;
  const t = now.getTime();
  return t >= openFrom && t < liveUntil;
}

export function universitySessionsService(db: Db) {
  // Resolve the member's durable identity (lowercased email + accountId) from
  // the portal accountId — same pattern as customer-portal's
  // resolveProgressIdentity. The email keys RSVPs; account_id is carried.
  async function resolveMemberIdentity(
    accountId: string,
  ): Promise<MemberIdentity | null> {
    const rows = await db
      .select({ id: customerAccounts.id, email: customerAccounts.email })
      .from(customerAccounts)
      .where(eq(customerAccounts.id, accountId))
      .limit(1);
    const account = rows[0];
    if (!account) return null;
    return { email: normalizeEmail(account.email), accountId: account.id };
  }

  async function getSessionRow(sessionId: string) {
    const rows = await db
      .select()
      .from(universitySessions)
      .where(eq(universitySessions.id, sessionId))
      .limit(1);
    return rows[0] ?? null;
  }

  // Count of `going` RSVPs for a session.
  async function goingCount(sessionId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          eq(universitySessionRsvps.status, "going"),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  // The member's RSVP status for a session (going | canceled | null).
  async function myRsvpStatus(
    identity: MemberIdentity,
    sessionId: string,
  ): Promise<RsvpStatus | null> {
    const rows = await db
      .select({ status: universitySessionRsvps.status })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          or(
            sql`LOWER(${universitySessionRsvps.email}) = ${identity.email}`,
            eq(universitySessionRsvps.accountId, identity.accountId),
          ),
        ),
      )
      .limit(1);
    const s = rows[0]?.status;
    return s === "going" || s === "canceled" ? s : null;
  }

  // Serialize a session row into the member-facing view. join_url is gated:
  // only included when the session is live AND the member RSVP'd `going`.
  function toView(
    row: typeof universitySessions.$inferSelect,
    opts: { goingCount: number; myRsvp: RsvpStatus | null; now: Date },
  ): SessionView {
    const isLive = isSessionLive(row, opts.now);
    const view: SessionView = {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      hostName: row.hostName,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes,
      status: row.status,
      capacity: row.capacity ?? null,
      goingCount: opts.goingCount,
      myRsvp: opts.myRsvp,
      isLive,
    };
    if (isLive && opts.myRsvp === "going") {
      view.joinUrl = row.joinUrl;
    }
    return view;
  }

  // -------------------------------------------------------------------------
  // Member reads
  // -------------------------------------------------------------------------

  /**
   * List sessions for the member.
   *  - upcoming: not yet ENDED (still future OR currently live), ascending
   *    (soonest first). The boundary is the end of the live window
   *    (starts_at + duration + grace), NOT starts_at — so a session that is
   *    live right now stays in `upcoming` where the "Join now" button lives,
   *    instead of dropping into `past` the moment it begins. All scheduled +
   *    canceled rows are returned so the UI can show a "Canceled" state.
   *  - past: already ended, descending (most recent first), capped.
   * Each item carries goingCount + the member's own RSVP, with join_url gated.
   */
  async function listSessions(
    accountId: string,
    scope: SessionScope,
    now: Date = new Date(),
  ): Promise<SessionView[]> {
    const identity = await resolveMemberIdentity(accountId);
    if (!identity) return [];

    // The instant a session is considered "ended": starts_at + duration + the
    // post-end grace the live window uses. Computed per-row from duration. The
    // comparison clock is bound as an explicit timestamptz (ISO string) — a raw
    // JS Date in a sql`` fragment isn't auto-serialized by the driver.
    const nowTs = sql`${now.toISOString()}::timestamptz`;
    const endedAt = sql`${universitySessions.startsAt} + make_interval(mins => ${universitySessions.durationMinutes} + ${JOIN_GRACE_AFTER_MINUTES})`;

    const rows =
      scope === "upcoming"
        ? await db
            .select()
            .from(universitySessions)
            .where(sql`${endedAt} > ${nowTs}`)
            .orderBy(asc(universitySessions.startsAt))
        : await db
            .select()
            .from(universitySessions)
            .where(sql`${endedAt} <= ${nowTs}`)
            .orderBy(desc(universitySessions.startsAt))
            .limit(PAST_LIMIT);

    const views: SessionView[] = [];
    for (const row of rows) {
      const [count, mine] = await Promise.all([
        goingCount(row.id),
        myRsvpStatus(identity, row.id),
      ]);
      views.push(toView(row, { goingCount: count, myRsvp: mine, now }));
    }
    return views;
  }

  /**
   * The single-session view for a member (used after an RSVP mutation), same
   * shape as a list item. Returns null when the session does not exist.
   */
  async function getSessionView(
    accountId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<SessionView | null> {
    const identity = await resolveMemberIdentity(accountId);
    if (!identity) return null;
    const row = await getSessionRow(sessionId);
    if (!row) return null;
    const [count, mine] = await Promise.all([
      goingCount(sessionId),
      myRsvpStatus(identity, sessionId),
    ]);
    return toView(row, { goingCount: count, myRsvp: mine, now });
  }

  // -------------------------------------------------------------------------
  // Member mutations
  // -------------------------------------------------------------------------

  /**
   * RSVP `going` for this member+session (idempotent upsert on
   * UNIQUE(session_id, email)). Re-RSVPing flips a prior `canceled` back to
   * `going`. Capacity is enforced here: if the session is full and the member
   * does not already hold a `going` row, returns { code: "full" } (→ 409).
   * Rejects canceled / already-ended sessions (→ 400).
   */
  async function rsvp(
    accountId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<RsvpResult> {
    const identity = await resolveMemberIdentity(accountId);
    if (!identity) return { ok: false, code: "not_found" };
    const row = await getSessionRow(sessionId);
    if (!row) return { ok: false, code: "not_found" };
    if (row.status !== "scheduled") return { ok: false, code: "canceled" };

    // An ended session can't be RSVP'd (past the live window's end).
    const endedAt =
      row.startsAt.getTime() +
      row.durationMinutes * MINUTE_MS +
      JOIN_GRACE_AFTER_MINUTES * MINUTE_MS;
    if (now.getTime() >= endedAt) return { ok: false, code: "ended" };

    const existing = await myRsvpStatus(identity, sessionId);
    // Capacity check: only blocks NEW going seats. A member already `going`
    // re-RSVPing is a no-op; a `canceled` member re-claims a seat only if there
    // is room.
    if (
      row.capacity !== null &&
      existing !== "going"
    ) {
      const count = await goingCount(sessionId);
      if (count >= row.capacity) return { ok: false, code: "full" };
    }

    await db
      .insert(universitySessionRsvps)
      .values({
        sessionId,
        accountId: identity.accountId,
        email: identity.email,
        status: "going",
      })
      .onConflictDoUpdate({
        target: [
          universitySessionRsvps.sessionId,
          universitySessionRsvps.email,
        ],
        set: {
          // Backfill the account link if it resolved after the first RSVP, and
          // flip a prior `canceled` back to `going`.
          accountId: identity.accountId,
          status: "going",
          updatedAt: now,
        },
      });

    const session = await getSessionView(accountId, sessionId, now);
    // session is non-null here (row exists), but guard for the type.
    if (!session) return { ok: false, code: "not_found" };
    return { ok: true, session };
  }

  /**
   * Cancel the member's RSVP (soft — status='canceled'). Idempotent: no row /
   * already canceled still resolves ok. Returns false only when the session
   * doesn't exist (→ 404); the route maps everything else to 200.
   */
  async function cancelRsvp(
    accountId: string,
    sessionId: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    const identity = await resolveMemberIdentity(accountId);
    if (!identity) return false;
    const row = await getSessionRow(sessionId);
    if (!row) return false;

    await db
      .update(universitySessionRsvps)
      .set({ status: "canceled", updatedAt: now })
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          or(
            sql`LOWER(${universitySessionRsvps.email}) = ${identity.email}`,
            eq(universitySessionRsvps.accountId, identity.accountId),
          ),
        ),
      );
    return true;
  }

  // -------------------------------------------------------------------------
  // ICS (RFC-5545) — built server-side. Contains the join link, so the route
  // gates it to members (and only the join_url itself, never a leak path,
  // because the .ics is a member-authenticated download).
  // -------------------------------------------------------------------------

  /**
   * Build a single-VEVENT .ics for a session. UTC DTSTART/DTEND (…Z) so
   * calendar clients localize. Returns null when the session doesn't exist.
   */
  async function buildIcs(
    sessionId: string,
    now: Date = new Date(),
  ): Promise<string | null> {
    const row = await getSessionRow(sessionId);
    if (!row) return null;
    return renderIcs(row, now);
  }

  // -------------------------------------------------------------------------
  // Admin mutations
  // -------------------------------------------------------------------------

  /** Insert a single `scheduled` session row. Returns the created row. */
  async function createSession(
    input: CreateSessionInput,
  ): Promise<typeof universitySessions.$inferSelect> {
    const [row] = await db
      .insert(universitySessions)
      .values({
        title: input.title,
        description: input.description ?? null,
        hostName: input.hostName,
        hostEmail: input.hostEmail ?? null,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes ?? 60,
        joinUrl: input.joinUrl,
        capacity: input.capacity ?? null,
        createdByAccount: input.createdByAccount ?? null,
      })
      .returning();
    return row;
  }

  /**
   * Partial edit of an existing session. Returns the updated row, or null when
   * the session doesn't exist. Only the provided fields are touched.
   */
  async function patchSession(
    sessionId: string,
    input: PatchSessionInput,
  ): Promise<typeof universitySessions.$inferSelect | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.title !== undefined) set.title = input.title;
    if (input.description !== undefined) set.description = input.description;
    if (input.hostName !== undefined) set.hostName = input.hostName;
    if (input.hostEmail !== undefined) set.hostEmail = input.hostEmail;
    if (input.startsAt !== undefined) set.startsAt = input.startsAt;
    if (input.durationMinutes !== undefined)
      set.durationMinutes = input.durationMinutes;
    if (input.joinUrl !== undefined) set.joinUrl = input.joinUrl;
    if (input.capacity !== undefined) set.capacity = input.capacity;

    const [row] = await db
      .update(universitySessions)
      .set(set)
      .where(eq(universitySessions.id, sessionId))
      .returning();
    return row ?? null;
  }

  /**
   * Soft-cancel a session (status='canceled'). RSVPs are left intact for audit.
   * Returns the going RSVP emails (so the route can fire the canceled notice)
   * + the row, or null when the session doesn't exist.
   */
  async function cancelSession(sessionId: string): Promise<{
    row: typeof universitySessions.$inferSelect;
    goingEmails: string[];
  } | null> {
    const [row] = await db
      .update(universitySessions)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(universitySessions.id, sessionId))
      .returning();
    if (!row) return null;

    const rsvps = await db
      .select({ email: universitySessionRsvps.email })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          eq(universitySessionRsvps.status, "going"),
        ),
      );
    return { row, goingEmails: rsvps.map((r) => r.email) };
  }

  return {
    listSessions,
    getSessionView,
    rsvp,
    cancelRsvp,
    buildIcs,
    createSession,
    patchSession,
    cancelSession,
  };
}

export type UniversitySessionsService = ReturnType<
  typeof universitySessionsService
>;

// ---------------------------------------------------------------------------
// ICS rendering (pure, exported for testing).
// ---------------------------------------------------------------------------

// Format a Date as an RFC-5545 UTC timestamp: YYYYMMDDTHHMMSSZ.
function icsUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString().padStart(4, "0") +
    (d.getUTCMonth() + 1).toString().padStart(2, "0") +
    d.getUTCDate().toString().padStart(2, "0") +
    "T" +
    d.getUTCHours().toString().padStart(2, "0") +
    d.getUTCMinutes().toString().padStart(2, "0") +
    d.getUTCSeconds().toString().padStart(2, "0") +
    "Z"
  );
}

// Escape a value for an ICS TEXT field (RFC-5545 §3.3.11).
function icsEscape(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * Render a single-VEVENT .ics for a session. DTSTART/DTEND are UTC (…Z) from
 * starts_at + duration_minutes; a VALARM fires 60 min before as the member's
 * own calendar reminder (independent of our email reminders). UID is stable
 * (session-<id>@coherencedaddy.com) so re-downloading updates the same entry.
 */
export function renderIcs(
  session: {
    id: string;
    title: string;
    description: string | null;
    startsAt: Date;
    durationMinutes: number;
    joinUrl: string;
  },
  now: Date = new Date(),
): string {
  const dtStart = icsUtc(session.startsAt);
  const dtEnd = icsUtc(
    new Date(session.startsAt.getTime() + session.durationMinutes * MINUTE_MS),
  );
  const descriptionParts: string[] = [];
  if (session.description) descriptionParts.push(session.description);
  descriptionParts.push(`Join: ${session.joinUrl}`);
  const description = descriptionParts.join("\\n\\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Coherence Daddy//University Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:session-${session.id}@coherencedaddy.com`,
    `DTSTAMP:${icsUtc(now)}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${icsEscape(session.title)}`,
    `DESCRIPTION:${icsEscape(description)}`,
    `URL:${icsEscape(session.joinUrl)}`,
    "LOCATION:Online",
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "DESCRIPTION:Reminder",
    "TRIGGER:-PT60M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  // RFC-5545 mandates CRLF line endings.
  return lines.join("\r\n") + "\r\n";
}
