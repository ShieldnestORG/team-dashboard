import { Router, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Db } from "@paperclipai/db";
import {
  customerPortalService,
  portalBaseUrl,
  PORTAL_SESSION_COOKIE,
  CommunityError,
  COMMUNITY_DEFAULT_EMOJI,
  COMMUNITY_POST_TYPES,
  COMMUNITY_TOPICS,
  clampCommunityLimit,
  isTrainingGameSlug,
  type CommunityPostType,
  type CommunityTopic,
} from "../services/customer-portal.js";
import {
  stripeRequest,
  stripeConfigured,
  universityStripeKey,
} from "../services/stripe-client.js";
import { logger } from "../middleware/logger.js";
import { portalCsrfGuard } from "../middleware/portal-csrf.js";
import {
  adminImpersonationService,
  ADMIN_IMPERSONATION_COOKIE,
  verifyImpersonationCookie,
  type ImpersonationSession,
} from "../services/admin-impersonation.js";
import { logActivity } from "../services/activity-log.js";
import {
  mintBridgeToken,
  type BridgeStatus,
} from "../services/optimize-me-bridge.js";
import { universitySessionsService } from "../services/university-sessions.js";
import { voiceBudgetService } from "../services/voice-budget.js";
import { coherenceService } from "../services/coherence.js";
import { createCheckoutSession } from "../services/stripe-checkout.js";
import {
  VOICE_ADDON_TIERS,
  type VoiceAddonTier,
} from "../services/university-stripe-handler.js";
import { sendCreditscoreEmail } from "../services/creditscore-email-callback.js";
import {
  UNIVERSITY_SESSIONS_URL,
  universitySessionIcsUrl,
} from "../services/university-email.js";

// Optimize Me ("architect") app surface. The bridge handoff lands at
// /api/sso/bridge there. Overridable via env for staging/local.
function optimizeMeAppUrl(): string {
  return (
    process.env.OPTIMIZE_ME_APP_URL?.trim() ||
    "https://app.optimize-me.coherencedaddy.com"
  );
}

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

