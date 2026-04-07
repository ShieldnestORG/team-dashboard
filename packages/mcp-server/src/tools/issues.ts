import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { TeamDashboardClient } from "../client.js";

export function registerIssueTools(server: McpServer, client: TeamDashboardClient): void {
  server.tool(
    "list_issues",
    "List and filter issues in the workspace. Supports search, filtering by team/status/assignee/project/labels/priority, and pagination.",
    {
      query: z.string().optional().describe("Free-text search across title and description"),
      teamId: z.string().optional().describe("Filter by team"),
      status: z.string().optional().describe("Filter by specific workflow state"),
      stateType: z
        .enum(["triage", "backlog", "unstarted", "started", "completed", "cancelled"])
        .optional()
        .describe("Filter by state category"),
      assigneeId: z.string().optional().describe("Filter by assignee (agent id)"),
      projectId: z.string().optional().describe("Filter by project"),
      parentId: z.string().optional().describe("Filter by parent issue (returns sub-issues)"),
      labelIds: z.array(z.string()).optional().describe("Filter to issues with ALL of these labels"),
      priority: z.number().min(0).max(4).optional().describe("Filter by priority (0=none, 1=urgent, 2=high, 3=medium, 4=low)"),
      includeArchived: z.boolean().optional().describe("Include archived issues. Default: false"),
      orderBy: z
        .enum(["created", "updated", "priority", "due_date"])
        .optional()
        .describe("Sort order. Default: created"),
      limit: z.number().optional().describe("Max results. Default: 50"),
      after: z.string().optional().describe("Cursor for forward pagination"),
      before: z.string().optional().describe("Cursor for backward pagination"),
    },
    async (params) => {
      const result = await client.listIssues(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "get_issue",
    "Retrieve a single issue by ID or identifier (e.g. ENG-123), with all relations, comments, labels, and sub-issues expanded.",
    {
      id: z.string().describe("UUID or human-readable identifier (e.g. ENG-123)"),
    },
    async ({ id }) => {
      const result = await client.getIssue(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "create_issue",
    "Create a new issue in the workspace. Requires a title and team. Returns the created issue with auto-generated identifier.",
    {
      title: z.string().describe("Issue title"),
      teamId: z.string().describe("Team the issue belongs to"),
      description: z.string().optional().describe("Markdown description"),
      status: z.string().optional().describe("Workflow state name or ID. Default: team's default state"),
      priority: z.number().min(0).max(4).optional().describe("0=none, 1=urgent, 2=high, 3=medium, 4=low"),
      estimate: z.number().optional().describe("Point estimate"),
      dueDate: z.string().optional().describe("ISO date"),
      assigneeId: z.string().optional().describe("Agent to assign"),
      projectId: z.string().optional().describe("Project to associate with"),
      milestoneId: z.string().optional().describe("Milestone within the project"),
      parentId: z.string().optional().describe("Parent issue (makes this a sub-issue)"),
      goalId: z.string().optional().describe("Linked goal/objective"),
      labelIds: z.array(z.string()).optional().describe("Labels to apply"),
      sortOrder: z.number().optional().describe("Ordering within views"),
    },
    async (params) => {
      const result = await client.createIssue(params);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "update_issue",
    "Update an existing issue. Only provided fields are changed. Can transition status, reassign, reparent, add/remove from project, etc.",
    {
      id: z.string().describe("UUID or identifier of the issue to update"),
      title: z.string().optional().describe("New title"),
      description: z.string().optional().describe("New markdown description"),
      status: z.string().optional().describe("Transition to a new workflow state"),
      priority: z.number().min(0).max(4).optional().describe("0-4"),
      estimate: z.number().optional().describe("Point estimate"),
      dueDate: z.string().nullable().optional().describe("ISO date, or null to clear"),
      assigneeId: z.string().nullable().optional().describe("Agent id, or null to unassign"),
      projectId: z.string().nullable().optional().describe("Project id, or null to remove from project"),
      milestoneId: z.string().nullable().optional().describe("Milestone id, or null to clear"),
      parentId: z.string().nullable().optional().describe("Reparent, or null to promote to standalone"),
      goalId: z.string().nullable().optional().describe("Goal id, or null to unlink"),
      labelIds: z.array(z.string()).optional().describe("Replaces all labels (not additive)"),
      teamId: z.string().optional().describe("Move to a different team"),
      sortOrder: z.number().optional().describe("Ordering within views"),
    },
    async ({ id, ...data }) => {
      const result = await client.updateIssue(id, data);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  server.tool(
    "archive_issue",
    "Soft-archive an issue. Sets archivedAt timestamp. Does not permanently delete.",
    {
      id: z.string().describe("UUID or identifier of the issue to archive"),
    },
    async ({ id }) => {
      const result = await client.archiveIssue(id);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );
}
