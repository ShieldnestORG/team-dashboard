import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerRelationTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_issue_relations",
    "List all relations for an issue. Each relation includes an expanded summary of the related issue.",
    {
      issueId: z.string().describe("Issue UUID or identifier"),
    },
    async ({ issueId }) => {
      const result = await client.listIssueRelations(issueId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_issue_relation",
    "Create a relation between two issues. Types: related, blocks, blocked_by, duplicate. Creating 'blocks' A->B also creates 'blocked_by' B->A.",
    {
      issueId: z.string().describe("Source issue UUID or identifier"),
      relatedIssueId: z.string().describe("Target issue UUID or identifier"),
      type: z
        .enum(["related", "blocks", "blocked_by", "duplicate"])
        .describe("Relation type"),
    },
    async (params) => {
      const result = await client.createIssueRelation(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "delete_issue_relation",
    "Remove a relation between two issues.",
    {
      id: z.string().describe("Relation UUID"),
    },
    async ({ id }) => {
      const result = await client.deleteIssueRelation(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
