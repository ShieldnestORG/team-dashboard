// ---------------------------------------------------------------------------
// Canva Connect API — pure TypeScript client
// OAuth 2.0 Authorization Code Flow with PKCE
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { canvaOauthTokens } from "@paperclipai/db";
import { encrypt, decrypt } from "./x-api/oauth.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const CANVA_CLIENT_ID = process.env.CANVA_CLIENT_ID || "";
const CANVA_CLIENT_SECRET = process.env.CANVA_CLIENT_SECRET || "";
const CANVA_CALLBACK_URL = process.env.CANVA_CALLBACK_URL || "https://team-dashboard-cyan.vercel.app/api/canva/oauth/callback";

const API_BASE = "https://api.canva.com/rest/v1";
const AUTHORIZE_ENDPOINT = "https://www.canva.com/api/oauth/authorize";
const TOKEN_ENDPOINT = "https://api.canva.com/rest/v1/oauth/token";

const SCOPES = "asset:read design:content:read design:meta:read folder:read profile:read";
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CanvaTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  canvaUserId: string;
  canvaDisplayName: string;
}

export interface CanvaDesign {
  id: string;
  title: string;
  thumbnail?: { url: string; width: number; height: number };
  created_at: string;
  updated_at: string;
  urls?: { edit_url: string; view_url: string };
}

export interface CanvaFolder {
  id: string;
  name: string;
  created_at: string;
}

export interface CanvaExportResult {
  exportId: string;
  status: "in_progress" | "completed" | "failed";
  urls?: Array<{ url: string }>;
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

export function generateCodeVerifier(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

export function generateAuthUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CANVA_CLIENT_ID,
    redirect_uri: CANVA_CALLBACK_URL,
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

export async function exchangeCode(code: string, codeVerifier: string): Promise<CanvaTokenSet> {
  const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: CANVA_CALLBACK_URL,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`Canva token exchange failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Fetch user profile
  const profileRes = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });

  let canvaUserId = "unknown";
  let canvaDisplayName = "Unknown";
  if (profileRes.ok) {
    // Canva API may wrap in { profile: { ... } } or return flat { id, display_name }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await profileRes.json() as any;
    const profile = raw.profile || raw;
    canvaUserId = profile.id || profile.user_id || "unknown";
    canvaDisplayName = profile.display_name || profile.displayName || "Unknown";
    logger.info({ canvaUserId, canvaDisplayName, rawKeys: Object.keys(raw) }, "Canva profile fetched");
  } else {
    logger.warn({ status: profileRes.status }, "Canva /users/me failed — using defaults");
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    canvaUserId,
    canvaDisplayName,
  };
}

// ---------------------------------------------------------------------------
// Token refresh
// ---------------------------------------------------------------------------

async function refreshAccessToken(refreshToken: string): Promise<CanvaTokenSet> {
  const basicAuth = Buffer.from(`${CANVA_CLIENT_ID}:${CANVA_CLIENT_SECRET}`).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`Canva token refresh failed (${res.status}): ${errText}`);
  }

  const data = await res.json() as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Re-fetch profile after refresh
  const profileRes = await fetch(`${API_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });

  let canvaUserId = "unknown";
  let canvaDisplayName = "Unknown";
  if (profileRes.ok) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await profileRes.json() as any;
    const profile = raw.profile || raw;
    canvaUserId = profile.id || profile.user_id || "unknown";
    canvaDisplayName = profile.display_name || profile.displayName || "Unknown";
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    canvaUserId,
    canvaDisplayName,
  };
}

// ---------------------------------------------------------------------------
// DB persistence — save / load / delete
// ---------------------------------------------------------------------------

export async function saveTokens(db: Db, companyId: string, tokenSet: CanvaTokenSet): Promise<void> {
  const values = {
    companyId,
    canvaUserId: tokenSet.canvaUserId,
    canvaDisplayName: tokenSet.canvaDisplayName,
    accessTokenEnc: encrypt(tokenSet.accessToken),
    refreshTokenEnc: encrypt(tokenSet.refreshToken),
    scope: tokenSet.scope,
    expiresAt: tokenSet.expiresAt,
    updatedAt: new Date(),
  };

  const updated = await db
    .update(canvaOauthTokens)
    .set(values)
    .where(eq(canvaOauthTokens.companyId, companyId))
    .returning({ id: canvaOauthTokens.id });

  if (updated.length === 0) {
    await db.insert(canvaOauthTokens).values(values);
  }

  logger.info({ companyId, canvaDisplayName: tokenSet.canvaDisplayName }, "Canva OAuth tokens saved");
}

