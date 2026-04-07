import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerLabelTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_labels",
    "List labels available for a team. Includes workspace-level labels. Grouped by label group.",
    {
      teamId: z.string().optional().describe("Team ID. If omitted, returns only workspace labels"),
    },
    async (params) => {
      const result = await client.listLabels(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_label",
    "Get a label by name or ID.",
    {
      query: z.string().describe("Label name or UUID"),
    },
    async ({ query }) => {
      const result = await client.getLabel(query);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_label",
    "Create a new label. Can be workspace-level or team-scoped.",
    {
      name: z.string().describe("Label name"),
      color: z.string().optional().describe("Hex color. Auto-assigned if omitted"),
      description: z.string().optional().describe("Label description"),
      teamId: z.string().optional().describe("Team ID. Omit for workspace-level label"),
      groupId: z.string().optional().describe("Parent label group ID"),
    },
    async (params) => {
      const result = await client.createLabel(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_label",
    "Update an existing label. Only provided fields are changed.",
    {
      id: z.string().describe("Label UUID"),
      name: z.string().optional().describe("New name"),
      color: z.string().optional().describe("New hex color"),
      description: z.string().optional().describe("New description"),
    },
    async ({ id, ...data }) => {
      const result = await client.updateLabel(id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
