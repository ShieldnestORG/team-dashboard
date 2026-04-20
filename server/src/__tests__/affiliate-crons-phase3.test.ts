/**
 * Unit tests for Phase 3 affiliate cron handlers:
 *   - affiliate:lead-expiration  (03:30 UTC)
 *   - affiliate:lock-expiration  (03:45 UTC)
 *
 * Strategy mirrors the Phase 2 pattern used in affiliate-crons.test.ts:
 * we mock `registerCronJob` to capture handler functions, mock the email
 * transport, and stub the Db chain. The stub understands drizzle's
 * update/insert/select chains at a structural level — just enough to
 * verify the handler's intent.
 *
 * We intentionally do NOT reproduce drizzle's SQL-IR — we assert against
 * a JS-level model of the handler's predicates and the side-effect calls
 * (crm_activities inserts, sendTransactional calls).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { startAffiliateCrons } from "../services/affiliate-crons.ts";

// -----------------------------------------------------------------------------
// Shared mock: cron registry + email transport
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
// Lead-expiration stub
// -----------------------------------------------------------------------------
//
// The handler issues 3 UPDATE chains (one per status transition), each followed
// by an INSERT into crm_activities if any rows returned. The stub records:
//   - the `set` values per update (so we can assert to-status + timestamps)
//   - the returned rows (dictated by our fixture matcher)
//   - every insert payload (so we can inspect the crm_activities rows)
//
// We encode each transition's expected from-status by tagging the stub state
// with the SET value's leadStatus, which maps 1:1 to the transition.

interface PartnerRow {
  id: string;
  leadStatus: string;
  createdAt: Date;
  pipelineEnteredAt: Date | null;
  lastActivityAt: Date | null;
}

function createLeadExpirationStub(partners: PartnerRow[], now: Date) {
  const state = { partners: partners.map((r) => ({ ...r })) };
  const updateCalls: Array<{ toStatus: string; ids: string[] }> = [];
  const insertCalls: Array<Array<Record<string, unknown>>> = [];

  const ageRef = (row: PartnerRow): Date =>
    row.lastActivityAt ?? row.pipelineEnteredAt ?? row.createdAt;

  const expectedTransitions: Array<{
    from: string;
    to: string;
    ageDays: number;
  }> = [
    { from: "submitted", to: "expired", ageDays: 7 },
    { from: "demo_scheduled", to: "nurture", ageDays: 14 },
    { from: "proposal_sent", to: "nurture", ageDays: 30 },
  ];

  let updateIndex = 0;

  const db = {
    update: vi.fn(() => {
      let pendingSet: Record<string, unknown> | null = null;
      const chain = {
        set(values: Record<string, unknown>) {
          pendingSet = values;
          return chain;
        },
        where(_cond: unknown) {
          return {
            async returning(_cols: unknown) {
              // Identify which transition this update belongs to by the toStatus
              // set value — unambiguous because each transition has a unique
              // (fromStatus, toStatus) pair in the handler.
              const toStatus = pendingSet?.leadStatus as string | undefined;
              const transition = expectedTransitions.find((t) => t.to === toStatus && t === expectedTransitions[updateIndex]);
              updateIndex += 1;
              if (!transition) return [];

              const cutoff = now.getTime() - transition.ageDays * 24 * 60 * 60 * 1000;
              const matched: Array<{ id: string }> = [];
              for (const row of state.partners) {
                if (row.leadStatus !== transition.from) continue;
                if (ageRef(row).getTime() >= cutoff) continue;
                row.leadStatus = transition.to;
                row.lastActivityAt = now;
                matched.push({ id: row.id });
              }
              updateCalls.push({ toStatus: transition.to, ids: matched.map((r) => r.id) });
              return matched;
            },
          };
        },
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      async values(rows: Array<Record<string, unknown>>) {
        insertCalls.push(rows);
      },
    })),
  };

  return {
    db: db as unknown as import("@paperclipai/db").Db,
    state,
    updateCalls,
    insertCalls,
  };
}

// -----------------------------------------------------------------------------
// Lock-expiration stub
// -----------------------------------------------------------------------------
//
// The handler:
//   1. SELECT candidate rows (join attribution + affiliates + partner_companies)
//   2. UPDATE attribution.lockReleasedAt for those ids (re-checking IS NULL)
//   3. INSERT crm_activities rows for actually-released leads
//   4. For each released row, sendTransactional('affiliate-lock-expired', ...)
//
// We supply a fixture of candidates and verify (a) only the ones whose leadStatus
// is NOT in the progressed set get released, (b) crm_activities insert includes
// all released leadIds, (c) sendTransactional fires once per released row.

interface CandidateRow {
  attributionId: string;
  leadId: string;
  affiliateId: string;
  affiliateEmail: string;
  affiliateName: string;
  leadName: string;
  leadStatus: string | null;
  lockExpiresAt: Date;
  lockReleasedAt: Date | null;
}

const PROGRESSED = new Set([
  "contacted",
  "awaiting_response",
  "interested",
  "demo_scheduled",
  "proposal_sent",
  "negotiation",
  "won",
]);

function createLockExpirationStub(rows: CandidateRow[], now: Date) {
  const state = { rows: rows.map((r) => ({ ...r })) };
  const insertCalls: Array<Array<Record<string, unknown>>> = [];

  const eligible = () =>
    state.rows.filter(
      (r) =>
        r.lockReleasedAt === null &&
        r.lockExpiresAt.getTime() < now.getTime() &&
        (r.leadStatus === null || !PROGRESSED.has(r.leadStatus)),
    );

  const db = {
    select: vi.fn(() => ({
      from: () => ({
        innerJoin: () => ({
          innerJoin: () => ({
            where: (_cond: unknown) =>
              Promise.resolve(
                eligible().map((r) => ({
                  attributionId: r.attributionId,
                  leadId: r.leadId,
                  affiliateId: r.affiliateId,
                  affiliateEmail: r.affiliateEmail,
                  affiliateName: r.affiliateName,
                  leadName: r.leadName,
                  leadStatus: r.leadStatus,
                })),
              ),
          }),
        }),
      }),
    })),
    update: vi.fn(() => {
      let pendingSet: Record<string, unknown> | null = null;
      const chain = {
        set(values: Record<string, unknown>) {
          pendingSet = values;
          return chain;
        },
        where(_cond: unknown) {
          return {
            async returning(_cols: unknown) {
              // Mark only eligible-still rows as released.
              const released: Array<{ id: string }> = [];
              for (const r of state.rows) {
                if (r.lockReleasedAt !== null) continue;
                if (r.lockExpiresAt.getTime() >= now.getTime()) continue;
                if (r.leadStatus && PROGRESSED.has(r.leadStatus)) continue;
                if (pendingSet?.lockReleasedAt !== undefined) {
                  r.lockReleasedAt = pendingSet.lockReleasedAt as Date;
                }
                released.push({ id: r.attributionId });
              }
              return released;
            },
          };
        },
      };
      return chain;
    }),
    insert: vi.fn(() => ({
      async values(payload: Array<Record<string, unknown>>) {
        insertCalls.push(payload);
      },
    })),
  };

  return {
    db: db as unknown as import("@paperclipai/db").Db,
    state,
    insertCalls,
  };
}

// -----------------------------------------------------------------------------
// Tests — affiliate:lead-expiration
// -----------------------------------------------------------------------------

describe("affiliate:lead-expiration cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createLeadExpirationStub([], new Date());
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:lead-expiration");
    expect(def?.schedule).toBe("30 3 * * *");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("transitions stale leads across all three pipeline buckets", async () => {
    const now = new Date("2026-04-20T03:30:00.000Z");
    const ms = (days: number) => days * 24 * 60 * 60 * 1000;

    const partners: PartnerRow[] = [
      // submitted > 7d → expired
      {
        id: "lead-stale-submitted",
        leadStatus: "submitted",
        createdAt: new Date(now.getTime() - ms(10)),
        pipelineEnteredAt: new Date(now.getTime() - ms(10)),
        lastActivityAt: null,
      },
      // submitted fresh → stays
      {
        id: "lead-fresh-submitted",
        leadStatus: "submitted",
        createdAt: new Date(now.getTime() - ms(3)),
        pipelineEnteredAt: new Date(now.getTime() - ms(3)),
        lastActivityAt: null,
      },
      // demo_scheduled > 14d → nurture
      {
        id: "lead-stale-demo",
        leadStatus: "demo_scheduled",
        createdAt: new Date(now.getTime() - ms(30)),
        pipelineEnteredAt: new Date(now.getTime() - ms(30)),
        lastActivityAt: new Date(now.getTime() - ms(20)),
      },
      // demo_scheduled fresh → stays
      {
        id: "lead-fresh-demo",
        leadStatus: "demo_scheduled",
        createdAt: new Date(now.getTime() - ms(30)),
        pipelineEnteredAt: new Date(now.getTime() - ms(30)),
        lastActivityAt: new Date(now.getTime() - ms(5)),
      },
      // proposal_sent > 30d → nurture
      {
        id: "lead-stale-proposal",
        leadStatus: "proposal_sent",
        createdAt: new Date(now.getTime() - ms(60)),
        pipelineEnteredAt: new Date(now.getTime() - ms(60)),
        lastActivityAt: new Date(now.getTime() - ms(45)),
      },
    ];

    const { db, state, updateCalls, insertCalls } = createLeadExpirationStub(partners, now);
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:lead-expiration")!()) as Record<
      string,
      number
    >;

    expect(result.transitioned).toBe(3);
    expect(result.submitted_to_expired).toBe(1);
    expect(result.demo_scheduled_to_nurture).toBe(1);
    expect(result.proposal_sent_to_nurture).toBe(1);

    // One insert call per non-empty transition (3 transitions × 1 row each).
    expect(insertCalls).toHaveLength(3);
    // Every insert row must be actor=system, activity=status_change, visibleToAffiliate=true
    for (const batch of insertCalls) {
      for (const row of batch) {
        expect(row.actorType).toBe("system");
        expect(row.activityType).toBe("status_change");
        expect(row.visibleToAffiliate).toBe(true);
        expect(row.fromStatus).toBeTruthy();
        expect(row.toStatus).toBeTruthy();
      }
    }

    // Fixture state reflects the transitions.
    const byId = Object.fromEntries(state.partners.map((r) => [r.id, r.leadStatus]));
    expect(byId["lead-stale-submitted"]).toBe("expired");
    expect(byId["lead-fresh-submitted"]).toBe("submitted");
    expect(byId["lead-stale-demo"]).toBe("nurture");
    expect(byId["lead-fresh-demo"]).toBe("demo_scheduled");
    expect(byId["lead-stale-proposal"]).toBe("nurture");

    expect(updateCalls).toHaveLength(3);
  });

  it("no-ops when every lead is fresh", async () => {
    const now = new Date("2026-04-20T03:30:00.000Z");
    const partners: PartnerRow[] = [
      {
        id: "fresh-1",
        leadStatus: "submitted",
        createdAt: new Date(now.getTime() - 60_000),
        pipelineEnteredAt: new Date(now.getTime() - 60_000),
        lastActivityAt: null,
      },
    ];
    const { db, insertCalls } = createLeadExpirationStub(partners, now);
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:lead-expiration")!()) as Record<
      string,
      number
    >;
    expect(result.transitioned).toBe(0);
    expect(insertCalls).toHaveLength(0);
  });
});

// -----------------------------------------------------------------------------
// Tests — affiliate:lock-expiration
// -----------------------------------------------------------------------------

describe("affiliate:lock-expiration cron", () => {
  beforeEach(() => {
    registeredJobs.clear();
    registeredDefs.clear();
    sendTransactionalMock.mockClear();
  });

  it("registers with the correct name + schedule", async () => {
    const { db } = createLockExpirationStub([], new Date());
    startAffiliateCrons(db);
    const def = registeredDefs.get("affiliate:lock-expiration");
    expect(def?.schedule).toBe("45 3 * * *");
    expect(def?.sourceFile).toBe("affiliate-crons.ts");
  });

  it("releases eligible locks, writes crm_activities, emails the affiliate", async () => {
    const now = new Date("2026-04-20T03:45:00.000Z");
    const rows: CandidateRow[] = [
      // Expired + early pipeline → release
      {
        attributionId: "attr-releasable",
        leadId: "lead-1",
        affiliateId: "aff-1",
        affiliateEmail: "one@example.com",
        affiliateName: "Affiliate One",
        leadName: "Lead One",
        leadStatus: "qualified",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
      },
      // Expired but progressed past qualified → stays locked
      {
        attributionId: "attr-progressed",
        leadId: "lead-2",
        affiliateId: "aff-2",
        affiliateEmail: "two@example.com",
        affiliateName: "Affiliate Two",
        leadName: "Lead Two",
        leadStatus: "demo_scheduled",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
      },
      // Not yet expired → stays locked
      {
        attributionId: "attr-fresh",
        leadId: "lead-3",
        affiliateId: "aff-3",
        affiliateEmail: "three@example.com",
        affiliateName: "Affiliate Three",
        leadName: "Lead Three",
        leadStatus: "submitted",
        lockExpiresAt: new Date(now.getTime() + 60_000),
        lockReleasedAt: null,
      },
      // Already released → noop
      {
        attributionId: "attr-already",
        leadId: "lead-4",
        affiliateId: "aff-4",
        affiliateEmail: "four@example.com",
        affiliateName: "Affiliate Four",
        leadName: "Lead Four",
        leadStatus: "submitted",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: new Date(now.getTime() - 120_000),
      },
      // Null leadStatus + expired → release (defensive path)
      {
        attributionId: "attr-nullstatus",
        leadId: "lead-5",
        affiliateId: "aff-5",
        affiliateEmail: "five@example.com",
        affiliateName: "Affiliate Five",
        leadName: "Lead Five",
        leadStatus: null,
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
      },
    ];

    const { db, state, insertCalls } = createLockExpirationStub(rows, now);
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:lock-expiration")!()) as {
      released: number;
      emailsSent: number;
      emailsFailed: number;
    };

    expect(result.released).toBe(2);
    expect(result.emailsSent).toBe(2);
    expect(result.emailsFailed).toBe(0);

    // Only the eligible rows flipped to released.
    const byId = Object.fromEntries(state.rows.map((r) => [r.attributionId, r.lockReleasedAt]));
    expect(byId["attr-releasable"]).not.toBeNull();
    expect(byId["attr-nullstatus"]).not.toBeNull();
    expect(byId["attr-progressed"]).toBeNull();
    expect(byId["attr-fresh"]).toBeNull();

    // crm_activities insert: one batch, two rows, both lock_expired + system
    expect(insertCalls).toHaveLength(1);
    const activityBatch = insertCalls[0]!;
    expect(activityBatch).toHaveLength(2);
    for (const row of activityBatch) {
      expect(row.actorType).toBe("system");
      expect(row.activityType).toBe("lock_expired");
      expect(row.visibleToAffiliate).toBe(true);
    }
    const releasedLeadIds = activityBatch.map((r) => r.leadId).sort();
    expect(releasedLeadIds).toEqual(["lead-1", "lead-5"]);

    // Email fired for each released affiliate.
    expect(sendTransactionalMock).toHaveBeenCalledTimes(2);
    const emailTargets = sendTransactionalMock.mock.calls.map((args) => args[1]).sort();
    expect(emailTargets).toEqual(["five@example.com", "one@example.com"]);
    // Template name is the stubbed affiliate-lock-expired identifier.
    for (const call of sendTransactionalMock.mock.calls) {
      expect(call[0]).toBe("affiliate-lock-expired");
      expect(call[2]).toMatchObject({
        recipientEmail: expect.any(String),
        affiliateName: expect.any(String),
        leadName: expect.any(String),
      });
    }
  });

  it("no-ops cleanly when there are no candidates", async () => {
    const now = new Date("2026-04-20T03:45:00.000Z");
    const { db, insertCalls } = createLockExpirationStub([], now);
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:lock-expiration")!()) as {
      released: number;
    };
    expect(result.released).toBe(0);
    expect(insertCalls).toHaveLength(0);
    expect(sendTransactionalMock).not.toHaveBeenCalled();
  });

  it("counts email failures without aborting the run", async () => {
    const now = new Date("2026-04-20T03:45:00.000Z");
    sendTransactionalMock.mockRejectedValueOnce(new Error("smtp down"));

    const rows: CandidateRow[] = [
      {
        attributionId: "attr-a",
        leadId: "lead-a",
        affiliateId: "aff-a",
        affiliateEmail: "a@example.com",
        affiliateName: "A",
        leadName: "Lead A",
        leadStatus: "submitted",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
      },
      {
        attributionId: "attr-b",
        leadId: "lead-b",
        affiliateId: "aff-b",
        affiliateEmail: "b@example.com",
        affiliateName: "B",
        leadName: "Lead B",
        leadStatus: "submitted",
        lockExpiresAt: new Date(now.getTime() - 60_000),
        lockReleasedAt: null,
      },
    ];
    const { db } = createLockExpirationStub(rows, now);
    startAffiliateCrons(db);

    const result = (await registeredJobs.get("affiliate:lock-expiration")!()) as {
      released: number;
      emailsSent: number;
      emailsFailed: number;
    };

    expect(result.released).toBe(2);
    expect(result.emailsSent).toBe(1);
    expect(result.emailsFailed).toBe(1);
  });
});
