import { Router } from "express";
import crypto from "node:crypto";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import {
  generateAuthUrl,
  generateCodeVerifier,
  generateCodeChallenge,
  exchangeCode,
  saveTokens,
  loadTokens,
  revokeTokens,
  getRateLimitStatus,
  setMultiplier,
} from "../services/x-api/index.js";

// ---------------------------------------------------------------------------
// In-memory PKCE verifier store (keyed by state, expires after 10 min)
// ---------------------------------------------------------------------------

interface PendingAuth {
  codeVerifier: string;
  createdAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [state, pending] of pendingAuths) {
    if (now - pending.createdAt > PENDING_AUTH_TTL_MS) {
      pendingAuths.delete(state);
    }
  }
}, 5 * 60 * 1000);

// ---------------------------------------------------------------------------
// Company ID from env (same as other routes)
// ---------------------------------------------------------------------------

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function xOauthRoutes(db: Db) {
  const router = Router();

  // GET /authorize — start OAuth flow
  router.get("/authorize", (req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "TEAM_DASHBOARD_COMPANY_ID not configured" });
      return;
    }

    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    pendingAuths.set(state, { codeVerifier, createdAt: Date.now() });

    const authUrl = generateAuthUrl(state, codeChallenge);
    logger.info({ state }, "X OAuth: redirecting to authorization URL");
    res.redirect(authUrl);
  });

  // GET /callback — handle OAuth callback from X
  router.get("/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      logger.warn({ error }, "X OAuth callback received error");
      res.status(400).json({ error: `X OAuth error: ${error}` });
      return;
    }

    if (!code || !state) {
      res.status(400).json({ error: "Missing code or state parameter" });
      return;
    }

    const pending = pendingAuths.get(state);
    if (!pending) {
      res.status(400).json({ error: "Invalid or expired state parameter — try connecting again" });
      return;
    }

    pendingAuths.delete(state);

    try {
      const tokenSet = await exchangeCode(code, pending.codeVerifier);
      await saveTokens(db, COMPANY_ID, tokenSet);

      logger.info(
        { xUsername: tokenSet.xUsername, xUserId: tokenSet.xUserId },
        "X OAuth: successfully connected",
      );

      // Redirect to dashboard settings page (or wherever the X integration UI lives)
      res.redirect("/?x_connected=true");
    } catch (err) {
      logger.error({ err }, "X OAuth: token exchange failed");
      res.status(500).json({
        error: "Failed to complete X authorization",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /status — check connection status
  router.get("/status", async (_req, res) => {
    if (!COMPANY_ID) {
      res.json({ connected: false });
      return;
    }

    try {
      const tokenSet = await loadTokens(db, COMPANY_ID);
      if (!tokenSet) {
        res.json({ connected: false });
        return;
      }

      res.json({
        connected: true,
        username: tokenSet.xUsername,
        xUserId: tokenSet.xUserId,
        expiresAt: tokenSet.expiresAt.toISOString(),
        scope: tokenSet.scope,
      });
    } catch (err) {
      logger.error({ err }, "X OAuth: failed to check status");
      res.json({ connected: false, error: "Failed to read token status" });
    }
  });

  // POST /revoke — disconnect X account
  router.post("/revoke", async (_req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "TEAM_DASHBOARD_COMPANY_ID not configured" });
      return;
    }

    try {
      await revokeTokens(db, COMPANY_ID);
      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "X OAuth: failed to revoke tokens");
      res.status(500).json({
        error: "Failed to revoke X tokens",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /rate-limits — get current rate limit status
  router.get("/rate-limits", (_req, res) => {
    res.json(getRateLimitStatus());
  });

  // POST /rate-limits/multiplier — update the rate limit multiplier
  router.post("/rate-limits/multiplier", (req, res) => {
    const { multiplier } = req.body as { multiplier?: number };
    if (typeof multiplier !== "number" || multiplier < 0.1 || multiplier > 1) {
      res.status(400).json({ error: "multiplier must be a number between 0.1 and 1" });
      return;
    }
    setMultiplier(multiplier);
    res.json({ success: true, multiplier });
  });

  return router;
}
