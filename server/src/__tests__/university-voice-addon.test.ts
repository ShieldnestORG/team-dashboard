// ---------------------------------------------------------------------------
// Coherent Ones University — paid Rex voice ADD-ON money-path tests.
//
// Exercises the add-on checkout / status handlers + the voice-budget cap against
// a REAL embedded Postgres (mirrors university-referral-webhook.test.ts). Covers
// the previously-untested money path:
//   1. Duplicate checkout.session.completed upserts EXACTLY ONE row (idempotency
//      via the UNIQUE stripe_subscription_id constraint).
//   2. Overlapping active add-ons grant the MAX seconds, never the SUM.
//   3. mapAddonStatus('past_due') is a no-op — the granted cap stays INTACT
//      (an out-of-order dunning blip must not zero a paid member's cap).
//
// Skips cleanly (NO fake pass) if embedded Postgres is unavailable.
// ---------------------------------------------------------------------------

import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";

import {
  createDb,
  companies,
  universityMembers,
  universityVoiceAddons,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { startNoPgvectorTestDatabase } from "./helpers/embedded-postgres-no-pgvector.js";
import {
  handleVoiceAddonCheckout,
  handleVoiceAddonSubscriptionUpdated,
  VOICE_ADDON_PRODUCT,
} from "../services/university-stripe-handler.js";
import { voiceBudgetService, VOICE_FREE_SECONDS } from "../services/voice-budget.js";

const COMPANY_ID = "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";
const MEMBER_EMAIL = "voice-addon@test.dev";

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
    `Skipping university voice add-on test (embedded Postgres unavailable): ${
      support.reason ?? "unsupported"
    }`,
  );
}

describeDb("university voice add-on money path (integration)", () => {
  let db!: ReturnType<typeof createDb>;
  let cleanup: (() => Promise<void>) | null = null;
  let memberId!: string;

  beforeAll(async () => {
    process.env.TEAM_DASHBOARD_COMPANY_ID = COMPANY_ID;

    if (dbMode === "fullChain") {
      const tempDb = await startEmbeddedPostgresTestDatabase("university-voice-addon-");
      db = createDb(tempDb.connectionString);
      cleanup = tempDb.cleanup;
    } else {
      const tempDb = await startNoPgvectorTestDatabase("university-voice-addon-novec-");
      db = tempDb.db;
      cleanup = tempDb.cleanup;
    }

    await db
      .insert(companies)
      .values({ id: COMPANY_ID, name: "Coherence Daddy" })
      .onConflictDoNothing();

    // A durable member row for the suite — its id is the add-on's member_id.
    const inserted = await db
      .insert(universityMembers)
      .values({
        email: MEMBER_EMAIL,
        status: "active",
        plan: "university_monthly",
        joinedAt: new Date(),
      })
      .returning({ id: universityMembers.id });
    memberId = inserted[0].id;
  }, 60_000);

  afterEach(async () => {
    await db.delete(universityVoiceAddons);
  });

  afterAll(async () => {
    await db.delete(universityMembers);
    await cleanup?.();
  });

  function addonSession(subscriptionId: string, tier: "1hr" | "2p5hr") {
    return {
      id: `cs_${subscriptionId}`,
      subscription: subscriptionId,
      metadata: {
        product: VOICE_ADDON_PRODUCT,
        memberId,
        tier,
      },
    };
  }

  async function activeAddonRows() {
    return db
      .select()
      .from(universityVoiceAddons)
      .where(sql`member_id = ${memberId}`);
  }

  it("duplicate checkout.session.completed upserts EXACTLY ONE row (idempotency on stripe_subscription_id)", async () => {
    const first = await handleVoiceAddonCheckout(db, addonSession("sub_addon_dupe", "1hr"));
    expect(first).not.toBeNull();

    // Stripe re-delivers the SAME event (or the same subscription's checkout).
    const replay = await handleVoiceAddonCheckout(db, addonSession("sub_addon_dupe", "1hr"));
    expect(replay).not.toBeNull();

    const rows = await activeAddonRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].tier).toBe("1hr");
    expect(rows[0].status).toBe("active");
    // The upsert targets the same row → both calls resolve to the same id.
    expect(replay!.addonId).toBe(first!.addonId);
  });

  it("overlapping active add-ons grant the MAX seconds, never the SUM", async () => {
    // A brief upgrade window can leave two active rows for one member. The cap
    // takes the MAX (defensive non-additive), so a stray overlap never stacks.
    await handleVoiceAddonCheckout(db, addonSession("sub_addon_1hr", "1hr")); // 3600
    await handleVoiceAddonCheckout(db, addonSession("sub_addon_2p5hr", "2p5hr")); // 9000

    const rows = await activeAddonRows();
    expect(rows).toHaveLength(2);

    const svc = voiceBudgetService(db);
    const addonSeconds = await svc.addonSeconds(memberId);
    expect(addonSeconds).toBe(9000); // MAX
    expect(addonSeconds).not.toBe(3600 + 9000); // NOT the SUM

    const limit = await svc.voiceLimitSeconds(memberId);
    expect(limit).toBe(VOICE_FREE_SECONDS + 9000);
  });

  it("mapAddonStatus('past_due') is a no-op — the granted cap stays INTACT", async () => {
    await handleVoiceAddonCheckout(db, addonSession("sub_addon_pd", "2p5hr"));
    const svc = voiceBudgetService(db);
    expect(await svc.addonSeconds(memberId)).toBe(9000);

    // A transient dunning past_due must NOT flip the row to canceled / zero the
    // paid cap (matches the membership convention: past_due stays entitled).
    const res = await handleVoiceAddonSubscriptionUpdated(db, {
      id: "sub_addon_pd",
      status: "past_due",
    });
    expect(res.matched).toBe(1); // it IS ours (dispatcher won't fall through)

    const rows = await activeAddonRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active"); // untouched
    expect(await svc.addonSeconds(memberId)).toBe(9000); // cap intact
  });
});
