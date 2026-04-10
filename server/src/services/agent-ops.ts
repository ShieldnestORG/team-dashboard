import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, agentRuntimeState, heartbeatRuns, systemCrons } from "@paperclipai/db";

const STALE_THRESHOLD_MS = 2 * 60 * 60 * 1000; // 2 hours

interface LatestRunRow {
  agent_id: string;
  status: string;
  finished_at: string | null;
  error: string | null;
}

interface RunIssueRow {
  agent_id: string;
  issue_title: string;
  issue_identifier: string;
}

export function agentOpsService(db: Db) {
  return {
    overview: async (companyId: string) => {
      // 1. All non-terminated agents with runtime state
      const agentRows = await db
        .select({
          id: agents.id,
          name: agents.name,
          role: agents.role,
          title: agents.title,
          icon: agents.icon,
          status: agents.status,
          pauseReason: agents.pauseReason,
          lastHeartbeatAt: agents.lastHeartbeatAt,
          budgetMonthlyCents: agents.budgetMonthlyCents,
          spentMonthlyCents: agents.spentMonthlyCents,
          adapterType: agents.adapterType,
          rsLastRunStatus: agentRuntimeState.lastRunStatus,
          rsLastError: agentRuntimeState.lastError,
          rsTotalCostCents: agentRuntimeState.totalCostCents,
          rsTotalInputTokens: agentRuntimeState.totalInputTokens,
          rsTotalOutputTokens: agentRuntimeState.totalOutputTokens,
        })
        .from(agents)
        .leftJoin(agentRuntimeState, eq(agentRuntimeState.agentId, agents.id))
        .where(
          and(
            eq(agents.companyId, companyId),
            ne(agents.status, "terminated"),
          ),
        );

      if (agentRows.length === 0) {
        return { agents: [], attentionRequired: [], summary: { total: 0, running: 0, idle: 0, paused: 0, error: 0, pendingApproval: 0 } };
      }

      // 2. Active runs (running/queued) grouped by agent
      const activeRunRows = await db
        .select({
          agentId: heartbeatRuns.agentId,
          activeCount: sql<number>`count(*)::int`,
          firstRunId: sql<string>`min(${heartbeatRuns.id})`,
        })
        .from(heartbeatRuns)
        .where(
          and(
            eq(heartbeatRuns.companyId, companyId),
            inArray(heartbeatRuns.status, ["running", "queued"]),
          ),
        )
        .groupBy(heartbeatRuns.agentId);

      const activeRunMap = new Map(activeRunRows.map((r) => [r.agentId, r]));

      // 3. Latest finished run per agent
      const latestRuns = await db.execute(sql`
        SELECT DISTINCT ON (hr.agent_id)
          hr.agent_id,
          hr.status,
          hr.finished_at,
          hr.error
        FROM heartbeat_runs hr
        WHERE hr.company_id = ${companyId}
          AND hr.status NOT IN ('running', 'queued')
        ORDER BY hr.agent_id, hr.created_at DESC
      `) as unknown as LatestRunRow[];

      const latestRunMap = new Map(latestRuns.map((r) => [r.agent_id, r]));

      // 4. Get issue context for active runs
      const activeRunIds = activeRunRows
        .map((r) => r.firstRunId)
        .filter(Boolean);

      let activeRunIssueMap = new Map<string, RunIssueRow>();
      if (activeRunIds.length > 0) {
        const runIssues = await db.execute(sql`
          SELECT hr.agent_id, i.title AS issue_title, i.identifier AS issue_identifier
          FROM heartbeat_runs hr
          JOIN issues i ON i.id = (hr.context_snapshot->>'issueId')::uuid
          WHERE hr.id = ANY(${activeRunIds}::uuid[])
            AND hr.context_snapshot->>'issueId' IS NOT NULL
        `) as unknown as RunIssueRow[];
        activeRunIssueMap = new Map(runIssues.map((r) => [r.agent_id, r]));
      }

      // 5. Cron error counts per owner agent
      const cronRows = await db
        .select({
          ownerAgent: systemCrons.ownerAgent,
          totalErrors: sql<number>`coalesce(sum(${systemCrons.errorCount}), 0)::int`,
        })
        .from(systemCrons)
        .where(sql`${systemCrons.ownerAgent} IS NOT NULL`)
        .groupBy(systemCrons.ownerAgent);

      const cronMap = new Map(cronRows.map((r) => [r.ownerAgent, r]));

      // Assemble
      const now = Date.now();
      const twentyFourHoursAgo = new Date(now - 24 * 60 * 60 * 1000);

      const summary = { total: 0, running: 0, idle: 0, paused: 0, error: 0, pendingApproval: 0 };
      const attentionRequired: {
        agentId: string;
        agentName: string;
        type: string;
        message: string;
        timestamp: string | null;
      }[] = [];

      const agentEntries = agentRows.map((a) => {
        const activeRun = activeRunMap.get(a.id);
        const latestRun = latestRunMap.get(a.id);
        const activeIssue = activeRunIssueMap.get(a.id);
        const cronByName = cronMap.get(a.name?.toLowerCase() ?? "") ?? cronMap.get(a.role?.toLowerCase() ?? "");

        const entry = {
          id: a.id,
          name: a.name,
          role: a.role,
          title: a.title,
          icon: a.icon,
          status: a.status,
          adapterType: a.adapterType,
          pauseReason: a.pauseReason,
          lastHeartbeatAt: a.lastHeartbeatAt?.toISOString() ?? null,
          budgetMonthlyCents: a.budgetMonthlyCents ?? 0,
          spentMonthlyCents: a.spentMonthlyCents ?? 0,
          lastRunStatus: latestRun?.status ?? a.rsLastRunStatus ?? null,
          lastRunFinishedAt: latestRun?.finished_at ?? null,
          lastRunError: latestRun?.error ?? null,
          lastError: a.rsLastError ?? null,
          totalCostCents: Number(a.rsTotalCostCents ?? 0),
          totalInputTokens: Number(a.rsTotalInputTokens ?? 0),
          totalOutputTokens: Number(a.rsTotalOutputTokens ?? 0),
          activeRunCount: activeRun?.activeCount ?? 0,
          activeRunId: activeRun?.firstRunId ?? null,
          activeRunIssueTitle: activeIssue?.issue_title ?? null,
          activeRunIssueIdentifier: activeIssue?.issue_identifier ?? null,
          cronErrorCount: cronByName?.totalErrors ?? 0,
        };

        // Summary
        summary.total++;
        if (a.status === "running" || (activeRun?.activeCount ?? 0) > 0) summary.running++;
        else if (a.status === "paused") summary.paused++;
        else if (a.status === "error") summary.error++;
        else if (a.status === "pending_approval") summary.pendingApproval++;
        else summary.idle++;

        // Attention flags
        if (a.status === "error") {
          attentionRequired.push({
            agentId: a.id, agentName: a.name, type: "error",
            message: a.rsLastError ?? "Agent is in error state",
            timestamp: a.lastHeartbeatAt?.toISOString() ?? null,
          });
        }
        if (a.status === "pending_approval") {
          attentionRequired.push({
            agentId: a.id, agentName: a.name, type: "pending_approval",
            message: "Agent is awaiting approval",
            timestamp: a.lastHeartbeatAt?.toISOString() ?? null,
          });
        }
        if (a.status === "paused" && a.pauseReason) {
          attentionRequired.push({
            agentId: a.id, agentName: a.name,
            type: a.pauseReason.includes("budget") ? "budget_paused" : "paused",
            message: a.pauseReason,
            timestamp: a.lastHeartbeatAt?.toISOString() ?? null,
          });
        }
        if (
          latestRun?.status === "failed" &&
          latestRun.finished_at &&
          new Date(latestRun.finished_at) > twentyFourHoursAgo
        ) {
          attentionRequired.push({
            agentId: a.id, agentName: a.name, type: "failed_run",
            message: latestRun.error ?? "Last run failed",
            timestamp: latestRun.finished_at,
          });
        }
        if (
          a.status !== "paused" && a.status !== "error" && a.status !== "pending_approval" &&
          a.lastHeartbeatAt && now - a.lastHeartbeatAt.getTime() > STALE_THRESHOLD_MS &&
          (activeRun?.activeCount ?? 0) === 0
        ) {
          attentionRequired.push({
            agentId: a.id, agentName: a.name, type: "stale",
            message: "No heartbeat in over 2 hours",
            timestamp: a.lastHeartbeatAt.toISOString(),
          });
        }

        return entry;
      });

      // Sort: errors first, then pending_approval, then running, then paused, then idle
      const statusOrder: Record<string, number> = {
        error: 0, pending_approval: 1, running: 2, active: 3, idle: 4, paused: 5,
      };
      agentEntries.sort((a, b) => {
        const aOrder = a.status === "idle" && a.activeRunCount > 0 ? 2 : (statusOrder[a.status] ?? 6);
        const bOrder = b.status === "idle" && b.activeRunCount > 0 ? 2 : (statusOrder[b.status] ?? 6);
        return aOrder - bOrder;
      });

      return { agents: agentEntries, attentionRequired, summary };
    },
  };
}
