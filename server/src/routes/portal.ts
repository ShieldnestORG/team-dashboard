import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  customerPortalService,
  portalBaseUrl,
  PORTAL_SESSION_COOKIE,
} from "../services/customer-portal.js";
import {
  stripeRequest,
  stripeConfigured,
  universityStripeKey,
} from "../services/stripe-client.js";
import { logger } from "../middleware/logger.js";
import {
  adminImpersonationService,
  ADMIN_IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
  type ImpersonationSession,
} from "../services/admin-impersonation.js";
import { logActivity } from "../services/activity-log.js";

const TEAM_DASHBOARD_COMPANY_ID =
  process.env.TEAM_DASHBOARD_COMPANY_ID ||
  "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

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

// ---------------------------------------------------------------------------
// Impersonation cookie helpers — mirror the session cookie config but use a
// distinct name (`cd_portal_impersonation`) and a shorter 60-min lifetime.
// The two cookies coexist: clearing one does NOT clear the other, so the
// "Stop impersonating" button leaves the admin's real customer session (if
// any) intact. The Domain attribute keeps both readable across
// app.coherencedaddy.com + coherencedaddy.com.
// ---------------------------------------------------------------------------

const IMPERSONATION_MAX_AGE_SEC = 60 * 60; // matches SESSION_TTL_MIN

function readImpersonationCookie(req: Request): string | null {
  const header = req.headers["cookie"];
  if (typeof header !== "string") return null;
  const cookies = parseCookies(header);
  return cookies[ADMIN_IMPERSONATION_COOKIE] ?? null;
}

