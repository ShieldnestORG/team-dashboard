import { api } from "./client.js";

export interface SocialAccount {
  id: string;
  companyId: string;
  brand: string;
  platform: string;
  handle: string;
  displayName: string | null;
  profileUrl: string | null;
  connectionType: "oauth" | "api_key" | "manual" | "none";
  oauthRef: string | null;
  // Derived by GET /socials/accounts: which publisher this account posts through.
  // "zernio" when oauthRef starts with "zernio:", else "native". Absent on
  // create/update responses, hence optional.
  routing?: "zernio" | "native";
  status: "active" | "dormant" | "paused" | "deprecated";
  automationMode: "full_auto" | "assisted" | "manual" | "none";
  automationNotes: string | null;
  lastActivityAt: string | null;
  ownerUserId: string | null;
  tags: string[];
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  // Zernio linkage + funnel master-switch. Present on GET /socials/accounts
  // rows; absent on create/update responses, hence optional.
  zernioAccountId?: string | null;
  funnelsEnabled?: boolean;
}

export interface SocialAutomation {
  id: string;
  socialAccountId: string | null;
  kind: string;
  cronExpr: string | null;
  personalityId: string | null;
  contentType: string | null;
  sourceRef: string;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  notes: string | null;
}

export interface SocialPost {
  id: string;
  socialAccountId: string;
  text: string;
  mediaUrls: string[];
  altTexts: string[];
  replyToUrl: string | null;
  scheduledAt: string;
  status: "scheduled" | "pending_approval" | "publishing" | "posted" | "failed" | "canceled";
  attempts: number;
  maxAttempts: number;
  postedUrl: string | null;
  platformPostId: string | null;
  error: string | null;
  createdAt: string;
  postedAt: string | null;
  platform: string;
  brand: string;
  handle: string;
  createdByUserId?: string | null;
  authorEmail?: string | null;
  authorName?: string | null;
}

export interface NewSocialPost {
  socialAccountId: string;
  text: string;
  mediaUrls?: string[];
  altTexts?: string[];
  replyToUrl?: string;
  scheduledAt?: string;
  maxAttempts?: number;
  payload?: Record<string, unknown>;
}

export interface RelayerTickResult {
  picked: number;
  posted: number;
  failed: number;
  retrying: number;
  skipped: number;
}

