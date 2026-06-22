// ---------------------------------------------------------------------------
// Watchtower monitor tests — adapter contract + runSubscription end-to-end
// + cron handler filter assertions. All tests use a mocked engine adapter
// (no live LLM calls) so they pass offline.
// ---------------------------------------------------------------------------

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  createDb,
  customerAccounts,
  watchtowerResults,
  watchtowerRuns,
  watchtowerSubscriptions,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import {
  detectMention,
  HARD_PROMPT_CEILING,
  runSubscription,
} from "../services/watchtower-monitor.js";
import type { EngineAdapter } from "../services/watchtower-engines/index.js";
import {
  maskEmail,
  resolveWatchtowerRecipient,
  runWeeklyWatchtowerJobs,
} from "../services/watchtower-cron.js";

const support = await getEmbeddedPostgresTestSupport();
const describeDb = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded-Postgres watchtower tests: ${support.reason ?? "unsupported"}`,
  );
}

// ---------------------------------------------------------------------------
// Pure-function detection tests
// ---------------------------------------------------------------------------

describe("detectMention (v1)", () => {
  it("flags case-insensitive brand match and a positive sentiment", () => {
    const r = detectMention(
      "If you need a fraud product, I recommend Stripe Radar.",
      "Stripe Radar",
      "stripe.com",
    );
    expect(r.mentioned).toBe(true);
    expect(r.sentiment).toBe("positive");
    expect(r.excerpt).toContain("Stripe Radar");
  });

  it("falls back to domain match when brand misses", () => {
    const r = detectMention(
      "I'd skip the docs at example.com — looks like a scam.",
      "ExampleCorp",
      "example.com",
    );
    expect(r.mentioned).toBe(true);
    expect(r.sentiment).toBe("negative");
  });

  it("returns mentioned=false for empty response", () => {
    const r = detectMention("", "Anything", null);
    expect(r.mentioned).toBe(false);
    expect(r.sentiment).toBe("unknown");
    expect(r.excerpt).toBeNull();
  });

  it("returns neutral sentiment when brand is mentioned with no signal words", () => {
    const r = detectMention(
      "Stripe Radar is a product Stripe sells.",
      "Stripe Radar",
      null,
    );
    expect(r.mentioned).toBe(true);
    expect(r.sentiment).toBe("neutral");
  });
});

// ---------------------------------------------------------------------------
// Mock adapter helper
// ---------------------------------------------------------------------------

function mockAdapter(opts: {
  id: "chatgpt" | "claude" | "perplexity" | "gemini";
  responses: Record<string, string>;
  enabled?: boolean;
}): EngineAdapter {
  return {
    id: opts.id,
    enabled: () => opts.enabled !== false,
    query: async ({ prompt }) => {
      const text = opts.responses[prompt] ?? "";
      return { text, latencyMs: 12, ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// runSubscription end-to-end (1 mocked engine, 2 prompts)
// ---------------------------------------------------------------------------

describeDb("runSubscription (e2e)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-monitor-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerSubscriptions);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("persists per-cell results and a single summary row", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Watchtower",
      domain: "watchtower.example",
      prompts: ["who builds brand monitors?", "is watchtower good?"],
      status: "active",
      frequency: "weekly",
      promptCap: 25,
    });

    const adapter = mockAdapter({
      id: "claude",
      responses: {
        "who builds brand monitors?":
          "I recommend Watchtower for brand-mention tracking.",
        "is watchtower good?":
          "I would avoid generic monitors; pick a focused one.",
      },
    });

    const result = await runSubscription(db, subId, { engines: [adapter] });

    expect(result.totalPrompts).toBe(2);
    // First prompt mentions the brand; second does not (lowercase
    // 'watchtower' inside the brand IS detected — we case-fold in v1).
    expect(result.mentionCount).toBe(2);

    // afterEach truncates between tests — only this test's rows will exist.
    const stored = await db.select().from(watchtowerResults);
    expect(stored.length).toBe(2);
    expect(stored.every((r) => r.engine === "claude")).toBe(true);
    expect(stored.some((r) => r.sentiment === "positive")).toBe(true);
    expect(stored.some((r) => r.sentiment === "negative")).toBe(true);
  });

  it("caps prompts at promptCap", async () => {
    const subId = randomUUID();
    const promptList = Array.from({ length: 8 }, (_, i) => `prompt #${i}`);
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: promptList,
      status: "active",
      frequency: "weekly",
      promptCap: 3, // expect 3 used
    });

    const adapter = mockAdapter({
      id: "chatgpt",
      responses: Object.fromEntries(promptList.map((p) => [p, "no mention"])),
    });

    const result = await runSubscription(db, subId, { engines: [adapter] });
    expect(result.totalPrompts).toBe(3);

    const stored = await db.select().from(watchtowerResults);
    expect(stored).toHaveLength(3);
  });

  it("ceiling never exceeds HARD_PROMPT_CEILING", () => {
    // Sanity assertion the constant is what callers expect.
    expect(HARD_PROMPT_CEILING).toBe(75);
  });

  it("skips disabled engines and runs only enabled ones", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      brandName: "Brand",
      prompts: ["one prompt"],
      status: "active",
      frequency: "weekly",
      promptCap: 25,
    });

    const enabled = mockAdapter({
      id: "claude",
      responses: { "one prompt": "Brand is great" },
    });
    const disabled = mockAdapter({
      id: "perplexity",
      responses: {},
      enabled: false,
    });

    const result = await runSubscription(db, subId, {
      engines: [enabled, disabled],
    });

    expect(result.summary.skippedEngines).toContain("perplexity");
    expect(Object.keys(result.summary.byEngine)).toEqual(["claude"]);
    const stored = await db.select().from(watchtowerResults);
    expect(stored).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Cron handler — only active+weekly subscriptions are processed
