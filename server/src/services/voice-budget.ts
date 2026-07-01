// ---------------------------------------------------------------------------
// Coherent Ones University — Rex VOICE BUDGET service.
//
// Meters Rex realtime-voice usage against a per-member monthly seconds cap.
// Phase 1: free 3600 s/mo, calendar-month reset (no Stripe, no add-ons). Holds
// all DB logic for the /api/portal/university/voice/* routes (routes stay
// validation + shape only), mirroring university-sessions.ts / the customer-
// portal svc. Operates on `db` directly.
//
// Deliberately mirrors the intel usage meter (middleware/intel-rate-limit.ts +
// schema/intel_billing.ts): a per-period counter keyed UNIQUE(member_id,
// period_start) where period_start is the first-of-month DATE (UTC 'YYYY-MM-01'),
// incremented via an atomic ON CONFLICT UPSERT.
//
// Reserve-then-reconcile (anti-freeride):
//   reserve  → granted = clamp(requested, 0, remaining); DEBIT meter
//              (seconds_used += granted) atomically; insert an `open` reservation.
//   settle   → clampedActual = clamp(actual, 0, granted); refund = granted −
//              clampedActual; CREDIT meter (seconds_used −= refund, never < 0);
//              mark the reservation `settled`. Idempotent: only an `open` row
//              refunds, so a replayed settle is a no-op.
// A client that lies or never reports still eats the full grant.
//
// Member identity follows the rest of University EXACTLY: resolveVoiceMemberId
// mirrors the entitlement resolver — LOWER(email)=… OR account_id=…, newest
// active/past_due row (see customer-portal.ts getAccountWithEntitlements).
// ---------------------------------------------------------------------------

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  customerAccounts,
  universityMembers,
  universityVoiceAddons,
  universityVoiceMeter,
  universityVoiceReservations,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";

// Phase 1 free-tier cap. Phase 2 adds addonSeconds(member) on top.
export const VOICE_FREE_SECONDS = 3600;

// Paid add-on tiers → seconds granted ON TOP of the free cap. NON-additive: a
// member holds at most one active tier; addonSeconds() takes the MAX over
// active rows defensively (see university_voice_addons). Single source of truth
// for tier→seconds; the checkout endpoint + webhook map tier↔price separately
// (services/university-stripe-handler.ts VOICE_ADDON_TIERS).
export const VOICE_ADDON_TIER_SECONDS: Record<string, number> = {
  "1hr": 3600,
  "2p5hr": 9000,
};

export interface VoiceBudget {
  periodStart: string;
  usedSeconds: number;
  limitSeconds: number;
  remainingSeconds: number;
}

export interface VoiceReservationResult {
  reservationId: string;
  grantedSeconds: number;
  remainingSeconds: number;
}

export interface VoiceSettleResult {
  ok: true;
  usedSeconds: number;
  remainingSeconds: number;
}

// First-of-month (UTC) 'YYYY-MM-01'. Mirrors intel-rate-limit periodStartDate().
function periodStartDate(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

// pg drivers return either an array or an { rows } envelope depending on path;
// normalize like intel-rate-limit's incrementMonthlyUsage does.
function firstRow<T>(result: unknown): T | undefined {
  const envelope = result as { rows?: T[] };
  if (envelope && Array.isArray(envelope.rows)) return envelope.rows[0];
  if (Array.isArray(result)) return (result as T[])[0];
  return undefined;
}

function clampInt(value: unknown, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(Math.trunc(n), max));
}

