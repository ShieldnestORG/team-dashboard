import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerTeamTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_teams",
    "List all teams in the workspace.",
    {
      query: z.string().optional().describe("Filter by name"),
    },
    async (params) => {
      const result = await client.listTeams(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_team",
    "Get a team by name, key, or ID.",
    {
      query: z.string().describe("Team name, key, or UUID"),
    },
    async ({ query }) => {
      const result = await client.getTeam(query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
