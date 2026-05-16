// ---------------------------------------------------------------------------
// admin_access_log retention cron — embedded-pg gated.
//
// Verifies:
//   1. Rows with created_at < now() - 90d are deleted.
//   2. Rows with created_at >= now() - 90d are retained.
//   3. The purge summary { purged, durationMs } reports the correct count.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminAccessLog, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
  type EmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { runAdminAccessLogPurge } from "../services/admin-access-log-retention-cron.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres admin-access-log retention tests: ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("admin_access_log retention cron", () => {
  let testDb: EmbeddedPostgresTestDatabase;
  let db: ReturnType<typeof createDb>;

  beforeAll(async () => {
    testDb = await startEmbeddedPostgresTestDatabase(
      "admin-access-log-retention-",
    );
    db = createDb(testDb.connectionString);
  });

  afterAll(async () => {
    await testDb.cleanup();
  });

  it("deletes rows older than 90 days and keeps recent rows", async () => {
    // Clean slate
    await db.execute(sql`DELETE FROM admin_access_log`);

    // Insert: 3 old rows (>90d), 2 recent rows (<90d).
    // We use raw SQL to backdate created_at — defaultNow() would otherwise
    // stamp every row at insert time.
    await db.execute(sql`
      INSERT INTO admin_access_log
        (method, path, status_code, duration_ms, created_at)
      VALUES
        ('GET',  '/old-1', 200, 10, now() - interval '91 days'),
        ('POST', '/old-2', 200, 12, now() - interval '120 days'),
        ('GET',  '/old-3', 401, 5,  now() - interval '365 days'),
        ('GET',  '/new-1', 200, 8,  now() - interval '1 day'),
        ('POST', '/new-2', 204, 9,  now() - interval '89 days')
    `);

    const before = await db.select().from(adminAccessLog);
    expect(before).toHaveLength(5);

    const summary = await runAdminAccessLogPurge(db);
    expect(summary.purged).toBe(3);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);

    const after = await db.select().from(adminAccessLog);
    expect(after).toHaveLength(2);
    const paths = after.map((r) => r.path).sort();
    expect(paths).toEqual(["/new-1", "/new-2"]);
  });

  it("returns 0 purged when there is nothing to delete", async () => {
    await db.execute(sql`DELETE FROM admin_access_log`);
    await db.execute(sql`
      INSERT INTO admin_access_log
        (method, path, status_code, duration_ms, created_at)
      VALUES ('GET', '/recent', 200, 3, now() - interval '5 days')
    `);

    const summary = await runAdminAccessLogPurge(db);
    expect(summary.purged).toBe(0);

    const remaining = await db.select().from(adminAccessLog);
    expect(remaining).toHaveLength(1);
  });
});
