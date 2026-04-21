import type { Request, Response, NextFunction } from "express";
import type { Db } from "@paperclipai/db";
import { affiliates } from "@paperclipai/db";
import { eq } from "drizzle-orm";
import { verifyAffiliateJwt, type AffiliateJwtClaims } from "../affiliate-auth-jwt.js";

declare global {
  namespace Express {
    interface Request {
      affiliateClaims?: AffiliateJwtClaims & {
        status: string;
        policyAcceptedAt: Date | null;
        suspendedAt: Date | null;
        suspensionReason: string | null;
      };
    }
  }
}

export interface RequireAffiliateOptions {
  /**
   * When true, suspended affiliates are allowed through (read-only routes
   * such as dashboard GET endpoints). Defaults to false — mutating endpoints
   * (lead submission, merch request, engagement posts) reject suspended
   * accounts with 403.
   */
  allowSuspended?: boolean;
}

export function requireAffiliate(
  db: Db,
  options: RequireAffiliateOptions = {},
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const allowSuspended = options.allowSuspended === true;
  return async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.toLowerCase().startsWith("bearer ")) {
      res.status(401).json({ error: "Affiliate token required" });
      return;
    }
    const token = auth.slice(7).trim();
    const claims = verifyAffiliateJwt(token);
    if (!claims) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
    const [row] = await db
      .select({
        status: affiliates.status,
        policyAcceptedAt: affiliates.policyAcceptedAt,
        suspendedAt: affiliates.suspendedAt,
        suspensionReason: affiliates.suspensionReason,
      })
      .from(affiliates)
      .where(eq(affiliates.id, claims.sub))
      .limit(1);
    if (!row) {
      res.status(401).json({ error: "Affiliate not found" });
      return;
    }
    if (row.status === "suspended" && !allowSuspended) {
      res.status(403).json({
        error: "Account suspended",
        reason: row.suspensionReason ?? null,
      });
      return;
    }
    if (row.suspendedAt && !allowSuspended) {
      res.status(403).json({
        error: "Account suspended",
        reason: row.suspensionReason ?? null,
      });
      return;
    }
    req.affiliateClaims = {
      ...claims,
      status: row.status,
      policyAcceptedAt: row.policyAcceptedAt ?? null,
      suspendedAt: row.suspendedAt ?? null,
      suspensionReason: row.suspensionReason ?? null,
    };
    next();
  };
}
