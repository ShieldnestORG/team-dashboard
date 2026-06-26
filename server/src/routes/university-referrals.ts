import { Router, type Request, type Response } from "express";
import { desc, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityReferrals,
  universityCreditLedger,
} from "@paperclipai/db";
import {
  customerPortalService,
  PORTAL_SESSION_COOKIE,
} from "../services/customer-portal.js";
import {
  getOrCreateReferralCode,
  REFERRAL_REWARD_CENTS,
} from "../services/university-referrals.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Coherent Ones University — REFERRAL portal API (Phase 2 of
// designs/DESIGN-referral-program.md §5.1).
//
// One read-only endpoint the member-area referrals page reads:
//
//   GET /api/portal/university/referral
//     → { code, url, creditBalanceCents, referrals: [{ email, status,
//          monthlyCreditCents, since }] }
//
// Mounted at /api/portal so it inherits the same `cd_portal_session` cookie as
// the rest of the portal (see routes/portal.ts). Auth + membership gating
// mirror requireUniversityMember there: a non-member with a valid session gets
// 403 (never a silent empty result), so the portal can branch on membership.
//
// The code is created lazily on first call via the Phase-1 service
// (getOrCreateReferralCode) — keyed on the member's lowercased email, so a
// re-call returns the same code. The balance is SUM(ledger.amount_cents) for
// that email — the single source of truth shared with repost-for-credit.
//
// Per CLAUDE.md the req.params/query/body cast rule applies — cast incoming
// input through typeof checks; never trust the type system at runtime.
// ---------------------------------------------------------------------------

// Public join page that carries the ?ref= attribution param.
const JOIN_URL_BASE = "https://coherencedaddy.com/university";

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

/**
 * Masks a referred member's email for display — never leak the raw address to
 * the referrer. `friend@gmail.com` → `f•••@gmail.com`. Keeps the first char +
 * the full domain so the referrer can recognize a referral they made.
 */
function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "•••";
  const local = email.slice(0, at);
  const domain = email.slice(at); // includes the '@'
  const head = local[0] ?? "";
  return `${head}•••${domain}`;
}

/**
 * Per-referral monthly credit the referrer currently earns. An `active`
 * referral earns the per-month reward each paid month; every other state
 * (pending / churned / reversed / self_referral_blocked) earns nothing right
 * now. This is a display projection — the authoritative accrual is the
 * event-driven ledger (Phase 1).
 */
function monthlyCreditCentsFor(status: string): number {
  return status === "active" ? REFERRAL_REWARD_CENTS : 0;
}

export function universityReferralRoutes(db: Db): Router {
  const router = Router();
  const svc = customerPortalService(db);

  // Resolve the portal session → accountId, then require University membership.
  // Returns the member's { accountId, email } on success, or null after writing
  // the response. Mirrors requireUniversityMember in routes/portal.ts.
  async function requireUniversityMember(
    req: Request,
    res: Response,
  ): Promise<{ accountId: string; email: string } | null> {
    const session = svc.verifySession(readSessionCookie(req));
    if (!session) {
      res.status(401).json({ error: "Unauthenticated" });
      return null;
    }
    const accountId = session.accountId;

    let isMember: boolean;
    try {
      isMember = await svc.isUniversityAccount(accountId);
    } catch (err) {
      logger.error(
        { err, accountId },
        "portal/university/referral: membership check failed",
      );
      res.status(500).json({ error: "Failed to verify membership" });
      return null;
    }
    if (!isMember) {
      res.status(403).json({ error: "University membership required" });
      return null;
    }

    const account = await svc.getAccount(accountId);
    if (!account) {
      res.status(401).json({ error: "Account not found" });
      return null;
    }
    return { accountId, email: account.email.trim().toLowerCase() };
  }

  // -- Referral overview: code + shareable url + balance + referrals ----------
  router.get(
    "/university/referral",
    async (req: Request, res: Response) => {
      const member = await requireUniversityMember(req, res);
      if (!member) return;

      try {
        // 1) Code (lazily created on first call; idempotent by email).
        const { code } = await getOrCreateReferralCode(db, {
          email: member.email,
          accountId: member.accountId,
        });

        // 2) Credit balance = SUM(amount_cents) for this email (the one shared
        //    ledger). COALESCE so a member with no rows reads 0.
        const balanceRows = await db
          .select({
            total: sql<string>`COALESCE(SUM(${universityCreditLedger.amountCents}), 0)`,
          })
          .from(universityCreditLedger)
          .where(sql`LOWER(${universityCreditLedger.email}) = ${member.email}`);
        const creditBalanceCents = Number(balanceRows[0]?.total ?? 0);

        // 3) Their referrals — masked email, status, current monthly earnings,
        //    and when attribution locked. Newest first.
        const referralRows = await db
          .select({
            referredEmail: universityReferrals.referredEmail,
            status: universityReferrals.status,
            attributedAt: universityReferrals.attributedAt,
          })
          .from(universityReferrals)
          .where(
            sql`LOWER(${universityReferrals.referrerEmail}) = ${member.email}`,
          )
          .orderBy(desc(universityReferrals.attributedAt));

        const referrals = referralRows
          // self_referral_blocked rows are audit artifacts — never show them.
          .filter((r) => r.status !== "self_referral_blocked")
          .map((r) => ({
            email: maskEmail(r.referredEmail),
            status: r.status,
            monthlyCreditCents: monthlyCreditCentsFor(r.status),
            since: r.attributedAt.toISOString(),
          }));

        res.json({
          code,
          url: `${JOIN_URL_BASE}?ref=${code}`,
          creditBalanceCents,
          referrals,
        });
      } catch (err) {
        logger.error(
          { err, accountId: member.accountId },
          "portal/university/referral: load failed",
        );
        res.status(500).json({ error: "Failed to load referral info" });
      }
    },
  );

  return router;
}
