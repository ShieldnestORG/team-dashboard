// ---------------------------------------------------------------------------
// Trends-digest persistence. One row per run date in `trends_digests`. The
// Rule-7 human-approval gate lives in the SQL itself, not just the route layer:
//
//   * savePending  — upserts a `pending` digest, but ON CONFLICT only when the
//     existing row is pending/rejected, so a rebuild can NEVER clobber a digest
//     a human already approved or sent.
//   * approve      — flips pending → approved (records who/when).
//   * markSent     — flips approved → sent (records when). Refuses a non-approved
//     row, so nothing un-approved can be blasted.
//   * latestPublished — what `/api/trends/today` serves: the newest approved or
//     sent digest. A `pending` digest is never exposed to members.
// ---------------------------------------------------------------------------

import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import type { DigestStatus, TrendDigest } from "./types.js";

export interface StoredDigest {
  digestDate: string;
  status: DigestStatus;
  generatedAt: string | null;
  payload: TrendDigest;
  adFriendlyIds: string[];
  approvedAt: string | null;
  approvedBy: string | null;
  sentAt: string | null;
}

function asIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

interface RawRow {
  digest_date: string;
  status: string;
  generated_at: unknown;
  payload: unknown;
  ad_friendly_ids: unknown;
  approved_at: unknown;
  approved_by: unknown;
  sent_at: unknown;
}

function rowToStored(row: RawRow): StoredDigest {
  return {
    digestDate: row.digest_date,
    status: row.status as DigestStatus,
    generatedAt: asIso(row.generated_at),
    payload: row.payload as TrendDigest,
    adFriendlyIds: Array.isArray(row.ad_friendly_ids)
      ? (row.ad_friendly_ids as string[])
      : [],
    approvedAt: asIso(row.approved_at),
    approvedBy: row.approved_by == null ? null : String(row.approved_by),
    sentAt: asIso(row.sent_at),
  };
}

function rows<T>(result: unknown): T[] {
  // The repo's db.execute returns the row array directly (see trend-scanner).
  // Tolerate a {rows} shape too, just in case.
  if (Array.isArray(result)) return result as T[];
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

export function trendsDigestStore(db: Db) {
  return {
    /** Upsert a freshly-built PENDING digest. Never overwrites an approved/sent row. */
    async savePending(digest: TrendDigest): Promise<void> {
      await db.execute(sql`
        INSERT INTO trends_digests
          (digest_date, status, generated_at, payload, ad_friendly_ids)
        VALUES
          (${digest.digestDate}, 'pending', ${digest.generatedAt}::timestamptz,
           ${JSON.stringify(digest)}::jsonb,
           ${JSON.stringify(digest.adFriendlyItemIds)}::jsonb)
        ON CONFLICT (digest_date) DO UPDATE SET
          status = 'pending',
          generated_at = EXCLUDED.generated_at,
          payload = EXCLUDED.payload,
          ad_friendly_ids = EXCLUDED.ad_friendly_ids,
          approved_at = NULL,
          approved_by = NULL,
          sent_at = NULL
        WHERE trends_digests.status IN ('pending','rejected')
      `);
    },

    async getByDate(date: string): Promise<StoredDigest | null> {
      const result = await db.execute(sql`
        SELECT * FROM trends_digests WHERE digest_date = ${date} LIMIT 1
      `);
      const r = rows<RawRow>(result);
      return r[0] ? rowToStored(r[0]) : null;
    },

    /** What members see: the newest approved-or-sent digest (never pending). */
    async latestPublished(): Promise<StoredDigest | null> {
      const result = await db.execute(sql`
        SELECT * FROM trends_digests
        WHERE status IN ('approved','sent')
        ORDER BY digest_date DESC LIMIT 1
      `);
      const r = rows<RawRow>(result);
      return r[0] ? rowToStored(r[0]) : null;
    },

    /** Newest digest awaiting human review. */
    async latestPending(): Promise<StoredDigest | null> {
      const result = await db.execute(sql`
        SELECT * FROM trends_digests
        WHERE status = 'pending'
        ORDER BY digest_date DESC LIMIT 1
      `);
      const r = rows<RawRow>(result);
      return r[0] ? rowToStored(r[0]) : null;
    },

    /** Rule 7: a human approves. pending → approved. Returns true if a row moved. */
    async approve(date: string, approvedBy: string): Promise<boolean> {
      const result = await db.execute(sql`
        UPDATE trends_digests
        SET status = 'approved', approved_at = now(), approved_by = ${approvedBy}
        WHERE digest_date = ${date} AND status = 'pending'
        RETURNING digest_date
      `);
      return rows<{ digest_date: string }>(result).length > 0;
    },

    /** approved → sent. Refuses anything not approved. Returns true if a row moved. */
    async markSent(date: string): Promise<boolean> {
      const result = await db.execute(sql`
        UPDATE trends_digests
        SET status = 'sent', sent_at = now()
        WHERE digest_date = ${date} AND status = 'approved'
        RETURNING digest_date
      `);
      return rows<{ digest_date: string }>(result).length > 0;
    },

    /** pending → rejected (discard a bad run without sending). */
    async reject(date: string): Promise<boolean> {
      const result = await db.execute(sql`
        UPDATE trends_digests
        SET status = 'rejected'
        WHERE digest_date = ${date} AND status = 'pending'
        RETURNING digest_date
      `);
      return rows<{ digest_date: string }>(result).length > 0;
    },
  };
}

export type TrendsDigestStore = ReturnType<typeof trendsDigestStore>;
