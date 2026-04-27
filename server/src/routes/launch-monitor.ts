// ---------------------------------------------------------------------------
// Launch Comment Monitor — admin routes.
//
// Mounted at /api/launch-monitor by app.ts. All routes are scoped to the
// active company (TEAM_DASHBOARD_COMPANY_ID). No public access.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { commentReplies, launchTrackedItems } from "@paperclipai/db";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

const ALLOWED_PLATFORMS = new Set(["hn", "reddit", "devto"]);

export function launchMonitorRoutes(db: Db) {
  const router = Router();

  // ----- Comments queue -----
  router.get("/comments", async (req, res) => {
    const status = (req.query.status as string | undefined) ?? "pending";
    const rows = await db
      .select()
      .from(commentReplies)
      .where(
        and(
          eq(commentReplies.companyId, COMPANY_ID),
          eq(commentReplies.status, status),
        ),
      )
      .orderBy(desc(commentReplies.createdAt))
      .limit(200);
    res.json({ comments: rows });
  });

  router.post("/comments/:id/replied", async (req, res) => {
    const id = req.params.id as string;
    const updated = await db
      .update(commentReplies)
      .set({
        status: "replied",
        repliedAt: sql`now()`,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(commentReplies.id, id), eq(commentReplies.companyId, COMPANY_ID)),
      )
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ comment: updated[0] });
  });

  router.post("/comments/:id/dismiss", async (req, res) => {
    const id = req.params.id as string;
    const reason =
      typeof req.body?.reason === "string" ? (req.body.reason as string) : null;
    const updated = await db
      .update(commentReplies)
      .set({
        status: "dismissed",
        dismissedReason: reason,
        updatedAt: sql`now()`,
      })
      .where(
        and(eq(commentReplies.id, id), eq(commentReplies.companyId, COMPANY_ID)),
      )
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ comment: updated[0] });
  });

  // ----- Tracked items -----
  router.get("/tracked-items", async (_req, res) => {
    const rows = await db
      .select()
      .from(launchTrackedItems)
      .where(eq(launchTrackedItems.companyId, COMPANY_ID))
      .orderBy(desc(launchTrackedItems.createdAt));
    res.json({ items: rows });
  });

  router.post("/tracked-items", async (req, res) => {
    const body = req.body ?? {};
    const platform = String(body.platform || "");
    const externalId = String(body.externalId || "").trim();
    if (!ALLOWED_PLATFORMS.has(platform) || !externalId) {
      return res
        .status(400)
        .json({ error: "platform must be hn|reddit|devto and externalId is required" });
    }
    let watchUntil: Date;
    if (body.watchUntil) {
      const d = new Date(String(body.watchUntil));
      if (Number.isNaN(d.getTime())) {
        return res.status(400).json({ error: "watchUntil must be an ISO timestamp" });
      }
      watchUntil = d;
    } else {
      const hours =
        typeof body.watchHours === "number" && Number.isFinite(body.watchHours)
          ? body.watchHours
          : 72;
      watchUntil = new Date(Date.now() + hours * 3600 * 1000);
    }

    const inserted = await db
      .insert(launchTrackedItems)
      .values({
        companyId: COMPANY_ID,
        platform,
        externalId,
        title: body.title ? String(body.title) : null,
        postUrl: body.postUrl ? String(body.postUrl) : null,
        watchUntil,
      })
      .onConflictDoNothing({
        target: [
          launchTrackedItems.companyId,
          launchTrackedItems.platform,
          launchTrackedItems.externalId,
        ],
      })
      .returning();

    if (!inserted[0]) {
      // Already tracked — return existing.
      const [existing] = await db
        .select()
        .from(launchTrackedItems)
        .where(
          and(
            eq(launchTrackedItems.companyId, COMPANY_ID),
            eq(launchTrackedItems.platform, platform),
            eq(launchTrackedItems.externalId, externalId),
          ),
        );
      return res.status(200).json({ item: existing, alreadyExisted: true });
    }
    res.status(201).json({ item: inserted[0] });
  });

  router.delete("/tracked-items/:id", async (req, res) => {
    const id = req.params.id as string;
    const updated = await db
      .update(launchTrackedItems)
      .set({ active: false })
      .where(
        and(
          eq(launchTrackedItems.id, id),
          eq(launchTrackedItems.companyId, COMPANY_ID),
        ),
      )
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ ok: true, item: updated[0] });
  });

  return router;
}
