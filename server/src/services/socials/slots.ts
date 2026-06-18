/**
 * Next-open-slot auto-scheduler for the socials queue.
 *
 * Ported from the verified Python prototype
 * (marketing/prototypes/scheduler/scheduler.py + test_scheduler.py). It fits a
 * new post into the next open posting slot for an account, with a "post sooner /
 * bump" override path.
 *
 * This is PURE date math over an in-memory list of already-scheduled instants
 * the CALLER supplies (per account). It posts nothing and calls no external API.
 *
 * TZ correctness (the bug this port preserves the fix for): the live IG_Auditor
 * scripts hardcode the literal offset "-07:00" (schedule_girls.py:13), which is
 * only correct while Los Angeles is on PDT. Across PST months / the DST
 * boundaries every emitted timestamp would be off by one hour. We instead resolve
 * the correct offset PER DATE using a real IANA zone, conforming to this repo's
 * established tz convention — native `Intl.DateTimeFormat` with `timeZone` +
 * `formatToParts` (see services/routines.ts getZonedMinuteParts).
 *
 * Boundary model: instants are native `Date` (UTC), matching
 * social_posts.scheduled_at (timestamp withTimezone — a UTC instant). Grid /
 * occupancy math is done in the account's local wall-clock time, then converted
 * back to a UTC `Date` for storage / comparison.
 *
 * Occupancy source (documented integration point — NOT wired here): the caller
 * supplies this account's already-scheduled instants. The verified canonical
 * query is, per social_account_id:
 *
 *   SELECT scheduled_at
 *     FROM social_posts
 *    WHERE social_account_id = $1
 *      AND status IN ('scheduled', 'publishing', 'posted')
 *      AND scheduled_at >= $after;
 *
 * Pass those Dates as `existingScheduled`. Do NOT rewire the compose/upload UI
 * here — that is the separate integration step.
 *
 * TODO(concurrency): two concurrent allocations can pick the SAME open slot
 * before either is persisted (the prototype flagged this). The durable guard is
 * either a DB unique index on (social_account_id, scheduled_at) or allocating
 * inside the same transaction that inserts the row (SELECT ... FOR UPDATE on the
 * account's queue). This pure function cannot enforce that on its own.
 */

import { createHash } from "node:crypto";

export const DEFAULT_SLOTS = ["09:00", "13:00", "18:00"] as const; // mirrors schedule_girls.py:13
export const DEFAULT_TZ = "America/Los_Angeles"; // replaces the literal "-07:00"

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

export interface SlotOptions {
  slots?: readonly string[];
  tz?: string;
  applyJitter?: boolean;
  maxDays?: number;
}

export interface SoonerResult {
  /** tz-aware UTC instant of the slot actually allocated. */
  scheduledFor: Date;
  /** True if the requested target collided and we moved past it. */
  bumped: boolean;
  /** The target the caller asked for (echoed back as a UTC instant). */
  requested: Date;
}

// --------------------------------------------------------------------------- //
// tz helpers (conform to services/routines.ts: Intl.DateTimeFormat + timeZone)
// --------------------------------------------------------------------------- //

