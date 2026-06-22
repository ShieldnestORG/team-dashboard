// ---------------------------------------------------------------------------
// Coherent Ones University — agent runner entrypoint.
//
// startAgentRunner(deps) wires the two periodic behaviors (ambient + feed) onto
// timers. It is OFF BY DEFAULT and inert until explicitly enabled:
//
//   AGENTS_RUNNER_ENABLED must be 'true' (or AGENT_DAILY_TOKEN_BUDGET must be
//   set to a positive number). Anything else → the runner logs and returns
//   without registering any timers. Importing this module does NOTHING.
//
// If ANTHROPIC_API_KEY is missing the runner does NOT start (the LLM variation/
// help paths would be permanently scripted, and we never crash the shared boot
// — Rule 10 / BUILD-SPEC correction #2: scope the failure, don't FATAL).
//
// Each Claude call already fails safe to a scripted line (claude.ts → null),
// every write is wrapped, and timer callbacks swallow+log so a tick error never
// kills the interval or the process.
// ---------------------------------------------------------------------------

import type { Db } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import { AgentEngine, type CommunityWriter } from "./engine.js";

const AMBIENT_INTERVAL_MS = 30_000; // ~30s ambient small-talk tick
const FEED_INTERVAL_MS = 30_000; // ~30s responsive feed poll
const MAX_STARTUP_JITTER_MS = 60_000; // spread first activity after boot

export interface AgentRunnerDeps {
  db: Db;
  community: CommunityWriter;
}

export interface AgentRunnerHandle {
  stop: () => void;
}

/** True only when an admin has explicitly turned the runner on. Default: false. */
export function agentRunnerEnabled(): boolean {
  if (process.env.AGENTS_RUNNER_ENABLED === "true") return true;
  const budget = Number(process.env.AGENT_DAILY_TOKEN_BUDGET);
  return Number.isFinite(budget) && budget > 0;
}

function dailyBudgetUsd(): number {
  const budget = Number(process.env.AGENT_DAILY_TOKEN_BUDGET);
  // Default to a conservative $5/day ceiling when the flag is on but no budget
  // is configured. budgetExhausted() treats <=0 as "no LLM", so this stays safe.
  return Number.isFinite(budget) && budget > 0 ? budget : 5;
}

/**
 * Start the agent runner. Returns a handle to stop the timers, or null when the
 * runner is disabled / cannot start (missing key). NEVER throws.
 */
export function startAgentRunner(deps: AgentRunnerDeps): AgentRunnerHandle | null {
  if (!agentRunnerEnabled()) {
    logger.info("agent-runner: disabled (AGENTS_RUNNER_ENABLED!=true and no AGENT_DAILY_TOKEN_BUDGET); not starting");
    return null;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.error("agent-runner: ANTHROPIC_API_KEY missing; runner NOT started (boot continues)");
    return null;
  }

  const engine = new AgentEngine({
    db: deps.db,
    community: deps.community,
    apiKey,
    dailyBudgetUsd: dailyBudgetUsd(),
  });

  let ambientTimer: ReturnType<typeof setInterval> | null = null;
  let feedTimer: ReturnType<typeof setInterval> | null = null;

  const jitter = Math.floor(Math.random() * MAX_STARTUP_JITTER_MS);

  const startTimer = setTimeout(() => {
    void (async () => {
      try {
        await engine.initWatermark();
      } catch (err) {
        logger.error({ err }, "agent-runner: initWatermark threw (continuing)");
      }

      ambientTimer = setInterval(() => {
        engine.ambientTick().catch((err) =>
          logger.error({ err }, "agent-runner: ambientTick failed (non-fatal)"),
        );
      }, AMBIENT_INTERVAL_MS);

      feedTimer = setInterval(() => {
        engine.feedTick().catch((err) =>
          logger.error({ err }, "agent-runner: feedTick failed (non-fatal)"),
        );
      }, FEED_INTERVAL_MS);

      logger.info(
        { ambientMs: AMBIENT_INTERVAL_MS, feedMs: FEED_INTERVAL_MS, dailyBudgetUsd: dailyBudgetUsd() },
        "agent-runner: started",
      );
    })();
  }, jitter);

  logger.info({ jitterMs: jitter }, "agent-runner: scheduled startup after jitter");

  return {
    stop: () => {
      clearTimeout(startTimer);
      if (ambientTimer) clearInterval(ambientTimer);
      if (feedTimer) clearInterval(feedTimer);
      logger.info("agent-runner: stopped");
    },
  };
}
