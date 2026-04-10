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
  deleteTokens,
  getConnectionStatus,
  listDesigns,
  listFolders,
} from "../services/canva-connect.js";

// ---------------------------------------------------------------------------
// In-memory PKCE verifier store (keyed by state, expires after 10 min)
// ---------------------------------------------------------------------------

interface PendingAuth {
  codeVerifier: string;
  createdAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();
const PENDING_AUTH_TTL_MS = 10 * 60 * 1000;

setInterval(() => {
  const now = Date.now();
  for (const [state, pending] of pendingAuths) {
    if (now - pending.createdAt > PENDING_AUTH_TTL_MS) {
      pendingAuths.delete(state);
    }
  }
}, 5 * 60 * 1000);

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export function canvaOauthRoutes(db: Db) {
  const router = Router();

  // GET /authorize — start Canva OAuth flow
  router.get("/authorize", (_req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "TEAM_DASHBOARD_COMPANY_ID not configured" });
      return;
    }

    const state = crypto.randomBytes(16).toString("hex");
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    pendingAuths.set(state, { codeVerifier, createdAt: Date.now() });

    const authUrl = generateAuthUrl(state, codeChallenge);
    logger.info({ state }, "Canva OAuth: redirecting to authorization URL");
    res.redirect(authUrl);
  });

  // GET /callback — handle OAuth callback from Canva
  router.get("/callback", async (req, res) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    if (error) {
      logger.warn({ error }, "Canva OAuth callback received error");
      res.status(400).json({ error: `Canva OAuth error: ${error}` });
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
        { canvaDisplayName: tokenSet.canvaDisplayName, canvaUserId: tokenSet.canvaUserId },
        "Canva OAuth: successfully connected",
      );

      res.redirect("/?canva_connected=true");
    } catch (err) {
      logger.error({ err }, "Canva OAuth: token exchange failed");
      res.status(500).json({
        error: "Failed to complete Canva authorization",
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // GET /status — check Canva connection status
  router.get("/status", async (_req, res) => {
    if (!COMPANY_ID) {
      res.json({ connected: false, error: "COMPANY_ID not set" });
      return;
    }

    try {
      const status = await getConnectionStatus(db, COMPANY_ID);
      res.json(status);
    } catch (err) {
      res.json({ connected: false, error: String(err) });
    }
  });

  // POST /revoke — disconnect Canva
  router.post("/revoke", async (_req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "COMPANY_ID not set" });
      return;
    }

    try {
      await deleteTokens(db, COMPANY_ID);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /designs — list Canva designs
  router.get("/designs", async (_req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "COMPANY_ID not set" });
      return;
    }

    try {
      const designs = await listDesigns(db, COMPANY_ID, { ownership: "owned" });
      res.json({ designs });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /folders — list Canva folders
  router.get("/folders", async (_req, res) => {
    if (!COMPANY_ID) {
      res.status(500).json({ error: "COMPANY_ID not set" });
      return;
    }

    try {
      const folders = await listFolders(db, COMPANY_ID);
      res.json({ folders });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
