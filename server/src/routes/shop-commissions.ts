import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { assertBoard } from "./authz.js";
import {
  shopCommissionsService,
  verifyWooSignature,
  wooSignaturePayload,
} from "../services/shop-commissions.js";

// ---------------------------------------------------------------------------
// Shop commissions routes — mounted at /api/shop.
//
//   POST /api/shop/woo/order        → inbound WooCommerce order (HMAC-signed).
//                                      Inert until WOO_WEBHOOK_SECRET is set.
//   GET  /api/shop/admin/commissions → ledger list (board auth).
//
// The Woo store is external (Hostinger); a thin Woo-side adapter posts our
// clean contract and signs it. See docs/products/affiliate-unified-links.md.
// ---------------------------------------------------------------------------

export function shopCommissionsRoutes(db: Db): Router {
  const router = Router();
  const svc = shopCommissionsService(db);

  router.post("/woo/order", async (req: Request, res: Response) => {
    const secret = process.env.WOO_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Woo ingestion not configured" });
      return;
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const orderRef = typeof body.orderRef === "string" ? body.orderRef.trim() : "";
    const referralCode =
      typeof body.ref === "string"
        ? body.ref.trim()
        : typeof body.referralCode === "string"
          ? body.referralCode.trim()
          : "";
    const grossAmountCents = Number(body.grossAmountCents);
    const currency = typeof body.currency === "string" ? body.currency : "usd";
    const status = typeof body.status === "string" ? body.status : "";
    const signature = (req.headers["x-cd-signature"] as string | undefined) ?? "";

    if (!orderRef || !referralCode || !status || !Number.isFinite(grossAmountCents)) {
      res
        .status(400)
        .json({ error: "orderRef, ref, grossAmountCents and status are required" });
      return;
    }

    const payload = wooSignaturePayload({
      orderRef,
      referralCode,
      grossAmountCents,
      currency,
      status,
    });
    if (!verifyWooSignature(payload, signature, secret)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    try {
      const result = await svc.recordWooOrder({
        orderRef,
        referralCode,
        grossAmountCents,
        currency,
        status,
      });
      res.status(200).json(result);
    } catch (err) {
      logger.error({ err, orderRef }, "shop-commissions: recordWooOrder failed");
      res.status(500).json({ error: "Failed to record order" });
    }
  });

  router.get("/admin/commissions", async (req: Request, res: Response) => {
    try {
      assertBoard(req);
    } catch {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      const commissions = await svc.listForAdmin();
      res.json({ commissions });
    } catch (err) {
      logger.error({ err }, "shop-commissions: listForAdmin failed");
      res.status(500).json({ error: "Failed to list commissions" });
    }
  });

  return router;
}
