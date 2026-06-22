// ---------------------------------------------------------------------------
// Coherent Ones University — member-economics REPORTING layer (M4) integration
// test (no live Stripe, no net).
//
// Gives runtime coverage to the two M4 artifacts that were otherwise only
// "exists in a migration / route file" but never exercised against a real DB:
//   - the SQL view `member_economics_by_campaign`
//     (packages/db/src/migrations/0128_member_economics_view.sql)
//   - the read-only admin endpoint GET /api/university/economics
//     (server/src/routes/dashboard.ts) that selects straight from it.
//
// It reuses the SAME embedded-Postgres harness the webhook-integration test
// uses (helpers/embedded-postgres[-no-pgvector]) — the full migration chain
// (incl. 0127 attribution tables + 0128 view) is applied to a REAL Postgres,
// then we:
//   1. seed a minimal but representative scenario: one campaign with an ACTIVE
//      subscription (a clean paid invoice) and a CHURNED one (paid then fully
//      refunded), plus the marketing ledger rows the view sums cash from, and
//      an attribution row exercising the campaign FALLBACK join;
//   2. SELECT * FROM member_economics_by_campaign and assert the per-campaign
//      aggregates are exactly the numbers the seed implies (new/active/churned
//      counts + gross/net MRR + realized LTV);
//   3. hit the REAL GET /api/university/economics route (mounted with the same
//      board-only guard + logAdminAccess middleware the app uses) and assert it
//      returns those same rows for an authorized (board) actor — and 401s for a
//      non-board actor.
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable, exactly
// like the webhook-integration test it mirrors.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  createDb,
  universitySubscriptions,
  universityAttribution,
  universityAttributionEvents,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import { dashboardRoutes } from "../routes/dashboard.js";

const CAMPAIGN = "summer";
const SOURCE = "facebook";

// Two distinct Stripe customers — the ledger keys on stripe_customer_id, so
// each subscription's cash must hang off its OWN customer id.
const CUST_ACTIVE = "cus_econ_active";
const CUST_CHURNED = "cus_econ_churned";

// --- DB mode selection: identical to university-webhook-integration.test.ts ---
// fullChain (pgvector present) → apply the whole production migration chain.
// noPgvector → replay the migration files with the vector(N)→text shim (still a
// real Postgres, real DDL for every table the view reads). skip → Postgres
// itself can't start (NO fake pass; the reason is printed).
const support = await getEmbeddedPostgresTestSupport();
const pgvectorOnlyBlocker =
  !support.supported && /pgvector|vector/i.test(support.reason ?? "");
const dbMode: "fullChain" | "noPgvector" | "skip" = support.supported
  ? "fullChain"
  : pgvectorOnlyBlocker
    ? "noPgvector"
    : "skip";

const describeDb = dbMode === "skip" ? describe.skip : describe;