export interface PlatformCap {
  id: string;
  platform: string;
  maxGeneratedPerDay: number;
  maxPublishedPerDay: number;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCounter {
  platform: string;
  generatedToday: number;
  generatedCap: number;
  publishedToday: number;
  publishedCap: number;
  queued: number;
  failed24h: number;
  enabled: boolean;
}

// Green-light board rows (GET /socials/zernio/greenlight — mirror-backed,
// read-only). Shape mirrors GreenlightRow in server/src/routes/socials.ts.
export interface ZernioGreenlightStats {
  /** null = Zernio didn't report this number — render "not reported", never 0. */
  triggered: number | null;
  dmsSent: number | null;
  linkClicks: number | null;
}

export interface ZernioGreenlightRow {
  keyword: string;
  automationName: string;
  /** Stable per-row identity with the keyword — account+keyword is NOT unique. */
  zernioAutomationId: string;
  zernioAccountId: string;
  /** "@handle" of the connected account, or the raw Zernio id. */
  accountLabel: string;
  clickTag: string | null;
  isActive: boolean;
  lastSyncedAt: string | null;
  stats: ZernioGreenlightStats;
  tone: "green" | "amber" | "red";
  addonMissing: boolean;
}

export interface CalendarEvent {
  id: string;
  source: "content" | "cron-projection";
  when: string;
  brand: string;
  platform: string;
  status: string;
  title: string;
  contentItemId?: string;
  socialAccountId?: string | null;
  automated: boolean;
}

// ---------------------------------------------------------------------------
// Funnels — Zernio comment→DM automation mirror + strategy catalog + leads.
// Response shapes are DEFENSIVE: the Zernio mirror + strategy catalog carry
// free-form jsonb whose fields vary per row. Treat every optional as maybe-absent.
// ---------------------------------------------------------------------------

// One row of GET /socials/zernio/automations/mirror — a live comment→DM
// automation as last synced from Zernio (mirror refreshes hourly).
export interface ZernioAutomationMirror {
  zernioAutomationId: string;
  zernioAccountId: string;
  name: string;
  platform: string;
  trigger: string | null;
  keywords: string[];
  matchMode: string | null;
  dmMessage: string | null;
  clickTag: string | null;
  isActive: boolean;
  // jsonb blob, shape varies (may carry triggered / dmsSent / clicks …).
  stats: Record<string, unknown> | null;
  lastSyncedAt: string | null;
}

// Result of toggling one automation on/off. `mechanism` reports how Zernio
// actually applied the change — "patch" flips a flag, "delete" removes the
// automation, "recreate" re-adds it. Never imply success the mechanism denies.
export interface ZernioAutomationToggleResult {
  ok: boolean;
  isActive: boolean;
  mechanism: "patch" | "delete" | "recreate";
  zernioAutomationId: string;
}

// One automation killed as a side effect of turning an account's funnels OFF.
export interface KilledAutomation {
  zernioAutomationId: string;
  name: string;
  mechanism?: "patch" | "delete" | "recreate";
  ok: boolean;
  error?: string;
}

export interface AccountFunnelsToggleResult {
  ok: boolean;
  funnelsEnabled: boolean;
  killed: KilledAutomation[];
}

// One entry of the read-only strategy catalog (GET /socials/funnels/catalog).
// 19 entries; fields vary widely per status — everything past id/name/status
// is optional.
export interface FunnelCatalogEntry {
  id: string;
  name: string;
  status: string;
  accounts?: string[];
  trigger?: string;
  destination?: string;
  mechanic?: string;
  tos_risk?: string;
  clickTag?: string;
  [key: string]: unknown;
}

export interface FunnelCatalog {
  snapshotDate: string | null;
  source: string | null;
  funnels: FunnelCatalogEntry[];
}

// One captured lead (GET /socials/leads).
export interface FunnelLead {
  id: string;
  captureKind: string | null;
  platform: string | null;
  zernioAccountId: string | null;
  handle: string | null;
  displayName: string | null;
  email: string | null;
  keyword: string | null;
  clickTag: string | null;
  eventCount: number | null;
  lastEventAt: string | null;
  brevoSyncedAt: string | null;
}

// One inbound Zernio webhook event (GET /socials/zernio/events).
export interface ZernioEvent {
  id: string;
  eventType: string | null;
  receivedAt: string | null;
  processedAt: string | null;
  error: string | null;
}

export const socialsApi = {
  listAccounts: (params?: { brand?: string; platform?: string; status?: string }) => {
    const q = new URLSearchParams();
    if (params?.brand) q.set("brand", params.brand);
    if (params?.platform) q.set("platform", params.platform);
    if (params?.status) q.set("status", params.status);
    const qs = q.toString();
    return api.get<{ accounts: SocialAccount[] }>(`/socials/accounts${qs ? `?${qs}` : ""}`);
  },
  createAccount: (data: Partial<SocialAccount>) =>
    api.post<{ account: SocialAccount }>("/socials/accounts", data),
  updateAccount: (id: string, data: Partial<SocialAccount>) =>
    api.patch<{ account: SocialAccount }>(`/socials/accounts/${id}`, data),
  archiveAccount: (id: string) => api.delete<{ ok: true }>(`/socials/accounts/${id}`),
  listAutomations: (accountId?: string) =>
    api.get<{ automations: SocialAutomation[] }>(
      `/socials/automations${accountId ? `?accountId=${accountId}` : ""}`,
    ),
  // Fast mirror-backed read (no Zernio call) — the Content Hub's default.
  getZernioGreenlight: () =>
    api.get<{ rows: ZernioGreenlightRow[]; source: string; generatedAt: string }>(
      "/socials/zernio/greenlight",
    ),
  // ONE live Zernio fetch per key + mirror refresh side effect. Explicit
  // user action only ("Refresh from Zernio now") — rate limits are shared
  // with Mark's crons and the team's Claude account. Read-only endpoint.
  refreshZernioAutomations: () =>
    api.get<{ automations: unknown[]; errors: unknown[] }>("/socials/zernio/automations"),
  syncAutomations: () => api.post<{ upserted: number; skipped: number }>("/socials/automations/sync", {}),
  listPosts: (params?: { accountId?: string; status?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.accountId) q.set("accountId", params.accountId);
    if (params?.status) q.set("status", params.status);
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api.get<{ posts: SocialPost[] }>(`/socials/posts${qs ? `?${qs}` : ""}`);
  },
  createPost: (data: NewSocialPost) =>
    api.post<{ post: SocialPost; pendingApproval: boolean }>("/socials/posts", data),
  approvePost: (id: string, body?: { scheduledAt?: string }) =>
    api.post<{ post: SocialPost }>(`/socials/posts/${id}/approve`, body ?? {}),
  cancelPost: (id: string) => api.delete<{ ok: true }>(`/socials/posts/${id}`),
  relayNow: () => api.post<RelayerTickResult>("/socials/posts/relay-now", {}),
  listPlatformCaps: () =>
    api.get<{ caps: PlatformCap[] }>("/socials/platform-caps"),
  updatePlatformCap: (
    platform: string,
    data: Partial<Pick<PlatformCap, "maxGeneratedPerDay" | "maxPublishedPerDay" | "enabled" | "notes">>,
  ) => api.patch<{ cap: PlatformCap }>(`/socials/platform-caps/${platform}`, data),
  listPlatformCounters: () =>
    api.get<{ counters: PlatformCounter[] }>("/socials/platform-counters"),
  calendar: (params: { from?: string; to?: string; brand?: string; platform?: string }) => {
    const q = new URLSearchParams();
    if (params.from) q.set("from", params.from);
    if (params.to) q.set("to", params.to);
    if (params.brand) q.set("brand", params.brand);
    if (params.platform) q.set("platform", params.platform);
    return api.get<{ from: string; to: string; events: CalendarEvent[] }>(
      `/socials/calendar?${q.toString()}`,
    );
  },

  // ── Funnels ───────────────────────────────────────────────────────────────
  // Live comment→DM automation mirror (refreshes hourly).
  zernioAutomationsMirror: () =>
    api.get<{ automations: ZernioAutomationMirror[] }>(
      "/socials/zernio/automations/mirror",
    ),
  // Toggle one automation on/off directly on Zernio. 404 = not found;
  // 409 {error} when enabling on a funnels-disabled account.
  setAutomationActive: (
    automationId: string,
    body: { zernioAccountId: string; isActive: boolean },
  ) =>
    api.patch<ZernioAutomationToggleResult>(
      `/socials/zernio/automations/${automationId}`,
      body,
    ),
  // Master switch: enable/disable ALL funnels for an account. Disabling
  // kills every live automation on Zernio (see `killed`).
  setAccountFunnels: (accountId: string, body: { enabled: boolean }) =>
    api.patch<AccountFunnelsToggleResult>(
      `/socials/accounts/${accountId}/funnels`,
      body,
    ),
  // Read-only strategy catalog.
  funnelsCatalog: () => api.get<FunnelCatalog>("/socials/funnels/catalog"),
  // Recent captured leads, optionally scoped to one Zernio account (the
  // funnel drill-down uses this to show only leads for one live automation).
  funnelLeads: (params?: { limit?: number; zernioAccountId?: string }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.zernioAccountId) q.set("zernioAccountId", params.zernioAccountId);
    const qs = q.toString();
    return api.get<{ leads: FunnelLead[]; brevoConfigured: boolean }>(
      `/socials/leads${qs ? `?${qs}` : ""}`,
    );
  },
  // Recent send/skip/fail logs for one comment->DM automation. The Zernio
  // response shape is free-form (opaque passthrough) — callers must parse
  // defensively.
  zernioAutomationLogs: (
    automationId: string,
    params: { zernioAccountId: string; status?: "sent" | "failed" | "skipped"; limit?: number; skip?: number },
  ) => {
    const q = new URLSearchParams();
    q.set("zernioAccountId", params.zernioAccountId);
    if (params.status) q.set("status", params.status);
    if (params.limit) q.set("limit", String(params.limit));
    if (params.skip) q.set("skip", String(params.skip));
    return api.get<Record<string, unknown>>(
      `/socials/zernio/automations/${automationId}/logs?${q.toString()}`,
    );
  },
  // Recent inbound Zernio webhook events.
  zernioEvents: (params?: { limit?: number }) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    const qs = q.toString();
    return api.get<{ events: ZernioEvent[] }>(
      `/socials/zernio/events${qs ? `?${qs}` : ""}`,
    );
  },
};
