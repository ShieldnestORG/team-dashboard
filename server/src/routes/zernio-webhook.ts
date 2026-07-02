/**
 * Zernio webhook receiver (plan-zernio-leverage §1 L4: adopt).
 *
 * Mounted BEFORE express.json() in app.ts — HMAC-SHA256 verification needs the
 * raw body, same as the Stripe webhook routers. Delivery is at-least-once, so
 * every event is deduped on Zernio's stable event id (zernio_webhook_events
 * unique index) before any side effect runs.
 *
 * Subscribed events (registered via POST /api/socials/zernio/webhooks/register):
 * comment.received / message.received / lead.received / post.published /
 * post.failed / account.disconnected.
 */

import { Router } from "express";
import express from "express";
import type { Request, Response } from "express";
import { sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { verifyZernioSignature } from "../services/platform-publishers/zernio.js";
import { processZernioWebhookEvent } from "../services/socials/zernio-lead-capture.js";
import { logger } from "../middleware/logger.js";

interface ZernioWebhookEnvelope {
  id: string;
  event: string;
  timestamp?: string;
  account?: { id?: string };
  [key: string]: unknown;
}

export function zernioWebhookRouter(db: Db): Router {
  const router = Router();

  router.post(
    "/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const secret = process.env.ZERNIO_WEBHOOK_SECRET;
      if (!secret) {
        // Fail loud, never open: an unverifiable webhook is a write-path into
        // the leads table and the accounts pause switch.
        logger.error({}, "zernio-webhook: ZERNIO_WEBHOOK_SECRET not configured");
        res.status(503).json({ error: "webhook secret not configured" });
        return;
      }
      const raw = req.body as Buffer;
      const sig = req.headers["x-zernio-signature"] as string | undefined;
      if (!Buffer.isBuffer(raw) || !verifyZernioSignature(raw, sig, secret)) {
        res.status(401).json({ error: "invalid signature" });
        return;
      }

      let envelope: ZernioWebhookEnvelope;
      try {
        envelope = JSON.parse(raw.toString("utf8")) as ZernioWebhookEnvelope;
      } catch {
        res.status(400).json({ error: "invalid JSON body" });
        return;
      }
      if (typeof envelope.id !== "string" || !envelope.id || typeof envelope.event !== "string") {
        res.status(400).json({ error: "missing event id/type" });
        return;
      }

      // Dedup FIRST (at-least-once delivery): the unique index on event_id
      // makes redeliveries a no-op before any side effect.
      const inserted = await db.execute(sql`
        INSERT INTO zernio_webhook_events (event_id, event_type, zernio_account_id, payload)
        VALUES (
          ${envelope.id},
          ${envelope.event},
          ${envelope.account?.id ?? null},
          ${JSON.stringify(envelope)}::jsonb
        )
        ON CONFLICT (event_id) DO NOTHING
        RETURNING id
      `);
      const rows = inserted as unknown as Array<{ id: string }>;
      if (rows.length === 0) {
        res.json({ received: true, duplicate: true });
        return;
      }
      const eventRowId = rows[0].id;

      // Handler failures are recorded on the event row but still ACK 200 —
      // Zernio disables a webhook after 10 consecutive delivery failures, and
      // a stored event can be reprocessed; a disabled webhook loses data.
      try {
        const outcome = await processZernioWebhookEvent(
          db,
          envelope.event,
          envelope as Record<string, unknown>,
        );
        await db.execute(sql`
          UPDATE zernio_webhook_events
             SET processed_at = now()
           WHERE id = ${eventRowId}
        `);
        res.json({ received: true, outcome });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          { err, eventId: envelope.id, eventType: envelope.event },
          "zernio-webhook: handler failed (event stored, delivery ACKed)",
        );
        await db
          .execute(sql`
            UPDATE zernio_webhook_events
               SET error = ${msg.slice(0, 500)}
             WHERE id = ${eventRowId}
          `)
          .catch(() => {});
        res.json({ received: true, outcome: "error" });
      }
    },
  );

  return router;
}
