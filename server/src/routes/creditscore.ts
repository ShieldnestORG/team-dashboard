import express, { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import { creditscoreService } from "../services/creditscore.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// CreditScore routes — mounted at /api/creditscore.
// Webhook router exported separately; mount BEFORE express.json() in app.ts.
// ---------------------------------------------------------------------------

export function creditscoreRoutes(db: Db): Router {
  const router = Router();
  const svc = creditscoreService(db);

  // GET /api/creditscore/plans — public; consumed by coherencedaddy-landing
  router.get("/plans", async (_req, res) => {
    try {
      const plans = await svc.listPlans();
      res.json({
        plans: plans.map((p) => ({
          slug: p.slug,
          name: p.name,
          tier: p.tier,
          billingInterval: p.billingInterval,
          priceCents: p.priceCents,
          stripePriceId: p.stripePriceId,
          entitlements: p.entitlements,
        })),
      });
    } catch (err) {
      logger.error({ err }, "creditscore: listPlans failed");
      res.status(500).json({ error: "Failed to list plans" });
    }
  });

  // POST /api/creditscore/checkout — public (storefront proxies here)
  router.post("/checkout", async (req: Request, res: Response) => {
    const tier = typeof req.body?.tier === "string" ? req.body.tier : "";
    const url = typeof req.body?.url === "string" ? req.body.url : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : undefined;
    const auditResultId =
      typeof req.body?.audit_result_id === "string"
        ? req.body.audit_result_id
        : typeof req.body?.auditResultId === "string"
          ? req.body.auditResultId
          : undefined;
    const companyId = req.actor?.companyId;

    if (!tier || !url) {
      res.status(400).json({ error: "tier and url required" });
      return;
    }
    try {
      const out = await svc.createCheckout({ tier, url, email, auditResultId, companyId });
      res.json(out);
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not implemented")) {
        res.status(501).json({ error: msg });
        return;
      }
      logger.error({ err, tier }, "creditscore: checkout failed");
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/creditscore/entitlement?domain=X&email=Y — public
  router.get("/entitlement", async (req: Request, res: Response) => {
    const domain = typeof req.query.domain === "string" ? req.query.domain : undefined;
    const email = typeof req.query.email === "string" ? req.query.email.toLowerCase() : undefined;
    if (!domain && !email) {
      res.status(400).json({ error: "domain or email required" });
      return;
    }
    try {
      const sub = await svc.resolveEntitlement({ domain, email });
      if (!sub) {
        res.json({ active: false, tier: null });
        return;
      }
      res.json({
        active: true,
        tier: sub.tier,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
      });
    } catch (err) {
      logger.error({ err }, "creditscore: resolveEntitlement failed");
      res.status(500).json({ error: "Failed to resolve entitlement" });
    }
  });

  // GET /api/creditscore/report/:id — public (shareable reports)
  router.get("/report/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const report = await svc.getReport(id);
      if (!report) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      res.json({ report });
    } catch (err) {
      logger.error({ err, id }, "creditscore: getReport failed");
      res.status(500).json({ error: "Failed to fetch report" });
    }
  });

  // POST /api/creditscore/audit/store — public (storefront proxies free-audit
  // results here from the in-browser SSE stream so we can upsell against them)
  router.post("/audit/store", async (req: Request, res: Response) => {
    const url = typeof req.body?.url === "string" ? req.body.url : "";
    const email =
      typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : undefined;
    const result = req.body?.result;
    if (!url || !result || typeof result !== "object") {
      res.status(400).json({ error: "url and result required" });
      return;
    }
    try {
      const out = await svc.storeAuditResult({ url, email, result });
      res.json(out);
    } catch (err) {
      logger.error({ err }, "creditscore: audit/store failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

export function creditscoreWebhookRouter(db: Db): Router {
  const router = Router();
  const svc = creditscoreService(db);

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const sig = req.headers["stripe-signature"] as string | undefined;
      try {
        const out = await svc.handleWebhook(req.body as Buffer, sig);
        res.json(out);
      } catch (err) {
        logger.error({ err }, "creditscore: webhook failed");
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
