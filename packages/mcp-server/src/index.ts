#!/usr/bin/env node

/**
 * Paperclip MCP Server
 *
 * Exposes 35 tools for managing issues, projects, milestones, labels, teams,
 * workflow states, comments, issue relations, and initiatives via the
 * Model Context Protocol (MCP). Connects to the Team Dashboard REST API.
 *
 * Configuration via environment variables:
 *   PAPERCLIP_API_URL   - Base URL of the Team Dashboard API (default: http://localhost:3100)
 *   PAPERCLIP_API_TOKEN - JWT or API key for authentication (required)
 *   PAPERCLIP_COMPANY_ID - Company UUID to scope operations to (required)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TeamDashboardClient } from "./client.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerMilestoneTools } from "./tools/milestones.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerWorkflowStateTools } from "./tools/workflow-states.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerRelationTools } from "./tools/relations.js";
import { registerInitiativeTools } from "./tools/initiatives.js";

async function main() {
  const apiUrl = process.env.PAPERCLIP_API_URL ?? "http://localhost:3100";
  const token = process.env.PAPERCLIP_API_TOKEN;
  const companyId = process.env.PAPERCLIP_COMPANY_ID;

  if (!token) {
    console.error("PAPERCLIP_API_TOKEN is required");
    process.exit(1);
  }

  if (!companyId) {
    console.error("PAPERCLIP_COMPANY_ID is required");
    process.exit(1);
  }

  const client = new TeamDashboardClient({ baseUrl: apiUrl, token, companyId });

  const server = new McpServer({
    name: "paperclip",
    version: "0.1.0",
  });

  // Register all 35 tools across 9 entities
  registerIssueTools(server, client);       // 5 tools
  registerProjectTools(server, client);     // 5 tools
  registerMilestoneTools(server, client);   // 4 tools
  registerLabelTools(server, client);       // 4 tools
  registerTeamTools(server, client);        // 2 tools
  registerWorkflowStateTools(server, client); // 2 tools
  registerCommentTools(server, client);     // 4 tools
  registerRelationTools(server, client);    // 3 tools
  registerInitiativeTools(server, client);  // 5 tools
  // Total: 34 tools + list_my_issues (below) = 35

  // list_my_issues is a convenience wrapper, registered directly here
  const { z } = await import("zod");
  server.tool(
    "list_my_issues",
    "List issues assigned to a specific agent. Convenience wrapper around list_issues with assigneeId pre-filled.",
    {
      agentId: z.string().describe("The agent whose issues to list"),
      stateType: z
        .enum(["triage", "backlog", "unstarted", "started", "completed", "cancelled"])
        .optional()
        .describe("Filter by state category"),
      orderBy: z
        .enum(["created", "updated", "priority", "due_date"])
        .optional()
        .describe("Sort order. Default: priority"),
      limit: z.number().optional().describe("Max results. Default: 50"),
    },
    async ({ agentId, ...params }) => {
      const result = await client.listIssues({
        assigneeId: agentId,
        orderBy: params.orderBy ?? "priority",
        ...params,
      });
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