function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone: ${timeZone}`);
  }
}

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

/** Wall-clock parts of a UTC instant, observed in `timeZone`. Mirrors
 * routines.ts getZonedMinuteParts (adds seconds). */
function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  });
  const map = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value]),
  );
  const weekday = WEEKDAY_INDEX[map.weekday ?? ""];
  if (weekday == null) {
    throw new Error(`Unable to resolve weekday for timezone ${timeZone}`);
  }
  // Intl renders midnight as hour "24" in some engines; normalize to 0.
  const hour = Number(map.hour) % 24;
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour,
    minute: Number(map.minute),
    second: Number(map.second),
    weekday,
  };
}

/** The zone's UTC offset, in minutes, for the given instant (DST-correct). */
function zoneOffsetMinutes(date: Date, timeZone: string): number {
  const p = getZonedParts(date, timeZone);
  // Build the UTC timestamp that has those same wall-clock numbers, then diff
  // against the real instant — the gap is the zone's offset at that instant.
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

/** Convert a wall-clock time IN `timeZone` to the correct UTC `Date`,
 * resolving DST per date. Two-pass to settle the offset around boundaries. */
function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let offset = zoneOffsetMinutes(new Date(naiveUtc), timeZone);
  let candidate = new Date(naiveUtc - offset * 60000);
  // Re-resolve once: near a DST transition the first offset guess can be for
  // the wrong side; the second pass converges (standard technique).
  const offset2 = zoneOffsetMinutes(candidate, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    candidate = new Date(naiveUtc - offset * 60000);
  }
  return candidate;
}

// --------------------------------------------------------------------------- //
// grid + occupancy
// --------------------------------------------------------------------------- //

function parseSlots(slots: readonly string[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const s of slots) {
    const [hhRaw, mmRaw] = s.split(":");
    const hh = Number(hhRaw);
    const mm = Number(mmRaw);
    if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh >= 24 || mm < 0 || mm >= 60) {
      throw new Error(`bad slot ${JSON.stringify(s)}`);
    }
    out.push([hh, mm]);
  }
  if (out.length === 0) throw new Error("slots must be non-empty");
  // sort ascending by (hh, mm)
  out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return out;
}

/** Deterministic ±6 min spread, byte-for-byte identical to the live scripts
 * (schedule_girls.py:36-38): (sha256(seed) % 13) - 6. */
export function jitter(seed: string): number {
  const hex = createHash("sha256").update(seed).digest("hex");
  // mod 13 of a big-endian 256-bit int == mod 13 of the value; compute via
  // running remainder over the hex nibbles to avoid BigInt-vs-Python drift.
  let rem = 0;
  for (const ch of hex) {
    rem = (rem * 16 + parseInt(ch, 16)) % 13;
  }
  return rem - 6;
}

/** Occupancy identity of a slot: its wall-clock (Y,M,D,hh,mm) in `tz`. Jitter
 * is intentionally NOT part of this key — a stored 09:04 still occupies 09:00. */
function slotKey(date: Date, tz: string): string {
  const p = getZonedParts(date, tz);
  return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`;
}

/** Snap an instant to its base grid slot if within ±30 min of one (jitter
 * tolerant), else keep its literal wall-clock key so it still blocks an exact
 * re-book. */
function occupancyKey(date: Date, tz: string, slotsParsed: Array<[number, number]>): string {
  const p = getZonedParts(date, tz);
  for (const [hh, mm] of slotsParsed) {
    const anchorUtc = zonedWallTimeToUtc(p.year, p.month, p.day, hh, mm, tz);
    if (Math.abs(date.getTime() - anchorUtc.getTime()) <= 30 * 60 * 1000) {
      return slotKey(anchorUtc, tz);
    }
  }
  return `${p.year}-${p.month}-${p.day}-${p.hour}-${p.minute}`;
}

function buildOccupiedSet(
  existing: Date[],
  tz: string,
  slotsParsed: Array<[number, number]>,
): Set<string> {
  const occ = new Set<string>();
  for (const e of existing) {
    occ.add(occupancyKey(e, tz, slotsParsed));
  }
  return occ;
}

// --------------------------------------------------------------------------- //
// core API
// --------------------------------------------------------------------------- //

/**
 * First grid slot at/after `after` not already taken for `account`.
 *
 * `existingScheduled` is THIS account's already-booked instants (caller isolates
 * per account). Returns a UTC `Date`. Walks the slot grid day-by-day from
 * `after`, skipping occupied base slots and any slot strictly before `after`.
 */
