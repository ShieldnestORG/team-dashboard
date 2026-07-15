// ---------------------------------------------------------------------------
// Coherent Ones University — ambient-comment cap unit test.
//
// Locks in the per-agent daily comment cap added 2026-07-15: before it, one
// chatty persona (Felix: 17h window × 0.30/tick) could burn the entire 30/day
// global comment budget alone. Pure predicate over a stubbed state (Rule 5).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { CAPS, canAmbientComment } from "./caps.js";
import type { AgentRunnerState } from "./state.js";

const stubState = (globalCount: number, agentCount: number): AgentRunnerState =>
  ({
    globalAmbientCommentCount: async () => globalCount,
    agentAmbientCommentCount: async () => agentCount,
  }) as unknown as AgentRunnerState;

describe("canAmbientComment (global + per-agent)", () => {
  it("allows a comment under both caps", async () => {
    expect(await canAmbientComment(stubState(0, 0), "felix")).toBe(true);
    expect(
      await canAmbientComment(
        stubState(CAPS.ambientCommentsPerDay - 1, CAPS.ambientCommentsPerAgentPerDay - 1),
        "felix",
      ),
    ).toBe(true);
  });

  it("blocks at the global daily cap even if the agent is fresh", async () => {
    expect(await canAmbientComment(stubState(CAPS.ambientCommentsPerDay, 0), "felix")).toBe(false);
  });

  it("blocks at the per-agent daily cap even with global budget left", async () => {
    expect(
      await canAmbientComment(stubState(5, CAPS.ambientCommentsPerAgentPerDay), "felix"),
    ).toBe(false);
  });
});
