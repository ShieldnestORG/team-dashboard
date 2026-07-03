import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companyMemberships } from "@paperclipai/db";
import { logger } from "./logger.js";

/**
 * Fail-closed path allowlist for marketing-role actors.
 *
 * A "marketing actor" is a real board user (session or board_key, never the
 * local_implicit dev principal, never an instance admin) whose EVERY active
 * company membership carries membership_role = 'marketing'. Such users get
 * exactly the surfaces the Content Hub flow needs; every other /api path is
 * a 403 with a plain-English error the UI can render.
 *
 * The UI's role-filtered sidebar is cosmetic — this middleware is the real
 * enforcement. Mounted app-level (right after actorMiddleware) so it covers
 * every /api route regardless of where it is mounted. Non-/api paths (UI
 * HTML/assets) always pass.
 *
 * ⚠ SECURITY LIMIT of the every()-semantics: users with a MIX of roles
 * (marketing in one company, member/owner in another) are NOT restricted at
 * all — one non-marketing membership voids containment, and plain company
 * membership already grants costs/secrets reads for the marketing company
 * via assertCompanyAccess. Adding a marketing user to a second company as a
 * plain 'member' is therefore an escalation, not an add. The gate logs a
 * loud warning when it sees this state; a per-company gate (restrict on the
 * companies where the membership role IS 'marketing') is the real fix and is
 * recorded as deferred in docs/deploy/content-hub-notes.md.
 */

// Prefix → allowed methods. null = all methods (the routes carry their own
// auth/RBAC). Extend DELIBERATELY and mirror every addition in
// server/src/__tests__/marketing-role.test.ts.
const ALLOWED: Array<{ prefix: string; methods: Set<string> | null; exact?: boolean }> = [
  // Sign-in/out + session — auth must always be reachable.
  { prefix: "/api/auth", methods: null },
  // Health probe (Layout polls it for deployment mode).
  { prefix: "/api/health", methods: new Set(["GET", "HEAD"]) },
  // Board identity + memberships (useBoardAccess / CLI approve flow).
  { prefix: "/api/cli-auth", methods: null },
  // Company LIST only (membership-filtered) — NOT /api/companies/:id/*
  // subpaths, which include secrets/costs and other admin-ish reads.
  { prefix: "/api/companies", methods: new Set(["GET", "HEAD"]), exact: true },
  // Socials & Content surface: reads are board-level; drafts are two-tier
  // (pending_approval) and every Zernio mutation inside is requireAdmin.
  { prefix: "/api/socials", methods: null },
  // Voice-snippet factory (board-gated inside; click-to-generate).
  { prefix: "/api/voice-snippets", methods: null },
  // Asset playback/download for voice chips (GET /api/assets/:id/content).
  { prefix: "/api/assets", methods: new Set(["GET", "HEAD"]) },
];

// Users already warned about (mixed-role containment void) — once per process.
const warnedMixedRoleUsers = new Set<string>();

function isAllowed(method: string, path: string): boolean {
  const m = method.toUpperCase();
  for (const rule of ALLOWED) {
    const prefixMatch = rule.exact
      ? path === rule.prefix || path === `${rule.prefix}/`
      : path === rule.prefix || path.startsWith(`${rule.prefix}/`);
    if (!prefixMatch) continue;
    if (rule.methods === null || rule.methods.has(m)) return true;
  }
  return false;
}

export function marketingRoleGate(db: Db): RequestHandler {
  return async (req, res, next) => {
    try {
      // Express routing is case-insensitive by default; compare lowercased so
      // "/API/costs" cannot slip past the gate while still hitting the route.
      const path = req.path.toLowerCase();
      // Only board API paths are gated; the UI shell itself always loads.
      if (!path.startsWith("/api/")) return next();
      // Only real board users can be marketing-scoped. Agents, portal/affiliate
      // JWT surfaces, webhooks and anonymous requests keep their own auth.
      if (req.actor.type !== "board" || !req.actor.userId) return next();
      if (req.actor.isInstanceAdmin) return next();
      if (req.actor.source === "local_implicit") return next();
      // Allowlisted paths never need the role lookup.
      if (isAllowed(req.method, path)) return next();

      const rows = await db
        .select({ membershipRole: companyMemberships.membershipRole })
        .from(companyMemberships)
        .where(
          and(
            eq(companyMemberships.principalType, "user"),
            eq(companyMemberships.principalId, req.actor.userId),
            eq(companyMemberships.status, "active"),
          ),
        );
      const marketingOnly =
        rows.length > 0 && rows.every((row) => row.membershipRole === "marketing");
      if (!marketingOnly) {
        // Loud warning (once per user per process): a marketing membership
        // mixed with any non-marketing one means this user is fully
        // UNRESTRICTED — including costs/secrets reads on the marketing
        // company. Admins usually cause this by adding a marketing user to a
        // second company with the default 'member' role.
        if (
          rows.some((row) => row.membershipRole === "marketing") &&
          !warnedMixedRoleUsers.has(req.actor.userId)
        ) {
          warnedMixedRoleUsers.add(req.actor.userId);
          logger.warn(
            { userId: req.actor.userId },
            "marketing-role gate VOIDED for user with mixed memberships: a non-marketing membership lifts ALL marketing restrictions (incl. costs/secrets of the marketing company). Set membership_role='marketing' on every membership to keep this user contained.",
          );
        }
        return next();
      }

      res.status(403).json({
        error:
          "You don't have access to this page. Your account is set up for marketing work — kits, socials, and voice snippets. Ask Mark if you need more.",
        code: "marketing_role_restricted",
      });
    } catch (err) {
      next(err);
    }
  };
}
