// ---------------------------------------------------------------------------
// Mission step executor — translates mission steps to X API v2 calls
// ---------------------------------------------------------------------------

import type { PluginContext } from "@paperclipai/plugin-sdk";
import type { MissionData, MissionStep } from "./types.js";
import {
  getXApiClient,
  extractTweetId,
  executeEngagement,
  jitteredDelay,
} from "./executor.js";

// ---------------------------------------------------------------------------
// Step result
// ---------------------------------------------------------------------------

export interface StepResult {
  action: string;
  success: boolean;
  skipped?: boolean;
  error?: string;
  data?: unknown;
}

// ---------------------------------------------------------------------------
// DOM-only actions that have no API equivalent
// ---------------------------------------------------------------------------

const DOM_ONLY_ACTIONS = new Set([
  "GOTO",
  "SCROLL",
  "WAIT",
  "CLICK_TWEET",
  "VISIT_PROFILE",
  "NAVIGATE_BACK",
]);

// ---------------------------------------------------------------------------
// Execute a single mission step
// ---------------------------------------------------------------------------

export async function executeMissionStep(
  step: MissionStep,
  ctx: PluginContext,
): Promise<StepResult> {
  const params = step.params || {};

  // DOM-only steps are no-ops with logging
  if (DOM_ONLY_ACTIONS.has(step.action)) {
    ctx.logger.info(`Mission step ${step.action}: skipped (DOM-only, no API equivalent)`, {
      action: step.action,
      params,
    });
    return {
      action: step.action,
      success: true,
      skipped: true,
    };
  }

  try {
    switch (step.action) {
      case "SEARCH": {
        // No search API on free tier — fetch target user's tweets instead
        const client = await getXApiClient();
        const username = params.username as string | undefined;
        if (username) {
          // Look up user by username via getMe won't work for others,
          // but we can try fetching tweets if we have a userId
          ctx.logger.info(`Mission SEARCH: free tier has no search API, skipping query: ${params.query || ""}`);
        }
        return {
          action: "SEARCH",
          success: true,
          skipped: true,
          data: { note: "Search API unavailable on free tier" },
        };
      }

      case "LIKE": {
        const tweetId = (params.tweetId as string) || extractTweetId((params.tweetUrl as string) || "");
        if (!tweetId) {
          return { action: "LIKE", success: false, error: "No tweetId or tweetUrl in step params" };
        }
        const result = await executeEngagement({
          type: "like",
          targetTweetId: tweetId,
        });
        return {
          action: "LIKE",
          success: result.success,
          error: result.error,
          data: result,
        };
      }

      case "REPOST": {
        const tweetId = (params.tweetId as string) || extractTweetId((params.tweetUrl as string) || "");
        if (!tweetId) {
          return { action: "REPOST", success: false, error: "No tweetId or tweetUrl in step params" };
        }
        const result = await executeEngagement({
          type: "retweet",
          targetTweetId: tweetId,
        });
        return {
          action: "REPOST",
          success: result.success,
          error: result.error,
          data: result,
        };
      }

      case "FOLLOW": {
        const userId = params.userId as string | undefined;
        if (!userId) {
          return { action: "FOLLOW", success: false, error: "No userId in step params" };
        }
        const result = await executeEngagement({
          type: "follow",
          targetUserId: userId,
        });
        return {
          action: "FOLLOW",
          success: result.success,
          error: result.error,
          data: result,
        };
      }

      case "REPLY": {
        const tweetId = (params.tweetId as string) || extractTweetId((params.tweetUrl as string) || "");
        const text = params.text as string;
        if (!tweetId || !text) {
          return { action: "REPLY", success: false, error: "tweetId/tweetUrl and text required for REPLY" };
        }
        const result = await executeEngagement({
          type: "reply",
          targetTweetId: tweetId,
          replyText: text,
        });
        return {
          action: "REPLY",
          success: result.success,
          error: result.error,
          data: result,
        };
      }

      case "POST": {
        const text = params.text as string;
        if (!text) {
          return { action: "POST", success: false, error: "text required for POST" };
        }
        const client = await getXApiClient();
        const result = await client.createTweet({ text });
        return {
          action: "POST",
          success: true,
          data: { tweetId: result.data.id, tweetUrl: `https://x.com/i/status/${result.data.id}` },
        };
      }

      case "EXTRACT": {
        const tweetId = (params.tweetId as string) || extractTweetId((params.tweetUrl as string) || "");
        if (!tweetId) {
          return { action: "EXTRACT", success: false, error: "No tweetId or tweetUrl for EXTRACT" };
        }
        const client = await getXApiClient();
        const tweet = await client.getTweet(tweetId);
        return {
          action: "EXTRACT",
          success: true,
          data: tweet,
        };
      }

      case "BULK_EXTRACT": {
        const userId = params.userId as string | undefined;
        const maxResults = (params.maxResults as number) || 10;
        if (!userId) {
          return { action: "BULK_EXTRACT", success: false, error: "No userId for BULK_EXTRACT" };
        }
        const client = await getXApiClient();
        const tweets = await client.getUserTweets(userId, maxResults);
        return {
          action: "BULK_EXTRACT",
          success: true,
          data: tweets,
        };
      }

      default:
        return {
          action: step.action,
          success: false,
          error: `Unknown mission step action: ${step.action}`,
        };
    }
  } catch (err) {
    return {
      action: step.action,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ---------------------------------------------------------------------------
// Execute an entire mission from currentStepIndex onward
// ---------------------------------------------------------------------------

export async function executeMission(
  missionId: string,
  mission: MissionData,
  ctx: PluginContext,
): Promise<{ completed: boolean; stepsExecuted: number; errors: string[] }> {
  const errors: string[] = [];
  let stepsExecuted = 0;

  for (let i = mission.currentStep; i < mission.steps.length; i++) {
    const step = mission.steps[i];

    ctx.logger.info(`Mission ${missionId}: executing step ${i + 1}/${mission.steps.length} — ${step.action}`);

    const result = await executeMissionStep(step, ctx);
    stepsExecuted++;
    mission.currentStep = i + 1;
    mission.results.push(result);

    if (!result.success && !result.skipped) {
      errors.push(`Step ${i + 1} (${step.action}): ${result.error}`);
      ctx.logger.warn(`Mission ${missionId}: step ${i + 1} failed: ${result.error}`);
      // Continue to next step on failure (graceful degradation)
    }

    // Update progress in plugin state
    await ctx.entities.upsert({
      entityType: "mission",
      scopeKind: "instance",
      externalId: missionId,
      title: mission.name || `Mission (${mission.steps.length} steps)`,
      status: "active",
      data: mission as unknown as Record<string, unknown>,
    });

    // Apply jittered delay between steps (2-8 seconds)
    if (i < mission.steps.length - 1) {
      await jitteredDelay(2000, 8000);
    }
  }

  // Mark mission as completed
  mission.completedAt = new Date().toISOString();
  await ctx.entities.upsert({
    entityType: "mission",
    scopeKind: "instance",
    externalId: missionId,
    title: mission.name || `Mission (${mission.steps.length} steps)`,
    status: errors.length > 0 && stepsExecuted === errors.length ? "failed" : "completed",
    data: mission as unknown as Record<string, unknown>,
  });

  ctx.logger.info(`Mission ${missionId}: finished (${stepsExecuted} steps, ${errors.length} errors)`);

  return {
    completed: true,
    stepsExecuted,
    errors,
  };
}
