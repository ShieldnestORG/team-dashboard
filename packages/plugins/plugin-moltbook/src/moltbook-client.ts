/**
 * Safe HTTP client for the Moltbook API.
 *
 * Security features:
 *   - Hardcoded base URL (www.moltbook.com only)
 *   - Redirect rejection (no off-domain redirects)
 *   - API key injected via Authorization header, never logged
 *   - Rate limit header tracking
 *   - Full audit logging of every request
 */

import type { PluginHttpClient } from "@paperclipai/plugin-sdk";
import type { MoltbookResponse } from "./types.js";
import { MoltbookRateLimiter } from "./rate-limiter.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const BASE_URL = "https://www.moltbook.com/api/v1";
const ALLOWED_HOST = "www.moltbook.com";

// ─── Types ──────────────────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface ClientRequest {
  method: HttpMethod;
  path: string;
  body?: Record<string, unknown>;
  query?: Record<string, string | number>;
}

export interface AuditEntry {
  endpoint: string;
  method: string;
  requestBody?: Record<string, unknown>;
  responseStatus: number;
  responseBody?: Record<string, unknown>;
  performedAt: string;
  durationMs: number;
  rateLimitRemaining?: number;
}

interface ClientOptions {
  http: PluginHttpClient;
  apiKey: string;
  rateLimiter: MoltbookRateLimiter;
  onAudit?: (entry: AuditEntry) => void;
  logger?: { info: (msg: string, meta?: Record<string, unknown>) => void; warn: (msg: string, meta?: Record<string, unknown>) => void; error: (msg: string, meta?: Record<string, unknown>) => void };
}

// ─── Client class ───────────────────────────────────────────────────────────

export class MoltbookClient {
  private http: PluginHttpClient;
  private apiKey: string;
  private rateLimiter: MoltbookRateLimiter;
  private onAudit?: (entry: AuditEntry) => void;
  private logger?: ClientOptions["logger"];

  constructor(opts: ClientOptions) {
    this.http = opts.http;
    this.apiKey = opts.apiKey;
    this.rateLimiter = opts.rateLimiter;
    this.onAudit = opts.onAudit;
    this.logger = opts.logger;
  }

  // ─── Public API methods ─────────────────────────────────────────────────

  // Registration (no auth required)
  async register(name: string, description: string): Promise<MoltbookResponse> {
    return this.request({
      method: "POST",
      path: "/agents/register",
      body: { name, description },
    }, { skipAuth: true });
  }

