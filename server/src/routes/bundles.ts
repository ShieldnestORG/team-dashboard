import express, { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import { bundleEntitlementsService } from "../services/bundle-entitlements.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Bundle package routes — mounted at /api/bundles
// Webhook router exported separately; mount BEFORE express.json() in app.ts.
// ---------------------------------------------------------------------------

export function bundleRoutes(db: Db): Router {
  const router = Router();
  const svc = bundleEntitlementsService(db);

  // GET /api/bundles/plans — public
  router.get("/plans", async (_req, res) => {
    try {
      const plans = await svc.listPlans();
      res.json({
        plans: plans.map((p) => ({
          slug: p.slug,
          name: p.name,
          priceCents: p.priceCents,
          annualPriceCents: p.annualPriceCents,
          entitlements: p.entitlements,
        })),
      });
    } catch (err) {
      logger.error({ err }, "bundles: listPlans failed");
      res.status(500).json({ error: "Failed to list plans" });
    }
  });

  // POST /api/bundles/checkout — authenticated; body: { slug, interval? }
  router.post("/checkout", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const slug = typeof req.body?.slug === "string" ? req.body.slug : "";
    const interval = req.body?.interval === "annual" ? "annual" : "monthly";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!slug || !email || !email.includes("@")) {
      res.status(400).json({ error: "slug and valid email required" });
      return;
    }
    try {
      const { url } = await svc.createCheckoutSession(slug, companyId, email, interval);
      res.json({ url });
    } catch (err) {
      logger.error({ err, slug }, "bundles: checkout failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/bundles/subscription — authenticated; returns active bundle + entitlements
  router.get("/subscription", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const sub = await svc.getActiveSubscription(companyId);
      const entitlements = await svc.getEntitlementsForCompany(companyId);
      res.json({ subscription: sub, entitlements });
    } catch (err) {
      logger.error({ err }, "bundles: get subscription failed");
      res.status(500).json({ error: "Failed to load subscription" });
    }
  });

  // GET /api/bundles/entitlements — authenticated; returns entitlement map only
  router.get("/entitlements", async (req: Request, res: Response) => {
    const companyId = req.actor?.companyId;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    try {
      const entitlements = await svc.getEntitlementsForCompany(companyId);
      res.json(entitlements);
    } catch (err) {
      logger.error({ err }, "bundles: get entitlements failed");
      res.status(500).json({ error: "Failed to load entitlements" });
    }
  });

  return router;
}

export function bundleWebhookRouter(db: Db): Router {
  const router = Router();
  const svc = bundleEntitlementsService(db);

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string | undefined;
      try {
        await svc.handleWebhook(req.body as Buffer, sig);
        res.json({ received: true });
      } catch (err) {
        logger.error({ err }, "bundles: webhook failed");
        const msg = (err as Error).message;
        if (msg.includes("Invalid Stripe signature")) {
          res.status(400).json({ error: msg });
        } else {
          res.status(500).json({ error: msg });
        }
      }
    },
  );

  return router;
}
