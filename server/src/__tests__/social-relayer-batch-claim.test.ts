// ---------------------------------------------------------------------------
// Regression test for the social relayer's BATCH-CLAIM query, run against a
// REAL (embedded) Postgres + the postgres.js driver.
//
// THE BUG (fixed in PR #113): after picking due rows, the relayer claims them
// by marking them 'publishing'. The original implementation did this in ONE
// statement:
//     UPDATE social_posts SET status='publishing' WHERE id = ANY(${ids})
// where `ids` is a JS array. drizzle expands an interpolated JS array into a
// parenthesised row, so against the real postgres.js driver this compiles to
// `... WHERE id = ANY(($1, $2))` and Postgres throws
//     PostgresError: malformed array literal
// for ANY non-empty batch — i.e. on the happy path, every time >=1 post was due.
// Adding a `::uuid[]` cast (PR #111) did NOT help: `ANY(($1,$2)::uuid[])` is the
// same malformed row-cast. PR #113 fixed it by claiming rows in a SCALAR loop
// (`WHERE id = ${id}`).
//
// WHY 928 TESTS MISSED IT: every pre-existing relayer test used a MOCK
// db.execute() (see social-relayer-media-staging.test.ts) that records the SQL
// string but never parses it or binds params — so the array-binding error,
// which only the real driver raises, could never surface. This test closes that
// gap: it exercises the populated-batch path (>=2 due rows) against real
// Postgres and asserts the rows are claimed + dispatched with no driver error.
// Run against the buggy ANY(${ids}) form it fails with `malformed array literal`.
//
// Like every embedded-Postgres test in this repo, it self-skips on hosts whose
// embedded Postgres lacks the pgvector extension (the full migration chain needs
// vector(1024) columns); it runs in CI where pgvector is present.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { companies, createDb, socialAccounts, socialPosts } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

// social-relayer reads TEAM_DASHBOARD_COMPANY_ID at call time; set before import.
process.env.TEAM_DASHBOARD_COMPANY_ID = "company-1";

// Only the DATABASE is real here — that is the whole point, since only a real
// driver raises the array-binding error. The publisher, the daily-cap check and
// the R2 stager are mocked so the tick stays offline and deterministic.
const publishTextMock = vi.fn(async () => ({
  success: true,
  platformPostId: "zp1",
  platformUrl: "https://example.test/p/1",
}));
vi.mock("../services/platform-publishers/index.js", () => ({
  getPublisher: () => ({
    name: "instagram",
    isConfigured: () => true,
    publish: async () => ({ success: false }),
    publishText: publishTextMock,
  }),
}));
vi.mock("../services/socials/platform-caps.js", () => ({
  canPublish: async () => ({ allowed: true, used: 0, cap: 100 }),
}));
vi.mock("../storage/r2-staging.js", () => ({
  isAlreadyPublicUrl: (u: string) => /^https?:\/\//i.test(u),
  isR2StagingConfigured: () => true,
  stageBufferToR2: async () => "https://pub-test.r2.dev/x.mp4",
}));

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;
if (!support.supported) {
  console.warn(
    `Skipping social-relayer batch-claim test on this host: ${support.reason ?? "embedded Postgres unsupported"}`,
  );
}

let runSocialRelayerTick: typeof import("../services/social-relayer.js").runSocialRelayerTick;

// Posts seeded with empty media never hit storage (resolveMediaUrls returns
// early), so a throwing stub doubles as an assertion that no staging happened.
const noopStorage = {
  getObject: async () => {
    throw new Error("storageService must not be called for empty media");
  },
} as never;

describeDb("social-relayer batch claim (real Postgres)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-relayer-claim-");
    db = createDb(tempDb.connectionString);
    ({ runSocialRelayerTick } = await import("../services/social-relayer.js"));
  }, 60_000);

  afterEach(async () => {
    await db.delete(socialPosts);
    await db.delete(socialAccounts);
    await db.delete(companies);
    publishTextMock.mockClear();
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedDuePosts(count: number): Promise<string[]> {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Paperclip",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const accountId = randomUUID();
    await db.insert(socialAccounts).values({
      id: accountId,
      companyId,
      brand: "coherencedaddy",
      platform: "instagram",
      handle: "@coherencedaddy",
      connectionType: "oauth",
      oauthRef: "zernio:acct_1",
      status: "active",
    });
    const past = new Date(Date.now() - 60_000);
    const ids: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await db.insert(socialPosts).values({
        id,
        socialAccountId: accountId,
        text: `due post ${i}`,
        mediaUrls: [],
        altTexts: [],
        scheduledAt: past,
        status: "scheduled",
      });
    }
    return ids;
  }

  it("claims + dispatches a populated batch (>=2 due rows) with no driver error", async () => {
    const ids = await seedDuePosts(3);

    // Pre-fix, the claim UPDATE threw `malformed array literal` HERE, before any
    // post could dispatch — so this call rejecting is the regression signal.
    const res = await runSocialRelayerTick(db, noopStorage);

    expect(res.picked).toBe(3);
    expect(res.posted).toBe(3);
    expect(res.failed).toBe(0);
    expect(publishTextMock).toHaveBeenCalledTimes(3);

    // Every seeded row was claimed out of 'scheduled' and dispatched to 'posted'.
    const rows = await db
      .select({ id: socialPosts.id, status: socialPosts.status })
      .from(socialPosts);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.status === "posted")).toBe(true);
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(ids));
  });
});
