// ---------------------------------------------------------------------------
// Auto-Reply API Routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { autoReplyConfig, autoReplyLog } from "@paperclipai/db";
import { getAutoReplyService } from "../services/auto-reply.js";
import { getDailyBudget } from "../services/x-api/rate-limiter.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

export function autoReplyRoutes(db: Db) {
  const router = Router();

  // GET /auto-reply/config — list all configs
  router.get("/config", async (_req, res) => {
    try {
      const rows = await db
        .select()
        .from(autoReplyConfig)
        .where(eq(autoReplyConfig.companyId, COMPANY_ID))
        .orderBy(autoReplyConfig.createdAt);

      res.json({ configs: rows });
    } catch (err) {
      logger.error({ err }, "Failed to list auto-reply configs");
      res.status(500).json({ error: "Failed to list configs" });
    }
  });

  // POST /auto-reply/config — create new config
  router.post("/config", async (req, res) => {
    try {
      const {
        targetXUserId,
        targetXUsername,
        replyMode = "template",
        replyTemplates,
        aiPrompt,
        maxRepliesPerDay = 5,
        minDelaySeconds = 3,
        maxDelaySeconds = 15,
      } = req.body as {
        targetXUserId: string;
        targetXUsername: string;
        replyMode?: string;
        replyTemplates?: string[];
        aiPrompt?: string;
        maxRepliesPerDay?: number;
        minDelaySeconds?: number;
        maxDelaySeconds?: number;
      };

      if (!targetXUserId || !targetXUsername) {
        res.status(400).json({ error: "targetXUserId and targetXUsername are required" });
        return;
      }

      const [row] = await db
        .insert(autoReplyConfig)
        .values({
          companyId: COMPANY_ID,
          targetXUserId,
          targetXUsername,
          replyMode,
          replyTemplates: replyTemplates ?? null,
          aiPrompt: aiPrompt ?? null,
          maxRepliesPerDay,
          minDelaySeconds,
          maxDelaySeconds,
        })
        .returning();

      // Reload service configs
      const svc = getAutoReplyService();
      if (svc) await svc.loadConfigs();

      res.json({ config: row });
    } catch (err) {
      logger.error({ err }, "Failed to create auto-reply config");
      res.status(500).json({ error: "Failed to create config" });
    }
  });

  // PUT /auto-reply/config/:id — update config
  router.put("/config/:id", async (req, res) => {
    try {
      const id = req.params.id as string;
      const updates = req.body as Record<string, unknown>;

      // Only allow specific fields
      const allowed: Record<string, unknown> = {};
      for (const key of [
        "targetXUserId", "targetXUsername", "replyMode",
        "replyTemplates", "aiPrompt", "maxRepliesPerDay",
        "minDelaySeconds", "maxDelaySeconds", "enabled",
      ]) {
        if (key in updates) allowed[key] = updates[key];
      }

      allowed.updatedAt = new Date();

      const [row] = await db
        .update(autoReplyConfig)
        .set(allowed)
        .where(and(
          eq(autoReplyConfig.id, id),
          eq(autoReplyConfig.companyId, COMPANY_ID),
        ))
        .returning();

      if (!row) {
        res.status(404).json({ error: "Config not found" });
        return;
      }

      const svc = getAutoReplyService();
      if (svc) await svc.loadConfigs();

      res.json({ config: row });
    } catch (err) {
      logger.error({ err }, "Failed to update auto-reply config");
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  // DELETE /auto-reply/config/:id — delete config
  router.delete("/config/:id", async (req, res) => {
    try {
      const id = req.params.id as string;

      // Delete log entries first (FK constraint)
      await db
        .delete(autoReplyLog)
        .where(eq(autoReplyLog.configId, id));

      const deleted = await db
        .delete(autoReplyConfig)
        .where(and(
          eq(autoReplyConfig.id, id),
          eq(autoReplyConfig.companyId, COMPANY_ID),
        ))
        .returning();

      if (deleted.length === 0) {
        res.status(404).json({ error: "Config not found" });
        return;
      }

      const svc = getAutoReplyService();
      if (svc) await svc.loadConfigs();

      res.json({ success: true });
    } catch (err) {
      logger.error({ err }, "Failed to delete auto-reply config");
      res.status(500).json({ error: "Failed to delete config" });
    }
  });

  // POST /auto-reply/config/:id/toggle — enable/disable
  router.post("/config/:id/toggle", async (req, res) => {
    try {
      const id = req.params.id as string;

      // Get current state
      const [current] = await db
        .select({ enabled: autoReplyConfig.enabled })
        .from(autoReplyConfig)
        .where(and(
          eq(autoReplyConfig.id, id),
          eq(autoReplyConfig.companyId, COMPANY_ID),
        ));

      if (!current) {
        res.status(404).json({ error: "Config not found" });
        return;
      }

      const [row] = await db
        .update(autoReplyConfig)
        .set({ enabled: !current.enabled, updatedAt: new Date() })
        .where(eq(autoReplyConfig.id, id))
        .returning();

      const svc = getAutoReplyService();
      if (svc) await svc.loadConfigs();

      res.json({ config: row });
    } catch (err) {
      logger.error({ err }, "Failed to toggle auto-reply config");
      res.status(500).json({ error: "Failed to toggle config" });
    }
  });

  // GET /auto-reply/log — paginated reply log
  router.get("/log", async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const offset = (page - 1) * limit;

      const rows = await db
        .select()
        .from(autoReplyLog)
        .where(eq(autoReplyLog.companyId, COMPANY_ID))
        .orderBy(desc(autoReplyLog.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({ log: rows, page, limit });
    } catch (err) {
      logger.error({ err }, "Failed to get auto-reply log");
      res.status(500).json({ error: "Failed to get log" });
    }
  });

  // GET /auto-reply/stats — daily counts, success rate, avg latency
  router.get("/stats", async (_req, res) => {
    try {
      const svc = getAutoReplyService();
      if (!svc) {
        res.json({ todaySent: 0, todayFailed: 0, todayRateLimited: 0, avgLatencyMs: 0 });
        return;
      }

      const stats = await svc.getStats();
      const budget = getDailyBudget();

      res.json({
        ...stats,
        globalBudget: {
          repliesUsed: budget.replies.used,
          repliesLimit: budget.replies.limit,
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to get auto-reply stats");
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  return router;
}
