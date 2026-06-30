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
  universityMembers,
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
// The stored RSVP statuses. `waitlist` (migration 0139) parks a member behind a
// full finite-capacity session; the oldest waitlister is promoted to `going`
// when a seat frees on cancel.
export type RsvpStatus = "going" | "waitlist" | "canceled";

// The member-facing view of their own RSVP state. "none" = no row at all (never
// RSVP'd or the row was never created); distinct from "canceled" (had a seat,
// dropped it). The UI uses this to choose between RSVP / Cancel / "On waitlist".
export type MyRsvpStatus = "going" | "waitlist" | "canceled" | "none";

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
  // Count of confirmed `going` seats. spotsLeft (below) is derived from THIS,
  // never from waitlist rows — a waitlisted member does not occupy a seat.
  goingCount: number;
  // Number of people parked on the waitlist (status='waitlist', non-canceled).
  // 0 when the session is unlimited or under capacity.
  waitlistCount: number;
  // The member's own RSVP state for this session. "none" when they have no row.
  myRsvpStatus: MyRsvpStatus;
  // 1-based position in the waitlist queue, present ONLY when
  // myRsvpStatus === "waitlist" (else null). Computed as the count of earlier
  // (older created_at) non-canceled waitlist rows + 1.
  myWaitlistPosition: number | null;
  // Confirmed seats remaining: max(capacity - goingCount, 0); null when the
  // session is unlimited. Waitlist rows never reduce this.
  spotsLeft: number | null;
  // DEPRECATED alias of myRsvpStatus, kept so the existing member list UI and
  // route keep compiling. "going" | "waitlist" | "canceled" | null ("none").
  myRsvp: RsvpStatus | null;
  isLive: boolean;
  joinUrl?: string;
  // Manual recording link (v1). Unlike joinUrl this is NOT gated — it points at
  // a Zoom-cloud / unlisted-YouTube share URL and is what lights up the
  // member-facing "Watch recording" link on past sessions. null until pasted.
  recordingUrl: string | null;
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
  recordingUrl?: string | null;
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
  recordingUrl?: string | null;
}

interface MemberIdentity {
  email: string;
  accountId: string;
}

// One roster row for the admin attendee list. `name` is the member's
// displayName (joined from university_members by the durable email key) when
// available — there is no name column on the RSVP or customer_accounts row.
// `status` is included so the UI can distinguish going vs canceled.
export interface RsvpRosterEntry {
  email: string;
  name: string | null;
  accountId: string | null;
  status: RsvpStatus;
  createdAt: string;
}

export type RsvpResult =
  | {
      ok: true;
      // Discriminates a confirmed seat from a waitlisted RSVP. "going" when a
      // seat was claimed (capacity available or unlimited); "waitlist" when the
      // session was full and the member was parked behind it.
      rsvpStatus: "going" | "waitlist";
      session: SessionView;
      // The member's durable (lowercased) email — the route uses it as the
      // rsvp-confirm recipient without re-resolving identity.
      memberEmail: string;
      // True when this RSVP TRANSITIONED into `going` (a brand-new RSVP OR a
      // re-activation of a prior `canceled` row). False on a no-op repeat where
      // the member was already `going`, AND false whenever rsvpStatus is
      // "waitlist". The route fires the rsvp-confirm email only when this is
      // true, so a double-tap (or a waitlist park) doesn't re-send.
      newlyGoing: boolean;
      // 1-based queue position, present ONLY when rsvpStatus === "waitlist"
      // (else null). The route can surface "You're #N on the waitlist".
      waitlistPosition: number | null;
    }
  // `full` is retained in the type for callers/tests that assert the old
  // contract, but rsvp() no longer returns it — a full finite-capacity session
  // now yields ok:true with rsvpStatus:"waitlist" instead of an error.
  | { ok: false; code: "not_found" | "canceled" | "ended" | "full" };

// The member promoted off the waitlist when a `going` seat freed on cancel.
// Carries everything the route's "you're in" email needs WITHOUT re-querying
// the session — email is the recipient, the rest is the email body.
export interface PromotedMember {
  email: string;
  sessionId: string;
  sessionTitle: string;
  hostName: string;
  startsAt: string; // ISO
  durationMinutes: number;
  description: string | null;
}