  // Status
  async getStatus(): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/agents/status" });
  }

  // Profile
  async getMyProfile(): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/agents/me" });
  }

  async getAgentProfile(name: string): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/agents/profile", query: { name } });
  }

  async updateProfile(data: Record<string, unknown>): Promise<MoltbookResponse> {
    return this.request({ method: "PATCH", path: "/agents/me", body: data });
  }

  // Posts
  async createPost(data: Record<string, unknown>): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: "/posts", body: data });
  }

  async getFeed(sort: string = "hot", limit: number = 25): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/posts", query: { sort, limit } });
  }

  async getPersonalizedFeed(sort: string = "hot", limit: number = 25, filter?: string): Promise<MoltbookResponse> {
    const query: Record<string, string | number> = { sort, limit };
    if (filter) query.filter = filter;
    return this.request({ method: "GET", path: "/feed", query });
  }

  async deletePost(postId: string): Promise<MoltbookResponse> {
    return this.request({ method: "DELETE", path: `/posts/${postId}` });
  }

  // Comments
  async createComment(postId: string, content: string, parentId?: string): Promise<MoltbookResponse> {
    const body: Record<string, unknown> = { content };
    if (parentId) body.parent_id = parentId;
    return this.request({ method: "POST", path: `/posts/${postId}/comments`, body });
  }

  async getComments(postId: string, sort: string = "best", limit: number = 35): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: `/posts/${postId}/comments`, query: { sort, limit } });
  }

  // Voting
  async upvotePost(postId: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/posts/${postId}/upvote` });
  }

  async downvotePost(postId: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/posts/${postId}/downvote` });
  }

  async upvoteComment(commentId: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/comments/${commentId}/upvote` });
  }

  // Communities (Submolts)
  async createSubmolt(data: Record<string, unknown>): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: "/submolts", body: data });
  }

  async listSubmolts(): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/submolts" });
  }

  async subscribe(submoltName: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/submolts/${submoltName}/subscribe` });
  }

  async unsubscribe(submoltName: string): Promise<MoltbookResponse> {
    return this.request({ method: "DELETE", path: `/submolts/${submoltName}/subscribe` });
  }

  // Following
  async follow(agentName: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/agents/${agentName}/follow` });
  }

  async unfollow(agentName: string): Promise<MoltbookResponse> {
    return this.request({ method: "DELETE", path: `/agents/${agentName}/follow` });
  }

  // Search
  async search(query: string, type: string = "all", limit: number = 20): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/search", query: { q: query, type, limit } });
  }

  // Notifications
  async getDashboard(): Promise<MoltbookResponse> {
    return this.request({ method: "GET", path: "/home" });
  }

  async markNotificationsRead(postId?: string): Promise<MoltbookResponse> {
    if (postId) {
      return this.request({ method: "POST", path: `/notifications/read-by-post/${postId}` });
    }
    return this.request({ method: "POST", path: "/notifications/read-all" });
  }

  // Verification
  async submitVerification(verificationCode: string, answer: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: "/verify", body: { verification_code: verificationCode, answer } });
  }

  // Moderation
  async pinPost(postId: string): Promise<MoltbookResponse> {
    return this.request({ method: "POST", path: `/posts/${postId}/pin` });
  }

  // ─── Core request handler ───────────────────────────────────────────────

  private async request(
    req: ClientRequest,
    opts: { skipAuth?: boolean } = {},
  ): Promise<MoltbookResponse> {
    const requestType = req.method === "GET" ? "read" as const : "write" as const;

    // Rate limit check
    const rlCheck = this.rateLimiter.canMakeRequest(requestType);
    if (!rlCheck.allowed) {
      this.logger?.warn("Rate limit would be exceeded", { retryAfterMs: rlCheck.retryAfterMs });
      return {
        success: false,
        error: `Rate limit exceeded. Retry after ${Math.ceil((rlCheck.retryAfterMs ?? 5000) / 1000)}s`,
        hint: "The local rate limiter is protecting you from hitting Moltbook's limits.",
      };
    }

    // Build URL
    let url = `${BASE_URL}${req.path}`;
    if (req.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(req.query)) {
        params.set(k, String(v));
      }
      url += `?${params.toString()}`;
    }

    // Validate URL stays on allowed host
    const parsed = new URL(url);
    if (parsed.hostname !== ALLOWED_HOST) {
      this.logger?.error("Domain lockdown violation", { hostname: parsed.hostname });
      return { success: false, error: `Blocked: request to ${parsed.hostname} rejected. Only ${ALLOWED_HOST} is allowed.` };
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (!opts.skipAuth) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    // Execute
    const startMs = Date.now();
    let response: Response;
    try {
      response = await this.http.fetch(url, {
        method: req.method,
        headers,
        body: req.body ? JSON.stringify(req.body) : undefined,
        redirect: "manual", // prevent off-domain redirects
      });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      this.logger?.error("HTTP request failed", { url: req.path, error: String(err) });
      this.emitAudit(req, 0, undefined, durationMs);
      return { success: false, error: `Network error: ${String(err)}` };
    }

    const durationMs = Date.now() - startMs;

    // Check for redirect (domain lockdown)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location") ?? "";
      this.logger?.warn("Redirect detected and blocked", { status: response.status, location });
      this.emitAudit(req, response.status, undefined, durationMs);
      return { success: false, error: `Redirect blocked: ${response.status} → ${location}` };
    }

    // Record in rate limiter
    this.rateLimiter.recordRequest(requestType);

    // Update rate limiter from response headers
    const headerMap: Record<string, string> = {};
    response.headers.forEach((v, k) => { headerMap[k.toLowerCase()] = v; });
    this.rateLimiter.updateFromHeaders(requestType, headerMap);

    // Handle 429
    if (response.status === 429) {
      this.rateLimiter.enterPanicMode();
      this.logger?.warn("429 received — entering panic mode for 1 hour");
      this.emitAudit(req, 429, undefined, durationMs, parseInt(headerMap["x-ratelimit-remaining"] ?? "0", 10));
      return { success: false, error: "Rate limited by Moltbook (429). Panic mode activated — budgets halved for 1 hour." };
    }

    // Parse response
    let body: MoltbookResponse;
    try {
      body = await response.json() as MoltbookResponse;
    } catch {
      body = { success: response.ok, error: response.ok ? undefined : `HTTP ${response.status}` };
    }

    // Audit
    const remaining = parseInt(headerMap["x-ratelimit-remaining"] ?? "", 10);
    this.emitAudit(req, response.status, body, durationMs, isNaN(remaining) ? undefined : remaining);

    return body;
  }

  private emitAudit(
    req: ClientRequest,
    status: number,
    responseBody: Record<string, unknown> | undefined,
    durationMs: number,
    rateLimitRemaining?: number,
  ): void {
    if (!this.onAudit) return;

    // Scrub API key from any logged request body (defensive)
    const sanitizedBody = req.body ? { ...req.body } : undefined;
    if (sanitizedBody && "api_key" in sanitizedBody) {
      sanitizedBody.api_key = "[REDACTED]";
    }

    this.onAudit({
      endpoint: req.path,
      method: req.method,
      requestBody: sanitizedBody,
      responseStatus: status,
      responseBody: responseBody as Record<string, unknown> | undefined,
      performedAt: new Date().toISOString(),
      durationMs,
      rateLimitRemaining,
    });
  }
}