if (dbMode === "skip") {
  console.warn(
    `Skipping university economics view test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
} else if (dbMode === "noPgvector") {
  console.warn(
    `university economics view test: pgvector unavailable — running against ` +
      `real Postgres with the vector(N)→text migration shim. ` +
      `Reason: ${support.reason ?? "unknown"}`,
  );
}

describeDb("member_economics_by_campaign view + GET /university/economics (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let app!: express.Express;

  beforeAll(async () => {
    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase(
        "university-economics-view-",
      );
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase(
        "university-economics-view-novec-",
      );
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    // Real Express app: the actual dashboardRoutes(db) router (which mounts the
    // board-only guard + logAdminAccess on /university/economics internally).
    // An inline middleware injects req.actor before it — mirroring how
    // actorMiddleware populates the actor in production, and the exact pattern
    // the admin-access-log route tests use.
    app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      const header = req.header("x-test-actor");
      if (header === "board") {
        req.actor = {
          type: "board",
          userId: randomUUID(),
          isInstanceAdmin: true,
          source: "session",
        };
      } else if (header === "agent") {
        req.actor = { type: "agent", agentId: randomUUID(), source: "session" };
      } else {
        req.actor = { type: "none" };
      }
      next();
    });
    app.use("/api", dashboardRoutes(db));
  }, 60_000);

  afterEach(async () => {
    // Order matters: attribution references the subscription; events stand alone.
    await db.delete(universityAttribution);
    await db.delete(universityAttributionEvents);
    await db.delete(universitySubscriptions);
  });

  afterAll(async () => {
    await cleanup?.();
  });

  // Seed one campaign (summer/facebook) with:
  //   * an ACTIVE subscription (cus_econ_active): one paid invoice of $50, no
  //     refund. Campaign is stamped DIRECTLY on the subscription row.
  //   * a CHURNED (cancelled) subscription (cus_econ_churned): one paid invoice
  //     of $50 and a full $50 refund. Campaign is left NULL on the sub and
  //     supplied via an attribution row — exercising the view's fallback join.
  //
  // Implied view aggregates for (summer, facebook):
  //   new_members        = 2  (both subs)
  //   active_members     = 1  (the active one)
  //   churned_members    = 1  (the cancelled one)
  //   gross_mrr          = 50.00   (only ACTIVE subs contribute latest_paid; the
  //                                 active sub's latest invoice.paid = 5000c)
  //   net_mrr            = 0.00    (GREATEST(5000 active_mrr - 5000 refunded,0)/100)
  //   realized_ltv       = 25.00   (AVG of (5000-0)/100=50 and (5000-5000)/100=0)
  async function seedScenario() {
    const activeSubId = randomUUID();
    const churnedSubId = randomUUID();

    await db.insert(universitySubscriptions).values([
      {
        id: activeSubId,
        email: "active@econ.test",
        status: "active",
        stripeCustomerId: CUST_ACTIVE,
        stripeSubscriptionId: "sub_econ_active",
        utmCampaign: CAMPAIGN,
        utmSource: SOURCE,
      },
      {
        id: churnedSubId,
        email: "churned@econ.test",
        status: "cancelled",
        stripeCustomerId: CUST_CHURNED,
        stripeSubscriptionId: "sub_econ_churned",
        canceledAt: new Date(),
        // utm_* intentionally NULL here → resolved via the attribution row below.
      },
    ]);

    // Attribution row supplies the campaign for the churned sub (fallback path).
    await db.insert(universityAttribution).values({
      email: "churned@econ.test",
      subscriptionId: churnedSubId,
      stripeCustomerId: CUST_CHURNED,
      utmCampaign: CAMPAIGN,
      utmSource: SOURCE,
      firstTouchAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
    });

    // Marketing ledger: the view reads amount_paid / amount_refunded out of the
    // JSONB payload, keyed on stripe_customer_id.
    await db.insert(universityAttributionEvents).values([
      {
        stripeEventId: "evt_paid_active",
        eventType: "invoice.paid",
        stripeCustomerId: CUST_ACTIVE,
        payload: { amount_paid: 5000 },
      },
      {
        stripeEventId: "evt_paid_churned",
        eventType: "invoice.paid",
        stripeCustomerId: CUST_CHURNED,
        payload: { amount_paid: 5000 },
      },
      {
        stripeEventId: "evt_refund_churned",
        eventType: "charge.refunded",
        stripeCustomerId: CUST_CHURNED,
        payload: { amount_refunded: 5000 },
      },
    ]);

    return { activeSubId, churnedSubId };
  }

  it("the view rolls the seeded scenario up to the campaign grain with the expected aggregates", async () => {
    await seedScenario();

    const rows = (await db.execute(
      sql`SELECT * FROM member_economics_by_campaign`,
    )) as unknown as Array<Record<string, unknown>>;

    // The campaign appears, on its own row (no leakage into other buckets).
    const summer = rows.find(
      (r) => r.utm_campaign === CAMPAIGN && r.utm_source === SOURCE,
    );
    expect(summer, `expected a row for (${CAMPAIGN}, ${SOURCE})`).toBeDefined();

    // Counts.
    expect(Number(summer!.new_members)).toBe(2);
    expect(Number(summer!.active_members)).toBe(1);
    expect(Number(summer!.churned_members)).toBe(1);

    // Money columns come back as NUMERIC → pg serializes them as strings.
    // gross_mrr: only the ACTIVE sub's latest paid invoice ($50) counts.
    expect(Number(summer!.gross_mrr)).toBe(50);
    // net_mrr: GREATEST(active_mrr 5000 - refunded 5000, 0) / 100 = 0.
    expect(Number(summer!.net_mrr)).toBe(0);
    // realized_ltv: AVG((5000-0)/100=50, (5000-5000)/100=0) = 25.
    expect(Number(summer!.realized_ltv)).toBe(25);
    // avg_lifetime_months is directional but must be a finite, non-negative #.
    expect(Number(summer!.avg_lifetime_months)).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(Number(summer!.avg_lifetime_months))).toBe(true);

    // No other (unattributed) bucket — every seeded sub carries the campaign
    // (directly or via the fallback attribution row).
    const unattributed = rows.find((r) => r.utm_campaign === "(unattributed)");
    expect(unattributed).toBeUndefined();
  });

  it("GET /api/university/economics returns the campaign rows for a board actor", async () => {
    await seedScenario();

    const res = await request(app)
      .get("/api/university/economics")
      .set("x-test-actor", "board");

    expect(res.status).toBe(200);
    expect(res.body.estimated).toBe(true);
    expect(typeof res.body.note).toBe("string");
    expect(typeof res.body.generatedAt).toBe("string");
    expect(Array.isArray(res.body.campaigns)).toBe(true);

    const summer = res.body.campaigns.find(
      (c: Record<string, unknown>) =>
        c.utm_campaign === CAMPAIGN && c.utm_source === SOURCE,
    );
    expect(summer, "endpoint must surface the seeded campaign").toBeDefined();
    // The endpoint coerces NUMERIC strings → numbers via its `num()` helper.
    expect(summer.new_members).toBe(2);
    expect(summer.active_members).toBe(1);
    expect(summer.churned_members).toBe(1);
    expect(summer.gross_mrr).toBe(50);
    expect(summer.net_mrr).toBe(0);
    expect(summer.realized_ltv).toBe(25);
  });

  it("GET /api/university/economics is board-only (401 for a non-board actor)", async () => {
    const res = await request(app)
      .get("/api/university/economics")
      .set("x-test-actor", "agent");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Admin only" });
  });
});
