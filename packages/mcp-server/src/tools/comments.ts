import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerCommentTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_comments",
    "List comments on an issue. Returns threaded comments (top-level with nested children).",
    {
      issueId: z.string().describe("Issue UUID or identifier"),
      limit: z.number().optional().describe("Max results. Default: 50"),
    },
    async ({ issueId, ...params }) => {
      const result = await client.listComments(issueId, params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_comment",
    "Add a comment to an issue. Supports threading via parentId.",
    {
      issueId: z.string().describe("Issue UUID or identifier"),
      body: z.string().describe("Comment body (Markdown)"),
      parentId: z.string().optional().describe("Reply to an existing comment (thread)"),
    },
    async (params) => {
      const result = await client.createComment(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_comment",
    "Update a comment's body.",
    {
      id: z.string().describe("Comment UUID"),
      body: z.string().describe("New comment body (Markdown)"),
    },
    async ({ id, body }) => {
      const result = await client.updateComment(id, { body });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "resolve_comment",
    "Mark a comment thread as resolved. Sets resolvedAt timestamp.",
    {
      id: z.string().describe("Comment UUID"),
    },
    async ({ id }) => {
      const result = await client.resolveComment(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
