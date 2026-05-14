import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  customerPortalService,
  PORTAL_SESSION_COOKIE,
  type AccountWithEntitlements,
} from "../services/customer-portal.js";
import { logger } from "../middleware/logger.js";
import {
  isUpsellContext,
  selectUpsellCards,
  type UpsellContext,
  type UpsellUserSignal,
} from "../services/upsell-cards.js";

// ---------------------------------------------------------------------------
// Portal upsell-cards route — GET /api/portal/upsell-cards?context=<ctx>
//
// Returns at most 3 prioritized upsell cards for the logged-in portal user,
// contextual to where they are rendered. Auth: same cd_portal_session cookie
// as the rest of /api/portal (HMAC-signed; see customer-portal.ts).
//
// Eligibility/priority lives in services/upsell-cards.ts. THIS file's only
// job is: authenticate, load existing entitlements, project them into the
// UpsellUserSignal shape, and call selectUpsellCards.
//
// Per CLAUDE.md: cast req.query.* / req.params.* through `String(...)` at
// the access site; don't trust the type system for runtime input.
// ---------------------------------------------------------------------------

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

// AEO bundle slugs as they exist in the bundle_plans table (see
// migrations/0087_bundle_entitlements.sql). Cross-referenced by slug because
// bundlePlanId varies per environment.
const AEO_GROWTH_SLUG = "aeo_growth";
const AEO_SCALE_SLUG = "aeo_scale";

function buildUserSignal(
  data: AccountWithEntitlements,
  now: Date = new Date(),
): UpsellUserSignal {
  const { account, entitlements } = data;
  const tenureMs = now.getTime() - new Date(account.createdAt).getTime();
  const tenureDays = Math.max(0, Math.floor(tenureMs / (24 * 60 * 60 * 1000)));

  const bundleSlugs = new Set(
    entitlements.bundles
      .filter((b) => b.status === "active" || b.status === "past_due")
      .map((b) => b.slug)
      .filter((s): s is string => typeof s === "string"),
  );

  const hasCreditscore = entitlements.creditscore !== null;
  const hasWatchtower = entitlements.watchtower !== null;
  const hasAeoGrowthBundle = bundleSlugs.has(AEO_GROWTH_SLUG);
  const hasAeoScaleBundle = bundleSlugs.has(AEO_SCALE_SLUG);

  // Intel API: bundle entitlement isn't on CustomerEntitlements (only the
  // bundle slug is surfaced). AEO Scale grants intelApi (see migration 0087);
  // any other path is "no intel api" for V1. Standalone intel-api subscriptions
  // aren't yet wired into the portal entitlements resolver — when they are,
  // flip this to read the dedicated flag and the upsell will suppress
  // automatically.
  const hasIntelApi = hasAeoScaleBundle;

  // Agents: planned product, no entitlement field exists yet. Until the
  // agents subscription table + resolver lands, treat every account as
  // not-having-agents. The eligibility predicate is already keyed off this
  // flag, so the upsell will start suppressing as soon as the field is added.
  const hasAgents = false;

  return {
    hasWatchtower,
    hasCreditscore,
    hasAeoGrowthBundle,
    hasAeoScaleBundle,
    hasIntelApi,
    hasAgents,
    tenureDays,
  };
}

export function portalUpsellRoutes(db: Db): Router {
  const router = Router();
  const svc = customerPortalService(db);

  function requireSession(req: Request, res: Response): string | null {
    const cookie = readSessionCookie(req);
    const session = svc.verifySession(cookie);
    if (!session) {
      res.status(401).json({ error: "Unauthenticated" });
      return null;
    }
    return session.accountId;
  }

  router.get("/upsell-cards", async (req: Request, res: Response) => {
    const accountId = requireSession(req, res);
    if (!accountId) return;

    const rawContext = req.query.context;
    const contextStr =
      typeof rawContext === "string" && rawContext.trim()
        ? rawContext.trim()
        : "dashboard";
    const context: UpsellContext = isUpsellContext(contextStr)
      ? contextStr
      : "dashboard";

    try {
      const data = await svc.getAccountWithEntitlements(accountId);
      if (!data) {
        // Cookie was valid but the account row was deleted. Return 401 to
        // match the convention from /api/portal/me.
        res.status(401).json({ error: "Account not found" });
        return;
      }
      const signal = buildUserSignal(data);
      const cards = selectUpsellCards(signal, context);
      res.json({ cards });
    } catch (err) {
      logger.error(
        { err, accountId, context },
        "portal/upsell-cards: selection failed",
      );
      res.status(500).json({ error: "Failed to load upsell cards" });
    }
  });

  return router;
}

// Exported for unit testing of the signal projection without spinning up
// the route layer.
export const __internals = { buildUserSignal };