// Add `n` whole months to a date in UTC, preserving the day-of-month where the
// target month is long enough (JS Date normalizes overflow, e.g. Jan 31 + 1mo
// → Mar 3; acceptable for a billing-pause resume anchor). Used to compute the
// University pause `resumes_at` (now + 1 billing cycle).
function addUtcMonths(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  d.setUTCMonth(d.getUTCMonth() + n);
  return d;
}

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
<title>Enter — Coherence Daddy</title>
<link rel="icon" type="image/png" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABmJLR0QA/wD/AP+gvaeTAAAEt0lEQVRYha2XXWwUZRSGnzO7W9puCIGyKIFAhEA0akTASkATlIayU9qkiSVBIwENjd0tVBIvwARZxSBBDUK7DYIIKAkXXEBKuw0/SoWoEWMskhhU/ItWpAUqStF2d+Z44dqV3ZnpD56r+eac877vd+b7OSPcommk7BFIXsA2fBhyL4ZcRJkLTMfQ56W+9XevfBkWKQi1ZStBq1Gmgp4CCafx/JlIu4Rk1ynZ+VnSDcvv5sghrTVnoywFpgGTUZ0KBNPzqHDOMu7GP24KsOuWBGhN2SzQJmD8YAWnrQaRQ14BngK0ruI2ktYYRHegQyYHuBO47BVguJLHYgap1BFE24DZwyAH6CKQ97ZXgHsFus48BDwwMIdcQLQDpQO0E6QTZAHoAmAMyeRq4KUhCdDaxfNR+6A7qX6Myk5s47jsaO7I8caqXqez5zBCGNR1B7gKAJ0NjHV0Cc9KQ+s2L1CJHezTaOWT0HsW4YZXbM4a0OgiE9VXXTMC1rtegP0i4oeuILoMZdKQBKDGWk/kXv99OSnVJaO0pmyK1pVPyrwrH4stDwOVGjGXayzmuOBzXwqtngIMpvWTRMwZWmvuI5B3EUO/JWX9oFFzOgB59iYMxgF3IOzh8pk9WlXlG1gATPYWICczYuU1lD+Bgn75cESj5kbUvgeo7I9VlhG6XkmWOXwCckr8H/tQtjd/o9HKIo2aW0ALgCVZMdcknliPYbyAUnQTshH4aGAB3nZZI+H10LsZrH3AOWB01gw+B5D6lhOIPA1o2nFUGpp+yQbM3YYGX6PMcREwD59vg9Q3nwXQyPznkMIZwINp/xdYvsyhI3YTKi3ADZK+qBOgUwWOZo3PAz+nn0fwx/Wv+vEb264TKp4LzEFlHp3BmbKjuUOrZwW0tqwUm5dRPYPyJd353U4CcivQ5ztMwOoGRiNsRa3dJPO+x28tQdhJYXAm0P8tJRazgU/+HWt1ySgCgY3YugiRCQg/AR0UXSsCOrPpHBsSjZqbgHUIT6BsBnpIWo9SMMKWbU2XnHIA9KmKkRSk3sPpDhGOAQlpSNx0ijovwkDeFuAqto7HlhogSJ7f9CRfFZ5IQao5Tf4dyHL8/tuxZSrQg5KPzQfZeY4C5I3DvyHyCmI8Q37h+wgnUa12O810TekYVNahXEV1FaHgXYQKD5CyNmDY+/mnc4pLY6I9tzBuM1o+P59gYTvCjwSspbL16FWNVeXRlRop8UNX3PIcsaLhvYhxWhpadmf7XM8B2dv2F4asRCmhz3deo+HtdPacgN4mXRUeMRQBCLtQvd/J5XkQSX3LaZA3gRDIYtC3ELqxxbXJzDatK5+EshAodvIP3JQa9lpsWQxyQxoT72h16XECxjmNhg9gG/vx05thswOojAQmgxSDziFlTQQB4UXHSQ5qFpFwOSJ7JZ4oSo8fQ8SjY7rJ+lBZI40tjcMWAKC1ZhuipVLf2gugUbMBqALGDZC6UOKJ427OIVxGmsCyMmSh4tUYOg1lBZCzvdJmk7zU5oU6+AqASOZmy/VHzBkIK4DHyfSTXRJPeFZo0BXwIgeQxkS7xBN1hIITgJWABfw6WPz/3TRqtmvUPDZQ3KB/Todhn6Li3V8CfwN/wqxhbT7C6wAAAABJRU5ErkJggg==" />
<style>
  :root { color-scheme: dark; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: #0E0E10;
    color: #FAFAF8;
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
    color: #FF6B4A;
    margin-bottom: 24px;
  }
  h1 { font-size: 24px; margin: 0 0 12px; font-weight: 600; }
  p { color: #B8B5AE; margin: 0 0 28px; }
  button {
    appearance: none;
    border: 0;
    background: #FF6B4A;
    color: #0E0E10;
    font: inherit;
    font-weight: 600;
    padding: 12px 24px;
    border-radius: 8px;
    cursor: pointer;
  }
  button:hover { background: #E5553A; }
  .fineprint { margin-top: 24px; font-size: 12px; color: #78756E; }
</style>
</head>
<body>
<main>
  <div class="brand">Coherence Daddy</div>
  <h1>Step inside</h1>
  <p>You're verified — click below to enter. This link is single-use and expires shortly.</p>
  <form method="POST" action="/api/portal/auth?token=${safeToken}">
    <button type="submit">Enter</button>
  </form>
  <div class="fineprint">If you didn't request this, you can safely ignore the email.</div>
</main>
</body>
</html>`;
}

// --- University session validation (pure, module-scope) --------------------

interface SessionCreateValue {
  title: string;
  description: string | null;
  hostName: string;
  hostEmail: string | null;
  startsAt: Date;
  durationMinutes: number;
  joinUrl: string;
  capacity: number | null;
  recordingUrl: string | null;
}

// Bounds shared by create + patch validation.
const SESSION_LIMITS = {
  titleMax: 200,
  descMax: 4_000,
  hostMax: 200,
  durationMax: 480,
} as const;

function isHttpsUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === "https:";
}

// A manual recording link is more permissive than join_url: allow http OR https
// (Zoom-cloud / YouTube share links are always https in practice, but we don't
// reject a plain http link). Empty/whitespace is treated as "clear" upstream.
function isHttpUrl(value: string): boolean {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return false;
  }
  return u.protocol === "https:" || u.protocol === "http:";
}

// Parse an optional recordingUrl field shared by create + patch.
//   - undefined        → { value: undefined } (field absent; leave as-is)
//   - null / ""        → { value: null }      (explicit clear)
//   - non-empty string → must be an http(s) URL, returned trimmed
function parseRecordingUrl(
  raw: unknown,
): { value: string | null | undefined } | { error: string } {
  if (raw === undefined) return { value: undefined };
  if (raw === null) return { value: null };
  if (typeof raw !== "string") {
    return { error: "recordingUrl must be a string URL or null" };
  }
  const trimmed = raw.trim();
  if (trimmed === "") return { value: null };
  if (!isHttpUrl(trimmed)) {
    return { error: "recordingUrl must be an http(s) URL" };
  }
  return { value: trimmed };
}

// Validate an optional capacity field. Returns the parsed value, undefined when
// absent, or an error message. null/absent both mean "unlimited".
function parseCapacity(
  raw: unknown,
): { value: number | null } | { error: string } {
  if (raw === undefined || raw === null) return { value: null };
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) {
    return { error: "capacity must be an integer >= 1 or null" };
  }
  return { value: n };
}

function parseDuration(
  raw: unknown,
): { value: number } | { error: string } {
  const n = Number(raw);
  if (
    !Number.isFinite(n) ||
    !Number.isInteger(n) ||
    n < 1 ||
    n > SESSION_LIMITS.durationMax
  ) {
    return { error: `durationMinutes must be 1–${SESSION_LIMITS.durationMax}` };
  }
  return { value: n };
}

export function parseSessionCreate(
  body: Record<string, unknown>,
): { value: SessionCreateValue } | { error: string } {
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > SESSION_LIMITS.titleMax) {
    return { error: `title required (1–${SESSION_LIMITS.titleMax} chars)` };
  }
  const hostName =
    typeof body.hostName === "string" ? body.hostName.trim() : "";
  if (!hostName || hostName.length > SESSION_LIMITS.hostMax) {
    return { error: `hostName required (1–${SESSION_LIMITS.hostMax} chars)` };
  }
  const joinUrl = typeof body.joinUrl === "string" ? body.joinUrl.trim() : "";
  if (!joinUrl || !isHttpsUrl(joinUrl)) {
    return { error: "joinUrl required and must be an https URL" };
  }
  const startsAtRaw =
    typeof body.startsAt === "string" ? body.startsAt.trim() : "";
  const startsAt = startsAtRaw ? new Date(startsAtRaw) : new Date("invalid");
  if (Number.isNaN(startsAt.getTime())) {
    return { error: "startsAt must be a valid ISO timestamp" };
  }
  if (startsAt.getTime() <= Date.now()) {
    return { error: "startsAt must be in the future" };
  }

  let durationMinutes = 60;
  if (body.durationMinutes !== undefined) {
    const d = parseDuration(body.durationMinutes);
    if ("error" in d) return { error: d.error };
    durationMinutes = d.value;
  }

  const cap = parseCapacity(body.capacity);
  if ("error" in cap) return { error: cap.error };

  const rec = parseRecordingUrl(body.recordingUrl);
  if ("error" in rec) return { error: rec.error };

  const description =
    typeof body.description === "string"
      ? body.description.slice(0, SESSION_LIMITS.descMax)
      : null;
  const hostEmail =
    typeof body.hostEmail === "string" && body.hostEmail.trim()
      ? body.hostEmail.trim()
      : null;

  return {
    value: {
      title,
      description,
      hostName,
      hostEmail,
      startsAt,
      durationMinutes,
      joinUrl,
      capacity: cap.value,
      // Absent on create → null; otherwise the validated value.
      recordingUrl: rec.value ?? null,
    },
  };
}

export function parseSessionPatch(
  body: Record<string, unknown>,
):
  | { value: Partial<SessionCreateValue> }
  | { error: string } {
  const out: Partial<SessionCreateValue> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title || title.length > SESSION_LIMITS.titleMax) {
      return { error: `title must be 1–${SESSION_LIMITS.titleMax} chars` };
    }
    out.title = title;
  }
  if (body.hostName !== undefined) {
    const hostName =
      typeof body.hostName === "string" ? body.hostName.trim() : "";
    if (!hostName || hostName.length > SESSION_LIMITS.hostMax) {
      return { error: `hostName must be 1–${SESSION_LIMITS.hostMax} chars` };
    }
    out.hostName = hostName;
  }
  if (body.joinUrl !== undefined) {
    const joinUrl =
      typeof body.joinUrl === "string" ? body.joinUrl.trim() : "";
    if (!joinUrl || !isHttpsUrl(joinUrl)) {
      return { error: "joinUrl must be an https URL" };
    }
    out.joinUrl = joinUrl;
  }
  if (body.startsAt !== undefined) {
    const raw = typeof body.startsAt === "string" ? body.startsAt.trim() : "";
    const startsAt = raw ? new Date(raw) : new Date("invalid");
    if (Number.isNaN(startsAt.getTime())) {
      return { error: "startsAt must be a valid ISO timestamp" };
    }
    out.startsAt = startsAt;
  }
  if (body.durationMinutes !== undefined) {
    const d = parseDuration(body.durationMinutes);
    if ("error" in d) return { error: d.error };
    out.durationMinutes = d.value;
  }
  if (body.capacity !== undefined) {
    const cap = parseCapacity(body.capacity);
    if ("error" in cap) return { error: cap.error };
    out.capacity = cap.value;
  }
  if (body.recordingUrl !== undefined) {
    const rec = parseRecordingUrl(body.recordingUrl);
    if ("error" in rec) return { error: rec.error };
    // value is null (cleared) or a validated string — never undefined here.
    out.recordingUrl = rec.value ?? null;
  }
  if (body.description !== undefined) {
    out.description =
      typeof body.description === "string"
        ? body.description.slice(0, SESSION_LIMITS.descMax)
        : null;
  }
  if (body.hostEmail !== undefined) {
    out.hostEmail =
      typeof body.hostEmail === "string" && body.hostEmail.trim()
        ? body.hostEmail.trim()
        : null;
  }

  if (Object.keys(out).length === 0) {
    return { error: "No editable fields provided" };
  }
  return { value: out };
}

// Admin-facing serialization (full row, NOT the gated member view — admins see
// the join_url unconditionally since they author it). Timestamps as ISO.
function serializeAdminSession(row: {
  id: string;
  title: string;
  description: string | null;
  hostName: string;
  hostEmail: string | null;
  startsAt: Date;
  durationMinutes: number;
  joinUrl: string;
  capacity: number | null;
  recordingUrl: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? null,
    hostName: row.hostName,
    hostEmail: row.hostEmail ?? null,
    startsAt: row.startsAt.toISOString(),
    durationMinutes: row.durationMinutes,
    joinUrl: row.joinUrl,
    capacity: row.capacity ?? null,
    // Always present for admins (so the edit form can pre-fill it).
    recordingUrl: row.recordingUrl ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function portalRoutes(db: Db): Router {
  const router = Router();

  // Anti-CSRF: portal auth is cookie-based (SameSite=Lax + wildcard
  // .coherencedaddy.com Domain), which gives no protection against a same-site
  // foothold on any *.coherencedaddy.com subdomain. Enforce an Origin/Referer
  // allowlist on all unsafe methods (skips GET/HEAD/OPTIONS). Covers login,
  // /auth session issuance, and every state-changing portal endpoint.
  router.use(portalCsrfGuard());

  const svc = customerPortalService(db);
  const sessionsSvc = universitySessionsService(db);
  const voiceSvc = voiceBudgetService(db);
  const coherenceSvc = coherenceService(db);

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
      // no-referrer would force Origin: null on the interstitial's same-origin
      // POST (Fetch standard), which portalCsrfGuard then rejects as an
      // untrusted origin — breaking every magic-link login. same-origin keeps
      // the Origin header on the first-party submit (still stripped
      // cross-origin), so the guard accepts it.
      .setHeader("Referrer-Policy", "same-origin")
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
        totalReps: summary.totalReps,
        thirtyDayRate: summary.thirtyDayRate,
        weekByDay: summary.weekByDay,
        lessonsDone: summary.lessonsDone,
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

  // -- University training (brain-training drills) -----------------------------
  //
  // The portal Training hub POSTs every finished drill run here. Member-facing
  // copy says "drills"/"training" (standing owner directive); the wire field is
  // `game` per the frozen cross-repo contract.
  //
  // POST /university/training/score { game, level, score } → 200 { ok: true }
  //   Upsert per (member, game): best_score keeps the max, best_level follows
  //   the best-scoring run, plays counts EVERY valid submission. Scores are
  //   never echoed back.
  //
  // Gates are EXACTLY POST /university/progress's: member via
  // requireUniversityMember(), writes blocked under impersonation — plus the
  // per-member write limiter the community endpoints use (a real drill run
  // takes tens of seconds; 30/min is generous headroom, bot-hostile).
  // NOTE: communityWriteLimiter/writeLimit are function declarations below —
  // hoisted, so calling them here at router-setup time is safe.

  const trainingScoreLimiter = communityWriteLimiter(
    writeLimit("UNIVERSITY_TRAINING_SCORE_RATE_PER_MIN", 30),
  );

  router.post(
    "/university/training/score",
    trainingScoreLimiter,
    async (req: Request, res: Response) => {
      // Recording a score mutates state — block under impersonation (read-only).
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;

      const body = (req.body ?? {}) as {
        game?: unknown;
        level?: unknown;
        score?: unknown;
      };
      const game = typeof body.game === "string" ? body.game.trim() : "";
      if (!isTrainingGameSlug(game)) {
        res.status(400).json({ error: "Unknown drill" });
        return;
      }
      const level = Number(body.level);
      if (!Number.isInteger(level) || level < 1 || level > 5) {
        res.status(400).json({ error: "level must be an integer 1–5" });
        return;
      }
      const score = Number(body.score);
      if (!Number.isInteger(score) || score < 0 || score > 1000) {
        res.status(400).json({ error: "score must be an integer 0–1000" });
        return;
      }

      try {
        await svc.recordTrainingScore(accountId, game, level, score);
        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error(
          { err, accountId, game },
          "portal/university/training/score: record failed",
        );
        res.status(500).json({ error: "Failed to record score" });
      }
    },
  );

  // -- University notes (in-lesson "write this down") -------------------------
  //
  // Persists the in-lesson note prompts so they survive across sessions and
  // devices. Gated to University members via requireUniversityMember() — same
  // gate as the rep-log — and writes are blocked under impersonation
  // (read-only), exactly like POST /university/progress.
  //
  // A note is keyed by (lessonSlug, noteKey): noteKey is the stable slot for an
  // in-lesson field, so saving the same field again upserts the row in place.
  //
  // GET    /university/notes?lessonSlug=<slug>  (lessonSlug optional → all the
  //          member's notes) → { notes: [{ lessonSlug, noteKey, body, updatedAt }] }
  // POST   /university/notes { lessonSlug, noteKey, body } → upsert; returns the
  //          saved note. 400 on missing lessonSlug/noteKey.
  // DELETE /university/notes { lessonSlug, noteKey } → remove.
  //
  // FUTURE: these member notes are the input corpus for a planned "smart
  // pattern recognition" feature ported from the Optimize Me / architect app —
  // it will analyze members' notes to surface what to work on + best
  // suggestions. Not built yet.

  const NOTE_BODY_MAX = 20_000;

  router.get("/university/notes", async (req: Request, res: Response) => {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;
    const lessonSlugRaw = req.query.lessonSlug;
    const lessonSlug =
      typeof lessonSlugRaw === "string" ? lessonSlugRaw.trim() : undefined;
    try {
      const notes = await svc.getNotes({ accountId, lessonSlug });
      res.json({
        notes: notes.map((n) => ({
          lessonSlug: n.lessonSlug,
          noteKey: n.noteKey,
          body: n.body,
          updatedAt: n.updatedAt.toISOString(),
        })),
      });
    } catch (err) {
      logger.error({ err, accountId }, "portal/university/notes: list failed");
      res.status(500).json({ error: "Failed to load notes" });
    }
  });

  router.post("/university/notes", async (req: Request, res: Response) => {
    // Saving a note mutates state — block under impersonation (read-only).
    if (!requireNonImpersonating(req, res)) return;
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;

    const body = (req.body ?? {}) as {
      lessonSlug?: unknown;
      noteKey?: unknown;
      body?: unknown;
    };
    const lessonSlug =
      typeof body.lessonSlug === "string" ? body.lessonSlug.trim() : "";
    if (!lessonSlug || lessonSlug.length > 200) {
      res.status(400).json({ error: "lessonSlug required" });
      return;
    }
    const noteKey = typeof body.noteKey === "string" ? body.noteKey.trim() : "";
    if (!noteKey || noteKey.length > 200) {
      res.status(400).json({ error: "noteKey required" });
      return;
    }
    const noteBody = typeof body.body === "string" ? body.body : "";
    if (noteBody.length > NOTE_BODY_MAX) {
      res
        .status(400)
        .json({ error: `body must be at most ${NOTE_BODY_MAX} characters` });
      return;
    }

    try {
      const saved = await svc.upsertNote({
        accountId,
        lessonSlug,
        noteKey,
        body: noteBody,
      });
      res.status(200).json({
        note: {
          lessonSlug: saved.lessonSlug,
          noteKey: saved.noteKey,
          body: saved.body,
          updatedAt: saved.updatedAt.toISOString(),
        },
      });
    } catch (err) {
      logger.error(
        { err, accountId, lessonSlug, noteKey },
        "portal/university/notes: upsert failed",
      );
      res.status(500).json({ error: "Failed to save note" });
    }
  });

  router.delete("/university/notes", async (req: Request, res: Response) => {
    // Deleting a note mutates state — block under impersonation (read-only).
    if (!requireNonImpersonating(req, res)) return;
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;

    const body = (req.body ?? {}) as {
      lessonSlug?: unknown;
      noteKey?: unknown;
    };
    const lessonSlug =
      typeof body.lessonSlug === "string" ? body.lessonSlug.trim() : "";
    const noteKey = typeof body.noteKey === "string" ? body.noteKey.trim() : "";
    if (!lessonSlug) {
      res.status(400).json({ error: "lessonSlug required" });
      return;
    }
    if (!noteKey) {
      res.status(400).json({ error: "noteKey required" });
      return;
    }

    try {
      await svc.deleteNote({ accountId, lessonSlug, noteKey });
      res.status(200).json({ ok: true });
    } catch (err) {
      logger.error(
        { err, accountId, lessonSlug, noteKey },
        "portal/university/notes: delete failed",
      );
      res.status(500).json({ error: "Failed to delete note" });
    }
  });

  // -- University voice budget (Rex realtime-minutes cap) ---------------------
  //
  // Meters Rex realtime-voice usage against a monthly per-member seconds cap
  // (Phase 1: free 3600 s/mo). Same member gate as the rep-log/notes; the two
  // mutations are blocked under impersonation (read-only), exactly like
  // POST /university/progress. See services/voice-budget.ts for the reserve-
  // then-reconcile design.
  //
  // GET  /university/voice/budget  → { periodStart, usedSeconds, limitSeconds,
  //        remainingSeconds }
  // POST /university/voice/reserve { requestedSeconds } → debit up front;
  //        returns { reservationId, grantedSeconds, remainingSeconds }
  // POST /university/voice/usage   { reservationId, actualSeconds } → settle;
  //        returns { ok, usedSeconds, remainingSeconds }
  //
  // The member row is resolved from the account (active/past_due). A membership
  // that passes the status-agnostic gate but has no active row → 403.

  async function requireVoiceMember(
    req: Request,
    res: Response,
  ): Promise<string | null> {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return null;
    let memberId: string | null;
    try {
      memberId = await voiceSvc.resolveVoiceMemberId(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/voice: member resolve failed",
      );
      res.status(500).json({ error: "Failed to resolve member" });
      return null;
    }
    if (!memberId) {
      res.status(403).json({ error: "University membership required" });
      return null;
    }
    return memberId;
  }

  router.get(
    "/university/voice/budget",
    async (req: Request, res: Response) => {
      const memberId = await requireVoiceMember(req, res);
      if (!memberId) return;
      try {
        const budget = await voiceSvc.getVoiceBudget(memberId);
        res.json({
          periodStart: budget.periodStart,
          usedSeconds: budget.usedSeconds,
          limitSeconds: budget.limitSeconds,
          remainingSeconds: budget.remainingSeconds,
        });
      } catch (err) {
        logger.error(
          { err, memberId },
          "portal/university/voice/budget: failed",
        );
        res.status(500).json({ error: "Failed to load voice budget" });
      }
    },
  );

  router.post(
    "/university/voice/reserve",
    async (req: Request, res: Response) => {
      // Reserving debits the meter — block under impersonation (read-only).
      if (!requireNonImpersonating(req, res)) return;
      const memberId = await requireVoiceMember(req, res);
      if (!memberId) return;

      const body = (req.body ?? {}) as { requestedSeconds?: unknown };
      const requested = Number(body.requestedSeconds);
      if (!Number.isFinite(requested) || requested < 0) {
        res.status(400).json({ error: "requestedSeconds must be a non-negative number" });
        return;
      }

      try {
        const result = await voiceSvc.reserveVoiceSeconds(memberId, requested);
        res.status(200).json({
          reservationId: result.reservationId,
          grantedSeconds: result.grantedSeconds,
          remainingSeconds: result.remainingSeconds,
        });
      } catch (err) {
        logger.error(
          { err, memberId },
          "portal/university/voice/reserve: failed",
        );
        res.status(500).json({ error: "Failed to reserve voice seconds" });
      }
    },
  );

  router.post(
    "/university/voice/usage",
    async (req: Request, res: Response) => {
      // Settling mutates the meter — block under impersonation (read-only).
      if (!requireNonImpersonating(req, res)) return;
      const memberId = await requireVoiceMember(req, res);
      if (!memberId) return;

      const body = (req.body ?? {}) as {
        reservationId?: unknown;
        actualSeconds?: unknown;
      };
      const reservationId =
        typeof body.reservationId === "string" ? body.reservationId.trim() : "";
      if (!reservationId) {
        res.status(400).json({ error: "reservationId required" });
        return;
      }
      const actualSeconds = Number(body.actualSeconds);
      if (!Number.isFinite(actualSeconds) || actualSeconds < 0) {
        res.status(400).json({ error: "actualSeconds must be a non-negative number" });
        return;
      }

      try {
        const result = await voiceSvc.settleVoiceSeconds(
          reservationId,
          memberId,
          actualSeconds,
        );
        res.status(200).json({
          ok: result.ok,
          usedSeconds: result.usedSeconds,
          remainingSeconds: result.remainingSeconds,
        });
      } catch (err) {
        logger.error(
          { err, memberId, reservationId },
          "portal/university/voice/usage: failed",
        );
        res.status(500).json({ error: "Failed to record voice usage" });
      }
    },
  );

  // -- University coherence self-check ----------------------------------------
  //
  // The "how coherent am I right now?" self-rating. A member rates three axes
  // (body / focus / direction, each 0..100); the backend derives a fixed 0..100
  // score the frontend mirrors EXACTLY (see services/coherence.ts). Same member
  // gate + resolver as the voice budget — coherence rows tie to the SAME member
  // entity as the voice meter — and the mutation is blocked under impersonation
  // (read-only), exactly like POST /university/progress and voice/reserve.
  //
  // GET  /university/coherence        → CoherenceSummary
  // POST /university/coherence-check  { body, focus, direction } →
  //        { score } & CoherenceSummary
  //
  // The member row is resolved from the account (active/past_due) via
  // resolveVoiceMemberId; a membership with no active row → 403.

  async function requireCoherenceMember(
    req: Request,
    res: Response,
  ): Promise<string | null> {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return null;
    let memberId: string | null;
    try {
      // Same resolver as the voice budget → same member identity.
      memberId = await voiceSvc.resolveVoiceMemberId(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/coherence: member resolve failed",
      );
      res.status(500).json({ error: "Failed to resolve member" });
      return null;
    }
    if (!memberId) {
      res.status(403).json({ error: "University membership required" });
      return null;
    }
    return memberId;
  }

  router.get("/university/coherence", async (req: Request, res: Response) => {
    const memberId = await requireCoherenceMember(req, res);
    if (!memberId) return;
    try {
      const summary = await coherenceSvc.getCoherenceSummary(memberId);
      res.json(summary);
    } catch (err) {
      logger.error(
        { err, memberId },
        "portal/university/coherence: summary failed",
      );
      res.status(500).json({ error: "Failed to load coherence" });
    }
  });

  router.post(
    "/university/coherence-check",
    async (req: Request, res: Response) => {
      // Logging a check mutates state — block under impersonation (read-only).
      if (!requireNonImpersonating(req, res)) return;
      const memberId = await requireCoherenceMember(req, res);
      if (!memberId) return;

      const body = (req.body ?? {}) as {
        body?: unknown;
        focus?: unknown;
        direction?: unknown;
      };
      // Each axis is required and must be an integer in [0, 100].
      const axes: Record<"body" | "focus" | "direction", number> = {
        body: 0,
        focus: 0,
        direction: 0,
      };
      for (const key of ["body", "focus", "direction"] as const) {
        const raw = body[key];
        const n = Number(raw);
        if (
          raw === undefined ||
          raw === null ||
          !Number.isInteger(n) ||
          n < 0 ||
          n > 100
        ) {
          res.status(400).json({ error: `${key} must be an integer 0–100` });
          return;
        }
        axes[key] = n;
      }

      try {
        const result = await coherenceSvc.logCoherenceCheck(memberId, axes);
        res.status(200).json(result);
      } catch (err) {
        logger.error(
          { err, memberId },
          "portal/university/coherence-check: failed",
        );
        res.status(500).json({ error: "Failed to record coherence check" });
      }
    },
  );

  // -- University voice ADD-ON checkout (Phase 2 paid upgrades) ----------------
  //
  // Starts a Stripe Checkout (subscription) on the Starwise account for a paid
  // Rex voice-minute add-on. Same member gate as the meter routes; blocked under
  // impersonation (a purchase is a mutation). The webhook
  // (university-stripe-handler.ts) upserts the add-on row keyed by the member id
  // we pass in metadata + client_reference_id.
  //
  // POST /university/voice/addon-checkout { tier: "1hr" | "2p5hr" } → { url }
  router.post(
    "/university/voice/addon-checkout",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const memberId = await requireVoiceMember(req, res);
      if (!memberId) return;

      const body = (req.body ?? {}) as { tier?: unknown };
      const tier = typeof body.tier === "string" ? body.tier : "";
      if (tier !== "1hr" && tier !== "2p5hr") {
        res.status(400).json({ error: "tier must be '1hr' or '2p5hr'" });
        return;
      }
      const addonTier = tier as VoiceAddonTier;

      try {
        // University bills on the Starwise account — use the University key so the
        // session is created where the add-on prices live. Throws in production if
        // UNIVERSITY_STRIPE_SECRET_KEY is unset (never falls back to the shared key).
        const secretKey = universityStripeKey();
        if (!secretKey && !stripeConfigured()) {
          res.status(503).json({ error: "STRIPE_SECRET_KEY not configured" });
          return;
        }

        const email = await voiceSvc.getMemberEmail(memberId);
        if (!email) {
          res.status(500).json({ error: "Failed to resolve member email" });
          return;
        }

        const priceId = VOICE_ADDON_TIERS[addonTier].priceId;
        // Return to the portal Rex surface on success/cancel. Env-overridable.
        const base =
          process.env.VOICE_ADDON_RETURN_URL
          || "https://app.coherencedaddy.com/university";
        const sep = base.includes("?") ? "&" : "?";
        const successUrl = `${base}${sep}status=addon_success&session_id={CHECKOUT_SESSION_ID}&product=university_voice_addon`;
        const cancelUrl = `${base}${sep}status=addon_cancelled`;

        const { checkoutUrl } = await createCheckoutSession({
          email,
          priceId,
          successUrl,
          cancelUrl,
          // memberId is the webhook's mapping key (metadata + client_reference_id).
          metadata: {
            product: "university_voice_addon",
            memberId,
            tier: addonTier,
          },
          secretKey,
          clientReferenceId: memberId,
        });

        res.status(200).json({ url: checkoutUrl });
      } catch (err) {
        logger.error(
          { err, memberId, tier },
          "portal/university/voice/addon-checkout: failed",
        );
        res.status(500).json({ error: "Failed to start add-on checkout" });
      }
    },
  );

  // -- University community (the native members feed) -------------------------
  //
  // The "Do, between sessions" beat of the Coherent Loop. A members-only async
  // feed: members post short updates, comment, and react ("Resonate"). Mounted
  // INLINE here (not a separate router) reusing the in-place requireUniversity-
  // Member + requireNonImpersonating gates — identical to /university/progress
  // and /university/notes. Every mutation is also rate-limited per member
  // (write floods) and runs the deterministic profanity gate in the service.
  //
  // GET    /university/community/feed?cursor=&limit=&type=&topic=&unanswered=1 → feed page
  // POST   /university/community/posts { body, postType?, topic? } → create post
  // GET    /university/community/posts/:id?cursor=&limit=     → post + comments
  // DELETE /university/community/posts/:id                    → author soft-delete
  // POST   /university/community/posts/:id/accept { commentId } → mark accepted answer
  // DELETE /university/community/posts/:id/accept             → clear accepted answer
  // POST   /university/community/posts/:id/comments { body }  → add comment
  // DELETE /university/community/comments/:id                 → author soft-delete
  // POST   /university/community/react   { targetType, targetId, emoji? }
  // DELETE /university/community/react   { targetType, targetId, emoji? }
  // POST   /university/community/report  { targetType, targetId, reason? }
  // GET    /university/community/notifications/unread-count   → { count }
  // POST   /university/community/notifications/seen           → { ok }

  // Map a thrown service CommunityError to its HTTP status; rethrow anything
  // else for the generic 500 path. The profanity 422 surfaces a non-preachy
  // message the portal renders inline.
  function sendCommunityError(res: Response, err: unknown): boolean {
    if (err instanceof CommunityError) {
      if (err.status === 422 && err.message === "profanity") {
        res.status(422).json({
          error: "Let's keep it coherent — please rephrase.",
          code: "profanity",
        });
        return true;
      }
      res.status(err.status).json({ error: err.message });
      return true;
    }
    return false;
  }

  // Per-member write rate limiter. Keyed on the verified session account id
  // (so a member behind shared NAT doesn't throttle others, and a bot behind
  // one account is caught) with an IPv6-safe IP fallback for unauthenticated
  // hits. 429 returns a friendly "slow down". Mirrors global-rate-limit.ts.
  function communityWriteLimiter(maxPerMinute: number) {
    return rateLimit({
      windowMs: 60 * 1000,
      max: maxPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: "You're posting quickly — give it a moment." },
      keyGenerator: (req: Request): string => {
        const resolved = resolvePortalAuth(req, (c) => svc.verifySession(c));
        if (resolved) return `acct:${resolved.accountId}`;
        return ipKeyGenerator(req.ip ?? "");
      },
    });
  }

  // Owner-confirmed per-minute write limits (DESIGN §13.9): posts ≤ 5,
  // comments ≤ 15, reactions/reports kept loose but bounded against automation.
  // Env-overridable so the owner can tune without a redeploy (and so the test
  // suite can lift the ceiling — the limits are behavioural, not correctness).
  function writeLimit(envVar: string, fallback: number): number {
    const raw = process.env[envVar];
    const n = raw ? Number(raw) : fallback;
    if (!Number.isFinite(n) || n < 1) return fallback;
    return Math.floor(n);
  }
  const postWriteLimiter = communityWriteLimiter(
    writeLimit("COMMUNITY_POST_RATE_PER_MIN", 5),
  );
  const commentWriteLimiter = communityWriteLimiter(
    writeLimit("COMMUNITY_COMMENT_RATE_PER_MIN", 15),
  );
  const reactWriteLimiter = communityWriteLimiter(
    writeLimit("COMMUNITY_REACT_RATE_PER_MIN", 60),
  );
  const reportWriteLimiter = communityWriteLimiter(
    writeLimit("COMMUNITY_REPORT_RATE_PER_MIN", 20),
  );
  // Support requires a written reason, so it's more deliberate than a Resonate
  // tap (60/min) but a member browsing ideas may support several — 30/min.
  const supportWriteLimiter = communityWriteLimiter(
    writeLimit("COMMUNITY_SUPPORT_RATE_PER_MIN", 30),
  );

  function parseTargetType(raw: unknown): "post" | "comment" | null {
    return raw === "post" || raw === "comment" ? raw : null;
  }

  // Narrow a query/body post_type to the union, or null if absent/invalid.
  // (The service is the authority and re-validates create; the feed filter just
  // ignores an unrecognised type.)
  function parsePostType(raw: unknown): CommunityPostType | null {
    return typeof raw === "string" &&
      (COMMUNITY_POST_TYPES as readonly string[]).includes(raw)
      ? (raw as CommunityPostType)
      : null;
  }

  // Narrow a query/body topic to the union, or null if absent/invalid.
  function parseTopic(raw: unknown): CommunityTopic | null {
    return typeof raw === "string" &&
      (COMMUNITY_TOPICS as readonly string[]).includes(raw)
      ? (raw as CommunityTopic)
      : null;
  }

  // Validate a body string (string + non-empty after trim). Length is enforced
  // in the service against the table-specific cap.
  function readBody(raw: unknown): string | null {
    if (typeof raw !== "string") return null;
    return raw;
  }

  type SerializableAuthor = {
    displayName: string;
    handle: string;
    isYou: boolean;
    isMark: boolean;
  };

  function serializePost(p: {
    id: string;
    author: SerializableAuthor;
    body: string;
    commentCount: number;
    reactionCount: number;
    youReacted: boolean;
    createdAt: Date;
    postType: string;
    topic: string | null;
    acceptedCommentId: string | null;
    acceptedAnswer: {
      commentId: string;
      body: string;
      author: SerializableAuthor;
    } | null;
    ideaSupport: {
      count: number;
      youSupported: { reason: string } | null;
    } | null;
  }) {
    return {
      id: p.id,
      author: p.author,
      body: p.body,
      commentCount: p.commentCount,
      reactionCount: p.reactionCount,
      youReacted: p.youReacted,
      createdAt: p.createdAt.toISOString(),
      postType: p.postType,
      topic: p.topic,
      acceptedCommentId: p.acceptedCommentId,
      acceptedAnswer: p.acceptedAnswer,
      // null for non-idea posts; support only ever rises or holds (no
      // down/net/negative).
      ideaSupport: p.ideaSupport,
    };
  }

  // Serialize one supporter-list entry (GET supporters). createdAt → ISO; the
  // author label is already resolved by the service.
  function serializeSupporter(s: {
    reason: string;
    author: SerializableAuthor;
    createdAt: Date;
  }) {
    return {
      reason: s.reason,
      author: s.author,
      createdAt: s.createdAt.toISOString(),
    };
  }

  function serializeComment(c: {
    id: string;
    postId: string;
    author: SerializableAuthor;
    body: string;
    reactionCount: number;
    youReacted: boolean;
    createdAt: Date;
    isAccepted: boolean;
  }) {
    return {
      id: c.id,
      postId: c.postId,
      author: c.author,
      body: c.body,
      reactionCount: c.reactionCount,
      youReacted: c.youReacted,
      createdAt: c.createdAt.toISOString(),
      isAccepted: c.isAccepted,
    };
  }

  router.get(
    "/university/community/feed",
    async (req: Request, res: Response) => {
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = clampCommunityLimit(req.query.limit);
      const type = parsePostType(req.query.type);
      const topic = parseTopic(req.query.topic);
      const unanswered = req.query.unanswered === "1";
      try {
        const { posts, nextCursor } = await svc.getCommunityFeed(accountId, {
          cursor,
          limit,
          type,
          topic,
          unanswered,
        });
        res.json({ posts: posts.map(serializePost), nextCursor });
      } catch (err) {
        logger.error(
          { err, accountId },
          "portal/university/community/feed: list failed",
        );
        res.status(500).json({ error: "Failed to load feed" });
      }
    },
  );

  router.post(
    "/university/community/posts",
    postWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const reqBody = (req.body ?? {}) as {
        body?: unknown;
        postType?: unknown;
        topic?: unknown;
      };
      const body = readBody(reqBody.body);
      if (body === null) {
        res.status(400).json({ error: "Post body required" });
        return;
      }
      // Pass the raw values through — the service validates the enums and
      // throws CommunityError(400) on a bad value (routed via sendCommunityError).
      const postType =
        typeof reqBody.postType === "string" ? reqBody.postType : null;
      const topic = typeof reqBody.topic === "string" ? reqBody.topic : null;
      try {
        const post = await svc.createCommunityPost(
          accountId,
          body,
          postType,
          topic,
        );
        res.status(201).json({ post: serializePost(post) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId },
          "portal/university/community/posts: create failed",
        );
        res.status(500).json({ error: "Failed to create post" });
      }
    },
  );

  router.get(
    "/university/community/posts/:id",
    async (req: Request, res: Response) => {
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = clampCommunityLimit(req.query.limit);
      try {
        const result = await svc.getCommunityPost(accountId, postId, {
          cursor,
          limit,
        });
        res.json({
          post: serializePost(result.post),
          comments: result.comments.map(serializeComment),
          nextCursor: result.nextCursor,
        });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id: detail failed",
        );
        res.status(500).json({ error: "Failed to load post" });
      }
    },
  );

  router.delete(
    "/university/community/posts/:id",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      try {
        const ok = await svc.deleteCommunityPost(accountId, postId);
        if (!ok) {
          res.status(404).json({ error: "Post not found" });
          return;
        }
        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id: delete failed",
        );
        res.status(500).json({ error: "Failed to delete post" });
      }
    },
  );

  router.post(
    "/university/community/posts/:id/comments",
    commentWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      const body = readBody((req.body ?? {}).body);
      if (body === null) {
        res.status(400).json({ error: "Comment body required" });
        return;
      }
      try {
        const comment = await svc.createCommunityComment(
          accountId,
          postId,
          body,
        );
        res.status(201).json({ comment: serializeComment(comment) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/comments: create failed",
        );
        res.status(500).json({ error: "Failed to create comment" });
      }
    },
  );

  router.delete(
    "/university/community/comments/:id",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const commentId = String(req.params.id);
      try {
        const ok = await svc.deleteCommunityComment(accountId, commentId);
        if (!ok) {
          res.status(404).json({ error: "Comment not found" });
          return;
        }
        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error(
          { err, accountId, commentId },
          "portal/university/community/comments/:id: delete failed",
        );
        res.status(500).json({ error: "Failed to delete comment" });
      }
    },
  );

  router.post(
    "/university/community/posts/:id/accept",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      const commentId =
        typeof (req.body ?? {}).commentId === "string"
          ? (req.body as { commentId: string }).commentId
          : "";
      if (!commentId) {
        res.status(400).json({ error: "commentId required" });
        return;
      }
      try {
        const post = await svc.acceptCommunityAnswer(
          accountId,
          postId,
          commentId,
        );
        res.status(200).json({ post: serializePost(post) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id/accept: accept failed",
        );
        res.status(500).json({ error: "Failed to accept answer" });
      }
    },
  );

  router.delete(
    "/university/community/posts/:id/accept",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      try {
        const post = await svc.unacceptCommunityAnswer(accountId, postId);
        res.status(200).json({ post: serializePost(post) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id/accept: unaccept failed",
        );
        res.status(500).json({ error: "Failed to un-accept answer" });
      }
    },
  );

  // Idea support (Spec B). Mirrors the accept routes: member-gated, writes also
  // non-impersonating, errors via sendCommunityError. The service is the
  // authority on reason validation (400/403/422) and the idea gate.
  router.post(
    "/university/community/posts/:id/support",
    supportWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      const b = (req.body ?? {}) as { reason?: unknown };
      const reason = typeof b.reason === "string" ? b.reason : "";
      try {
        const post = await svc.supportIdea(accountId, postId, reason);
        res.status(200).json({ post: serializePost(post) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id/support: support failed",
        );
        res.status(500).json({ error: "Failed to record support" });
      }
    },
  );

  router.delete(
    "/university/community/posts/:id/support",
    supportWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      try {
        const post = await svc.unsupportIdea(accountId, postId);
        res.status(200).json({ post: serializePost(post) });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id/support: retract failed",
        );
        res.status(500).json({ error: "Failed to retract support" });
      }
    },
  );

  // Supporter list — paginated reasons, always available (no reveal gate).
  // Read-only: member-gated, no impersonation block.
  router.get(
    "/university/community/posts/:id/supporters",
    async (req: Request, res: Response) => {
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const postId = String(req.params.id);
      const cursor =
        typeof req.query.cursor === "string" ? req.query.cursor : null;
      const limit = clampCommunityLimit(req.query.limit);
      try {
        const { supporters, nextCursor } = await svc.listIdeaSupporters(
          accountId,
          postId,
          { cursor, limit },
        );
        res.json({ supporters: supporters.map(serializeSupporter), nextCursor });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, postId },
          "portal/university/community/posts/:id/supporters: list failed",
        );
        res.status(500).json({ error: "Failed to load supporters" });
      }
    },
  );

  router.post(
    "/university/community/react",
    reactWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const b = (req.body ?? {}) as {
        targetType?: unknown;
        targetId?: unknown;
        emoji?: unknown;
      };
      const targetType = parseTargetType(b.targetType);
      const targetId = typeof b.targetId === "string" ? b.targetId : "";
      if (!targetType || !targetId) {
        res.status(400).json({ error: "targetType and targetId required" });
        return;
      }
      const emoji =
        typeof b.emoji === "string" && b.emoji.trim().length
          ? b.emoji.trim().slice(0, 40)
          : COMMUNITY_DEFAULT_EMOJI;
      try {
        const result = await svc.reactToCommunity(
          accountId,
          targetType,
          targetId,
          emoji,
        );
        res.status(200).json(result);
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, targetType, targetId },
          "portal/university/community/react: react failed",
        );
        res.status(500).json({ error: "Failed to react" });
      }
    },
  );

  router.delete(
    "/university/community/react",
    reactWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const b = (req.body ?? {}) as {
        targetType?: unknown;
        targetId?: unknown;
        emoji?: unknown;
      };
      const targetType = parseTargetType(b.targetType);
      const targetId = typeof b.targetId === "string" ? b.targetId : "";
      if (!targetType || !targetId) {
        res.status(400).json({ error: "targetType and targetId required" });
        return;
      }
      const emoji =
        typeof b.emoji === "string" && b.emoji.trim().length
          ? b.emoji.trim().slice(0, 40)
          : COMMUNITY_DEFAULT_EMOJI;
      try {
        const result = await svc.unreactToCommunity(
          accountId,
          targetType,
          targetId,
          emoji,
        );
        res.status(200).json(result);
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, targetType, targetId },
          "portal/university/community/react: unreact failed",
        );
        res.status(500).json({ error: "Failed to remove reaction" });
      }
    },
  );

  router.post(
    "/university/community/report",
    reportWriteLimiter,
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const b = (req.body ?? {}) as {
        targetType?: unknown;
        targetId?: unknown;
        reason?: unknown;
      };
      const targetType = parseTargetType(b.targetType);
      const targetId = typeof b.targetId === "string" ? b.targetId : "";
      if (!targetType || !targetId) {
        res.status(400).json({ error: "targetType and targetId required" });
        return;
      }
      const reason = typeof b.reason === "string" ? b.reason : null;
      try {
        await svc.reportCommunityTarget(accountId, targetType, targetId, reason);
        // Never reveal report counts or the auto-hide outcome to members.
        res.status(200).json({ ok: true });
      } catch (err) {
        if (sendCommunityError(res, err)) return;
        logger.error(
          { err, accountId, targetType, targetId },
          "portal/university/community/report: report failed",
        );
        res.status(500).json({ error: "Failed to submit report" });
      }
    },
  );

  router.get(
    "/university/community/notifications/unread-count",
    async (req: Request, res: Response) => {
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      try {
        const count = await svc.getCommunityUnreadCount(accountId);
        res.json({ count });
      } catch (err) {
        logger.error(
          { err, accountId },
          "portal/university/community/notifications/unread-count: failed",
        );
        res.status(500).json({ error: "Failed to load unread count" });
      }
    },
  );

  router.post(
    "/university/community/notifications/seen",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      try {
        const marked = await svc.markCommunityNotificationsSeen(accountId);
        res.json({ ok: true, marked });
      } catch (err) {
        logger.error(
          { err, accountId },
          "portal/university/community/notifications/seen: failed",
        );
        res.status(500).json({ error: "Failed to mark notifications seen" });
      }
    },
  );

  // -- University live SESSIONS (scheduling + RSVP) ---------------------------
  //
  // The "Practice together" leg of the Coherent Loop. Admin-created scheduled
  // sits; members RSVP, get reminded (T-24h / T-1h via university-crons.ts),
  // save to calendar (.ics), and one-click join an external video room when
  // it's live. Gated to University members via requireUniversityMember();
  // mutations add requireNonImpersonating first (read-only under impersonation).
  // The DB logic lives in university-sessions.ts; routes stay validation/shape.
  //
  // join_url is NEVER returned unless the session is live AND the caller RSVP'd
  // `going` — the service enforces this so a recurring room link can't leak.
  //
  // GET    /university/sessions?scope=upcoming|past → { sessions: [...] }
  // POST   /university/sessions/:id/rsvp            → upsert going; 409 if full
  // DELETE /university/sessions/:id/rsvp            → soft-cancel; idempotent
  // GET    /university/sessions/:id/ics             → text/calendar (VEVENT)
  // POST   /university/sessions      (admin)        → create one scheduled row
  // PATCH  /university/sessions/:id  (admin)        → partial edit
  // POST   /university/sessions/:id/cancel (admin)  → soft-cancel + notice

  // Admin authoring is gated on an env allow-list of admin account emails
  // (UNIVERSITY_SESSION_ADMINS, comma-separated), checked AFTER the membership
  // gate. There is no member-facing admin-role system in the University path
  // today; an env allow-list is honest, zero-schema, and the simplest
  // sufficient gate (DESIGN §5.2/§10 opt 2).
  function sessionAdminEmails(): Set<string> {
    const raw = process.env.UNIVERSITY_SESSION_ADMINS ?? "";
    return new Set(
      raw
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.length > 0),
    );
  }

  // Resolve the member (membership-gated) AND require they're on the admin
  // allow-list. Returns the accountId on success, or null after writing 403.
  async function requireSessionAdmin(
    req: Request,
    res: Response,
  ): Promise<string | null> {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return null;
    const allow = sessionAdminEmails();
    if (allow.size === 0) {
      res.status(403).json({ error: "Session administration is not enabled" });
      return null;
    }
    let account: Awaited<ReturnType<typeof svc.getAccount>>;
    try {
      account = await svc.getAccount(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/sessions: admin account lookup failed",
      );
      res.status(500).json({ error: "Failed to verify admin" });
      return null;
    }
    const email = account?.email?.trim().toLowerCase() ?? "";
    if (!email || !allow.has(email)) {
      res.status(403).json({ error: "Session administration required" });
      return null;
    }
    return accountId;
  }

  router.get("/university/sessions", async (req: Request, res: Response) => {
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return;
    const scopeRaw = req.query.scope;
    const scope = scopeRaw === "past" ? "past" : "upcoming";
    try {
      const sessions = await sessionsSvc.listSessions(accountId, scope);
      res.json({ sessions });
    } catch (err) {
      logger.error(
        { err, accountId, scope },
        "portal/university/sessions: list failed",
      );
      res.status(500).json({ error: "Failed to load sessions" });
    }
  });

  router.post(
    "/university/sessions/:id/rsvp",
    async (req: Request, res: Response) => {
      // RSVPing mutates state — block under impersonation (read-only).
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const result = await sessionsSvc.rsvp(accountId, sessionId);
        if (!result.ok) {
          switch (result.code) {
            case "not_found":
              res.status(404).json({ error: "Session not found" });
              return;
            case "full":
              res.status(409).json({ error: "Session is full" });
              return;
            case "canceled":
              res.status(400).json({ error: "Session is canceled" });
              return;
            case "ended":
              res.status(400).json({ error: "Session has ended" });
              return;
          }
        }
        // RSVP-confirmation email — ONLY on a transition INTO going (new RSVP or
        // re-activation of a prior canceled). A no-op repeat (already going)
        // sends nothing. Transactional; the storefront template owns subject/
        // body. The .ics calendarUrl is the member-authenticated download route.
        // Per-send failure must not fail the RSVP — log and continue.
        if (result.ok && result.newlyGoing) {
          const s = result.session;
          try {
            await sendCreditscoreEmail({
              kind: "university_session_rsvp_confirm",
              to: result.memberEmail,
              data: {
                sessionId: s.id,
                sessionTitle: s.title,
                hostName: s.hostName,
                startsAt: s.startsAt,
                durationMinutes: s.durationMinutes,
                description: s.description ?? undefined,
                sessionsUrl: UNIVERSITY_SESSIONS_URL,
                calendarUrl: universitySessionIcsUrl(s.id),
              },
            });
          } catch (sendErr) {
            logger.error(
              { err: sendErr, email: result.memberEmail, sessionId },
              "portal/university/sessions: rsvp-confirm send failed (non-fatal)",
            );
          }
        }
        res.status(200).json({ session: result.session });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: rsvp failed",
        );
        res.status(500).json({ error: "Failed to RSVP" });
      }
    },
  );

  router.delete(
    "/university/sessions/:id/rsvp",
    async (req: Request, res: Response) => {
      // Canceling an RSVP mutates state — block under impersonation.
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const result = await sessionsSvc.cancelRsvp(accountId, sessionId);
        if (!result.ok) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        // Waitlist promotion notice — ONLY when canceling this member's `going`
        // seat auto-promoted the oldest waitlister into it. Transactional; the
        // storefront template owns subject/body and no-ops until it ships.
        // Per-send failure must not fail the cancel — log and continue.
        if (result.promoted) {
          const p = result.promoted;
          try {
            await sendCreditscoreEmail({
              kind: "university_session_waitlist_open",
              to: p.email,
              data: {
                sessionId: p.sessionId,
                sessionTitle: p.sessionTitle,
                hostName: p.hostName,
                startsAt: p.startsAt,
                durationMinutes: p.durationMinutes,
                description: p.description ?? undefined,
                sessionsUrl: UNIVERSITY_SESSIONS_URL,
                calendarUrl: universitySessionIcsUrl(p.sessionId),
              },
            });
          } catch (sendErr) {
            logger.error(
              { err: sendErr, email: p.email, sessionId },
              "portal/university/sessions: waitlist-promoted send failed (non-fatal)",
            );
          }
        }
        res.status(200).json({ ok: true });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: cancel-rsvp failed",
        );
        res.status(500).json({ error: "Failed to cancel RSVP" });
      }
    },
  );

  router.get(
    "/university/sessions/:id/ics",
    async (req: Request, res: Response) => {
      // Contains the join link → members only.
      const accountId = await requireUniversityMember(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const ics = await sessionsSvc.buildIcs(sessionId);
        if (ics === null) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        res
          .status(200)
          .setHeader("Content-Type", "text/calendar; charset=utf-8")
          .setHeader(
            "Content-Disposition",
            'attachment; filename="coherence-session.ics"',
          )
          .send(ics);
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: ics failed",
        );
        res.status(500).json({ error: "Failed to build calendar file" });
      }
    },
  );

  // -- Admin reads (env allow-list) -------------------------------------------

  // Full AdminSession (join_url ALWAYS included) for the admin edit form. The
  // member list view gates join_url, so the form reads the room link from here.
  router.get(
    "/university/sessions/:id",
    async (req: Request, res: Response) => {
      const accountId = await requireSessionAdmin(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const row = await sessionsSvc.getAdminSessionById(sessionId);
        if (!row) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        res.status(200).json({ session: serializeAdminSession(row) });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: admin get failed",
        );
        res.status(500).json({ error: "Failed to load session" });
      }
    },
  );

  // RSVP roster for a session (going + canceled, oldest first). Admin attendee
  // list; `name` is the member displayName when known.
  router.get(
    "/university/sessions/:id/rsvps",
    async (req: Request, res: Response) => {
      const accountId = await requireSessionAdmin(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const row = await sessionsSvc.getAdminSessionById(sessionId);
        if (!row) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        const rsvps = await sessionsSvc.listSessionRsvps(sessionId);
        res.status(200).json({ rsvps });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: rsvps list failed",
        );
        res.status(500).json({ error: "Failed to load RSVPs" });
      }
    },
  );

  // -- Admin authoring (env allow-list) ---------------------------------------

  router.post("/university/sessions", async (req: Request, res: Response) => {
    if (!requireNonImpersonating(req, res)) return;
    const accountId = await requireSessionAdmin(req, res);
    if (!accountId) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const parsed = parseSessionCreate(body);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    try {
      const row = await sessionsSvc.createSession({
        ...parsed.value,
        createdByAccount: accountId,
      });

      // New-session announcement — broadcast to ALL active members. COMMERCIAL:
      // the storefront adds postal address + working unsubscribe + the
      // suppression gate; team-dashboard only fans the envelope to active
      // members. messageId = announce:<sessionId>:<emailLower> so a retry of the
      // same broadcast is idempotent storefront-side. Per-send failures must NOT
      // fail the create (the session is already persisted) — log and continue.
      try {
        const members = await sessionsSvc.listActiveMemberEmails();
        for (const m of members) {
          const emailLower = m.email.trim().toLowerCase();
          try {
            await sendCreditscoreEmail({
              kind: "university_session_announce",
              to: m.email,
              messageId: `announce:${row.id}:${emailLower}`,
              data: {
                sessionId: row.id,
                sessionTitle: row.title,
                hostName: row.hostName,
                startsAt: row.startsAt.toISOString(),
                durationMinutes: row.durationMinutes,
                description: row.description ?? undefined,
                sessionsUrl: UNIVERSITY_SESSIONS_URL,
              },
            });
          } catch (sendErr) {
            logger.error(
              { err: sendErr, email: m.email, sessionId: row.id },
              "portal/university/sessions: announce send failed (non-fatal)",
            );
          }
        }
      } catch (announceErr) {
        logger.error(
          { err: announceErr, sessionId: row.id },
          "portal/university/sessions: announce fan-out failed (non-fatal)",
        );
      }

      res.status(200).json({ session: serializeAdminSession(row) });
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/sessions: create failed",
      );
      res.status(500).json({ error: "Failed to create session" });
    }
  });

  router.patch(
    "/university/sessions/:id",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireSessionAdmin(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);

      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsed = parseSessionPatch(body);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      try {
        const row = await sessionsSvc.patchSession(sessionId, parsed.value);
        if (!row) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        res.status(200).json({ session: serializeAdminSession(row) });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: patch failed",
        );
        res.status(500).json({ error: "Failed to update session" });
      }
    },
  );

  router.post(
    "/university/sessions/:id/cancel",
    async (req: Request, res: Response) => {
      if (!requireNonImpersonating(req, res)) return;
      const accountId = await requireSessionAdmin(req, res);
      if (!accountId) return;
      const sessionId = String(req.params.id);
      try {
        const result = await sessionsSvc.cancelSession(sessionId);
        if (!result) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
        // Event-driven "session canceled" notice to going RSVPs (DESIGN §9).
        // The storefront template owns FROM/subject/body; we post the envelope.
        // Per-send failures must not fail the cancel — log and continue.
        for (const email of result.goingEmails) {
          try {
            await sendCreditscoreEmail({
              kind: "university_session_canceled",
              to: email,
              data: {
                title: result.row.title,
                startsAtIso: result.row.startsAt.toISOString(),
                sessionsUrl: UNIVERSITY_SESSIONS_URL,
              },
            });
          } catch (sendErr) {
            logger.error(
              { err: sendErr, email, sessionId },
              "portal/university/sessions: canceled notice send failed (non-fatal)",
            );
          }
        }
        res.status(200).json({ session: serializeAdminSession(result.row) });
      } catch (err) {
        logger.error(
          { err, accountId, sessionId },
          "portal/university/sessions: cancel failed",
        );
        res.status(500).json({ error: "Failed to cancel session" });
      }
    },
  );

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

  // -- University billing save-flow: cancel / pause / reactivate --------------
  //
  // Three self-service actions on the member's University (Starwise) Stripe
  // subscription, all gated by requireUniversityMember (403 for non-members)
  // and requireNonImpersonating (these mutate billing — never allowed while an
  // admin is "viewing as customer"). Every call authenticates against the
  // SEPARATE Starwise account via universityStripeKey(); the subscription id is
  // read from university_subscriptions (the only writer that uses that key), so
  // key + subscription id always belong to the same Stripe account — same
  // pairing guarantee as /stripe-portal.
  //
  // "Manage payment & invoices" stays the existing /stripe-portal Customer
  // Portal hand-off — separate surface, unchanged.

  // Shared prelude: gate (non-impersonating + member), require Stripe to be
  // configured, then resolve the member's University subscription id. Returns
  // { accountId, subId } on success, or null after writing the response.
  async function resolveUniversitySubscription(
    req: Request,
    res: Response,
  ): Promise<{ accountId: string; subId: string } | null> {
    if (!requireNonImpersonating(req, res)) return null;
    const accountId = await requireUniversityMember(req, res);
    if (!accountId) return null;
    if (!stripeConfigured()) {
      res.status(503).json({ error: "Stripe not configured" });
      return null;
    }
    let subId: string | null;
    try {
      subId = await svc.getUniversityStripeSubscriptionId(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university billing: subscription lookup failed",
      );
      res.status(500).json({ error: "Failed to load subscription" });
      return null;
    }
    if (!subId) {
      res.status(400).json({
        error:
          "No University subscription found for this account. Contact support.",
      });
      return null;
    }
    return { accountId, subId };
  }

  // POST /university/cancel { reason? }
  //   → Stripe cancel_at_period_end=true (member keeps access through the paid
  //     period), persist the optional churn reason, return the access-until ISO.
  router.post("/university/cancel", async (req: Request, res: Response) => {
    const resolved = await resolveUniversitySubscription(req, res);
    if (!resolved) return;
    const { accountId, subId } = resolved;

    const body = (req.body ?? {}) as { reason?: unknown };
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 2_000) : "";

    try {
      const sub = await stripeRequest<{ current_period_end: number }>(
        "POST",
        `/subscriptions/${subId}`,
        { cancel_at_period_end: true },
        universityStripeKey(),
      );
      // Persist the reason AFTER Stripe confirms — we only log churn feedback
      // for cancels that actually took effect.
      try {
        await svc.recordCancelFeedback(accountId, reason || null);
      } catch (err) {
        // Feedback is non-critical; a failed insert must NOT fail the cancel.
        logger.error(
          { err, accountId },
          "portal/university/cancel: recordCancelFeedback failed (cancel still applied)",
        );
      }
      void svc.logAction(accountId, "university_cancel_requested", {});
      res.json({
        status: "canceling",
        accessUntil: new Date(sub.current_period_end * 1000).toISOString(),
      });
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/cancel: Stripe update failed",
      );
      res.status(500).json({ error: "Failed to cancel membership" });
    }
  });

  // POST /university/pause { months? = 1 }
  //   → Stripe pause_collection { behavior: 'void' } for one billing cycle.
  //     Voids invoices during the pause; collection resumes at resumes_at.
  router.post("/university/pause", async (req: Request, res: Response) => {
    const resolved = await resolveUniversitySubscription(req, res);
    if (!resolved) return;
    const { accountId, subId } = resolved;

    // Contract is single-cycle; `months` is accepted for forward-compat but
    // clamped to 1 (the only supported value today).
    const body = (req.body ?? {}) as { months?: unknown };
    const monthsRaw = Number(body.months);
    const months =
      Number.isFinite(monthsRaw) && monthsRaw >= 1 ? Math.trunc(monthsRaw) : 1;

    // resumes_at = now + one billing cycle (monthly). Computed from a UTC date
    // so the day-of-month anchor is preserved across month-length differences.
    const resumesAtMs = addUtcMonths(new Date(), months).getTime();
    const resumesAtUnix = Math.floor(resumesAtMs / 1000);

    try {
      await stripeRequest(
        "POST",
        `/subscriptions/${subId}`,
        { pause_collection: { behavior: "void", resumes_at: resumesAtUnix } },
        universityStripeKey(),
      );
      void svc.logAction(accountId, "university_paused", {});
      res.json({
        status: "paused",
        resumesAt: new Date(resumesAtUnix * 1000).toISOString(),
      });
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/pause: Stripe update failed",
      );
      res.status(500).json({ error: "Failed to pause membership" });
    }
  });

  // POST /university/reactivate
  //   → Undo a pending cancel ("keep my membership") AND lift any pause: unset
  //     cancel_at_period_end and clear pause_collection. Returns active.
  router.post("/university/reactivate", async (req: Request, res: Response) => {
    const resolved = await resolveUniversitySubscription(req, res);
    if (!resolved) return;
    const { accountId, subId } = resolved;

    try {
      await stripeRequest(
        "POST",
        `/subscriptions/${subId}`,
        // Empty string clears pause_collection (Stripe's documented unset form).
        { cancel_at_period_end: false, pause_collection: "" },
        universityStripeKey(),
      );
      void svc.logAction(accountId, "university_reactivated", {});
      res.json({ status: "active" });
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/reactivate: Stripe update failed",
      );
      res.status(500).json({ error: "Failed to reactivate membership" });
    }
  });

  // -- Optimize Me SSO bridge: issue a launch assertion -----------------------
  //
  // Mints a short-lived (120s), single-use, audience-pinned, HMAC-signed
  // assertion proving this member's email + entitlement status to the Optimize
  // Me app, and returns the launchUrl the portal opens in a new tab. The
  // assertion carries ONLY { email, status } — never the accountId or any
  // portal identifier (keeps University identity out of Optimize Me's activity
  // zone; see the integration spec).
  //
  // Gating uses the STRICT rule: status ∈ {active, past_due}, read from
  // getAccountWithEntitlements (whose `university` block is already strict-
  // gated) — NOT the lax isUniversityAccount(), which lets cancelled members
  // through. A cancelled member with a live portal session gets 403 here.
  router.post(
    "/optimize-me/launch",
    async (req: Request, res: Response) => {
      // Minting a cross-org access assertion is a privileged action; block it
      // while an admin is impersonating a customer (read-only mode).
      if (!requireNonImpersonating(req, res)) return;
      const accountId = requireSession(req, res);
      if (!accountId) return;
      try {
        const result = await svc.getAccountWithEntitlements(accountId);
        if (!result) {
          clearSessionCookie(res);
          res.status(401).json({ error: "Account not found" });
          return;
        }
        const uni = result.entitlements.university;
        // Strict gate: non-null only for active/past_due. Anything else
        // (no membership, pending, cancelled) is not entitled.
        if (!uni) {
          res.status(403).json({ error: "not_a_member" });
          return;
        }
        const { token } = mintBridgeToken(
          result.account.email,
          uni.status as BridgeStatus,
        );
        const launchUrl = `${optimizeMeAppUrl()}/api/sso/bridge?token=${encodeURIComponent(
          token,
        )}`;
        void svc.logAction(accountId, "optimize_me_launch", {
          status: uni.status,
        });
        res.json({ launchUrl });
      } catch (err) {
        logger.error(
          { err, accountId },
          "portal/optimize-me/launch: mint failed",
        );
        res.status(500).json({ error: "Failed to create launch link" });
      }
    },
  );

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
