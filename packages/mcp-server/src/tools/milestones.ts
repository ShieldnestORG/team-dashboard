import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerMilestoneTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_milestones",
    "List milestones for a project, ordered by sortOrder.",
    {
      projectId: z.string().describe("Project UUID"),
    },
    async ({ projectId }) => {
      const result = await client.listMilestones(projectId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_milestone",
    "Get a milestone by ID, including issue count by state category.",
    {
      id: z.string().describe("Milestone UUID"),
    },
    async ({ id }) => {
      const result = await client.getMilestone(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_milestone",
    "Create a new milestone within a project.",
    {
      projectId: z.string().describe("Parent project UUID"),
      name: z.string().describe("Milestone name"),
      description: z.string().optional().describe("Milestone description"),
      targetDate: z.string().optional().describe("ISO date"),
      sortOrder: z.number().optional().describe("Ordering within the project"),
    },
    async (params) => {
      const result = await client.createMilestone(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_milestone",
    "Update an existing milestone. Only provided fields are changed.",
    {
      id: z.string().describe("Milestone UUID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      targetDate: z.string().optional().describe("ISO date"),
      sortOrder: z.number().optional().describe("Ordering within the project"),
    },
    async ({ id, ...data }) => {
      const result = await client.updateMilestone(id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
