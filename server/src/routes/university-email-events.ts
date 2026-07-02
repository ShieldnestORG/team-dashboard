// ---------------------------------------------------------------------------
// Coherent Ones University — email engagement events (inbound) + stats (admin).
//
// Two surfaces:
//
//   POST /api/university/email-events      — public; the coherencedaddy-landing
//     storefront forwards Brevo open/click/bounce webhooks here, one event per
//     POST, signed with HMAC-SHA256 over the raw body (shared secret
//     EMAIL_EVENTS_KEY, header X-Email-Events-Signature: v1=<hex>). Fail
//     closed: 500 when the secret isn't configured, 401 on a bad/missing
//     signature. Uses express.raw() and must be mounted BEFORE express.json()
//     in app.ts (mirrors universityWebhookRouter).
//
//   GET /api/admin/university/email-stats  — board-only; per-campaign-kind
//     rollup (sent / delivered / opened / clicked / bounced / unsubscribed +
//     open/click rates + top clicked URLs). Optional ?since=<ISO> filter.
//     Board gate + logAdminAccess, mirroring university-agents-admin.ts.
//
// Verification / parsing / DB logic lives in
// services/university-email-events.ts; these routes stay validation/shape.
// ---------------------------------------------------------------------------

import express, { Router } from "express";
import type { Request, Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  verifyEmailEventsSignature,
  parseEmailEvent,
  recordEmailEvent,
  getUniversityEmailStats,
} from "../services/university-email-events.js";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

// Inbound events router — mounted at /api/university BEFORE express.json().
export function universityEmailEventsRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/email-events",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const secret = process.env.EMAIL_EVENTS_KEY?.trim();
      if (!secret) {
        logger.error({}, "university-email-events: EMAIL_EVENTS_KEY not configured");
        res.status(500).json({ error: "Email events not configured" });
        return;
      }

      const sig = req.headers["x-email-events-signature"];
      const raw = req.body as unknown;
      if (
        !Buffer.isBuffer(raw)
        || !verifyEmailEventsSignature(
          raw,
          typeof sig === "string" ? sig : undefined,
          secret,
        )
      ) {
        res.status(401).json({ error: "Invalid signature" });
        return;
      }

      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(raw.toString("utf8"));
      } catch {
        res.status(400).json({ error: "Invalid JSON body" });
        return;
      }

      const evt = parseEmailEvent(parsedBody);
      if (!evt) {
        res.status(400).json({ error: "Invalid event payload" });
        return;
      }

      try {
        await recordEmailEvent(db, evt);
      } catch (err) {
        logger.error(
          { err, event: evt.event, kind: evt.kind },
          "university-email-events: insert failed",
        );
        res.status(500).json({ error: "Failed to record event" });
        return;
      }

      res.status(202).json({ accepted: true });
    },
  );

  return router;
}

// Admin stats router — mounted at /api/admin/university (board-gated).
export function universityEmailStatsAdminRoutes(db: Db): Router {
  const router = Router();

  // Access-log every attempt (incl. unauthenticated probes), then board-gate —
  // the same admin convention as university-agents-admin.ts.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  router.get("/email-stats", async (req: Request, res: Response) => {
    let since: Date | undefined;
    const sinceRaw = req.query.since;
    if (typeof sinceRaw === "string" && sinceRaw.trim().length > 0) {
      const parsed = new Date(sinceRaw);
      if (Number.isNaN(parsed.getTime())) {
        res.status(400).json({ error: "Invalid since (expected ISO timestamp)" });
        return;
      }
      since = parsed;
    }

    try {
      const kinds = await getUniversityEmailStats(db, since);
      res.json({ since: since ? since.toISOString() : null, kinds });
    } catch (err) {
      logger.error({ err }, "university-email-stats: rollup failed");
      res.status(500).json({ error: "Failed to load email stats" });
    }
  });

  return router;
}
