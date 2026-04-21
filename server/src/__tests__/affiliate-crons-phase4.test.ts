/**
 * Unit tests for Phase 4 affiliate cron handlers:
 *   - affiliate:tier-recompute        (05:00 UTC daily)
 *   - affiliate:leaderboard-snapshot  (06:00 UTC monthly, day 1)
 *   - affiliate:inactive-reengagement (14:00 UTC weekly, Monday)
 *   - affiliate:giveaway-eligibility  (06:30 UTC monthly, day 1)
 *
 * Strategy follows the Phase 2/3 pattern: mock `registerCronJob` + the email
 * transport, and wire a per-test Db stub that understands just enough of
 * drizzle's chain shape to drive the handler. We do NOT reproduce drizzle's
 * SQL-IR — each stub routes by the table that's queried (first positional
 * arg to `db.select(...).from(table)` / `db.update(table)` / `db.insert(table)`)
 * and applies a JS model of the handler's predicates.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAffiliateCrons } from "../services/affiliate-crons.ts";

// -----------------------------------------------------------------------------
// Shared mocks: cron registry + email transport
// -----------------------------------------------------------------------------

const registeredJobs = vi.hoisted(() => new Map<string, () => Promise<unknown>>());
const registeredDefs = vi.hoisted(
  () =>
    new Map<
      string,
      { jobName: string; schedule: string; ownerAgent: string; sourceFile: string }
    >(),
);

vi.mock("../services/cron-registry.js", () => ({
  registerCronJob: vi.fn(
    (def: {
      jobName: string;
      schedule: string;
      ownerAgent: string;
      sourceFile: string;
      handler: () => Promise<unknown>;
    }) => {
      registeredJobs.set(def.jobName, def.handler);
      registeredDefs.set(def.jobName, {
        jobName: def.jobName,
        schedule: def.schedule,
        ownerAgent: def.ownerAgent,
        sourceFile: def.sourceFile,
      });
    },
  ),
}));

const sendTransactionalMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock("../services/email-templates.js", () => ({
  sendTransactional: sendTransactionalMock,
}));

// -----------------------------------------------------------------------------
// Table-identity shims
// -----------------------------------------------------------------------------
//
// Each stub below needs to route by the *table* passed to select().from(...) or
// update(...) / insert(...). We can't cheaply import the real drizzle tables
// into the stub (they'd wire to the real schema client), so we use the
// identity of the imported symbol from @paperclipai/db and match on its
// reference. Since our stubs are fed the same modules the handler imports,
// the identity comparison works without binding to drizzle internals.

import {
  activityLog,
  affiliateEngagement,
  affiliateTiers,
  affiliates,
  commissions,
  companies,
  leaderboardSnapshots,
  partnerCompanies,
  promoCampaigns,
} from "@paperclipai/db";

// -----------------------------------------------------------------------------
// Tier-recompute stub
// -----------------------------------------------------------------------------

interface TierRow {
  id: string;
  name: string;
  displayOrder: number;
  commissionRate: string;
  minLifetimeCents: number;
  minActivePartners: number;
}

interface AffiliateRow {
  id: string;
  name: string;
  email: string;
  tier: string;
  commissionRate: string;
  lifetimeCents: number; // test fixture: pretend aggregate
  activeCount: number;   // test fixture: pretend aggregate
}

function createTierRecomputeStub(params: {
  tiers: TierRow[];
  affiliates: AffiliateRow[];
}) {
  const state = {
    tiers: params.tiers.map((t) => ({ ...t })),
    affiliates: params.affiliates.map((a) => ({ ...a })),
  };

  const updateSetCalls: Array<{ affiliateId: string; values: Record<string, unknown> }> = [];

  // Track which aggregate we're about to answer based on the last from(commissions) call.
  // The handler issues two aggregates per affiliate in order: lifetime sum, then
  // active-partners count with the partnerCompanies inner join.
  let pendingAffiliateId: string | null = null;
  let pendingAggregate: "lifetime" | "active" | null = null;

  const db: Record<string, unknown> = {
    select: vi.fn((_cols?: unknown) => {
      return {
        from(tbl: unknown) {
          if (tbl === affiliateTiers) {
            return Promise.resolve(state.tiers.map((t) => ({ ...t })));
          }
          if (tbl === affiliates) {
            return Promise.resolve(
              state.affiliates.map((a) => ({
                id: a.id,
                name: a.name,
                email: a.email,
                tier: a.tier,
                commissionRate: a.commissionRate,
              })),
            );
          }
          if (tbl === commissions) {
            // Lifetime aggregate path — select({ lifetimeCents }).from(commissions).where(eq(affiliateId,...))
            pendingAggregate = "lifetime";
            return {
              where(_cond: unknown) {
                // Inspect the where clause indirectly: the handler always passes
                // affiliateId eq literal — pending id is set from the current loop
                // iteration. We stash the id in the chain via a closure below.
                // The handler's test drives affiliateId through pendingAffiliateId,
                // which is set by the test helper before it invokes the handler
                // iteration. Since we iterate the whole list, we scan by
                // incrementing a counter instead.
                return Promise.resolve([
                  { lifetimeCents: state.affiliates[advanceLifetime()]?.lifetimeCents ?? 0 },
                ]);
              },
              innerJoin(_tbl: unknown, _cond: unknown) {
                pendingAggregate = "active";
                return {
                  where(_cond2: unknown) {
                    return Promise.resolve([
                      { activeCount: state.affiliates[advanceActive()]?.activeCount ?? 0 },
                    ]);
                  },
                };
              },
            };
          }
          return Promise.resolve([]);
        },
      };
    }),
    update: vi.fn((tbl: unknown) => {
      if (tbl === affiliates) {
        let pendingSet: Record<string, unknown> = {};
        const chain = {
          set(values: Record<string, unknown>) {
            pendingSet = values;
            return chain;
          },
          where(_cond: unknown) {
            // We can't parse eq(affiliates.id, x), so the handler's update
            // happens in-order for the affiliate currently being recomputed.
            const target = state.affiliates[updateCursor++];
            if (target) {
              updateSetCalls.push({ affiliateId: target.id, values: pendingSet });
              if (typeof pendingSet.tier === "string") target.tier = pendingSet.tier;
              if (typeof pendingSet.commissionRate === "string")
                target.commissionRate = pendingSet.commissionRate;
            }
            return Promise.resolve();
          },
        };
        return chain;
      }
      return { set: () => ({ where: () => Promise.resolve() }) };
    }),
  };

  // Counter cursors — the handler iterates affiliates in array order, issuing
  // (lifetime aggregate, then active aggregate) per row.
  let lifetimeCursor = 0;
  let activeCursor = 0;
  let updateCursor = 0;
  function advanceLifetime() {
    return lifetimeCursor++;
  }
  function advanceActive() {
    return activeCursor++;
  }

  // Silence unused vars — pendingAffiliateId / pendingAggregate are kept as
  // intent markers for future expansion, not driving logic today.
  void pendingAffiliateId;
  void pendingAggregate;

  return {
    db: db as unknown as import("@paperclipai/db").Db,
    state,
    updateSetCalls,
  };
}

// -----------------------------------------------------------------------------
// Leaderboard-snapshot stub
// -----------------------------------------------------------------------------

interface LeaderboardCommissionRow {
  affiliateId: string;
  score: number;
}

function createLeaderboardStub(params: {
  existingSnapshots: Array<{ period: string }>;
  ranked: LeaderboardCommissionRow[];
}) {
  const state = {
    existingSnapshots: [...params.existingSnapshots],
    insertedRows: [] as Array<Record<string, unknown>>,
  };

  const db = {
    select: vi.fn((_cols?: unknown) => {
      return {
        from(tbl: unknown) {
          if (tbl === leaderboardSnapshots) {
            return {
              where(_cond: unknown) {
                // Pre-check: count of existing snapshots.
                // We can't decode `period` from the eq cond without drizzle IR,
                // so we assume the pre-check is for the single `period` the
                // handler computes — and the test configures `existingSnapshots`
                // with the exact period (or empty for first-run).
                return Promise.resolve([{ count: state.existingSnapshots.length }]);
              },
            };
          }
          if (tbl === commissions) {
            // Rank pipeline: .where(...).groupBy(...).orderBy(...).limit(20)
            return {
              where(_cond: unknown) {
                return {
                  groupBy(_col: unknown) {
                    return {
                      orderBy(_sq: unknown) {
                        return {
                          limit(_n: number) {
                            return Promise.resolve(
                              params.ranked.map((r) => ({
                                affiliateId: r.affiliateId,
                                score: r.score,
                              })),
                            );
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }
          return Promise.resolve([]);
        },
      };
    }),
    insert: vi.fn((tbl: unknown) => ({
      values(rows: Array<Record<string, unknown>>) {
        if (tbl === leaderboardSnapshots) {
          for (const r of rows) state.insertedRows.push(r);
        }
        return Promise.resolve();
      },
    })),
  };

  return { db: db as unknown as import("@paperclipai/db").Db, state };
}

// -----------------------------------------------------------------------------
// Reengagement stub
// -----------------------------------------------------------------------------

interface ReengAffiliate {
  id: string;
  name: string;
  email: string;
  status: string;
  suspendedAt: Date | null;
  lastLeadSubmittedAt: Date | null;
  // Test fixture — when true, the activity_log throttle fires (recent row exists).
  recentlyEmailed: boolean;
  // Test fixture — when present, maps to a companyId via partnerCompanies.
  referredCompanyId?: string | null;
}

function createReengagementStub(params: {
  affiliates: ReengAffiliate[];
  fallbackCompanyId: string | null;
}) {
  const state = {
    affiliates: params.affiliates.map((a) => ({ ...a })),
    activityLogInserts: [] as Array<Record<string, unknown>>,
  };

  // The handler issues three reads per-candidate in order:
  //   1) activity_log throttle check (for this affiliate)
  //   2) partner_companies companyId lookup (for this affiliate)
  // Plus one upfront reads: companies fallback.
  // We drive cursors per-table to route answers.

  let activityLogCursor = 0;
  let partnerCompaniesCursor = 0;
  let affiliatesQueryIssued = false;

  // Filter to the candidates matching the handler's WHERE:
  // status='active' AND suspendedAt IS NULL AND (last<cutoff OR last IS NULL)
  const now = Date.now();
  const inactiveCutoff = now - 45 * 24 * 60 * 60 * 1000;
  const eligible = state.affiliates.filter(
    (a) =>
      a.status === "active" &&
      a.suspendedAt === null &&
      (a.lastLeadSubmittedAt === null || a.lastLeadSubmittedAt.getTime() < inactiveCutoff),
  );

  const db = {
    select: vi.fn((_cols?: unknown) => {
      return {
        from(tbl: unknown) {
          if (tbl === affiliates) {
            return {
              where(_cond: unknown) {
                affiliatesQueryIssued = true;
                return Promise.resolve(
                  eligible.map((a) => ({
                    id: a.id,
                    name: a.name,
                    email: a.email,
                    lastLeadSubmittedAt: a.lastLeadSubmittedAt,
                  })),
                );
              },
            };
          }
          if (tbl === companies) {
            return {
              limit(_n: number) {
                return Promise.resolve(
                  params.fallbackCompanyId ? [{ id: params.fallbackCompanyId }] : [],
                );
              },
            };
          }
          if (tbl === activityLog) {
            return {
              where(_cond: unknown) {
                return {
                  orderBy(_sq: unknown) {
                    return {
                      limit(_n: number) {
                        const aff = eligible[activityLogCursor++];
                        const fire = aff?.recentlyEmailed ?? false;
                        return Promise.resolve(fire ? [{ id: "recent-row" }] : []);
                      },
                    };
                  },
                };
              },
            };
          }
          if (tbl === partnerCompanies) {
            return {
              where(_cond: unknown) {
                return {
                  orderBy(_sq: unknown) {
                    return {
                      limit(_n: number) {
                        // Each partner-companies lookup corresponds to one
                        // non-throttled candidate iteration.
                        // Find the next eligible that isn't throttled.
                        while (
                          partnerCompaniesCursor < eligible.length &&
                          eligible[partnerCompaniesCursor]?.recentlyEmailed
                        ) {
                          partnerCompaniesCursor++;
                        }
                        const aff = eligible[partnerCompaniesCursor++];
                        if (!aff) return Promise.resolve([]);
                        if (aff.referredCompanyId) {
                          return Promise.resolve([{ companyId: aff.referredCompanyId }]);
                        }
                        return Promise.resolve([]);
                      },
                    };
                  },
                };
              },
            };
          }
          return Promise.resolve([]);
        },
      };
    }),
    insert: vi.fn((tbl: unknown) => ({
      values(payload: Record<string, unknown>) {
        if (tbl === activityLog) {
          state.activityLogInserts.push(payload);
        }
        return Promise.resolve();
      },
    })),
  };

  void affiliatesQueryIssued;

  return {
    db: db as unknown as import("@paperclipai/db").Db,
    state,
    eligible,
  };
}

// -----------------------------------------------------------------------------
// Giveaway stub
// -----------------------------------------------------------------------------

interface Campaign {
  id: string;
  name: string;
  endAt: Date;
  giveawayPrize: string | null;
}

interface EngagementWinner {
  engagementId: string;
  affiliateId: string;
  score: number;
  affiliateEmail: string;
  affiliateName: string;
}

function createGiveawayStub(params: {
  endedCampaigns: Campaign[];
  winnersByCampaign: Record<string, EngagementWinner[]>;
}) {
  const state = {
    updatedEngagementIds: [] as string[],
  };

  let campaignCursor = 0;

  const db = {
    select: vi.fn((_cols?: unknown) => {
      return {
        from(tbl: unknown) {
          if (tbl === promoCampaigns) {
            return {
              where(_cond: unknown) {
                return Promise.resolve(
                  params.endedCampaigns.map((c) => ({
                    id: c.id,
                    name: c.name,
                    giveawayPrize: c.giveawayPrize,
                  })),
                );
              },
            };
          }
          if (tbl === affiliateEngagement) {
            return {
              innerJoin(_tbl: unknown, _cond: unknown) {
                return {
                  where(_cond2: unknown) {
                    return {
                      orderBy(_sq: unknown) {
                        return {
                          limit(_n: number) {
                            const campaign = params.endedCampaigns[campaignCursor++];
                            if (!campaign) return Promise.resolve([]);
                            return Promise.resolve(
                              params.winnersByCampaign[campaign.id] ?? [],
                            );
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          }
          return Promise.resolve([]);
        },
      };
    }),
    update: vi.fn((tbl: unknown) => ({
      set(values: Record<string, unknown>) {
        return {
          where(_cond: unknown) {
            // Figure out which engagementIds were marked. We can't decode
            // the inArray condition, so we accumulate all engagementIds from
            // every campaign's winners list in order.
            if (tbl === affiliateEngagement && values.giveawayEligible === true) {
              // Append the winners for the most recent campaign whose SELECT
              // path we answered — we've advanced campaignCursor already, so
              // index = cursor - 1.
              const idx = Math.max(0, campaignCursor - 1);
              const campaign = params.endedCampaigns[idx];
              if (campaign) {
                const winners = params.winnersByCampaign[campaign.id] ?? [];
                for (const w of winners) state.updatedEngagementIds.push(w.engagementId);
              }
            }
            return Promise.resolve();
          },
        };
      },
    })),
  };

  return { db: db as unknown as import("@paperclipai/db").Db, state };
}

// =============================================================================
// Tests — affiliate:tier-recompute
// =============================================================================

const TIERS: TierRow[] = [
  {
    id: "tier-bronze",
    name: "bronze",
    displayOrder: 1,
    commissionRate: "0.1000",
    minLifetimeCents: 0,
    minActivePartners: 0,
  },
  {
    id: "tier-silver",
    name: "silver",
    displayOrder: 2,
    commissionRate: "0.1200",
    minLifetimeCents: 100_000,
    minActivePartners: 3,
  },
  {
    id: "tier-gold",
    name: "gold",
    displayOrder: 3,
    commissionRate: "0.1500",
    minLifetimeCents: 500_000,
    minActivePartners: 10,
  },
];

describe("affiliate:tier-recompute cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createTierRecomputeStub({ tiers: [], affiliates: [] });
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:tier-recompute");
    expect(def?.schedule).toBe("0 5 * * *");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("upgrades an affiliate when lifetime + active-partners cross a tier threshold", async () => {
    const affiliatesFixture: AffiliateRow[] = [
      // bronze → silver (lifetime 200_000, active 5)
      {
        id: "aff-upgrade",
        name: "Upgrade Alice",
        email: "alice@example.com",
        tier: "bronze",
        commissionRate: "0.1000",
        lifetimeCents: 200_000,
        activeCount: 5,
      },
    ];
    const { db, state, updateSetCalls } = createTierRecomputeStub({
      tiers: TIERS,
      affiliates: affiliatesFixture,
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:tier-recompute")!()) as {
      upgraded: number;
      checked: number;
    };

    expect(result.checked).toBe(1);
    expect(result.upgraded).toBe(1);
    expect(updateSetCalls).toHaveLength(1);
    expect(updateSetCalls[0]!.values.tier).toBe("silver");
    expect(updateSetCalls[0]!.values.commissionRate).toBe("0.1200");
    expect(state.affiliates[0]!.tier).toBe("silver");

    // Email to new tier
    expect(sendTransactionalMock).toHaveBeenCalledTimes(1);
    const call = sendTransactionalMock.mock.calls[0]!;
    expect(call[0]).toBe("affiliate-tier-upgraded");
    expect(call[1]).toBe("alice@example.com");
  });

  it("does NOT downgrade when the affiliate no longer meets their current tier's floor", async () => {
    // Affiliate is currently gold but lifetime dropped to silver-level.
    // Handler must never issue a downgrade update.
    const affiliatesFixture: AffiliateRow[] = [
      {
        id: "aff-gold-slip",
        name: "Gold Slipping",
        email: "gold@example.com",
        tier: "gold",
        commissionRate: "0.1500",
        lifetimeCents: 150_000, // silver tier territory
        activeCount: 4,
      },
    ];
    const { db, state, updateSetCalls } = createTierRecomputeStub({
      tiers: TIERS,
      affiliates: affiliatesFixture,
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:tier-recompute")!()) as {
      upgraded: number;
      checked: number;
    };

    expect(result.checked).toBe(1);
    expect(result.upgraded).toBe(0);
    expect(updateSetCalls).toHaveLength(0);
    expect(state.affiliates[0]!.tier).toBe("gold");
    expect(sendTransactionalMock).not.toHaveBeenCalled();
  });

  it("is a no-op when tier config is empty (safety guard)", async () => {
    const { db } = createTierRecomputeStub({
      tiers: [],
      affiliates: [
        {
          id: "aff-x",
          name: "X",
          email: "x@example.com",
          tier: "bronze",
          commissionRate: "0.1000",
          lifetimeCents: 10_000_000,
          activeCount: 50,
        },
      ],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:tier-recompute")!()) as {
      upgraded: number;
      checked: number;
    };
    expect(result.upgraded).toBe(0);
    expect(result.checked).toBe(0);
  });
});

// =============================================================================
// Tests — affiliate:leaderboard-snapshot
// =============================================================================

describe("affiliate:leaderboard-snapshot cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createLeaderboardStub({ existingSnapshots: [], ranked: [] });
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:leaderboard-snapshot");
    expect(def?.schedule).toBe("0 6 1 * *");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("inserts ranked rows for the prior month when none exist", async () => {
    const { db, state } = createLeaderboardStub({
      existingSnapshots: [],
      ranked: [
        { affiliateId: "aff-1", score: 5_000 },
        { affiliateId: "aff-2", score: 3_000 },
        { affiliateId: "aff-3", score: 1_500 },
      ],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:leaderboard-snapshot")!()) as {
      period: string;
      inserted: number;
      skipped: boolean;
    };

    expect(result.inserted).toBe(3);
    expect(result.skipped).toBe(false);
    expect(state.insertedRows).toHaveLength(3);
    expect(state.insertedRows[0]!.rank).toBe(1);
    expect(state.insertedRows[0]!.affiliateId).toBe("aff-1");
    expect(state.insertedRows[2]!.rank).toBe(3);
  });

  it("is idempotent — skips when snapshot rows already exist for the period", async () => {
    const { db, state } = createLeaderboardStub({
      existingSnapshots: [{ period: "2026-03" }, { period: "2026-03" }],
      ranked: [{ affiliateId: "aff-1", score: 5_000 }],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:leaderboard-snapshot")!()) as {
      period: string;
      inserted: number;
      skipped: boolean;
    };

    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(true);
    expect(state.insertedRows).toHaveLength(0);
  });

  it("handles empty month cleanly", async () => {
    const { db, state } = createLeaderboardStub({
      existingSnapshots: [],
      ranked: [],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:leaderboard-snapshot")!()) as {
      inserted: number;
      skipped: boolean;
    };
    expect(result.inserted).toBe(0);
    expect(result.skipped).toBe(false);
    expect(state.insertedRows).toHaveLength(0);
  });
});

// =============================================================================
// Tests — affiliate:inactive-reengagement
// =============================================================================

describe("affiliate:inactive-reengagement cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createReengagementStub({
      affiliates: [],
      fallbackCompanyId: "co-1",
    });
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:inactive-reengagement");
    expect(def?.schedule).toBe("0 14 * * 1");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("emails eligible affiliates and writes activity_log for throttle tracking", async () => {
    const now = Date.now();
    const oneYearAgo = new Date(now - 365 * 24 * 60 * 60 * 1000);

    const { db, state } = createReengagementStub({
      fallbackCompanyId: "co-fallback",
      affiliates: [
        {
          id: "aff-stale-a",
          name: "Stale A",
          email: "a@example.com",
          status: "active",
          suspendedAt: null,
          lastLeadSubmittedAt: oneYearAgo,
          recentlyEmailed: false,
          referredCompanyId: "co-partner-a",
        },
        {
          id: "aff-never-submitted",
          name: "Never B",
          email: "b@example.com",
          status: "active",
          suspendedAt: null,
          lastLeadSubmittedAt: null,
          recentlyEmailed: false,
          referredCompanyId: null, // falls through to fallbackCompanyId
        },
      ],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:inactive-reengagement")!()) as {
      emailed: number;
      throttled: number;
      skipped: number;
    };

    expect(result.emailed).toBe(2);
    expect(result.throttled).toBe(0);
    expect(result.skipped).toBe(0);

    // One activity_log row per email.
    expect(state.activityLogInserts).toHaveLength(2);
    for (const row of state.activityLogInserts) {
      expect(row.action).toBe("affiliate_reengagement_email");
      expect(row.entityType).toBe("affiliate");
      expect(row.actorType).toBe("system");
      expect(row.companyId).toBeTruthy();
    }

    expect(sendTransactionalMock).toHaveBeenCalledTimes(2);
    const templates = sendTransactionalMock.mock.calls.map((c) => c[0]);
    expect(templates.every((t) => t === "affiliate-reengagement")).toBe(true);
  });

  it("throttles affiliates emailed within the last 30 days", async () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const { db, state } = createReengagementStub({
      fallbackCompanyId: "co-fallback",
      affiliates: [
        {
          id: "aff-throttled",
          name: "Throttled",
          email: "t@example.com",
          status: "active",
          suspendedAt: null,
          lastLeadSubmittedAt: oneYearAgo,
          recentlyEmailed: true, // activity_log says we emailed within 30d
          referredCompanyId: "co-partner-t",
        },
      ],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:inactive-reengagement")!()) as {
      emailed: number;
      throttled: number;
      skipped: number;
    };

    expect(result.emailed).toBe(0);
    expect(result.throttled).toBe(1);
    expect(result.skipped).toBe(0);
    expect(state.activityLogInserts).toHaveLength(0);
    expect(sendTransactionalMock).not.toHaveBeenCalled();
  });

  it("excludes suspended affiliates from candidates", async () => {
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

    const { db } = createReengagementStub({
      fallbackCompanyId: "co-fallback",
      affiliates: [
        {
          id: "aff-suspended",
          name: "Suspended",
          email: "s@example.com",
          status: "active",
          suspendedAt: new Date(),
          lastLeadSubmittedAt: oneYearAgo,
          recentlyEmailed: false,
          referredCompanyId: "co-partner-s",
        },
      ],
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:inactive-reengagement")!()) as {
      emailed: number;
      throttled: number;
      skipped: number;
    };
    expect(result.emailed).toBe(0);
    expect(sendTransactionalMock).not.toHaveBeenCalled();
  });
});

// =============================================================================
// Tests — affiliate:giveaway-eligibility
// =============================================================================

describe("affiliate:giveaway-eligibility cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createGiveawayStub({
      endedCampaigns: [],
      winnersByCampaign: {},
    });
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:giveaway-eligibility");
    expect(def?.schedule).toBe("30 6 1 * *");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("marks top engagement rows eligible and emails winners per campaign", async () => {
    const campaigns: Campaign[] = [
      {
        id: "camp-1",
        name: "Spring Promo",
        endAt: new Date("2026-03-15T00:00:00.000Z"),
        giveawayPrize: "T-Shirt",
      },
    ];
    const winnersByCampaign = {
      "camp-1": [
        {
          engagementId: "eng-1",
          affiliateId: "aff-a",
          score: 100,
          affiliateEmail: "a@example.com",
          affiliateName: "A",
        },
        {
          engagementId: "eng-2",
          affiliateId: "aff-b",
          score: 90,
          affiliateEmail: "b@example.com",
          affiliateName: "B",
        },
      ],
    };
    const { db, state } = createGiveawayStub({
      endedCampaigns: campaigns,
      winnersByCampaign,
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:giveaway-eligibility")!()) as {
      campaigns: number;
      winners: number;
      emailsSent: number;
      emailsFailed: number;
    };

    expect(result.campaigns).toBe(1);
    expect(result.winners).toBe(2);
    expect(result.emailsSent).toBe(2);
    expect(result.emailsFailed).toBe(0);

    // Engagement rows marked eligible.
    expect(state.updatedEngagementIds.sort()).toEqual(["eng-1", "eng-2"]);

    // Emails fired to both winners.
    const toAddrs = sendTransactionalMock.mock.calls.map((c) => c[1]).sort();
    expect(toAddrs).toEqual(["a@example.com", "b@example.com"]);
    for (const call of sendTransactionalMock.mock.calls) {
      expect(call[0]).toBe("affiliate-giveaway-winner");
    }
  });

  it("is a no-op when no campaigns ended in the prior month", async () => {
    const { db } = createGiveawayStub({
      endedCampaigns: [],
      winnersByCampaign: {},
    });
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:giveaway-eligibility")!()) as {
      campaigns: number;
      winners: number;
    };
    expect(result.campaigns).toBe(0);
    expect(result.winners).toBe(0);
    expect(sendTransactionalMock).not.toHaveBeenCalled();
  });
});