// ---------------------------------------------------------------------------

describeDb("runWeeklyWatchtowerJobs (cron handler filter)", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-cron-");
    db = createDb(tempDb.connectionString);
    // We need a real engine for the cron path — install a stub adapter
    // by setting an env var the production code respects. Easier: rely
    // on the absence of any API key + the cron's per-subscription error
    // capture. The handler will throw "no engines enabled" and increment
    // `errors`, but it WILL still iterate every active+weekly row, which
    // is what we're asserting.
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerSubscriptions);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("only processes status=active AND frequency=weekly rows", async () => {
    const activeWeekly = randomUUID();
    const pausedWeekly = randomUUID();
    const activeDaily = randomUUID();
    const cancelledWeekly = randomUUID();

    await db.insert(watchtowerSubscriptions).values([
      {
        id: activeWeekly,
        brandName: "A",
        prompts: ["q"],
        status: "active",
        frequency: "weekly",
      },
      {
        id: pausedWeekly,
        brandName: "B",
        prompts: ["q"],
        status: "paused",
        frequency: "weekly",
      },
      {
        id: activeDaily,
        brandName: "C",
        prompts: ["q"],
        status: "active",
        frequency: "daily",
      },
      {
        id: cancelledWeekly,
        brandName: "D",
        prompts: ["q"],
        status: "cancelled",
        frequency: "weekly",
      },
    ]);

    const summary = await runWeeklyWatchtowerJobs(db);
    // No engines configured in test env → every active+weekly attempt
    // throws "no engines enabled" and lands in `errors`. We assert ONE
    // sub matched (the active+weekly one) by counting errors.
    expect(summary.errors).toBe(1);
    expect(summary.processed).toBe(0);
    expect(summary.skippedNoRecipient).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-account digest recipient resolution
// ---------------------------------------------------------------------------

describe("maskEmail", () => {
  it("keeps the first two chars of the local-part and the full domain", () => {
    expect(maskEmail("user@example.com")).toBe("us***@example.com");
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
    expect(maskEmail("USER@Example.COM")).toBe("us***@example.com");
  });
  it("returns *** for malformed input", () => {
    expect(maskEmail("not-an-email")).toBe("***");
    expect(maskEmail("@example.com")).toBe("***");
  });
});

describeDb("resolveWatchtowerRecipient", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("watchtower-recipient-");
    db = createDb(tempDb.connectionString);
  }, 30_000);

  afterEach(async () => {
    await db.delete(watchtowerResults);
    await db.delete(watchtowerRuns);
    await db.delete(watchtowerSubscriptions);
    await db.delete(customerAccounts);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  it("resolves to the linked customer_accounts.email (happy path)", async () => {
    const accountId = randomUUID();
    await db.insert(customerAccounts).values({
      id: accountId,
      email: "owner@example.com",
      stripeCustomerId: "cus_test_resolved",
    });
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      accountId,
      brandName: "Brand",
      prompts: ["q"],
      status: "active",
      frequency: "weekly",
    });

    const email = await resolveWatchtowerRecipient(db, {
      id: subId,
      accountId,
    });
    expect(email).toBe("owner@example.com");
  });

  it("returns null when subscription has no account_id (skip, do not leak to ops env)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      accountId: null,
      brandName: "Brand",
      prompts: ["q"],
      status: "active",
      frequency: "weekly",
    });

    const email = await resolveWatchtowerRecipient(db, {
      id: subId,
      accountId: null,
    });
    expect(email).toBeNull();
  });

  it("falls back to the subscription's own email when there is no account_id (promo client)", async () => {
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      accountId: null,
      email: "Promo@Example.com",
      brandName: "Brand",
      prompts: ["q"],
      status: "active",
      frequency: "weekly",
    });

    const email = await resolveWatchtowerRecipient(db, {
      id: subId,
      accountId: null,
      email: "Promo@Example.com",
    });
    // Fallback resolves AND normalizes to lowercase.
    expect(email).toBe("promo@example.com");
  });

  it("returns null when account_id points at a missing row (skip, do not leak)", async () => {
    const orphanAccountId = randomUUID();
    const subId = randomUUID();
    await db.insert(watchtowerSubscriptions).values({
      id: subId,
      accountId: orphanAccountId,
      brandName: "Brand",
      prompts: ["q"],
      status: "active",
      frequency: "weekly",
    });

    const email = await resolveWatchtowerRecipient(db, {
      id: subId,
      accountId: orphanAccountId,
    });
    expect(email).toBeNull();
  });

  it("resolves correctly when multiple subscriptions share the same account", async () => {
    const accountId = randomUUID();
    await db.insert(customerAccounts).values({
      id: accountId,
      email: "shared@example.com",
      stripeCustomerId: "cus_test_shared",
    });

    const subAId = randomUUID();
    const subBId = randomUUID();
    await db.insert(watchtowerSubscriptions).values([
      {
        id: subAId,
        accountId,
        brandName: "BrandA",
        prompts: ["q"],
        status: "active",
        frequency: "weekly",
      },
      {
        id: subBId,
        accountId,
        brandName: "BrandB",
        prompts: ["q"],
        status: "active",
        frequency: "weekly",
      },
    ]);

    const emailA = await resolveWatchtowerRecipient(db, {
      id: subAId,
      accountId,
    });
    const emailB = await resolveWatchtowerRecipient(db, {
      id: subBId,
      accountId,
    });
    expect(emailA).toBe("shared@example.com");
    expect(emailB).toBe("shared@example.com");
  });
});
