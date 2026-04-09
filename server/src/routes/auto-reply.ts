// ---------------------------------------------------------------------------
// Auto-Reply API Routes
// ---------------------------------------------------------------------------

import { Router } from "express";
import { eq, and, desc, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { autoReplyConfig, autoReplyLog } from "@paperclipai/db";
import { getAutoReplyService, type AutoReplyGlobalSettings } from "../services/auto-reply.js";
import { XApiClient } from "../services/x-api/client.js";
import { getDailyBudget } from "../services/x-api/rate-limiter.js";
import { logger } from "../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "8365d8c2-ea73-4c04-af78-a7db3ee7ecd4";

export function autoReplyRoutes(db: Db) {
  const router = Router();

  // ── Settings ─────────────────────────────────────────────────────

  // GET /auto-reply/settings — get global settings
  router.get("/settings", async (_req, res) => {
    try {
      const svc = getAutoReplyService();
      if (!svc) {
        res.json({ settings: null });
        return;
      }
      res.json({ settings: svc.settings });
    } catch (err) {
      logger.error({ err }, "Failed to get auto-reply settings");
      res.status(500).json({ error: "Failed to get settings" });
    }
  });

  // PUT /auto-reply/settings — update global settings
  router.put("/settings", async (req, res) => {
    try {
      const svc = getAutoReplyService();
      if (!svc) {
        res.status(503).json({ error: "Auto-reply service not initialized" });
        return;
      }

      const updates = req.body as Partial<AutoReplyGlobalSettings>;
      const settings = await svc.saveSettings(updates);
      res.json({ settings });
    } catch (err) {
      logger.error({ err }, "Failed to update auto-reply settings");
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // ── Username resolution ──────────────────────────────────────────

  // POST /auto-reply/resolve-username — look up X user ID from username
  router.post("/resolve-username", async (req, res) => {
    try {
      const { username } = req.body as { username: string };
      if (!username) {
        res.status(400).json({ error: "username is required" });
        return;
      }

      const clean = username.replace(/^@/, "");

      const result = await fetch(
        `https://api.x.com/2/users/by/username/${encodeURIComponent(clean)}`,
        {
          headers: {
            Authorization: `Bearer ${await import("../services/x-api/oauth.js").then((m) => m.getValidToken(db, COMPANY_ID))}`,
          },
        },
      );

      if (!result.ok) {
        const text = await result.text();
        res.status(result.status).json({ error: `X API error: ${text}` });
        return;
      }

      const data = (await result.json()) as { data?: { id: string; username: string; name: string } };
      if (!data.data) {
        res.status(404).json({ error: `User @${clean} not found` });
        return;
      }

      res.json({ userId: data.data.id, username: data.data.username, name: data.data.name });
    } catch (err) {
      logger.error({ err }, "Failed to resolve username");
      res.status(500).json({ error: String(err) });
    }
  });

  // ── Config CRUD ──────────────────────────────────────────────────

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
        target,
        targetXUserId,
        targetXUsername,
        targetType: explicitType,
        replyMode = "template",
        replyTemplates,
        aiPrompt,
        maxRepliesPerDay,
        minDelaySeconds,
        maxDelaySeconds,
      } = req.body as {
        target?: string;
        targetXUserId?: string;
        targetXUsername?: string;
        targetType?: string;
        replyMode?: string;
        replyTemplates?: string[];
        aiPrompt?: string;
        maxRepliesPerDay?: number;
        minDelaySeconds?: number;
        maxDelaySeconds?: number;
      };

      // Get defaults from settings
      const svc = getAutoReplyService();
      const defaults = svc?.settings;

      let resolvedType = explicitType ?? "account";
      let resolvedUsername = targetXUsername ?? "";
      let resolvedUserId = targetXUserId ?? null;

      if (target) {
        const trimmed = target.trim();
        if (trimmed.startsWith("@")) {
          resolvedType = "account";
          resolvedUsername = trimmed.replace(/^@/, "");
          if (!resolvedUserId) {
            try {
              const { getValidToken } = await import("../services/x-api/oauth.js");
              const token = await getValidToken(db, COMPANY_ID);
              const lookupRes = await fetch(
                `https://api.x.com/2/users/by/username/${encodeURIComponent(resolvedUsername)}`,
                { headers: { Authorization: `Bearer ${token}` } },
              );
              if (lookupRes.ok) {
                const lookupData = (await lookupRes.json()) as { data?: { id: string } };
                resolvedUserId = lookupData.data?.id ?? null;
              }
            } catch {
              logger.warn({ username: resolvedUsername }, "Auto-resolve user ID failed");
            }
          }
        } else {
          resolvedType = "keyword";
          resolvedUsername = trimmed.startsWith("#") ? trimmed : trimmed;
        }
      }

      if (!resolvedUsername) {
        res.status(400).json({ error: "target is required" });
        return;
      }

      const [row] = await db
        .insert(autoReplyConfig)
        .values({
          companyId: COMPANY_ID,
          targetType: resolvedType,
          targetXUserId: resolvedUserId,
          targetXUsername: resolvedUsername,
          replyMode,
          replyTemplates: replyTemplates ?? null,
          aiPrompt: aiPrompt ?? null,
          maxRepliesPerDay: maxRepliesPerDay ?? defaults?.defaultMaxRepliesPerTarget ?? 10,
          minDelaySeconds: minDelaySeconds ?? defaults?.defaultMinDelaySeconds ?? 3,
          maxDelaySeconds: maxDelaySeconds ?? defaults?.defaultMaxDelaySeconds ?? 15,
        })
        .returning();

      const svc2 = getAutoReplyService();
      if (svc2) await svc2.loadConfigs();

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

  // DELETE /auto-reply/config/:id
  router.delete("/config/:id", async (req, res) => {
    try {
      const id = req.params.id as string;

      await db.delete(autoReplyLog).where(eq(autoReplyLog.configId, id));

      const deleted = await db
        .delete(autoReplyConfig)
        .where(and(eq(autoReplyConfig.id, id), eq(autoReplyConfig.companyId, COMPANY_ID)))
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

  // POST /auto-reply/config/:id/toggle
  router.post("/config/:id/toggle", async (req, res) => {
    try {
      const id = req.params.id as string;

      const [current] = await db
        .select({ enabled: autoReplyConfig.enabled })
        .from(autoReplyConfig)
        .where(and(eq(autoReplyConfig.id, id), eq(autoReplyConfig.companyId, COMPANY_ID)));

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

  // ── Log & Stats ──────────────────────────────────────────────────

  // GET /auto-reply/log
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

  // GET /auto-reply/stats
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
        budget: {
          spentUsd: budget.spentUsd,
          capUsd: budget.capUsd,
          repliesSent: budget.repliesSent,
          maxReplies: budget.maxReplies,
          readCount: budget.readCount,
        },
        settings: {
          pollIntervalMinutes: svc.settings.pollIntervalMinutes,
          enabled: svc.settings.enabled,
        },
      });
    } catch (err) {
      logger.error({ err }, "Failed to get auto-reply stats");
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  return router;
}
