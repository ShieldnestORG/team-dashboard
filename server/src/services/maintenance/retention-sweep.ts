import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";

export interface RetentionSweepSummary {
  socialPosts: { deleted: number; kept: number };
  contentItems: { trimmed: number; deleted: number };
  marketingDrafts: { trimmed: number };
  creditscoreDrafts: { trimmed: number };
}

const BATCH_SIZE = 1000;

async function deleteBatched(
  db: Db,
  table: string,
  whereSql: ReturnType<typeof sql>,
): Promise<number> {
  let total = 0;
  // Loop until a batch deletes fewer than BATCH_SIZE rows — guards against
  // long single-statement locks on large tables.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = (await db.execute(
      sql`DELETE FROM ${sql.raw(table)} WHERE id IN (
            SELECT id FROM ${sql.raw(table)} WHERE ${whereSql} LIMIT ${BATCH_SIZE}
          )`,
    )) as unknown as { rowCount?: number } | unknown[];
    const n = Array.isArray(res) ? res.length : (res?.rowCount ?? 0);
    total += n;
    if (n < BATCH_SIZE) break;
  }
  return total;
}

async function updateBatched(
  db: Db,
  table: string,
  setSql: ReturnType<typeof sql>,
  whereSql: ReturnType<typeof sql>,
): Promise<number> {
  let total = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = (await db.execute(
      sql`UPDATE ${sql.raw(table)} SET ${setSql} WHERE id IN (
            SELECT id FROM ${sql.raw(table)} WHERE ${whereSql} LIMIT ${BATCH_SIZE}
          )`,
    )) as unknown as { rowCount?: number } | unknown[];
    const n = Array.isArray(res) ? res.length : (res?.rowCount ?? 0);
    total += n;
    if (n < BATCH_SIZE) break;
  }
  return total;
}

async function countWhere(
  db: Db,
  table: string,
  whereSql: ReturnType<typeof sql>,
): Promise<number> {
  const rows = (await db.execute(
    sql`SELECT COUNT(*)::int AS cnt FROM ${sql.raw(table)} WHERE ${whereSql}`,
  )) as unknown as Array<{ cnt: number }>;
  return Number(rows?.[0]?.cnt ?? 0);
}

export async function runRetentionSweep(db: Db): Promise<RetentionSweepSummary> {
  const summary: RetentionSweepSummary = {
    socialPosts: { deleted: 0, kept: 0 },
    contentItems: { trimmed: 0, deleted: 0 },
    marketingDrafts: { trimmed: 0 },
    creditscoreDrafts: { trimmed: 0 },
  };

  const postedDeleted = await deleteBatched(
    db,
    "social_posts",
    sql`status = 'posted' AND posted_at < now() - interval '30 days'`,
  );
  const failedDeleted = await deleteBatched(
    db,
    "social_posts",
    sql`status IN ('failed', 'canceled') AND updated_at < now() - interval '14 days'`,
  );
  summary.socialPosts.deleted = postedDeleted + failedDeleted;
  summary.socialPosts.kept = await countWhere(db, "social_posts", sql`1 = 1`);

  summary.contentItems.trimmed = await updateBatched(
    db,
    "content_items",
    sql`content = '', body_trimmed_at = now(), updated_at = now()`,
    sql`status = 'published'
        AND published_at < now() - interval '90 days'
        AND body_trimmed_at IS NULL`,
  );
  summary.contentItems.deleted = await deleteBatched(
    db,
    "content_items",
    sql`status = 'deleted' AND updated_at < now() - interval '30 days'`,
  );

  summary.marketingDrafts.trimmed = await updateBatched(
    db,
    "marketing_drafts",
    sql`payload = '{}'::jsonb, payload_trimmed_at = now(), updated_at = now()`,
    sql`status = 'published'
        AND updated_at < now() - interval '60 days'
        AND payload_trimmed_at IS NULL`,
  );

  summary.creditscoreDrafts.trimmed = await updateBatched(
    db,
    "creditscore_content_drafts",
    sql`html_draft = '', markdown_draft = '', body_trimmed_at = now(), updated_at = now()`,
    sql`status = 'published'
        AND updated_at < now() - interval '60 days'
        AND body_trimmed_at IS NULL`,
  );

  logger.info({ summary }, "Retention sweep completed");
  return summary;
}
