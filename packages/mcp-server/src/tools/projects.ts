import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerProjectTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_projects",
    "List projects in the workspace. Supports filtering by team, status, and pagination.",
    {
      teamId: z.string().optional().describe("Filter to projects containing issues from this team"),
      status: z
        .enum(["backlog", "planned", "in_progress", "completed", "cancelled"])
        .optional()
        .describe("Filter by project status"),
      includeArchived: z.boolean().optional().describe("Include archived projects. Default: false"),
      limit: z.number().optional().describe("Max results. Default: 50"),
      after: z.string().optional().describe("Cursor for pagination"),
    },
    async (params) => {
      const result = await client.listProjects(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_project",
    "Get a project by name or ID. Returns the project with milestones and issue count by state category.",
    {
      query: z.string().describe("Project name or UUID"),
    },
    async ({ query }) => {
      const result = await client.getProject(query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_project",
    "Create a new project. Status defaults to backlog.",
    {
      name: z.string().describe("Project name"),
      description: z.string().optional().describe("Project description"),
      summary: z.string().optional().describe("Short summary"),
      leadId: z.string().optional().describe("Lead agent ID"),
      startDate: z.string().optional().describe("ISO date"),
      targetDate: z.string().optional().describe("ISO date"),
    },
    async (params) => {
      const result = await client.createProject(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_project",
    "Update an existing project. Only provided fields are changed.",
    {
      id: z.string().describe("Project UUID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      summary: z.string().optional().describe("New summary"),
      status: z
        .enum(["backlog", "planned", "in_progress", "completed", "cancelled"])
        .optional()
        .describe("New status"),
      leadId: z.string().optional().describe("New lead agent ID"),
      startDate: z.string().optional().describe("ISO date"),
      targetDate: z.string().optional().describe("ISO date"),
    },
    async ({ id, ...data }) => {
      const result = await client.updateProject(id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "archive_project",
    "Soft-archive a project. Sets archivedAt. Does not delete.",
    {
      id: z.string().describe("Project UUID"),
    },
    async ({ id }) => {
      const result = await client.archiveProject(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
