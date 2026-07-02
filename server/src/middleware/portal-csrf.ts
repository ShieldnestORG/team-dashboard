import type { RequestHandler } from "express";
import { portalBaseUrl, portalApiBaseUrl } from "../services/customer-portal.js";

// ---------------------------------------------------------------------------
// Portal anti-CSRF Origin/Referer guard.
//
// Portal endpoints authenticate via the `cd_portal_session` cookie
// (HttpOnly, Secure, SameSite=Lax, Domain=.coherencedaddy.com). SameSite=Lax
// plus the wildcard cookie Domain gives NO CSRF protection against a same-site
// foothold on any *.coherencedaddy.com subdomain. This guard enforces an
// Origin/Referer allowlist on UNSAFE (state-changing) methods so a mutation is
// only accepted when it demonstrably comes from the portal app itself.
//
// Modeled on middleware/board-mutation-guard.ts (same parseOrigin idiom). Safe
// methods (GET/HEAD/OPTIONS) are never blocked.
// ---------------------------------------------------------------------------

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3100",
  "http://127.0.0.1:3100",
];

function parseOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

function allowedPortalOrigins() {
  const origins = new Set<string>();
  const base = parseOrigin(portalBaseUrl());
  if (base) origins.add(base);

  // The backend's own public origin (api.coherencedaddy.com). The magic-link
  // sign-in interstitial (GET /api/portal/auth) is HTML served BY this backend
  // and its form POSTs back to this same origin — a legitimate first-party
  // submit. Without this, every magic-link consume would 403. Trusting the
  // backend's own origin opens no new surface (an attacker who controls it
  // already owns the API); it does NOT trust other *.coherencedaddy.com subdomains.
  const apiOrigin = parseOrigin(portalApiBaseUrl());
  if (apiOrigin) origins.add(apiOrigin);

  // Extra trusted origins (staging/alt frontends), comma-separated.
  for (const raw of (process.env.PORTAL_TRUSTED_ORIGINS ?? "").split(",")) {
    const parsed = parseOrigin(raw.trim());
    if (parsed) origins.add(parsed);
  }

  if (process.env.NODE_ENV === "development") {
    for (const dev of DEV_ORIGINS) origins.add(dev);
  }

  return origins;
}

export function portalCsrfGuard(): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method.toUpperCase())) {
      next();
      return;
    }

    const allowed = allowedPortalOrigins();

    const origin = parseOrigin(req.header("origin"));
    if (origin) {
      if (allowed.has(origin)) {
        next();
        return;
      }
      res.status(403).json({ error: "Portal mutation requires trusted origin" });
      return;
    }

    // No Origin header — fall back to Referer origin.
    const refererOrigin = parseOrigin(req.header("referer"));
    if (refererOrigin) {
      if (allowed.has(refererOrigin)) {
        next();
        return;
      }
      res.status(403).json({ error: "Portal mutation requires trusted origin" });
      return;
    }

    // Neither Origin nor Referer present on an unsafe request. Browsers send
    // Origin on cross-origin unsafe requests, so absence is suspicious —
    // reject rather than fail open.
    res.status(403).json({ error: "Portal mutation requires trusted origin" });
  };
}
