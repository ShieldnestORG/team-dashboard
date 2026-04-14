// ---------------------------------------------------------------------------
// Directory Featured Listings — admin REST API
// Monetization layer on top of intel_companies. Admin-only (board actor).
// Stripe webhook is a separate router that must NOT go through JSON middleware
// re-parsing; we verify signature using req.rawBody captured by the global
// express.json({ verify }) callback in app.ts.
// ---------------------------------------------------------------------------

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { Db } from "@paperclipai/db";
import {
  directoryListingsService,
  LISTING_TIERS,
  type ListingTierSlug,
} from "../services/directory-listings.js";
import { verifyStripeSignature } from "../services/stripe-client.js";
import { logger } from "../middleware/logger.js";

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.actor?.type !== "board") {
    res.status(401).json({ error: "Admin only" });
    return;
  }
  next();
}

export function directoryListingsRoutes(db: Db): Router {
  const router = Router();
  const svc = directoryListingsService(db);

  // GET /api/directory-listings/tiers — list tier config (admin)
  router.get("/tiers", requireAdmin, (_req, res) => {
    res.json({
      tiers: Object.values(LISTING_TIERS).map((t) => ({
        slug: t.slug,
        label: t.label,
        monthlyPriceCents: t.monthlyPriceCents,
        stripePriceConfigured: !!process.env[t.priceIdEnv],
      })),
      stripeConfigured: !!process.env.STRIPE_SECRET_KEY,
    });
  });

  // GET /api/directory-listings/stats — counts + MRR
  router.get("/stats", requireAdmin, async (_req, res) => {
    try {
      const stats = await svc.getStats();
      res.json(stats);
    } catch (err) {
      logger.error({ err }, "directory-listings: stats failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings — paginated list of companies + latest listing
  router.get("/", requireAdmin, async (req, res) => {
    try {
      const directory = (req.query.directory as string | undefined) || undefined;
      const search = (req.query.search as string | undefined) || undefined;
      const status = (req.query.status as string | undefined) || "all";
      const limit = parseInt((req.query.limit as string) || "", 10) || 50;
      const offset = parseInt((req.query.offset as string) || "", 10) || 0;
      const result = await svc.listCompaniesWithListings({
        directory: directory === "all" ? undefined : directory,
        search,
        status,
        limit,
        offset,
      });
      res.json({ ...result, limit, offset });
    } catch (err) {
      logger.error({ err }, "directory-listings: list failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/company/:companyId — listings history for a company
  router.get("/company/:companyId", requireAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      const listings = await svc.getCompanyListings(companyId);
      res.json({ listings });
    } catch (err) {
      logger.error({ err }, "directory-listings: company listings failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/company/:companyId/traffic — attribution data
  router.get("/company/:companyId/traffic", requireAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      const data = await svc.getTrafficAttribution(companyId);
      if (!data) {
        res.status(404).json({ error: "Company not found" });
        return;
      }
      res.json(data);
    } catch (err) {
      logger.error({ err }, "directory-listings: traffic failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // PATCH /api/directory-listings/company/:companyId/contact — update contact info
  router.patch("/company/:companyId/contact", requireAdmin, async (req, res) => {
    try {
      const companyId = Number.parseInt(req.params.companyId as string, 10);
      if (Number.isNaN(companyId)) {
        res.status(400).json({ error: "Invalid companyId" });
        return;
      }
      await svc.upsertContact(companyId, {
        email: typeof req.body?.email === "string" ? req.body.email : undefined,
        name: typeof req.body?.name === "string" ? req.body.name : undefined,
        notes: typeof req.body?.notes === "string" ? req.body.notes : undefined,
        source: typeof req.body?.source === "string" ? req.body.source : "manual",
      });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: update contact failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/checkout — create Stripe Checkout session
  // body: { companyId, tier }
  router.post("/checkout", requireAdmin, async (req, res) => {
    try {
      const companyId = Number(req.body?.companyId);
      const tier = req.body?.tier as ListingTierSlug;
      if (!companyId || !tier || !(tier in LISTING_TIERS)) {
        res.status(400).json({ error: "companyId and valid tier required" });
        return;
      }
      const result = await svc.createCheckoutSession({ companyId, tier });
      res.json(result);
    } catch (err) {
      logger.error({ err }, "directory-listings: checkout failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/cancel — cancel subscription
  router.post("/:id/cancel", requireAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      await svc.cancelListing(id);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: cancel failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/note — add freeform note
  router.post("/:id/note", requireAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
      if (Number.isNaN(id) || !note) {
        res.status(400).json({ error: "id and note required" });
        return;
      }
      await svc.addNote(id, note);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: note failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // POST /api/directory-listings/:id/outreach — mark outreach attempt
  router.post("/:id/outreach", requireAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      const companyId = Number(req.body?.companyId);
      if (!companyId) {
        res.status(400).json({ error: "companyId required" });
        return;
      }
      const listingId = await svc.markOutreach(Number.isNaN(id) ? null : id, companyId);
      res.json({ ok: true, listingId });
    } catch (err) {
      logger.error({ err }, "directory-listings: outreach failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // GET /api/directory-listings/:id/events — audit log for a listing
  router.get("/:id/events", requireAdmin, async (req, res) => {
    try {
      const id = Number.parseInt(req.params.id as string, 10);
      if (Number.isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const events = await svc.getListingEvents(id);
      res.json({ events });
    } catch (err) {
      logger.error({ err }, "directory-listings: events failed");
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}

// ---------------------------------------------------------------------------
// Stripe webhook — separate mount, reads req.rawBody (captured by global
// express.json({ verify }) middleware in app.ts). No admin auth — signature
// is the auth.
// ---------------------------------------------------------------------------
export function directoryListingsWebhookRoutes(db: Db): Router {
  const router = Router();
  const svc = directoryListingsService(db);

  router.post("/webhook", async (req, res) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      res.status(503).json({ error: "Webhook secret not configured" });
      return;
    }
    const sig = req.headers["stripe-signature"];
    const rawBody = (req as unknown as { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      res.status(400).json({ error: "Missing raw body" });
      return;
    }
    if (!verifyStripeSignature(rawBody, typeof sig === "string" ? sig : undefined, secret)) {
      res.status(400).json({ error: "Invalid signature" });
      return;
    }
    try {
      const event = JSON.parse(rawBody.toString("utf8")) as {
        type: string;
        data: { object: Record<string, unknown> };
      };
      // Only handle events tagged with our source metadata.
      const src = (event.data.object as { metadata?: Record<string, string> })?.metadata?.source;
      if (event.type === "checkout.session.completed" && src !== "directory_listings") {
        // Let other webhook handlers (intel-billing) take it.
        res.json({ received: true, ignored: true });
        return;
      }
      await svc.handleStripeEvent(event);
      res.json({ received: true });
    } catch (err) {
      logger.error({ err }, "directory-listings: webhook handler failed");
      res.status(500).json({ error: "Webhook handler error" });
    }
  });

  return router;
}