export type CancelRsvpResult =
  // ok:false ONLY when the session doesn't exist (→ 404). Everything else (no
  // row / already canceled / nothing to promote) is ok:true with promoted:null.
  | { ok: false }
  | {
      ok: true;
      // The member auto-promoted off the waitlist into the freed `going` seat,
      // or null when there was no waitlist / no seat was freed. The route fires
      // the waitlist-promoted notification only when this is non-null.
      promoted: PromotedMember | null;
    };

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

  // The member's RSVP status for a session (going | waitlist | canceled | null).
  async function myRsvpStatus(
    identity: MemberIdentity,
    sessionId: string,
  ): Promise<RsvpStatus | null> {
    const rows = await db
      .select({
        status: universitySessionRsvps.status,
        createdAt: universitySessionRsvps.createdAt,
      })
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
    return s === "going" || s === "waitlist" || s === "canceled" ? s : null;
  }

  // Count of `waitlist` RSVPs for a session (non-canceled).
  async function waitlistCount(sessionId: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          eq(universitySessionRsvps.status, "waitlist"),
        ),
      );
    return rows[0]?.n ?? 0;
  }

  // 1-based waitlist position for a member: count of EARLIER (older created_at)
  // non-canceled waitlist rows for the session + 1. Returns null when the member
  // is not currently waitlisted. The created_at ordering is the queue order the
  // promote-on-cancel logic also uses, so the displayed position matches who
  // actually gets promoted next.
  async function myWaitlistPosition(
    identity: MemberIdentity,
    sessionId: string,
  ): Promise<number | null> {
    const mine = await db
      .select({ createdAt: universitySessionRsvps.createdAt })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          eq(universitySessionRsvps.status, "waitlist"),
          or(
            sql`LOWER(${universitySessionRsvps.email}) = ${identity.email}`,
            eq(universitySessionRsvps.accountId, identity.accountId),
          ),
        ),
      )
      .limit(1);
    const myCreatedAt = mine[0]?.createdAt;
    if (!myCreatedAt) return null;
    const earlier = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(universitySessionRsvps)
      .where(
        and(
          eq(universitySessionRsvps.sessionId, sessionId),
          eq(universitySessionRsvps.status, "waitlist"),
          sql`${universitySessionRsvps.createdAt} < ${myCreatedAt.toISOString()}::timestamptz`,
        ),
      );
    return (earlier[0]?.n ?? 0) + 1;
  }

  // Serialize a session row into the member-facing view. join_url is gated:
  // only included when the session is live AND the member RSVP'd `going`.
  function toView(
    row: typeof universitySessions.$inferSelect,
    opts: {
      goingCount: number;
      waitlistCount: number;
      myRsvp: RsvpStatus | null;
      myWaitlistPosition: number | null;
      now: Date;
    },
  ): SessionView {
    const isLive = isSessionLive(row, opts.now);
    const capacity = row.capacity ?? null;
    // spotsLeft is derived from confirmed `going` seats ONLY — waitlist rows do
    // not occupy a seat. null = unlimited.
    const spotsLeft =
      capacity === null ? null : Math.max(capacity - opts.goingCount, 0);
    const myRsvpStatus: MyRsvpStatus = opts.myRsvp ?? "none";
    const view: SessionView = {
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      hostName: row.hostName,
      startsAt: row.startsAt.toISOString(),
      durationMinutes: row.durationMinutes,
      status: row.status,
      capacity,
      goingCount: opts.goingCount,
      waitlistCount: opts.waitlistCount,
      myRsvpStatus,
      myWaitlistPosition:
        myRsvpStatus === "waitlist" ? opts.myWaitlistPosition : null,
      spotsLeft,
      myRsvp: opts.myRsvp,
      isLive,
      // Not gated — fine to expose to any member (it's the past-session replay
      // link). null until the admin pastes it.
      recordingUrl: row.recordingUrl ?? null,
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
      const [count, waiting, mine, myPos] = await Promise.all([
        goingCount(row.id),
        waitlistCount(row.id),
        myRsvpStatus(identity, row.id),
        myWaitlistPosition(identity, row.id),
      ]);
      views.push(
        toView(row, {
          goingCount: count,
          waitlistCount: waiting,
          myRsvp: mine,
          myWaitlistPosition: myPos,
          now,
        }),
      );
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
    const [count, waiting, mine, myPos] = await Promise.all([
      goingCount(sessionId),
      waitlistCount(sessionId),
      myRsvpStatus(identity, sessionId),
      myWaitlistPosition(identity, sessionId),
    ]);
    return toView(row, {
      goingCount: count,
      waitlistCount: waiting,
      myRsvp: mine,
      myWaitlistPosition: myPos,
      now,
    });
  }

  // -------------------------------------------------------------------------
  // Member mutations
  // -------------------------------------------------------------------------

  /**
   * RSVP for this member+session (idempotent upsert on UNIQUE(session_id,
   * email)). The target status is decided by capacity:
   *   - already `going`          → no-op (stays going).
   *   - unlimited OR under cap   → `going` (claims/re-claims a seat).
   *   - finite cap & at capacity → `waitlist` (parked behind the full session)
   *                                instead of the old { code: "full" } error.
   * Re-RSVPing a still-full session while already `waitlist` is a no-op (no
   * duplicate). Returns a discriminated result: rsvpStatus "going" | "waitlist"
   * (+ waitlistPosition when waitlisted). Rejects canceled / ended sessions.
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
    // Decide the target status. A member already `going` keeps their seat
    // regardless of count. Otherwise a finite-capacity session that is already
    // at/over capacity in `going` seats sends the member to the waitlist; an
    // unlimited or under-capacity session confirms a `going` seat.
    let target: "going" | "waitlist" = "going";
    if (row.capacity !== null && existing !== "going") {
      const count = await goingCount(sessionId);
      if (count >= row.capacity) target = "waitlist";
    }

    await db
      .insert(universitySessionRsvps)
      .values({
        sessionId,
        accountId: identity.accountId,
        email: identity.email,
        status: target,
      })
      .onConflictDoUpdate({
        target: [
          universitySessionRsvps.sessionId,
          universitySessionRsvps.email,
        ],
        set: {
          // Backfill the account link if it resolved after the first RSVP.
          accountId: identity.accountId,
          // Re-RSVPing flips a prior `canceled` back to the target status
          // (going, or waitlist if still full). A member already on the
          // waitlist re-RSVPing a still-full session resolves to waitlist
          // again — the same row, NOT a duplicate (UNIQUE(session_id, email)),
          // and created_at is preserved so their queue position is unchanged.
          status: target,
          updatedAt: now,
        },
      });

    const session = await getSessionView(accountId, sessionId, now);
    // session is non-null here (row exists), but guard for the type.
    if (!session) return { ok: false, code: "not_found" };
    // `existing` was the member's status BEFORE this upsert. A transition into
    // `going` is anything that wasn't already `going` AND landed on a real seat
    // (target === "going") — the route gates the rsvp-confirm send on this, so a
    // waitlist park never fires the going-confirmation email.
    return {
      ok: true,
      rsvpStatus: target,
      session,
      memberEmail: identity.email,
      newlyGoing: target === "going" && existing !== "going",
      waitlistPosition:
        target === "waitlist"
          ? await myWaitlistPosition(identity, sessionId)
          : null,
    };
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
  ): Promise<CancelRsvpResult> {
    const identity = await resolveMemberIdentity(accountId);
    if (!identity) return { ok: false };
    const row = await getSessionRow(sessionId);
    if (!row) return { ok: false };

    // Was this member holding a `going` seat? Only a freed seat can trigger a
    // promotion — canceling a waitlist row (or a no-op on no row) frees nothing.
    const priorStatus = await myRsvpStatus(identity, sessionId);

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

    // Promote the oldest waitlister into the freed seat — ONLY when an actual
    // `going` seat was given up, the session is scheduled with a finite
    // capacity, and there's now room (cancel could have dropped going below
    // capacity). The promotion is a SINGLE atomic UPDATE whose target row is
    // chosen by a correlated subselect (oldest non-canceled waitlist row,
    // FOR UPDATE SKIP LOCKED) so two near-simultaneous cancels can never promote
    // the same waitlist row twice — the second cancel's subselect skips the
    // row the first already locked/updated and picks the next one (or none).
    if (
      priorStatus !== "going" ||
      row.status !== "scheduled" ||
      row.capacity === null
    ) {
      return { ok: true, promoted: null };
    }

    const goingNow = await goingCount(sessionId);
    if (goingNow >= row.capacity) {
      // Cancel didn't actually open a seat (still at/over cap somehow).
      return { ok: true, promoted: null };
    }

    const promotedRows = (await db.execute(sql`
      UPDATE university_session_rsvps
         SET status = 'going', updated_at = ${now.toISOString()}::timestamptz
       WHERE id = (
         SELECT id FROM university_session_rsvps
          WHERE session_id = ${sessionId}
            AND status = 'waitlist'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
       )
      RETURNING email
    `)) as unknown as Array<{ email: string }>;

    const promotedEmail = promotedRows[0]?.email ?? null;
    if (!promotedEmail) return { ok: true, promoted: null };

    return {
      ok: true,
      promoted: {
        email: promotedEmail,
        sessionId: row.id,
        sessionTitle: row.title,
        hostName: row.hostName,
        startsAt: row.startsAt.toISOString(),
        durationMinutes: row.durationMinutes,
        description: row.description ?? null,
      },
    };
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
  // Admin reads
  // -------------------------------------------------------------------------

  /**
   * Fetch the full session row for an admin (the un-gated shape — includes
   * join_url unconditionally, same as create/patch/cancel responses). The route
   * runs it through serializeAdminSession. Returns null when not found. The
   * member list view gates join_url, so the admin edit form can't read the room
   * link from it — this is the read path it uses instead.
   */
  async function getAdminSessionById(
    sessionId: string,
  ): Promise<typeof universitySessions.$inferSelect | null> {
    return getSessionRow(sessionId);
  }

  /**
   * The full RSVP roster for a session (admin attendee list). Returns ALL rows
   * (going + canceled) so the UI can show who's coming vs who dropped, ordered
   * by sign-up time (ascending). `name` is the member's displayName, resolved
   * via a LEFT JOIN on the durable email key (lowercased) — null when the
   * member has no displayName or isn't a University member row.
   */
  async function listSessionRsvps(
    sessionId: string,
  ): Promise<RsvpRosterEntry[]> {
    const rows = await db
      .select({
        email: universitySessionRsvps.email,
        accountId: universitySessionRsvps.accountId,
        status: universitySessionRsvps.status,
        createdAt: universitySessionRsvps.createdAt,
        displayName: universityMembers.displayName,
      })
      .from(universitySessionRsvps)
      .leftJoin(
        universityMembers,
        sql`LOWER(${universityMembers.email}) = LOWER(${universitySessionRsvps.email})`,
      )
      .where(eq(universitySessionRsvps.sessionId, sessionId))
      .orderBy(asc(universitySessionRsvps.createdAt));

    return rows.map((r) => ({
      email: r.email,
      name: r.displayName ?? null,
      accountId: r.accountId ?? null,
      // Surface all three stored states so the admin sees the waitlist (in
      // created_at order, set by the orderBy above) distinct from going/canceled.
      status:
        r.status === "canceled"
          ? "canceled"
          : r.status === "waitlist"
            ? "waitlist"
            : "going",
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------
  // Admin mutations
  // -------------------------------------------------------------------------

  /**
   * All ACTIVE University members (email + displayName), for broadcast fan-out
   * (e.g. the new-session announcement). Mirrors the active-member selection in
   * university-crons.ts (onboarding): status='active'. Emails are returned as
   * stored; callers lowercase as needed for de-dup / messageId keys.
   */
  async function listActiveMemberEmails(): Promise<
    Array<{ email: string; displayName: string | null }>
  > {
    return db
      .select({
        email: universityMembers.email,
        displayName: universityMembers.displayName,
      })
      .from(universityMembers)
      .where(eq(universityMembers.status, "active"));
  }

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
        recordingUrl: input.recordingUrl ?? null,
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
    // recordingUrl: undefined = leave as-is; null = clear; string = set.
    if (input.recordingUrl !== undefined) set.recordingUrl = input.recordingUrl;

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
    getAdminSessionById,
    listSessionRsvps,
    listActiveMemberEmails,
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
