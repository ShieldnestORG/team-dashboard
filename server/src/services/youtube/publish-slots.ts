/**
 * YouTube Publish Slots — deterministic publish-time assignment.
 *
 * Pure core (slotConfigFromEnv / localWallTimeToUtc / nextFreeSlot) plus a thin
 * DB wrapper (nextPublishSlot) that reads the existing publish queue and proposes
 * the next free slot. Slots are a proposal the owner can change at approval time.
 */

import type { Db } from "@paperclipai/db";
import { ytPublishQueue } from "@paperclipai/db";
import { and, gte, inArray } from "drizzle-orm";

export interface SlotConfig {
  perDay: number;
  hours: number[];
  timeZone: string;
}

const DEFAULT_PER_DAY = 1;
const DEFAULT_HOURS = [7];
const DEFAULT_TIME_ZONE = "America/Los_Angeles";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function slotConfigFromEnv(env: NodeJS.ProcessEnv = process.env): SlotConfig {
  const perDayRaw = Number(env.YT_PUBLISH_PER_DAY);
  let perDay =
    Number.isInteger(perDayRaw) && perDayRaw >= 1 && perDayRaw <= 5
      ? perDayRaw
      : DEFAULT_PER_DAY;

  const hoursRaw = env.YT_PUBLISH_HOURS ?? "7";
  const hours = Array.from(
    new Set(
      hoursRaw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((h) => Number.isInteger(h) && h >= 0 && h <= 23),
    ),
  ).sort((a, b) => a - b);
  const effectiveHours = hours.length > 0 ? hours : [...DEFAULT_HOURS];

  if (effectiveHours.length > perDay) {
    effectiveHours.length = perDay; // keep the first perDay (already sorted)
  } else if (effectiveHours.length < perDay) {
    perDay = effectiveHours.length;
  }

  const timeZone = isValidTimeZone(env.YT_PUBLISH_TZ ?? "")
    ? (env.YT_PUBLISH_TZ as string)
    : DEFAULT_TIME_ZONE;

  return { perDay, hours: effectiveHours, timeZone };
}

function readLocalWallTime(
  instant: Date,
  timeZone: string,
): { year: number; month: number; day: number; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(instant);

  const get = (type: string): number => {
    const v = parts.find((p) => p.type === type)?.value;
    return v === undefined ? NaN : Number(v);
  };

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

export function localWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  timeZone: string,
): Date {
  // The desired wall time expressed as if it were UTC — the comparison target.
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
  let guess = wallAsUtc;

  for (let i = 0; i < 3; i++) {
    const local = readLocalWallTime(new Date(guess), timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0, 0);
    const offset = wallAsUtc - localAsUtc;
    if (offset === 0) break;
    guess += offset;
  }

  return new Date(guess);
}

export function nextFreeSlot(now: Date, taken: Date[], cfg: SlotConfig): Date {
  const minTime = now.getTime() + 60 * 60 * 1000;
  const tooCloseMs = 30 * 60 * 1000;

  const localDayKey = (d: Date): string => {
    const p = readLocalWallTime(d, cfg.timeZone);
    return `${p.year}-${p.month}-${p.day}`;
  };

  const today = readLocalWallTime(now, cfg.timeZone);
  let year = today.year;
  let month = today.month;
  let day = today.day;

  let lastCandidate: Date | null = null;

  for (let i = 0; i < 60; i++) {
    const dayKey = `${year}-${month}-${day}`;

    for (const hour of cfg.hours) {
      const candidate = localWallTimeToUtc(year, month, day, hour, cfg.timeZone);
      lastCandidate = candidate;

      const takenInDay = taken.filter((t) => localDayKey(t) === dayKey).length;
      if (takenInDay >= cfg.perDay) continue;
      if (candidate.getTime() < minTime) continue;
      if (taken.some((t) => Math.abs(t.getTime() - candidate.getTime()) < tooCloseMs)) continue;

      return candidate;
    }

    // Advance to the next local calendar day via local noon (stays valid across DST).
    const noon = localWallTimeToUtc(year, month, day, 12, cfg.timeZone);
    const nextNoon = new Date(noon.getTime() + 24 * 60 * 60 * 1000);
    const np = readLocalWallTime(nextNoon, cfg.timeZone);
    year = np.year;
    month = np.month;
    day = np.day;
  }

  // Nothing free in 60 days — return the last candidate examined plus one day (never throw).
  return new Date((lastCandidate ? lastCandidate.getTime() : minTime) + 24 * 60 * 60 * 1000);
}

export async function nextPublishSlot(db: Db, now: Date = new Date()): Promise<Date> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const rows = await db
    .select({ publishTime: ytPublishQueue.publishTime })
    .from(ytPublishQueue)
    .where(
      and(
        inArray(ytPublishQueue.status, ["pending_review", "scheduled", "publishing", "published"]),
        gte(ytPublishQueue.publishTime, since),
      ),
    );

  const taken = rows.map((r) => r.publishTime);
  return nextFreeSlot(now, taken, slotConfigFromEnv());
}
