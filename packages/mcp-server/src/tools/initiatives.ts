import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerInitiativeTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_initiatives",
    "List initiatives in the workspace. Optionally filter by status.",
    {
      status: z
        .enum(["planned", "active", "completed"])
        .optional()
        .describe("Filter by initiative status"),
      limit: z.number().optional().describe("Max results. Default: 50"),
    },
    async (params) => {
      const result = await client.listInitiatives(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_initiative",
    "Get an initiative by name or ID. Returns the initiative with expanded project summaries.",
    {
      query: z.string().describe("Initiative name or UUID"),
    },
    async ({ query }) => {
      const result = await client.getInitiative(query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_initiative",
    "Create a new initiative. Status defaults to planned.",
    {
      name: z.string().describe("Initiative name"),
      description: z.string().optional().describe("Initiative description"),
      ownerId: z.string().optional().describe("Owner agent ID"),
      targetDate: z.string().optional().describe("ISO date"),
      projectIds: z.array(z.string()).optional().describe("Associated project IDs"),
    },
    async (params) => {
      const result = await client.createInitiative(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_initiative",
    "Update an existing initiative. Only provided fields are changed.",
    {
      id: z.string().describe("Initiative UUID"),
      name: z.string().optional().describe("New name"),
      description: z.string().optional().describe("New description"),
      status: z
        .enum(["planned", "active", "completed"])
        .optional()
        .describe("New status"),
      ownerId: z.string().optional().describe("New owner agent ID"),
      targetDate: z.string().optional().describe("ISO date"),
      projectIds: z.array(z.string()).optional().describe("Replace associated project IDs"),
    },
    async ({ id, ...data }) => {
      const result = await client.updateInitiative(id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "archive_initiative",
    "Soft-archive an initiative. Sets archivedAt. Does not delete.",
    {
      id: z.string().describe("Initiative UUID"),
    },
    async ({ id }) => {
      const result = await client.archiveInitiative(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
