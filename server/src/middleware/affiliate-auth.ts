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
      };
    }
  }
}

export function requireAffiliate(
  db: Db,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
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
      })
      .from(affiliates)
      .where(eq(affiliates.id, claims.sub))
      .limit(1);
    if (!row) {
      res.status(401).json({ error: "Affiliate not found" });
      return;
    }
    if (row.status === "suspended") {
      res.status(403).json({ error: "Account suspended" });
      return;
    }
    req.affiliateClaims = {
      ...claims,
      status: row.status,
      policyAcceptedAt: row.policyAcceptedAt ?? null,
    };
    next();
  };
}
