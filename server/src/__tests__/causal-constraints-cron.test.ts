// Unit test for the causal-constraints cron's runCausalConstraintCheck().
//
// We mock:
//   - The constraint-table select (returns one constraint requiring Y after X).
//   - The findViolators raw SQL query (returns one fake violator).
//   - recordEvent (assert it's called with kind = "causal.constraint.violated").
//   - The post-violation UPDATE on event_constraints.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRecordEvent = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());
const mockLoggerInfo = vi.hoisted(() => vi.fn());

vi.mock("../services/causal-events.js", () => ({
  recordEvent: mockRecordEvent,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
    error: mockLoggerError,
    info: mockLoggerInfo,
    debug: vi.fn(),
  },
}));

// Stub the cron-registry so import doesn't try to wire anything real.
vi.mock("../services/cron-registry.js", () => ({
  registerCronJob: vi.fn(),
}));

const { runCausalConstraintCheck } = await import(
  "../services/causal-constraints-cron.js"
);

interface FakeConstraint {
  id: string;
  kind: string;
  pattern: { of: string; require: string };
  maxLagMs: number;
  enabled: boolean;
  violationCount: number;
}

function makeDb({
  constraints,
  violators,
}: {
  constraints: FakeConstraint[];
  violators: Array<{
    id: string;
    created_at: Date;
    entity_id: string;
    company_id: string | null;
  }>;
}) {
  const select = vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(async () => constraints),
    })),
  }));
  const execute = vi.fn(async () => ({ rows: violators }));
  const update = vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(async () => {}),
    })),
  }));
  return { select, execute, update } as any;
}

describe("runCausalConstraintCheck", () => {
  beforeEach(() => {
    mockRecordEvent.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerError.mockReset();
  });

  it("emits causal.constraint.violated for each unmatched parent", async () => {
    const db = makeDb({
      constraints: [
        {
          id: "c-1",
          kind: "watchtower:query-completes",
          pattern: { of: "watchtower.query.sent", require: "watchtower.query.response" },
          maxLagMs: 60_000,
          enabled: true,
          violationCount: 0,
        },
      ],
      violators: [
        {
          id: "evt-violator-1",
          created_at: new Date(),
          entity_id: "sub-1",
          company_id: "co-1",
        },
      ],
    });

    const result = await runCausalConstraintCheck(db);

    expect(result.constraintsChecked).toBe(1);
    expect(result.totalViolations).toBe(1);
    expect(result.errors).toBe(0);

    expect(mockRecordEvent).toHaveBeenCalledTimes(1);
    const call = mockRecordEvent.mock.calls[0][1];
    expect(call.kind).toBe("causal.constraint.violated");
    expect(call.companyId).toBe("co-1");
    expect(call.causedBy).toEqual(["evt-violator-1"]);
    expect(call.payload).toMatchObject({
      constraintId: "c-1",
      constraintKind: "watchtower:query-completes",
      of: "watchtower.query.sent",
      require: "watchtower.query.response",
    });
  });

  it("no violators: still touches last_checked_at, emits no events", async () => {
    const db = makeDb({
      constraints: [
        {
          id: "c-2",
          kind: "x:y",
          pattern: { of: "x.parent", require: "x.child" },
          maxLagMs: 10_000,
          enabled: true,
          violationCount: 0,
        },
      ],
      violators: [],
    });

    const result = await runCausalConstraintCheck(db);
    expect(result.totalViolations).toBe(0);
    expect(mockRecordEvent).not.toHaveBeenCalled();
    // Updated last_checked_at.
    expect((db as any).update).toHaveBeenCalled();
  });

  it("skips emit when violator has null company_id", async () => {
    const db = makeDb({
      constraints: [
        {
          id: "c-3",
          kind: "y:z",
          pattern: { of: "y.a", require: "y.b" },
          maxLagMs: 5_000,
          enabled: true,
          violationCount: 0,
        },
      ],
      violators: [
        {
          id: "evt-no-co",
          created_at: new Date(),
          entity_id: "e",
          company_id: null,
        },
      ],
    });
    const result = await runCausalConstraintCheck(db);
    expect(result.totalViolations).toBe(1);
    expect(mockRecordEvent).not.toHaveBeenCalled();
  });
});