export async function loadTokens(db: Db, companyId: string): Promise<CanvaTokenSet | null> {
  const rows = await db
    .select()
    .from(canvaOauthTokens)
    .where(eq(canvaOauthTokens.companyId, companyId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0]!;
  return {
    accessToken: decrypt(row.accessTokenEnc),
    refreshToken: decrypt(row.refreshTokenEnc),
    expiresAt: row.expiresAt,
    scope: row.scope,
    canvaUserId: row.canvaUserId,
    canvaDisplayName: row.canvaDisplayName,
  };
}

export async function deleteTokens(db: Db, companyId: string): Promise<void> {
  await db.delete(canvaOauthTokens).where(eq(canvaOauthTokens.companyId, companyId));
  logger.info({ companyId }, "Canva OAuth tokens deleted");
}

// ---------------------------------------------------------------------------
// Get valid token — auto-refresh if expired
// ---------------------------------------------------------------------------

export async function getValidToken(db: Db, companyId: string): Promise<string> {
  const tokenSet = await loadTokens(db, companyId);
  if (!tokenSet) {
    throw new Error("No Canva OAuth tokens found — connect your Canva account first");
  }

  if (tokenSet.expiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now()) {
    return tokenSet.accessToken;
  }

  logger.info({ companyId }, "Canva OAuth token expired, refreshing...");
  try {
    const refreshed = await refreshAccessToken(tokenSet.refreshToken);
    await saveTokens(db, companyId, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    logger.error({ err, companyId }, "Failed to refresh Canva OAuth token");
    throw new Error("Canva OAuth token refresh failed — reconnect your Canva account");
  }
}

// ---------------------------------------------------------------------------
// Internal: authenticated Canva API request
// ---------------------------------------------------------------------------

async function canvaRequest<T>(
  db: Db,
  companyId: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const token = await getValidToken(db, companyId);
  const url = `${API_BASE}${path}`;

  const start = Date.now();
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const elapsed = Date.now() - start;

  logger.info({ method, path, status: res.status, elapsed }, `Canva API ${method} ${path} — ${res.status}`);

  if (!res.ok) {
    const errText = await res.text().catch(() => "Unknown");
    throw new Error(`Canva API error ${res.status} on ${method} ${path}: ${errText}`);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Design operations
// ---------------------------------------------------------------------------

export async function listDesigns(
  db: Db,
  companyId: string,
  opts?: { ownership?: string; sortBy?: string },
): Promise<CanvaDesign[]> {
  const params = new URLSearchParams();
  if (opts?.ownership) params.set("ownership", opts.ownership);
  if (opts?.sortBy) params.set("sort_by", opts.sortBy);

  const qs = params.toString();
  const data = await canvaRequest<{ items: CanvaDesign[] }>(
    db, companyId, "GET", `/designs${qs ? `?${qs}` : ""}`,
  );
  return data.items || [];
}

export async function getDesign(db: Db, companyId: string, designId: string): Promise<CanvaDesign> {
  const data = await canvaRequest<{ design: CanvaDesign }>(
    db, companyId, "GET", `/designs/${designId}`,
  );
  return data.design;
}

// ---------------------------------------------------------------------------
// Export design as PNG/JPG buffer
// ---------------------------------------------------------------------------

export async function startExport(
  db: Db,
  companyId: string,
  designId: string,
  format: "png" | "jpg" | "pdf" = "png",
): Promise<string> {
  const data = await canvaRequest<{ job: { id: string; status: string } }>(
    db, companyId, "POST", `/designs/${designId}/exports`,
    { format: { type: format } },
  );
  return data.job.id;
}

export async function checkExport(
  db: Db,
  companyId: string,
  designId: string,
  exportId: string,
): Promise<CanvaExportResult> {
  const data = await canvaRequest<{ job: { id: string; status: string }; urls?: Array<{ url: string }> }>(
    db, companyId, "GET", `/designs/${designId}/exports/${exportId}`,
  );
  return {
    exportId: data.job.id,
    status: data.job.status as CanvaExportResult["status"],
    urls: data.urls,
  };
}

/**
 * High-level: export a design as a PNG buffer.
 * Starts export → polls every 2s → downloads when complete.
 */
export async function exportDesignAsBuffer(
  db: Db,
  companyId: string,
  designId: string,
  format: "png" | "jpg" = "png",
  maxWaitMs = 30000,
): Promise<Buffer> {
  const exportId = await startExport(db, companyId, designId, format);

  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const result = await checkExport(db, companyId, designId, exportId);

    if (result.status === "completed" && result.urls && result.urls.length > 0) {
      const downloadUrl = result.urls[0]!.url;
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`Failed to download Canva export: ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }

    if (result.status === "failed") {
      throw new Error(`Canva export failed for design ${designId}`);
    }

    // Wait 2 seconds before polling again
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Canva export timed out after ${maxWaitMs}ms for design ${designId}`);
}

// ---------------------------------------------------------------------------
// Folder operations
// ---------------------------------------------------------------------------

export async function listFolders(db: Db, companyId: string): Promise<CanvaFolder[]> {
  const data = await canvaRequest<{ items: CanvaFolder[] }>(
    db, companyId, "GET", "/folders",
  );
  return data.items || [];
}

export async function listFolderItems(
  db: Db,
  companyId: string,
  folderId: string,
): Promise<CanvaDesign[]> {
  const data = await canvaRequest<{ items: CanvaDesign[] }>(
    db, companyId, "GET", `/folders/${folderId}/items`,
  );
  return data.items || [];
}

// ---------------------------------------------------------------------------
// Status check — is Canva connected?
// ---------------------------------------------------------------------------

export async function getConnectionStatus(db: Db, companyId: string): Promise<{
  connected: boolean;
  displayName?: string;
  canvaUserId?: string;
  expiresAt?: Date;
  scope?: string;
}> {
  const tokenSet = await loadTokens(db, companyId);
  if (!tokenSet) return { connected: false };
  return {
    connected: true,
    displayName: tokenSet.canvaDisplayName,
    canvaUserId: tokenSet.canvaUserId,
    expiresAt: tokenSet.expiresAt,
    scope: tokenSet.scope,
  };
}
