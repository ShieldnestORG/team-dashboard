// ---------------------------------------------------------------------------
// alert:blog-publish-health against a real Postgres (embedded-pg gated).
// Exercises the SQL the pure-function tests cannot: the publish_results JSONB
// reads, the created_at bounds, and the alert_events once-per-outage lookup,
// including that an alert whose email failed does not silence the next one.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { companies, createDb } from "@paperclipai/db";
import { sql } from "drizzle-orm";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";

vi.mock("../services/alerting.js", () => ({ sendAlert: vi.fn(async () => {}) }));
import { sendAlert } from "../services/alerting.js";
import { checkBlogPublishHealth } from "../services/blog-publish-health.js";

// Same harness choice as university-checkin.test.ts: full migration chain when
// pgvector exists, else the no-pgvector replay (real DDL, vector → text).
const support = await getEmbeddedPostgresTestSupport();
const pgvectorOnlyBlocker = !support.supported && /pgvector|vector/i.test(support.reason ?? "");
const dbMode: "fullChain" | "noPgvector" | "skip" = support.supported
  ? "fullChain"
  : pgvectorOnlyBlocker
    ? "noPgvector"
    : "skip";
const describeDb = dbMode === "skip" ? describe.skip : describe;
if (dbMode === "skip") {
  console.warn(`Skipping blog-publish-health DB tests (embedded Postgres unavailable): ${support.reason ?? "unsupported"}`);
}

const H = 60 * 60 * 1000;
const CD_SUBJECT = "Blog publish failing: cd (coherencedaddy.com)";

describeDb("alert:blog-publish-health (real SQL)", () => {
  let cleanup: (() => Promise<void>) | null = null;
  let db!: ReturnType<typeof createDb>;
  const companyId = randomUUID();
  const now = new Date();
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H).toISOString();

  async function attempt(hoursAgo: number, legs: Record<string, { success: boolean; error?: string }>) {
    await db.execute(sql`
      INSERT INTO content_items (company_id, personality_id, content_type, platform, content, topic, publish_results, created_at)
      VALUES (${companyId}, 'forge', 'blog_post', 'blog', 'x', 't', ${JSON.stringify(legs)}::jsonb, ${at(hoursAgo)}::timestamptz)`);
  }
  async function pastAlert(hoursAgo: number, emailSent: boolean) {
    await db.execute(sql`
      INSERT INTO alert_events (type, severity, subject, body, email_sent, created_at)
      VALUES ('blog_publish_failing', 'critical', ${CD_SUBJECT}, 'b', ${emailSent}, ${at(hoursAgo)}::timestamptz)`);
  }

  /** cd: a success 3 days ago, then 5 failures. sn + tokns-app healthy on the same posts. */
  async function seedCdOutage() {
    await attempt(72, { cd: { success: true }, sn: { success: true }, toknsApp: { success: true } });
    for (const h of [10, 8, 6, 4, 2]) {
      await attempt(h, { cd: { success: false, error: "Unauthorized" }, sn: { success: true }, toknsApp: { success: true } });
    }
  }

  const cdCalls = () => vi.mocked(sendAlert).mock.calls.filter((c) => c[1] === CD_SUBJECT);

  beforeAll(async () => {
    if (dbMode === "fullChain") {
      const testDb = await startEmbeddedPostgresTestDatabase("blog-publish-health-");
      db = createDb(testDb.connectionString);
      cleanup = testDb.cleanup;
    } else {
      const testDb = await startNoPgvectorTestDatabase("blog-publish-health-");
      db = testDb.db;
      cleanup = testDb.cleanup;
    }
    await db.insert(companies).values({
      id: companyId,
      name: "Blog health test",
      issuePrefix: `B${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
  });

  afterAll(async () => {
    await cleanup?.();
  });

  beforeEach(async () => {
    vi.mocked(sendAlert).mockClear();
    await db.execute(sql`DELETE FROM content_items`);
    await db.execute(sql`DELETE FROM alert_events`);
  });

  it("alerts for the failing target only, with count, last error and its own cooldown key", async () => {
    await seedCdOutage();
    // sn-only posts that must not count for cd or tokns-app (leg absent)
    await attempt(1, { sn: { success: true } });
    // a future sn failure run must be ignored (created_at <= now)
    for (const h of [-1, -2, -3, -4, -5]) await attempt(h, { sn: { success: false, error: "future" } });

    const res = await checkBlogPublishHealth(db, now);

    expect(res).toEqual([
      { target: "cd", failing: true, consecutiveFailures: 5, alerted: true },
      { target: "sn", failing: false, consecutiveFailures: 0, alerted: false },
      { target: "tokns-app", failing: false, consecutiveFailures: 0, alerted: false },
    ]);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    const [type, subject, body, opts] = vi.mocked(sendAlert).mock.calls[0]!;
    expect(type).toBe("blog_publish_failing");
    expect(subject).toBe(CD_SUBJECT);
    expect(body).toContain("Failed attempts in a row: 5");
    expect(body).toContain("Last 24 h: 5 attempts, 0 succeeded");
    expect(body).toContain("Last error: Unauthorized");
    expect(opts).toEqual({ cooldownKey: "blog_publish_failing:cd" });
  });

  it("stays quiet when an alert email already went out during this outage", async () => {
    await seedCdOutage();
    await pastAlert(1, true);
    await checkBlogPublishHealth(db, now);
    expect(cdCalls()).toHaveLength(0);
  });

  it("alerts again when the earlier alert's email failed", async () => {
    await seedCdOutage();
    await pastAlert(1, false);
    await checkBlogPublishHealth(db, now);
    expect(cdCalls()).toHaveLength(1);
  });

  it("alerts again when the earlier alert predates the last success (new outage)", async () => {
    await seedCdOutage();
    await pastAlert(100, true);
    await checkBlogPublishHealth(db, now);
    expect(cdCalls()).toHaveLength(1);
  });

  it("clears once the target publishes again", async () => {
    await seedCdOutage();
    await attempt(1, { cd: { success: true } });
    const res = await checkBlogPublishHealth(db, now);
    expect(res[0]).toEqual({ target: "cd", failing: false, consecutiveFailures: 0, alerted: false });
    expect(sendAlert).not.toHaveBeenCalled();
  });
});
