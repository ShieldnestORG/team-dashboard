import express, { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import { creditscoreService } from "../services/creditscore.js";
import { creditscoreContentAgent } from "../services/creditscore-content-agent.js";
import { creditscoreSchemaAgent } from "../services/creditscore-schema-agent.js";
import { creditscoreCompetitorAgent } from "../services/creditscore-competitor-agent.js";
import { creditscoreSageStrategist } from "../services/creditscore-sage-strategist.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// CreditScore routes — mounted at /api/creditscore.
// Webhook router exported separately; mount BEFORE express.json() in app.ts.
// ---------------------------------------------------------------------------

export function creditscoreRoutes(db: Db): Router {
  const router = Router();
  const svc = creditscoreService(db);
  const contentAgent = creditscoreContentAgent(db);
  const schemaAgent = creditscoreSchemaAgent(db);
  const competitorAgent = creditscoreCompetitorAgent(db);
  const sageStrategist = creditscoreSageStrategist(db);

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

  // GET /api/creditscore/content-drafts — board admin review queue
  router.get("/content-drafts", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      const drafts = await contentAgent.listPendingDrafts();
      res.json({ drafts });
    } catch (err) {
      logger.error({ err }, "creditscore: listPendingDrafts failed");
      res.status(500).json({ error: "Failed to list drafts" });
    }
  });

  // GET /api/creditscore/content-drafts/:id — single draft detail
  router.get("/content-drafts/:id", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    const id = req.params.id as string;
    try {
      const draft = await contentAgent.getDraft(id);
      if (!draft) {
        res.status(404).json({ error: "Draft not found" });
        return;
      }
      res.json({ draft });
    } catch (err) {
      logger.error({ err, id }, "creditscore: getDraft failed");
      res.status(500).json({ error: "Failed to fetch draft" });
    }
  });

  // POST /api/creditscore/content-drafts/:id/approve
  router.post("/content-drafts/:id/approve", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    const id = req.params.id as string;
    const reviewNotes =
      typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes : undefined;
    try {
      await contentAgent.approveDraft(id, {
        userId: req.actor.userId ?? undefined,
        reviewNotes,
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, id }, "creditscore: approveDraft failed");
      res.status(500).json({ error: "Failed to approve draft" });
    }
  });

  // POST /api/creditscore/content-drafts/:id/reject
  router.post("/content-drafts/:id/reject", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    const id = req.params.id as string;
    const reviewNotes =
      typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes : undefined;
    try {
      await contentAgent.rejectDraft(id, {
        userId: req.actor.userId ?? undefined,
        reviewNotes,
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, id }, "creditscore: rejectDraft failed");
      res.status(500).json({ error: "Failed to reject draft" });
    }
  });

  // POST /api/creditscore/content-drafts/:id/published — mark as live on customer site
  router.post("/content-drafts/:id/published", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    const id = req.params.id as string;
    const publishedUrl =
      typeof req.body?.publishedUrl === "string" ? req.body.publishedUrl : "";
    if (!publishedUrl) {
      res.status(400).json({ error: "publishedUrl required" });
      return;
    }
    try {
      await contentAgent.markPublished(id, publishedUrl);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, id }, "creditscore: markPublished failed");
      res.status(500).json({ error: "Failed to mark published" });
    }
  });

  // -- Schema Impls (admin review) --------------------------------------------

  router.get("/schema-impls", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      res.json({ impls: await schemaAgent.listPending() });
    } catch (err) {
      logger.error({ err }, "creditscore: listPending schema impls failed");
      res.status(500).json({ error: "Failed to list schema impls" });
    }
  });

  router.get("/schema-impls/:id", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      const impl = await schemaAgent.getImpl(req.params.id as string);
      if (!impl) {
        res.status(404).json({ error: "Impl not found" });
        return;
      }
      res.json({ impl });
    } catch (err) {
      logger.error({ err }, "creditscore: getImpl failed");
      res.status(500).json({ error: "Failed to fetch impl" });
    }
  });

  router.post("/schema-impls/:id/approve", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      await schemaAgent.approve(req.params.id as string, {
        userId: req.actor.userId ?? undefined,
        reviewNotes:
          typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "creditscore: approve schema impl failed");
      res.status(500).json({ error: "Failed to approve impl" });
    }
  });

  router.post("/schema-impls/:id/reject", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      await schemaAgent.reject(req.params.id as string, {
        userId: req.actor.userId ?? undefined,
        reviewNotes:
          typeof req.body?.reviewNotes === "string" ? req.body.reviewNotes : undefined,
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "creditscore: reject schema impl failed");
      res.status(500).json({ error: "Failed to reject impl" });
    }
  });

  router.post("/schema-impls/:id/delivered", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      await schemaAgent.markDelivered(req.params.id as string);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "creditscore: mark schema impl delivered failed");
      res.status(500).json({ error: "Failed to mark delivered" });
    }
  });

  // -- Competitor scans (read-only; generated by cron) -------------------------

  router.get(
    "/subscriptions/:id/competitor-scans",
    async (req: Request, res: Response) => {
      if (req.actor?.type !== "board") {
        res.status(401).json({ error: "Board authentication required" });
        return;
      }
      const cycleTag =
        typeof req.query.cycleTag === "string" ? req.query.cycleTag : undefined;
      try {
        const scans = await competitorAgent.listForSubscription(
          req.params.id as string,
          cycleTag,
        );
        res.json({ scans });
      } catch (err) {
        logger.error({ err }, "creditscore: list competitor scans failed");
        res.status(500).json({ error: "Failed to list scans" });
      }
    },
  );

  // -- Sage weekly strategy docs (Pro) -----------------------------------------

  router.get("/subscriptions/:id/strategy-docs", async (req: Request, res: Response) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Board authentication required" });
      return;
    }
    try {
      const docs = await sageStrategist.listForSubscription(req.params.id as string);
      res.json({ docs });
    } catch (err) {
      logger.error({ err }, "creditscore: list strategy docs failed");
      res.status(500).json({ error: "Failed to list docs" });
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
