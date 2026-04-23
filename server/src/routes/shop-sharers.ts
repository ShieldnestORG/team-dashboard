import { Router, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import type { Db } from "@paperclipai/db";
import { shopSharersService, shareUrlFor } from "../services/shop-sharers.js";
import { logger } from "../middleware/logger.js";
import { sendTransactional } from "../services/email-templates.js";
import { assertBoard } from "./authz.js";

// ---------------------------------------------------------------------------
// Shop sharers routes — mounted at /api/shop.
//
// Public endpoints (CORS inherits the global *.coherencedaddy.com wildcard):
//   POST /api/shop/sharers                 → { referralCode, shareUrl, qrUrl,
//                                              applicationStatus, emailMasked }
//   GET  /api/shop/sharers/by-code/:code   → same shape as POST, lookup only
//   GET  /api/shop/sharers/:code/qr.png    → streams PNG
//   POST /api/shop/sharers/:code/apply-affiliate → queues for admin approval
//   POST /api/shop/ref/hit                 → beacon for ?ref=<code> visits
//
// Admin endpoints (board auth required):
//   GET  /api/shop/admin/sharers?status=pending
//   POST /api/shop/admin/sharers/:id/approve
//   POST /api/shop/admin/sharers/:id/reject
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0] ?? "*"}*@${domain}`;
  return `${local.slice(0, 2)}${"*".repeat(Math.max(1, local.length - 3))}${local.slice(-1)}@${domain}`;
}

function clientIp(req: Request): string {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)
    ?.split(",")[0]
    ?.trim();
  return fwd || req.socket.remoteAddress || "unknown";
}

function hashIp(ip: string): string {
  return createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

interface SharerPublicView {
  referralCode: string;
  shareUrl: string;
  qrUrl: string;
  emailMasked: string;
  applicationStatus: string | null;
  sharedMarketingEligible: boolean;
  canApplyAffiliate: boolean;
}

function toPublicView(row: {
  email: string;
  referralCode: string;
  affiliateApplicationStatus: string | null;
  sharedMarketingEligible: boolean;
}): SharerPublicView {
  return {
    referralCode: row.referralCode,
    shareUrl: shareUrlFor(row.referralCode),
    qrUrl: `/api/shop/sharers/${row.referralCode}/qr.png`,
    emailMasked: maskEmail(row.email),
    applicationStatus: row.affiliateApplicationStatus,
    sharedMarketingEligible: row.sharedMarketingEligible,
    canApplyAffiliate: row.affiliateApplicationStatus === null,
  };
}

export function shopSharersRoutes(db: Db): Router {
  const router = Router();
  const svc = shopSharersService(db);

  // -- Public -----------------------------------------------------------------

  router.post("/sharers", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { email?: unknown; source?: unknown };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const source =
      typeof body.source === "string" && body.source.length <= 32
        ? body.source
        : "shop_hero";
    if (!email || !EMAIL_RE.test(email)) {
      res.status(400).json({ error: "Valid email required" });
      return;
    }
    try {
      const row = await svc.upsertByEmail({ email, source });
      res.status(201).json({ sharer: toPublicView(row) });
    } catch (err) {
      logger.error({ err }, "shop-sharers: upsertByEmail failed");
      res.status(500).json({ error: "Failed to create sharer" });
    }
  });

  router.get("/sharers/by-code/:code", async (req: Request, res: Response) => {
    const code = req.params.code as string;
    try {
      const row = await svc.getByCode(code);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ sharer: toPublicView(row) });
    } catch (err) {
      logger.error({ err, code }, "shop-sharers: getByCode failed");
      res.status(500).json({ error: "Lookup failed" });
    }
  });

  router.get("/sharers/:code/qr.png", async (req: Request, res: Response) => {
    const code = req.params.code as string;
    try {
      const row = await svc.getByCode(code);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const png = await svc.renderQrPng(row.referralCode);
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Content-Length", String(png.byteLength));
      res.setHeader("Cache-Control", "public, max-age=604800, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.status(200).end(png);
    } catch (err) {
      logger.error({ err, code }, "shop-sharers: qr render failed");
      if (!res.headersSent) res.status(500).json({ error: "QR render failed" });
    }
  });

  router.post(
    "/sharers/:code/apply-affiliate",
    async (req: Request, res: Response) => {
      const code = req.params.code as string;
      try {
        const row = await svc.applyAffiliate(code);
        if (!row) {
          res.status(404).json({ error: "Not found or already processed" });
          return;
        }
        // Notify admin — fire and forget.
        const adminEmail =
          process.env.ALERT_EMAIL_TO ?? process.env.SMTP_USER ?? null;
        if (adminEmail) {
          sendTransactional("affiliate-application", adminEmail, {
            recipientName: "Team",
            recipientEmail: adminEmail,
            affiliateName: row.email,
          }).catch(() => {});
        }
        res.status(200).json({ sharer: toPublicView(row) });
      } catch (err) {
        logger.error({ err, code }, "shop-sharers: applyAffiliate failed");
        res.status(500).json({ error: "Apply failed" });
      }
    },
  );

  router.post("/ref/hit", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      code?: unknown;
      path?: unknown;
      utmSource?: unknown;
      utmMedium?: unknown;
      utmCampaign?: unknown;
      referrer?: unknown;
    };
    const code = typeof body.code === "string" ? body.code.trim() : "";
    if (!code) {
      // Beacon is fire-and-forget: never reveal validity.
      res.status(204).end();
      return;
    }
    const str = (v: unknown): string | undefined =>
      typeof v === "string" && v.length > 0 && v.length <= 1024 ? v : undefined;
    try {
      await svc.recordHit({
        code,
        path: str(body.path),
        utmSource: str(body.utmSource),
        utmMedium: str(body.utmMedium),
        utmCampaign: str(body.utmCampaign),
        referrer: str(body.referrer),
        userAgent: str(req.headers["user-agent"]),
        ipHash: hashIp(clientIp(req)),
      });
    } catch (err) {
      logger.warn({ err, code }, "shop-sharers: ref hit record failed");
    }
    res.status(204).end();
  });

  // -- Admin ------------------------------------------------------------------

  router.get("/admin/sharers", async (req: Request, res: Response) => {
    try {
      assertBoard(req);
    } catch {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    const status =
      typeof req.query.status === "string" ? req.query.status : undefined;
    try {
      const rows = await svc.listForAdmin(status);
      res.json({ sharers: rows });
    } catch (err) {
      logger.error({ err }, "shop-sharers: listForAdmin failed");
      res.status(500).json({ error: "Failed to list sharers" });
    }
  });

  router.post(
    "/admin/sharers/:id/approve",
    async (req: Request, res: Response) => {
      try {
        assertBoard(req);
      } catch {
        res.status(401).json({ error: "Board authentication required" });
        return;
      }
      const id = req.params.id as string;
      const body = (req.body ?? {}) as { displayName?: unknown };
      const displayName =
        typeof body.displayName === "string" && body.displayName.trim()
          ? body.displayName.trim()
          : undefined;
      try {
        const result = await svc.approve(id, { displayName });
        if (!result) {
          res.status(404).json({ error: "Sharer not found" });
          return;
        }
        res.json(result);
      } catch (err) {
        logger.error({ err, id }, "shop-sharers: approve failed");
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  router.post(
    "/admin/sharers/:id/reject",
    async (req: Request, res: Response) => {
      try {
        assertBoard(req);
      } catch {
        res.status(401).json({ error: "Board authentication required" });
        return;
      }
      const id = req.params.id as string;
      const body = (req.body ?? {}) as { notes?: unknown };
      const notes =
        typeof body.notes === "string" ? body.notes.slice(0, 500) : undefined;
      try {
        const row = await svc.reject(id, notes);
        if (!row) {
          res.status(404).json({ error: "Sharer not found" });
          return;
        }
        res.json({ sharer: row });
      } catch (err) {
        logger.error({ err, id }, "shop-sharers: reject failed");
        res.status(500).json({ error: (err as Error).message });
      }
    },
  );

  return router;
}
