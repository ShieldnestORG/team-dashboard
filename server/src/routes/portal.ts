import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  customerPortalService,
  portalBaseUrl,
  PORTAL_SESSION_COOKIE,
} from "../services/customer-portal.js";
import { stripeRequest, stripeConfigured } from "../services/stripe-client.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Customer Portal MVP routes — mounted at /api/portal.
//
// These are the FIRST customer-facing (non-board) routes in this server.
// Auth is via the `cd_portal_session` cookie (HMAC-SHA256). We do NOT use the
// board actor middleware — board sessions and customer sessions are entirely
// separate. The cookie is HttpOnly, Secure, SameSite=Lax, scoped to
// `.coherencedaddy.com` so the storefront and the portal can both read it.
//
// Per CLAUDE.md the `req.params.*` rule applies analogously to `req.body.*` —
// always cast incoming user input through `String(...)` / `typeof check` and
// never trust the type system to hold for runtime input.
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const COOKIE_DOMAIN = ".coherencedaddy.com";

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) {
      try {
        out[k] = decodeURIComponent(v);
      } catch {
        out[k] = v;
      }
    }
  }
  return out;
}

function readSessionCookie(req: Request): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  const cookies = parseCookies(header);
  return cookies[PORTAL_SESSION_COOKIE] ?? null;
}

