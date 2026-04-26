import { Router } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { socialAccounts, socialAutomations } from "@paperclipai/db";
import { loadCalendar } from "../services/socials/calendar.js";
import { syncSocialAutomations } from "../services/socials/cron-introspect.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";

export function socialsRoutes(db: Db) {
  const router = Router();

  // ----- Accounts -----
  router.get("/accounts", async (req, res) => {
    const brand = req.query.brand as string | undefined;
    const platform = req.query.platform as string | undefined;
    const status = req.query.status as string | undefined;
    const where = [eq(socialAccounts.companyId, COMPANY_ID), eq(socialAccounts.archived, false)];
    if (brand) where.push(eq(socialAccounts.brand, brand));
    if (platform) where.push(eq(socialAccounts.platform, platform));
    if (status) where.push(eq(socialAccounts.status, status));
    const rows = await db
      .select()
      .from(socialAccounts)
      .where(and(...where))
      .orderBy(socialAccounts.brand, socialAccounts.platform);
    res.json({ accounts: rows });
  });

  router.post("/accounts", async (req, res) => {
    const body = req.body ?? {};
    if (!body.brand || !body.platform || !body.handle) {
      return res.status(400).json({ error: "brand, platform, handle required" });
    }
    const inserted = await db
      .insert(socialAccounts)
      .values({
        companyId: COMPANY_ID,
        brand: String(body.brand),
        platform: String(body.platform),
        handle: String(body.handle),
        displayName: body.displayName ?? null,
        profileUrl: body.profileUrl ?? null,
        connectionType: body.connectionType ?? "manual",
        oauthRef: body.oauthRef ?? null,
        status: body.status ?? "active",
        automationMode: body.automationMode ?? "manual",
        automationNotes: body.automationNotes ?? null,
        ownerUserId: body.ownerUserId ?? null,
        tags: Array.isArray(body.tags) ? body.tags : [],
      })
      .returning();
    res.status(201).json({ account: inserted[0] });
  });

  router.patch("/accounts/:id", async (req, res) => {
    const id = req.params.id as string;
    const patch: Record<string, unknown> = {};
    const fields = [
      "brand", "platform", "handle", "displayName", "profileUrl",
      "connectionType", "oauthRef", "status", "automationMode",
      "automationNotes", "ownerUserId", "tags", "archived",
    ];
    for (const f of fields) {
      if (f in req.body) patch[f] = req.body[f];
    }
    patch.updatedAt = sql`now()`;
    const updated = await db
      .update(socialAccounts)
      .set(patch)
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ account: updated[0] });
  });

  router.delete("/accounts/:id", async (req, res) => {
    const id = req.params.id as string;
    // Soft-delete via archived flag.
    const updated = await db
      .update(socialAccounts)
      .set({ archived: true, updatedAt: sql`now()` })
      .where(and(eq(socialAccounts.id, id), eq(socialAccounts.companyId, COMPANY_ID)))
      .returning();
    if (!updated[0]) return res.status(404).json({ error: "not found" });
    res.json({ ok: true });
  });

  // ----- Automations -----
  router.get("/automations", async (req, res) => {
    const accountId = req.query.accountId as string | undefined;
    const where = accountId ? [eq(socialAutomations.socialAccountId, accountId)] : [];
    const rows = await db
      .select()
      .from(socialAutomations)
      .where(where.length ? and(...where) : undefined)
      .orderBy(socialAutomations.sourceRef);
    res.json({ automations: rows });
  });

  router.post("/automations/sync", async (_req, res) => {
    try {
      const result = await syncSocialAutomations(db, COMPANY_ID);
      res.json(result);
    } catch (err) {
      logger.error({ err }, "syncSocialAutomations failed");
      res.status(500).json({ error: "sync failed" });
    }
  });

  // ----- Calendar -----
  router.get("/calendar", async (req, res) => {
    const fromStr = req.query.from as string | undefined;
    const toStr = req.query.to as string | undefined;
    const brand = req.query.brand as string | undefined;
    const platform = req.query.platform as string | undefined;
    const now = Date.now();
    const from = fromStr ? new Date(fromStr) : new Date(now - 7 * 24 * 3600 * 1000);
    const to = toStr ? new Date(toStr) : new Date(now + 14 * 24 * 3600 * 1000);
    const events = await loadCalendar(db, { from, to, brand, platform, companyId: COMPANY_ID });
    res.json({ from: from.toISOString(), to: to.toISOString(), events });
  });

  return router;
}
