/**
 * HTTP client for the Team Dashboard MARKETING surface.
 *
 * Companion to `client.ts` (issues/projects) but deliberately separate: this
 * one authenticates with a marketing-scoped board API key (`pcp_board_…`),
 * needs no company id (the marketing endpoints are single-company
 * server-side), and only speaks to the marketing-gate allowlisted routes:
 * /api/socials/*, /api/voice-snippets/*, /api/assets/* (GET),
 * /api/cli-auth/key-info. Everything else 403s server-side by design.
 */

export class MarketingApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MarketingApiError";
  }
}

export interface KeyInfo {
  keyId: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  userId: string;
  user: { id: string; name: string | null; email: string | null } | null;
  isInstanceAdmin: boolean;
  memberships: Array<{ companyId: string; role: string | null }>;
}

export class MarketingClient {
  private baseUrl: string;
  private token: string;

  constructor(opts: { baseUrl: string; token: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new MarketingApiError(await this.friendlyError(res), res.status);
    }
    return res.json() as Promise<T>;
  }

  /**
   * The dashboard's error bodies are already plain English ({ error: "…" }).
   * Surface that text; add context only for auth failures so Eagan's Claude
   * can explain what to do next.
   */
  private async friendlyError(res: Response): Promise<string> {
    let detail = "";
    try {
      const parsed = (await res.json()) as { error?: string };
      if (parsed && typeof parsed.error === "string") detail = parsed.error;
    } catch {
      // non-JSON body — fall through to the generic message
    }
    if (res.status === 401) {
      return (
        detail ||
        "The dashboard rejected the access key (expired or revoked). Ask Mark for a new key."
      );
    }
    if (res.status === 403) {
      return (
        detail ||
        "That action is outside this key's marketing scope — it is not a bug, do not retry."
      );
    }
    return detail || `Dashboard request failed (HTTP ${res.status}).`;
  }

  private get<T = unknown>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T = unknown>(path: string, body?: Record<string, unknown>): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private qs(params: Record<string, unknown>): string {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (entries.length === 0) return "";
    const sp = new URLSearchParams();
    for (const [k, v] of entries) sp.set(k, String(v));
    return `?${sp.toString()}`;
  }

  // ----- Key identity / expiry -----

  keyInfo(): Promise<KeyInfo> {
    return this.get<KeyInfo>("/api/cli-auth/key-info");
  }

  // ----- Reads -----

  captionStyles(): Promise<unknown> {
    return this.get("/api/socials/caption-styles");
  }

  listFunnels(params: { status?: string; accountHandle?: string } = {}): Promise<unknown> {
    return this.get(`/api/socials/funnels${this.qs(params)}`);
  }

  funnelCatalog(): Promise<unknown> {
    return this.get("/api/socials/funnels/catalog");
  }

  funnelCoverage(): Promise<unknown> {
    return this.get("/api/socials/funnels/coverage");
  }

  funnelPosts(funnelId: string, limit?: number): Promise<unknown> {
    return this.get(`/api/socials/funnels/${encodeURIComponent(funnelId)}/posts${this.qs({ limit })}`);
  }

  listAccounts(): Promise<unknown> {
    return this.get("/api/socials/accounts");
  }

  listInspiration(status?: string): Promise<unknown> {
    return this.get(`/api/socials/inspiration${this.qs({ status })}`);
  }

  listBriefs(limit?: number): Promise<unknown> {
    return this.get(`/api/socials/briefs${this.qs({ limit })}`);
  }

  latestBrief(): Promise<unknown> {
    return this.get("/api/socials/briefs/latest");
  }

  briefByDate(date: string): Promise<unknown> {
    return this.get(`/api/socials/briefs/${encodeURIComponent(date)}`);
  }

  // ----- Generate / draft-handoff writes (all admin-approved server-side) -----

  generateVoiceClip(voiceKey: string, text: string): Promise<{
    assetId: string;
    contentPath: string;
    voiceName: string;
    durationSec: number | null;
    byteSize: number | null;
    cached: boolean;
  }> {
    return this.post("/api/voice-snippets", { voiceKey, text });
  }

  addInspiration(url: string, note?: string): Promise<unknown> {
    return this.post("/api/socials/inspiration", { url, ...(note ? { note } : {}) });
  }

  createDraftPost(data: {
    socialAccountId: string;
    text: string;
    mediaUrls?: string[];
    altTexts?: string[];
    replyToUrl?: string;
    scheduledAt?: string;
  }): Promise<unknown> {
    return this.post("/api/socials/posts", data as Record<string, unknown>);
  }

  /** Download an authenticated asset (e.g. a generated voice clip) as bytes. */
  async downloadAsset(contentPath: string): Promise<Uint8Array> {
    const res = await fetch(`${this.baseUrl}${contentPath}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!res.ok) {
      throw new MarketingApiError(await this.friendlyError(res), res.status);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Multipart upload to the media staging endpoint (field name: "file"). */
  async uploadMedia(fileName: string, bytes: Uint8Array): Promise<unknown> {
    const form = new FormData();
    form.append("file", new Blob([bytes as BlobPart]), fileName);
    const res = await fetch(`${this.baseUrl}/api/socials/media`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}` },
      body: form,
    });
    if (!res.ok) {
      throw new MarketingApiError(await this.friendlyError(res), res.status);
    }
    return res.json();
  }
}