export function voiceBudgetService(db: Db) {
  // Seconds granted by the member's ACTIVE paid add-on(s), ON TOP of the free
  // cap. NON-additive: a member is meant to hold one active tier, but we take
  // the MAX over active rows defensively so a stray overlapping row (e.g. a
  // brief window during an upgrade before the old sub cancels) never stacks or
  // under-grants. No active add-on → 0. One cheap indexed lookup on
  // (member_id, status='active'), consistent with getVoiceBudget's meter read.
  async function addonSeconds(memberId: string): Promise<number> {
    const rows = await db
      .select({ tier: universityVoiceAddons.tier })
      .from(universityVoiceAddons)
      .where(
        and(
          eq(universityVoiceAddons.memberId, memberId),
          eq(universityVoiceAddons.status, "active"),
        ),
      );
    let max = 0;
    for (const row of rows) {
      const seconds = VOICE_ADDON_TIER_SECONDS[row.tier] ?? 0;
      if (seconds > max) max = seconds;
    }
    return max;
  }

  // The member's monthly voice cap: the free tier plus their active add-on.
  async function voiceLimitSeconds(memberId: string): Promise<number> {
    return VOICE_FREE_SECONDS + (await addonSeconds(memberId));
  }

  // The member's login/receipt email — used by the add-on checkout route to set
  // Stripe's customer_email. Route stays validation+shape only (DB logic here).
  async function getMemberEmail(memberId: string): Promise<string | null> {
    const rows = await db
      .select({ email: universityMembers.email })
      .from(universityMembers)
      .where(eq(universityMembers.id, memberId))
      .limit(1);
    return rows.length ? rows[0].email : null;
  }

  // Resolve the University member row for a portal account the same way the
  // entitlement resolver does: match on the durable lowercased email OR the
  // linked account_id, newest active/past_due membership. Returns null for a
  // non-member (the route maps that to null voiceMinutes / a 403 upstream).
  async function resolveVoiceMemberId(
    accountId: string,
  ): Promise<string | null> {
    const accountRows = await db
      .select({ email: customerAccounts.email })
      .from(customerAccounts)
      .where(eq(customerAccounts.id, accountId))
      .limit(1);
    if (accountRows.length === 0) return null;
    const email = accountRows[0].email.trim().toLowerCase();

    const rows = await db
      .select({ id: universityMembers.id })
      .from(universityMembers)
      .where(
        and(
          or(
            sql`LOWER(${universityMembers.email}) = ${email}`,
            eq(universityMembers.accountId, accountId),
          ),
          or(
            eq(universityMembers.status, "active"),
            eq(universityMembers.status, "past_due"),
          ),
        ),
      )
      .orderBy(desc(universityMembers.createdAt))
      .limit(1);
    return rows.length ? rows[0].id : null;
  }

  async function getVoiceBudget(memberId: string): Promise<VoiceBudget> {
    const periodStart = periodStartDate();
    const rows = await db
      .select({ used: universityVoiceMeter.secondsUsed })
      .from(universityVoiceMeter)
      .where(
        and(
          eq(universityVoiceMeter.memberId, memberId),
          eq(universityVoiceMeter.periodStart, periodStart),
        ),
      )
      .limit(1);
    const usedSeconds = rows.length ? Number(rows[0].used) : 0;
    const limitSeconds = await voiceLimitSeconds(memberId);
    const remainingSeconds = Math.max(0, limitSeconds - usedSeconds);
    return { periodStart, usedSeconds, limitSeconds, remainingSeconds };
  }

  async function reserveVoiceSeconds(
    memberId: string,
    requestedSeconds: number,
  ): Promise<VoiceReservationResult> {
    const periodStart = periodStartDate();
    // Read-then-clamp against the current remaining (intel-style — the atomic
    // UPSERT below owns the actual debit; a stale read can at worst over-grant
    // by a concurrent reserve, which the free-tier cap tolerates).
    const budget = await getVoiceBudget(memberId);
    const granted = clampInt(requestedSeconds, 0, budget.remainingSeconds);

    // Atomic debit — mirrors intel_usage_meter's ON CONFLICT UPSERT.
    const upserted = await db.execute<{ seconds_used: number }>(sql`
      INSERT INTO university_voice_meter (member_id, period_start, seconds_used)
      VALUES (${memberId}, ${periodStart}, ${granted})
      ON CONFLICT (member_id, period_start) DO UPDATE SET
        seconds_used = university_voice_meter.seconds_used + ${granted},
        updated_at = now()
      RETURNING seconds_used
    `);
    const newUsed = Number(firstRow<{ seconds_used: number }>(upserted)?.seconds_used ?? granted);
    const remainingSeconds = Math.max(0, (await voiceLimitSeconds(memberId)) - newUsed);

    const inserted = await db
      .insert(universityVoiceReservations)
      .values({
        memberId,
        periodStart,
        grantedSeconds: granted,
        status: "open",
      })
      .returning({ id: universityVoiceReservations.id });

    return {
      reservationId: inserted[0].id,
      grantedSeconds: granted,
      remainingSeconds,
    };
  }

  async function settleVoiceSeconds(
    reservationId: string,
    memberId: string,
    actualSeconds: number,
  ): Promise<VoiceSettleResult> {
    // Read the reservation (scoped to the member so one member can't settle
    // another's grant). Unknown/foreign reservation → no-op, return budget.
    const resRows = await db
      .select({
        grantedSeconds: universityVoiceReservations.grantedSeconds,
        periodStart: universityVoiceReservations.periodStart,
        status: universityVoiceReservations.status,
      })
      .from(universityVoiceReservations)
      .where(
        and(
          eq(universityVoiceReservations.id, reservationId),
          eq(universityVoiceReservations.memberId, memberId),
        ),
      )
      .limit(1);

    if (resRows.length === 0) {
      logger.warn(
        { reservationId, memberId },
        "voice-budget: settle for unknown reservation (no-op)",
      );
      const budget = await getVoiceBudget(memberId);
      return {
        ok: true,
        usedSeconds: budget.usedSeconds,
        remainingSeconds: budget.remainingSeconds,
      };
    }

    const { grantedSeconds, periodStart } = resRows[0];
    const clampedActual = clampInt(actualSeconds, 0, grantedSeconds);
    const refund = grantedSeconds - clampedActual;

    // Guarded state flip: only an `open` row transitions. RETURNING tells us
    // whether THIS call won the settle — the refund is applied ONLY then, so a
    // replayed/concurrent settle never double-credits (idempotent).
    const settled = await db.execute<{ id: string }>(sql`
      UPDATE university_voice_reservations SET
        status = 'settled',
        actual_seconds = ${clampedActual},
        settled_at = now()
      WHERE id = ${reservationId}
        AND member_id = ${memberId}
        AND status = 'open'
      RETURNING id
    `);

    if (firstRow<{ id: string }>(settled) && refund > 0) {
      // Credit the unused seconds back to the reservation's OWN period (correct
      // even if settle lands after a month rollover). Never below 0.
      await db.execute(sql`
        UPDATE university_voice_meter SET
          seconds_used = GREATEST(0, seconds_used - ${refund}),
          updated_at = now()
        WHERE member_id = ${memberId}
          AND period_start = ${periodStart}
      `);
    }

    const budget = await getVoiceBudget(memberId);
    return {
      ok: true,
      usedSeconds: budget.usedSeconds,
      remainingSeconds: budget.remainingSeconds,
    };
  }

  return {
    voiceLimitSeconds,
    addonSeconds,
    getMemberEmail,
    resolveVoiceMemberId,
    getVoiceBudget,
    reserveVoiceSeconds,
    settleVoiceSeconds,
  };
}

export type VoiceBudgetService = ReturnType<typeof voiceBudgetService>;