function setImpersonationCookie(res: Response, value: string) {
  const useSecure = process.env.NODE_ENV !== "development";
  const useDomain = process.env.PORTAL_COOKIE_DOMAIN ?? COOKIE_DOMAIN;
  const parts = [
    `${ADMIN_IMPERSONATION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${IMPERSONATION_MAX_AGE_SEC}`,
  ];
  if (useDomain && useDomain.trim()) parts.push(`Domain=${useDomain}`);
  if (useSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function clearImpersonationCookie(res: Response) {
  const useSecure = process.env.NODE_ENV !== "development";
  const useDomain = process.env.PORTAL_COOKIE_DOMAIN ?? COOKIE_DOMAIN;
  const parts = [
    `${ADMIN_IMPERSONATION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (useDomain && useDomain.trim()) parts.push(`Domain=${useDomain}`);
  if (useSecure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

// Inspect both cookies. Resolution order:
//   1. impersonation cookie (admin viewing as someone else)
//   2. real customer session
// The impersonation cookie is read-only and surfaces via `req.impersonation`.
// Callers that mutate state (POST/DELETE) MUST call requireNonImpersonating.
export interface PortalAuthResolution {
  accountId: string;
  impersonation: ImpersonationSession | null;
}

function resolvePortalAuth(
  req: Request,
  verifyCustomerSession: (c: string | null | undefined) => { accountId: string } | null,
): PortalAuthResolution | null {
  const impCookie = readImpersonationCookie(req);
  const imp = verifyImpersonationCookie(impCookie);
  if (imp) {
    return { accountId: imp.targetAccountId, impersonation: imp };
  }
  const customer = verifyCustomerSession(readSessionCookie(req));
  if (customer) {
    return { accountId: customer.accountId, impersonation: null };
  }
  return null;
}

/**
 * Block writes under an impersonation cookie. Read-only mode is a CORE
 * security property — even though the portal's current write surface is
 * small, this guard MUST be applied to every new mutation route added in
 * the future. The test suite asserts it.
 */
export function requireNonImpersonating(
  req: Request,
  res: Response,
): boolean {
  const impCookie = readImpersonationCookie(req);
  const imp = verifyImpersonationCookie(impCookie);
  if (imp) {
    res.status(403).json({
      error: "Read-only: writes are disabled while impersonating a customer.",
      impersonating: true,
    });
    return false;
  }
  return true;
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

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}

function renderAuthInterstitial(token: string): string {
  // Token goes into the form's action URL, never into HTML body text. It's
  // url-encoded and the action attribute is double-quoted, so the html-
  // escaped value is safe. Form posts to the same path → POST consumes.
  const safeToken = htmlEscape(encodeURIComponent(token));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>Sign in — Coherence Daddy</title>
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: #0a0a0a;
    color: #f5f5f5;
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  main { max-width: 420px; text-align: center; }
  .brand {
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: #f97316;
    margin-bottom: 24px;
  }
  h1 { font-size: 24px; margin: 0 0 12px; font-weight: 600; }
  p { color: #a1a1aa; margin: 0 0 28px; }
  button {
    appearance: none;
    border: 0;
    background: #f97316;
    color: #0a0a0a;
    font: inherit;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover { background: #fb923c; }
  .fineprint { margin-top: 24px; font-size: 12px; color: #71717a; }
</style>
</head>
<body>
<main>
  <div class="brand">Coherence Daddy</div>
  <h1>Sign in to your account</h1>
  <p>Click below to complete sign-in. This link is single-use and expires shortly.</p>
  <form method="POST" action="/api/portal/auth?token=${safeToken}">
    <button type="submit">Sign in</button>
  </form>
  <div class="fineprint">If you didn't request this, you can safely ignore the email.</div>
</main>
</body>
</html>`;
}

export function portalRoutes(db: Db): Router {
  const router = Router();
  const svc = customerPortalService(db);

  function requireSession(req: Request, res: Response): string | null {
    // Impersonation cookie wins when present (admin "View as customer").
    // Reads resolve as the target customer; mutations are blocked by
    // requireNonImpersonating() on a per-route basis.
    const resolved = resolvePortalAuth(req, (c) => svc.verifySession(c));
    if (!resolved) {
      res.status(401).json({ error: "Unauthenticated" });
      return null;
    }
    (req as AuthedRequest).customerAccountId = resolved.accountId;
    return resolved.accountId;
  }

  const impSvc = adminImpersonationService(db);

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

  // -- Auth: two-step magic-link consume --------------------------------------
  //
  // GET is read-only: it previews the token state and renders a confirm-to-
  // sign-in interstitial. POST actually consumes the token and sets the
  // session cookie. This defeats inbox-side link scanners (Proton, AV,
  // Slack/Discord unfurls, etc.) that auto-fetch GET URLs and would otherwise
  // burn the single-use token before the recipient clicks.
  //
  // Don't fold these back into a single GET — that's the bug we're fixing.

  router.get("/auth", async (req: Request, res: Response) => {
    const tokenParam = req.query.token;
    const token = typeof tokenParam === "string" ? tokenParam : "";
    if (!token) {
      res.redirect(302, `${portalBaseUrl()}/auth?error=missing_token`);
      return;
    }
    let status: "ok" | "missing" | "expired" | "consumed";
    try {
      status = await svc.previewMagicLink(token);
    } catch (err) {
      logger.error({ err }, "portal/auth: previewMagicLink failed");
      res.redirect(302, `${portalBaseUrl()}/auth?error=server_error`);
      return;
    }
    if (status !== "ok") {
      // Uniform error code — don't let callers distinguish missing vs
      // consumed vs expired (token-existence oracle).
      res.redirect(302, `${portalBaseUrl()}/auth?error=invalid_or_expired`);
      return;
    }
    res
      .status(200)
      .setHeader("Content-Type", "text/html; charset=utf-8")
      // Tell intermediaries not to cache or prefetch deeper.
      .setHeader("Cache-Control", "no-store")
      .setHeader("Referrer-Policy", "no-referrer")
      .send(renderAuthInterstitial(token));
  });

  router.post("/auth", async (req: Request, res: Response) => {
    // Token travels in the query string (the form's action URL preserves it).
    // No body parser dependency, and we keep the consume path identical to
    // the email-link target — only the HTTP method differs.
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

  // -- University progress (rep-log) ------------------------------------------
  //
  // The "Practice" half of the learning loop. Gated to University members via
  // isUniversityAccount() — a non-member with a valid portal session gets 403,
  // never a silent empty result, so the storefront can branch on membership.
  //
  // GET  /university/progress → { currentStreak, weekCount, weekGoal, recent }
  // POST /university/progress { lessonSlug, reflection?, quizScore? }
  //   → idempotent upsert of TODAY's rep; returns { currentStreak, weekCount,
  //     weekGoal }.

  // Shared gate: resolve the session, then require University membership.
  // Returns the accountId on success, or null after writing the response.
  async function requireUniversityMember(
    req: Request,
    res: Response,
  ): Promise<string | null> {
    const accountId = requireSession(req, res);
    if (!accountId) return null;
    let isMember: boolean;
    try {
      isMember = await svc.isUniversityAccount(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university: membership check failed",
      );
      res.status(500).json({ error: "Failed to verify membership" });
      return null;
    }
    if (!isMember) {
      res.status(403).json({ error: "University membership required" });
      return null;
    }
    return accountId;
  }

  router.get("/university/progress", async (req: Request, res: Response) => {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;
    try {
      const summary = await svc.getProgressSummary(accountId);
      res.json({
        currentStreak: summary.currentStreak,
        weekCount: summary.weekCount,
        weekGoal: summary.weekGoal,
        recent: summary.recent.map((r) => ({
          lessonSlug: r.lessonSlug,
          created_at: r.createdAt.toISOString(),
          reflection: r.reflection ?? undefined,
        })),
      });
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/progress: summary failed",
      );
      res.status(500).json({ error: "Failed to load progress" });
    }
  });

  router.post("/university/progress", async (req: Request, res: Response) => {
    // Logging a rep mutates state — block under impersonation (read-only).
    if (!requireNonImpersonating(req, res)) return;
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;

    const body = (req.body ?? {}) as {
      lessonSlug?: unknown;
      reflection?: unknown;
      quizScore?: unknown;
    };
    const lessonSlug =
      typeof body.lessonSlug === "string" ? body.lessonSlug.trim() : "";
    if (!lessonSlug || lessonSlug.length > 200) {
      res.status(400).json({ error: "lessonSlug required" });
      return;
    }
    const reflection =
      typeof body.reflection === "string" ? body.reflection.slice(0, 10_000) : null;
    let quizScore: number | null = null;
    if (body.quizScore !== undefined && body.quizScore !== null) {
      const n = Number(body.quizScore);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        res.status(400).json({ error: "quizScore must be 0–100" });
        return;
      }
      quizScore = Math.trunc(n);
    }

    try {
      const result = await svc.recordRep(accountId, lessonSlug, {
        reflection,
        quizScore,
      });
      res.status(200).json({
        currentStreak: result.currentStreak,
        weekCount: result.weekCount,
        weekGoal: result.weekGoal,
      });
    } catch (err) {
      logger.error(
        { err, accountId, lessonSlug },
        "portal/university/progress: recordRep failed",
      );
      res.status(500).json({ error: "Failed to record rep" });
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
    if (!requireNonImpersonating(req, res)) return;
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
    if (!requireNonImpersonating(req, res)) return;
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
    // Billing is destructive (cancel, change card). Block under impersonation.
    if (!requireNonImpersonating(req, res)) return;
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
      // University members bill on a SEPARATE Stripe account (Starwise), so the
      // billing-portal session MUST be created with BOTH the University key AND
      // a Starwise customer id. The key/id pair must come from the SAME account
      // or Stripe rejects the request ("No such customer").
      //
      // Dual-customer fix: customer_accounts has a single stripe_customer_id
      // column and the customer-account-linker does ON CONFLICT(email) DO
      // UPDATE (last-writer-wins), so for a customer holding BOTH a University
      // (Starwise) and a CD (CreditScore/Watchtower) subscription that column
      // can hold EITHER account's id. We therefore never trust it for a
      // University account: the Starwise customer id is read from
      // university_subscriptions (written only by the University checkout, which
      // authenticates with universityStripeKey()), guaranteeing key+id share an
      // account. CD-only customers are unaffected — isUniversityAccount() is
      // false for them, so they keep using customer_accounts.stripe_customer_id
      // with the shared key, and that column is never read for an account that
      // also has a Starwise customer. universityStripeKey() falls back to
      // STRIPE_SECRET_KEY, so a single-account (local/dev) setup is a no-op.
      const isUniversity = await svc.isUniversityAccount(accountId);
      const stripeCustomerId = isUniversity
        ? await svc.getUniversityStripeCustomerId(accountId)
        : account.stripeCustomerId;
      if (!stripeCustomerId) {
        res.status(400).json({
          error:
            "No Stripe customer linked to this account yet. Make a purchase first or contact support.",
        });
        return;
      }
      const returnUrl =
        process.env.PORTAL_STRIPE_RETURN_URL?.trim() ||
        `${portalBaseUrl()}/billing`;
      const secretKey = isUniversity ? universityStripeKey() : undefined;
      const session = await stripeRequest<{ url: string }>(
        "POST",
        "/billing_portal/sessions",
        {
          customer: stripeCustomerId,
          return_url: returnUrl,
        },
        secretKey,
      );
      void svc.logAction(accountId, "stripe_portal_opened", {});
      res.json({ url: session.url });
    } catch (err) {
      logger.error({ err, accountId }, "portal/stripe-portal: create session failed");
      res.status(500).json({ error: "Failed to create billing portal session" });
    }
  });

  // -- Admin impersonation: exchange nonce → session cookie ------------------
  router.post("/admin-impersonate", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { nonce?: unknown };
    const nonce = typeof body.nonce === "string" ? body.nonce.trim() : "";
    if (!nonce) {
      res.status(400).json({ error: "nonce required" });
      return;
    }
    try {
      const result = await impSvc.exchangeNonce(nonce);
      if (!result) {
        // Nonce missing, expired, or already burned. Uniform 401 — do NOT
        // distinguish between cases (token-existence oracle).
        res.status(401).json({ error: "Invalid or expired nonce" });
        return;
      }
      setImpersonationCookie(res, result.cookieValue);

      // activity_log: admin.impersonate.start. companyId is the
      // team-dashboard primary company (Coherence Daddy). The
      // impersonated_customer_id lives on the actor side (entityType =
      // customer_account) so a customer's GDPR export can filter by their
      // own accountId == entityId and see every admin login.
      void logActivity(db, {
        companyId: TEAM_DASHBOARD_COMPANY_ID,
        actorType: "user",
        actorId: result.adminActorId,
        action: "admin.impersonate.start",
        entityType: "customer_account",
        entityId: result.session.targetAccountId,
        details: {
          admin_actor_id: result.adminActorId,
          impersonated_customer_id: result.session.targetAccountId,
          session_id: result.session.sid,
          started_at: result.session.startedAt.toISOString(),
          expires_at: result.session.expiresAt.toISOString(),
        },
      }).catch((err) => {
        logger.warn(
          { err },
          "portal/admin-impersonate: activity.start write failed",
        );
      });

      res.json({
        ok: true,
        viewingAs: {
          email: result.targetEmail,
          accountId: result.session.targetAccountId,
        },
      });
    } catch (err) {
      logger.error({ err }, "portal/admin-impersonate: exchange failed");
      res.status(500).json({ error: "Exchange failed" });
    }
  });

  // -- Admin impersonation: end + clear cookie -------------------------------
  router.post("/admin-impersonate/end", async (req: Request, res: Response) => {
    const cookie = readImpersonationCookie(req);
    const session = verifyImpersonationCookie(cookie);
    if (!session) {
      // Nothing to end; clear any stale cookie defensively and return ok.
      clearImpersonationCookie(res);
      res.json({ ok: true, ended: false });
      return;
    }
    const endedAt = new Date();
    const durationSec = Math.max(
      0,
      Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
    );

    void logActivity(db, {
      companyId: TEAM_DASHBOARD_COMPANY_ID,
      actorType: "user",
      actorId: session.adminActorId,
      action: "admin.impersonate.end",
      entityType: "customer_account",
      entityId: session.targetAccountId,
      details: {
        admin_actor_id: session.adminActorId,
        impersonated_customer_id: session.targetAccountId,
        session_id: session.sid,
        duration_s: durationSec,
        ended_at: endedAt.toISOString(),
      },
    }).catch((err) => {
      logger.warn(
        { err },
        "portal/admin-impersonate/end: activity.end write failed",
      );
    });

    clearImpersonationCookie(res);
    res.json({ ok: true, ended: true });
  });

  // -- Admin impersonation: status (for the banner) --------------------------
  router.get("/admin-impersonate/status", async (req: Request, res: Response) => {
    const cookie = readImpersonationCookie(req);
    const session = verifyImpersonationCookie(cookie);
    if (!session) {
      res.json({ active: false });
      return;
    }
    // Resolve the email to render in the banner. Best-effort.
    let email: string | null = null;
    try {
      const acct = await svc.getAccount(session.targetAccountId);
      email = acct?.email ?? null;
    } catch (err) {
      logger.warn({ err }, "portal/admin-impersonate/status: getAccount failed");
    }
    res.json({
      active: true,
      viewingAs: { email, accountId: session.targetAccountId },
      sessionStartedAt: session.startedAt.toISOString(),
      sessionExpiresAt: session.expiresAt.toISOString(),
    });
  });

  return router;
}
