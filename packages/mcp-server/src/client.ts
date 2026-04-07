/**
 * HTTP client for the Team Dashboard REST API.
 *
 * Wraps native `fetch` with auth headers and JSON parsing.
 * Every method corresponds to an API endpoint used by one or more MCP tools.
 */

export interface PaginationParams {
  limit?: number;
  after?: string;
  before?: string;
}

export class TeamDashboardClient {
  private baseUrl: string;
  private token: string;
  private companyId: string;

  constructor(opts: { baseUrl?: string; token: string; companyId: string }) {
    this.baseUrl = (opts.baseUrl ?? "http://localhost:3100").replace(/\/+$/, "");
    this.token = opts.token;
    this.companyId = opts.companyId;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}/api${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API ${method} ${path} failed (${res.status}): ${text}`);
    }

    return res.json() as Promise<T>;
  }

  private get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private patch<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  private del<T = unknown>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private qs(params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(
      ([, v]) => v !== undefined && v !== null,
    );
    if (entries.length === 0) return "";
    const sp = new URLSearchParams();
    for (const [k, v] of entries) {
      if (Array.isArray(v)) {
        for (const item of v) sp.append(k, String(item));
      } else {
        sp.set(k, String(v));
      }
    }
    return `?${sp.toString()}`;
  }

  // ---------------------------------------------------------------------------
  // Issues
  // ---------------------------------------------------------------------------

  async listIssues(params: {
    query?: string;
    teamId?: string;
    status?: string;
    stateType?: string;
    assigneeId?: string;
    projectId?: string;
    parentId?: string;
    labelIds?: string[];
    priority?: number;
    includeArchived?: boolean;
    orderBy?: string;
    limit?: number;
    after?: string;
    before?: string;
  } = {}): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/issues${this.qs(params)}`);
  }

  async getIssue(id: string): Promise<unknown> {
    return this.get(`/issues/${id}`);
  }

  async createIssue(data: {
    title: string;
    teamId: string;
    description?: string;
    status?: string;
    priority?: number;
    estimate?: number;
    dueDate?: string;
    assigneeId?: string;
    projectId?: string;
    milestoneId?: string;
    parentId?: string;
    goalId?: string;
    labelIds?: string[];
    sortOrder?: number;
  }): Promise<unknown> {
    return this.post(`/companies/${this.companyId}/issues`, data as Record<string, unknown>);
  }

  async updateIssue(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.patch(`/issues/${id}`, data);
  }

  async archiveIssue(id: string): Promise<unknown> {
    return this.del(`/issues/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async listProjects(params: {
    teamId?: string;
    status?: string;
    includeArchived?: boolean;
    limit?: number;
    after?: string;
  } = {}): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/projects${this.qs(params)}`);
  }

  async getProject(id: string): Promise<unknown> {
    return this.get(`/projects/${id}`);
  }

  async createProject(data: {
    name: string;
    description?: string;
    summary?: string;
    leadId?: string;
    startDate?: string;
    targetDate?: string;
  }): Promise<unknown> {
    return this.post(`/companies/${this.companyId}/projects`, data as Record<string, unknown>);
  }

  async updateProject(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.patch(`/projects/${id}`, data);
  }

  async archiveProject(id: string): Promise<unknown> {
    return this.del(`/projects/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Milestones (nested under projects)
  // ---------------------------------------------------------------------------

  async listMilestones(projectId: string): Promise<unknown> {
    return this.get(`/projects/${projectId}/milestones`);
  }

  async getMilestone(id: string): Promise<unknown> {
    return this.get(`/milestones/${id}`);
  }

  async createMilestone(data: {
    projectId: string;
    name: string;
    description?: string;
    targetDate?: string;
    sortOrder?: number;
  }): Promise<unknown> {
    const { projectId, ...body } = data;
    return this.post(`/projects/${projectId}/milestones`, body as Record<string, unknown>);
  }

  async updateMilestone(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.patch(`/milestones/${id}`, data);
  }

  // ---------------------------------------------------------------------------
  // Labels
  // ---------------------------------------------------------------------------

  async listLabels(params: { teamId?: string } = {}): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/labels${this.qs(params)}`);
  }

  async getLabel(id: string): Promise<unknown> {
    return this.get(`/labels/${id}`);
  }

  async createLabel(data: {
    name: string;
    color?: string;
    description?: string;
    teamId?: string;
    groupId?: string;
  }): Promise<unknown> {
    return this.post(`/companies/${this.companyId}/labels`, data as Record<string, unknown>);
  }

  async updateLabel(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.patch(`/labels/${id}`, data);
  }

  // ---------------------------------------------------------------------------
  // Teams (agents grouped by team in this system)
  // ---------------------------------------------------------------------------

  async listTeams(params: { query?: string } = {}): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/agents${this.qs(params)}`);
  }

  async getTeam(id: string): Promise<unknown> {
    return this.get(`/agents/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Workflow States
  // ---------------------------------------------------------------------------

  async listWorkflowStates(teamId: string): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/issues${this.qs({ teamId, limit: 0 })}`);
  }

  async getWorkflowState(teamId: string, query: string): Promise<unknown> {
    return this.get(
      `/companies/${this.companyId}/issues${this.qs({ teamId, status: query, limit: 0 })}`,
    );
  }

  // ---------------------------------------------------------------------------
  // Comments
  // ---------------------------------------------------------------------------

  async listComments(issueId: string, params: { limit?: number } = {}): Promise<unknown> {
    return this.get(`/issues/${issueId}/comments${this.qs(params)}`);
  }

  async createComment(data: {
    issueId: string;
    body: string;
    parentId?: string;
  }): Promise<unknown> {
    const { issueId, ...body } = data;
    return this.post(`/issues/${issueId}/comments`, body as Record<string, unknown>);
  }

  async updateComment(id: string, data: { body: string }): Promise<unknown> {
    return this.patch(`/comments/${id}`, data as Record<string, unknown>);
  }

  async resolveComment(id: string): Promise<unknown> {
    return this.post(`/comments/${id}/resolve`);
  }

  // ---------------------------------------------------------------------------
  // Issue Relations
  // ---------------------------------------------------------------------------

  async listIssueRelations(issueId: string): Promise<unknown> {
    return this.get(`/issues/${issueId}/relations`);
  }

  async createIssueRelation(data: {
    issueId: string;
    relatedIssueId: string;
    type: string;
  }): Promise<unknown> {
    const { issueId, ...body } = data;
    return this.post(`/issues/${issueId}/relations`, body as Record<string, unknown>);
  }

  async deleteIssueRelation(id: string): Promise<unknown> {
    return this.del(`/relations/${id}`);
  }

  // ---------------------------------------------------------------------------
  // Initiatives (mapped to goals in the REST API)
  // ---------------------------------------------------------------------------

  async listInitiatives(params: {
    status?: string;
    limit?: number;
  } = {}): Promise<unknown> {
    return this.get(`/companies/${this.companyId}/goals${this.qs(params)}`);
  }

  async getInitiative(id: string): Promise<unknown> {
    return this.get(`/goals/${id}`);
  }

  async createInitiative(data: {
    name: string;
    description?: string;
    ownerId?: string;
    targetDate?: string;
    projectIds?: string[];
  }): Promise<unknown> {
    return this.post(`/companies/${this.companyId}/goals`, data as Record<string, unknown>);
  }

  async updateInitiative(
    id: string,
    data: Record<string, unknown>,
  ): Promise<unknown> {
    return this.patch(`/goals/${id}`, data);
  }

  async archiveInitiative(id: string): Promise<unknown> {
    return this.del(`/goals/${id}`);
  }
}
