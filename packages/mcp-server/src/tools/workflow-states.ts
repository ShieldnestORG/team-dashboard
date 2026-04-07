import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerWorkflowStateTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_workflow_states",
    "List workflow states for a team, grouped by category (triage, backlog, unstarted, started, completed, cancelled), ordered by position.",
    {
      teamId: z.string().describe("Team UUID"),
    },
    async ({ teamId }) => {
      const result = await client.listWorkflowStates(teamId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_workflow_state",
    "Look up a workflow state by name or ID within a team.",
    {
      teamId: z.string().describe("Team UUID"),
      query: z.string().describe("State name or UUID"),
    },
    async ({ teamId, query }) => {
      const result = await client.getWorkflowState(teamId, query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
