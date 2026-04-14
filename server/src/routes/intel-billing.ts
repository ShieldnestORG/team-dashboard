import express, { Router } from "express";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { intelCustomers, intelPlans, intelApiKeys } from "@paperclipai/db";
import { intelBillingService, verifyStripeSignature } from "../services/intel-billing.js";
import { logger } from "../middleware/logger.js";

// ---------------------------------------------------------------------------
// Intel API billing routes
// Mounted at /api/intel-billing. The webhook route needs a raw body, so it is
// mounted with express.raw() here (never pass through the global JSON parser).
// ---------------------------------------------------------------------------

export function intelBillingRoutes(db: Db) {
  const router = Router();
  const svc = intelBillingService(db);

  // GET /api/intel-billing/plans — public
  router.get("/plans", async (_req, res) => {
    try {
      const plans = await svc.listPlans();
      res.json({
        plans: plans.map((p) => ({
          slug: p.slug,
          name: p.name,
          priceCents: p.priceCents,
          monthlyRequestQuota: Number(p.monthlyRequestQuota),
          rateLimitPerMin: p.rateLimitPerMin,
          overagePriceCentsPer1k: p.overagePriceCentsPer1k,
        })),
      });
    } catch (err) {
      logger.error({ err }, "intel-billing: listPlans failed");
      res.status(500).json({ error: "Failed to list plans" });
    }
  });

  // POST /api/intel-billing/checkout — public; body: { planSlug, email }
  router.post("/checkout", async (req, res) => {
    const planSlug = typeof req.body?.planSlug === "string" ? req.body.planSlug : "";
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!planSlug || !email || !email.includes("@")) {
      res.status(400).json({ error: "planSlug and valid email required" });
      return;
    }
    try {
      const { url } = await svc.createCheckoutSession({ planSlug, email });
      res.json({ url });
    } catch (err) {
      logger.error({ err, planSlug, email }, "intel-billing: checkout failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/intel-billing/me — authenticated via Bearer API key
  router.get("/me", async (req, res) => {
    const header = req.headers.authorization;
    const rawKey =
      header && header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : null;
    if (!rawKey) {
      res.status(401).json({ error: "Missing Bearer token" });
      return;
    }
    try {
      const me = await svc.getMyUsage(rawKey);
      if (!me) {
        res.status(404).json({ error: "Key not found" });
        return;
      }
      res.json(me);
    } catch (err) {
      logger.error({ err }, "intel-billing: me failed");
      res.status(500).json({ error: "Failed to load usage" });
    }
  });

  // GET /api/intel-billing/customers — admin list (authenticated via board actor)
  router.get("/customers", async (req, res) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    try {
      const rows = await db
        .select({
          id: intelCustomers.id,
          email: intelCustomers.email,
          status: intelCustomers.status,
          planSlug: intelPlans.slug,
          planName: intelPlans.name,
          priceCents: intelPlans.priceCents,
          currentPeriodEnd: intelCustomers.currentPeriodEnd,
          createdAt: intelCustomers.createdAt,
        })
        .from(intelCustomers)
        .leftJoin(intelPlans, eq(intelCustomers.planId, intelPlans.id))
        .orderBy(desc(intelCustomers.createdAt))
        .limit(500);
      const mrr = rows
        .filter((r) => r.status === "active")
        .reduce((sum, r) => sum + (r.priceCents ?? 0), 0);
      res.json({ customers: rows, mrrCents: mrr });
    } catch (err) {
      logger.error({ err }, "intel-billing: list customers failed");
      res.status(500).json({ error: "Failed to list customers" });
    }
  });

  return router;
}

// Webhook router is separate because it requires express.raw() and must NOT
// go through the global JSON parser (signature verification needs the raw body).
export function intelBillingWebhookRouter(db: Db) {
  const router = Router();
  const svc = intelBillingService(db);

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      const secret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!secret) {
        res.status(503).json({ error: "Webhook secret not configured" });
        return;
      }
      const sig = req.headers["stripe-signature"];
      const rawBody = req.body as Buffer;
      if (!verifyStripeSignature(rawBody, typeof sig === "string" ? sig : undefined, secret)) {
        res.status(400).json({ error: "Invalid signature" });
        return;
      }
      try {
        const event = JSON.parse(rawBody.toString("utf8")) as {
          type: string;
          data: { object: Record<string, unknown> };
        };
        await svc.handleWebhookEvent(event);
        res.json({ received: true });
      } catch (err) {
        logger.error({ err }, "intel-billing: webhook handler failed");
        res.status(500).json({ error: "Webhook handler error" });
      }
    },
  );

  return router;
}