export function nextOpenSlot(
  account: string,
  existingScheduled: Date[],
  after: Date,
  options: SlotOptions = {},
): Date {
  const tz = options.tz ?? DEFAULT_TZ;
  const slots = options.slots ?? DEFAULT_SLOTS;
  const applyJitter = options.applyJitter ?? false;
  const maxDays = options.maxDays ?? 366;

  assertTimeZone(tz);
  const slotsParsed = parseSlots(slots);
  const occ = buildOccupiedSet(existingScheduled, tz, slotsParsed);

  // Start from the local calendar date of `after` in tz.
  const startParts = getZonedParts(after, tz);
  let cursorUtcMidnight = zonedWallTimeToUtc(
    startParts.year, startParts.month, startParts.day, 0, 0, tz,
  );

  for (let d = 0; d < maxDays; d += 1) {
    // Local calendar date for day d: advance by adding 24h then re-reading the
    // local date, so DST-length days still land on the right calendar day.
    const dayParts = getZonedParts(
      new Date(cursorUtcMidnight.getTime() + d * 24 * 60 * 60 * 1000 + 6 * 60 * 60 * 1000),
      tz,
    );
    for (const [hh, mm] of slotsParsed) {
      const cand = zonedWallTimeToUtc(dayParts.year, dayParts.month, dayParts.day, hh, mm, tz);
      if (cand.getTime() < after.getTime()) continue;
      if (occ.has(slotKey(cand, tz))) continue;
      if (applyJitter) {
        const j = jitter(`${account}${slotKey(cand, tz)}`);
        return new Date(cand.getTime() + j * 60 * 1000);
      }
      return cand;
    }
  }
  throw new Error(
    `no open slot for ${JSON.stringify(account)} within ${maxDays} days after ${after.toISOString()}`,
  );
}

/**
 * "Post sooner" / targeted-request path.
 *
 *  - target undefined → earliest available slot at/after `after` (or now()).
 *  - target set        → if that base slot is free, honor it (bumped=false);
 *                        if it collides, return the next free slot AFTER it
 *                        (bumped=true). An off-grid target is honored literally
 *                        when free, else rolls forward on the grid.
 */
export function requestSlot(
  account: string,
  existingScheduled: Date[],
  options: SlotOptions & { target?: Date; after?: Date } = {},
): SoonerResult {
  const tz = options.tz ?? DEFAULT_TZ;
  const slots = options.slots ?? DEFAULT_SLOTS;
  const applyJitter = options.applyJitter ?? false;

  assertTimeZone(tz);
  const slotsParsed = parseSlots(slots);

  if (options.target == null) {
    const base = options.after ?? new Date();
    const chosen = nextOpenSlot(account, existingScheduled, base, { ...options, tz, slots });
    return { scheduledFor: chosen, bumped: false, requested: base };
  }

  const target = options.target;
  const occ = buildOccupiedSet(existingScheduled, tz, slotsParsed);

  // Snap target to its base grid slot if within ±30 min of one, so "post at
  // 9:04" tests occupancy of the 09:00 slot.
  const tp = getZonedParts(target, tz);
  let snapped = target;
  for (const [hh, mm] of slotsParsed) {
    const anchor = zonedWallTimeToUtc(tp.year, tp.month, tp.day, hh, mm, tz);
    if (Math.abs(target.getTime() - anchor.getTime()) <= 30 * 60 * 1000) {
      snapped = anchor;
      break;
    }
  }

  if (!occ.has(slotKey(snapped, tz))) {
    let chosen = snapped;
    if (applyJitter) {
      const j = jitter(`${account}${slotKey(chosen, tz)}`);
      chosen = new Date(chosen.getTime() + j * 60 * 1000);
    }
    return { scheduledFor: chosen, bumped: false, requested: target };
  }

  // Collision: next free slot strictly AFTER the requested target.
  const bumpAfter = new Date(snapped.getTime() + 60 * 1000);
  const chosen = nextOpenSlot(account, existingScheduled, bumpAfter, { ...options, tz, slots });
  return { scheduledFor: chosen, bumped: true, requested: target };
}
