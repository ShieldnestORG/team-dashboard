// Unit tests for the recordEvent() helper.
//
// The whole point of recordEvent is to wrap logActivity with a kill-switch +
// total error swallow. We mock logActivity so the DB never has to exist, and
// then drive recordEvent through every "what could go wrong" branch.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockLogActivity = vi.hoisted(() => vi.fn());
const mockLoggerWarn = vi.hoisted(() => vi.fn());

vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../middleware/logger.js", () => ({
  logger: {
    warn: mockLoggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are registered.
const { recordEvent } = await import("../services/causal-events.js");

describe("recordEvent", () => {
  beforeEach(() => {
    mockLogActivity.mockReset();
    mockLoggerWarn.mockReset();
    delete process.env.CAUSAL_EVENTS_ENABLED;
  });

  afterEach(() => {
    delete process.env.CAUSAL_EVENTS_ENABLED;
  });

  it("happy path: forwards to logActivity with defaults", async () => {
    mockLogActivity.mockResolvedValueOnce("evt-1");
    const id = await recordEvent({} as any, {
      kind: "watchtower.run.started",
      companyId: "co-1",
      entityId: "sub-1",
      payload: { foo: "bar" },
    });
    expect(id).toBe("evt-1");
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const args = mockLogActivity.mock.calls[0][1];
    expect(args).toMatchObject({
      companyId: "co-1",
      entityId: "sub-1",
      entityType: "watchtower",
      actorType: "system",
      actorId: "watchtower",
      action: "event",
      eventKind: "watchtower.run.started",
      details: { foo: "bar" },
      causedBy: null,
    });
  });

  it("missing kind: returns '' and warns, does not call logActivity", async () => {
    const id = await recordEvent({} as any, {
      // @ts-expect-error — deliberately missing kind
      kind: undefined,
      companyId: "co-1",
      entityId: "x",
    });
    expect(id).toBe("");
    expect(mockLogActivity).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it("multiple causedBy parents are forwarded verbatim", async () => {
    mockLogActivity.mockResolvedValueOnce("evt-child");
    const parents = [
      "00000000-0000-0000-0000-000000000001",
      "00000000-0000-0000-0000-000000000002",
      "00000000-0000-0000-0000-000000000003",
    ];
    await recordEvent({} as any, {
      kind: "watchtower.run.completed",
      companyId: "co-1",
      entityId: "sub-1",
      causedBy: parents,
    });
    const args = mockLogActivity.mock.calls[0][1];
    expect(args.causedBy).toEqual(parents);
  });

  it("filters out non-string entries in causedBy without throwing", async () => {
    mockLogActivity.mockResolvedValueOnce("evt-child");
    await recordEvent({} as any, {
      kind: "x.y.z",
      companyId: "co-1",
      entityId: "e-1",
      // @ts-expect-error — feeding garbage on purpose
      causedBy: ["00000000-0000-0000-0000-000000000001", null, undefined, ""],
    });
    const args = mockLogActivity.mock.calls[0][1];
    expect(args.causedBy).toEqual(["00000000-0000-0000-0000-000000000001"]);
  });

  it("empty causedBy array becomes null", async () => {
    mockLogActivity.mockResolvedValueOnce("evt-x");
    await recordEvent({} as any, {
      kind: "x.y",
      companyId: "co",
      entityId: "e",
      causedBy: [],
    });
    expect(mockLogActivity.mock.calls[0][1].causedBy).toBeNull();
  });

  it("logActivity throwing returns '' and warns instead of propagating", async () => {
    mockLogActivity.mockRejectedValueOnce(new Error("simulated DB failure"));
    const id = await recordEvent({} as any, {
      kind: "watchtower.query.sent",
      companyId: "co-1",
      entityId: "e-1",
    });
    expect(id).toBe("");
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it("payload that fails to serialize is still swallowed", async () => {
    // Force logActivity to throw on a circular reference / pathological payload.
    mockLogActivity.mockImplementationOnce(() => {
      throw new TypeError("Converting circular structure to JSON");
    });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const id = await recordEvent({} as any, {
      kind: "x.y",
      companyId: "co",
      entityId: "e",
      payload: circular,
    });
    expect(id).toBe("");
    expect(mockLoggerWarn).toHaveBeenCalledTimes(1);
  });

  it("kill switch CAUSAL_EVENTS_ENABLED=false: short-circuits without calling logActivity", async () => {
    process.env.CAUSAL_EVENTS_ENABLED = "false";
    const id = await recordEvent({} as any, {
      kind: "watchtower.run.started",
      companyId: "co-1",
      entityId: "sub-1",
    });
    expect(id).toBe("");
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("kill switch CAUSAL_EVENTS_ENABLED=true: still runs", async () => {
    process.env.CAUSAL_EVENTS_ENABLED = "true";
    mockLogActivity.mockResolvedValueOnce("evt-z");
    const id = await recordEvent({} as any, {
      kind: "x.y",
      companyId: "co",
      entityId: "e",
    });
    expect(id).toBe("evt-z");
  });
});