function setSessionCookie(res: Response, value: string) {
  // 30 days, matching the session TTL in customer-portal.ts.
  const maxAge = 30 * 24 * 60 * 60;
  const useSecure = process.env.NODE_ENV !== "development";
  const useDomain = process.env.PORTAL_COOKIE_DOMAIN ?? COOKIE_DOMAIN;
  const parts = [
    `${PORTAL_SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (useDomain && useDomain.trim()) parts.push(`Domain=${useDomain}`);
  if (useSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearSessionCookie(res: Response) {
  const useDomain = process.env.PORTAL_COOKIE_DOMAIN ?? COOKIE_DOMAIN;
  const useSecure = process.env.NODE_ENV !== "development";
  const parts = [
    `${PORTAL_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (useDomain && useDomain.trim()) parts.push(`Domain=${useDomain}`);
  if (useSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

interface AuthedRequest extends Request {
  customerAccountId: string;
}

export function portalRoutes(db: Db): Router {
  const router = Router();
  const svc = customerPortalService(db);

  function requireSession(req: Request, res: Response): string | null {
    const cookie = readSessionCookie(req);
    const session = svc.verifySession(cookie);
    if (!session) {
      res.status(401).json({ error: "Unauthenticated" });
      return null;
    }
    (req as AuthedRequest).customerAccountId = session.accountId;
    return session.accountId;
  }

  // -- Login: issue magic link ------------------------------------------------
  router.post("/login", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !EMAIL_RE.test(email) || email.length > 320) {
      // Do NOT leak whether the email is registered — return ok regardless of
      // shape errors past basic format. We only reject obviously malformed
      // input so the request body parser still rejects empty bodies cleanly.
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    try {
      await svc.createMagicLink(email);
    } catch (err) {
      logger.error({ err, email }, "portal/login: createMagicLink failed");
      // Still return ok — surface the error in logs but do not leak to caller.
    }
    res.status(200).json({ ok: true });
  });

  // -- Auth: consume token + set cookie + 302 ---------------------------------
  router.get("/auth", async (req: Request, res: Response) => {
    const tokenParam = req.query.token;
    const token = typeof tokenParam === "string" ? tokenParam : "";
    if (!token) {
      res.redirect(302, `${portalBaseUrl()}/auth?error=missing_token`);
      return;
    }
    let result;
    try {
      result = await svc.consumeMagicLink(token);
    } catch (err) {
      logger.error({ err }, "portal/auth: consumeMagicLink failed");
      res.redirect(302, `${portalBaseUrl()}/auth?error=server_error`);
      return;
    }
    if (!result) {
      res.redirect(302, `${portalBaseUrl()}/auth?error=invalid_or_expired`);
      return;
    }
    let cookieValue: string;
    try {
      cookieValue = svc.issueSession(result.accountId);
    } catch (err) {
      logger.error({ err }, "portal/auth: issueSession failed");
      res.redirect(302, `${portalBaseUrl()}/auth?error=server_error`);
      return;
    }
    setSessionCookie(res, cookieValue);
    res.redirect(302, `${portalBaseUrl()}/`);
  });

  // -- Logout -----------------------------------------------------------------
  router.post("/logout", (req: Request, res: Response) => {
    const cookie = readSessionCookie(req);
    const session = svc.verifySession(cookie);
    if (session) {
      void svc.logAction(session.accountId, "session_ended", {});
    }
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  // -- Me: account + entitlements --------------------------------------------
  router.get("/me", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;
    try {
      const result = await svc.getAccountWithEntitlements(accountId);
      if (!result) {
        // Cookie was valid but the account row was deleted; clear cookie.
        clearSessionCookie(res);
        res.status(401).json({ error: "Account not found" });
        return;
      }
      res.json(result);
    } catch (err) {
      logger.error({ err, accountId }, "portal/me: getAccountWithEntitlements failed");
      res.status(500).json({ error: "Failed to load account" });
    }
  });

  // -- List credentials -------------------------------------------------------
  router.get("/credentials", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;
    try {
      const rows = await svc.listCredentials(accountId);
      res.json({ credentials: rows });
    } catch (err) {
      logger.error({ err, accountId }, "portal/credentials: list failed");
      res.status(500).json({ error: "Failed to list credentials" });
    }
  });

  // -- Add credential ---------------------------------------------------------
  router.post("/credentials", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;
    const body = (req.body ?? {}) as { kind?: unknown; value?: unknown };
    const kind = typeof body.kind === "string" ? body.kind.trim() : "";
    const value = typeof body.value === "string" ? body.value : "";
    if (!kind || !value) {
      res.status(400).json({ error: "kind and value required" });
      return;
    }
    try {
      const row = await svc.addCredential(accountId, kind, value);
      res.status(201).json({ credential: row });
    } catch (err) {
      const msg = (err as Error).message;
      logger.warn({ err, accountId, kind }, "portal/credentials: addCredential rejected");
      res.status(400).json({ error: msg });
    }
  });

  // -- Soft-revoke credential by id ------------------------------------------
  router.delete("/credentials/:id", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;
    const id = req.params.id as string;
    try {
      const ok = await svc.revokeCredentialById(accountId, id);
      if (!ok) {
        res.status(404).json({ error: "Credential not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, accountId, id }, "portal/credentials: revoke failed");
      res.status(500).json({ error: "Failed to revoke credential" });
    }
  });

  // -- Stripe Billing Portal session ------------------------------------------
  router.post("/stripe-portal", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;
    if (!stripeConfigured()) {
      res.status(503).json({ error: "Stripe not configured" });
      return;
    }
    try {
      const account = await svc.getAccount(accountId);
      if (!account) {
        clearSessionCookie(res);
        res.status(401).json({ error: "Account not found" });
        return;
      }
      if (!account.stripeCustomerId) {
        res.status(400).json({
          error:
            "No Stripe customer linked to this account yet. Make a purchase first or contact support.",
        });
        return;
      }
      const returnUrl =
        process.env.PORTAL_STRIPE_RETURN_URL?.trim() ||
        `${portalBaseUrl()}/billing`;
      const session = await stripeRequest<{ url: string }>(
        "POST",
        "/billing_portal/sessions",
        {
          customer: account.stripeCustomerId,
          return_url: returnUrl,
        },
      );
      void svc.logAction(accountId, "stripe_portal_opened", {});
      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err, accountId }, "portal/stripe-portal: create session failed");
      res.status(500).json({ error: "Failed to create billing portal session" });
    }
  });

  return router;
}
