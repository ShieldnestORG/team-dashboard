// ---------------------------------------------------------------------------
// X API v2 — OAuth 2.0 Authorization Code Flow with PKCE
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { xOauthTokens } from "@paperclipai/db";
import { logger } from "../../middleware/logger.js";
import type { TokenSet } from "./types.js";

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const X_CLIENT_ID = process.env.X_CLIENT_ID || "";
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET || "";
const X_CALLBACK_URL = process.env.X_CALLBACK_URL || "";
const X_TOKEN_ENCRYPTION_KEY = process.env.X_TOKEN_ENCRYPTION_KEY || "";

const TOKEN_ENDPOINT = "https://api.x.com/2/oauth2/token";
const AUTHORIZE_ENDPOINT = "https://twitter.com/i/oauth2/authorize";
const REVOKE_ENDPOINT = "https://api.x.com/2/oauth2/revoke";

const SCOPES = "tweet.read tweet.write users.read like.read like.write follows.read follows.write offline.access";

// Refresh when token is within 5 minutes of expiry
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// AES-256-GCM encryption for stored tokens
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  if (!X_TOKEN_ENCRYPTION_KEY) {
    throw new Error("X_TOKEN_ENCRYPTION_KEY env var is not set — cannot encrypt/decrypt tokens");
  }
  // Accept either a 32-byte hex string (64 chars) or raw 32-byte key
  if (X_TOKEN_ENCRYPTION_KEY.length === 64) {
    return Buffer.from(X_TOKEN_ENCRYPTION_KEY, "hex");
  }
  return crypto.createHash("sha256").update(X_TOKEN_ENCRYPTION_KEY).digest();
}

export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted token format");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = Buffer.from(parts[2], "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
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
    client_id: X_CLIENT_ID,
    redirect_uri: X_CALLBACK_URL,
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

function basicAuthHeader(): string {
  return `Basic ${Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString("base64")}`;
}

export async function exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: X_CALLBACK_URL,
    code_verifier: codeVerifier,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Fetch user info to get userId and username
  const userRes = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });

  if (!userRes.ok) {
    throw new Error(`Failed to fetch user info after token exchange (${userRes.status})`);
  }

  const userData = (await userRes.json()) as { data: { id: string; username: string } };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    xUserId: userData.data.id,
    xUsername: userData.data.username,
  };
}

// ---------------------------------------------------------------------------
// Refresh token
// ---------------------------------------------------------------------------

export async function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(),
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "Unknown error");
    throw new Error(`Token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    scope: string;
  };

  // Fetch user info again (username may have changed)
  const userRes = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });

  let xUserId = "";
  let xUsername = "";
  if (userRes.ok) {
    const userData = (await userRes.json()) as { data: { id: string; username: string } };
    xUserId = userData.data.id;
    xUsername = userData.data.username;
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    scope: data.scope,
    xUserId,
    xUsername,
  };
}

// ---------------------------------------------------------------------------
// DB persistence — save / load / revoke
// ---------------------------------------------------------------------------

export async function saveTokens(db: Db, companyId: string, tokenSet: TokenSet): Promise<void> {
  const values = {
    companyId,
    xUserId: tokenSet.xUserId,
    xUsername: tokenSet.xUsername,
    accessTokenEnc: encrypt(tokenSet.accessToken),
    refreshTokenEnc: encrypt(tokenSet.refreshToken),
    scope: tokenSet.scope,
    expiresAt: tokenSet.expiresAt,
    updatedAt: new Date(),
  };

  // Upsert: try update first, insert if not found
  const updated = await db
    .update(xOauthTokens)
    .set(values)
    .where(eq(xOauthTokens.companyId, companyId))
    .returning({ id: xOauthTokens.id });

  if (updated.length === 0) {
    await db.insert(xOauthTokens).values(values);
  }

  logger.info({ companyId, xUsername: tokenSet.xUsername }, "X OAuth tokens saved");
}

export async function loadTokens(db: Db, companyId: string): Promise<TokenSet | null> {
  const rows = await db
    .select()
    .from(xOauthTokens)
    .where(eq(xOauthTokens.companyId, companyId))
    .limit(1);

  if (rows.length === 0) return null;

  const row = rows[0];
  return {
    accessToken: decrypt(row.accessTokenEnc),
    refreshToken: decrypt(row.refreshTokenEnc),
    expiresAt: row.expiresAt,
    scope: row.scope,
    xUserId: row.xUserId,
    xUsername: row.xUsername,
  };
}

export async function deleteTokens(db: Db, companyId: string): Promise<void> {
  await db.delete(xOauthTokens).where(eq(xOauthTokens.companyId, companyId));
  logger.info({ companyId }, "X OAuth tokens deleted from DB");
}

// ---------------------------------------------------------------------------
// Get a valid token — auto-refresh if expired
// ---------------------------------------------------------------------------

export async function getValidToken(db: Db, companyId: string): Promise<string> {
  const tokenSet = await loadTokens(db, companyId);
  if (!tokenSet) {
    throw new Error("No X OAuth tokens found — connect your X account first");
  }

  // Check if token is still valid (with 5min buffer)
  if (tokenSet.expiresAt.getTime() - EXPIRY_BUFFER_MS > Date.now()) {
    return tokenSet.accessToken;
  }

  // Token expired or about to expire — refresh
  logger.info({ companyId }, "X OAuth access token expired, refreshing...");
  try {
    const refreshed = await refreshAccessToken(tokenSet.refreshToken);
    await saveTokens(db, companyId, refreshed);
    return refreshed.accessToken;
  } catch (err) {
    logger.error({ err, companyId }, "Failed to refresh X OAuth token");
    throw new Error("X OAuth token refresh failed — reconnect your X account");
  }
}

// ---------------------------------------------------------------------------
// Revoke tokens
// ---------------------------------------------------------------------------

export async function revokeTokens(db: Db, companyId: string): Promise<void> {
  const tokenSet = await loadTokens(db, companyId);

  if (tokenSet) {
    // Attempt to revoke at X's endpoint (best effort)
    try {
      await fetch(REVOKE_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: basicAuthHeader(),
        },
        body: new URLSearchParams({
          token: tokenSet.accessToken,
          token_type_hint: "access_token",
        }).toString(),
      });
    } catch (err) {
      logger.warn({ err, companyId }, "Failed to revoke X access token at provider (non-fatal)");
    }
  }

  await deleteTokens(db, companyId);
  logger.info({ companyId }, "X OAuth tokens revoked and deleted");
}
