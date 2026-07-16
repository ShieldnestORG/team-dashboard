// ---------------------------------------------------------------------------
// Coherent Ones University — INVISIBLE AGENT admin control plane (board-only).
//
// Mounted at /api/university-agents-admin by app.ts. This is the ADMIN-ONLY
// surface to SEE every agent and TUNE each one (BUILD-SPEC Phase 5). It is
// structurally separate from the member-facing /api/portal/* surface, so the
// is_agent flag and the agent+…@coherencedaddy.com email never reach a member.
//
// Routes (all board-only):
//   GET  /agents                  → every agent: persona + live config + today's
//                                    cost + unresolved-report count + paused state
//   GET  /agents/:id              → one agent: config + cost rollup + recent reports
//   POST /agents/:id/config       → fine-tune upsert (model / chattiness / hours /
//                                    voice note). Takes effect next runner tick.
//   POST /agents/:id/toggle       → on/off via university_members.agent_paused_at
//   POST /agents/reports/:id/resolve → mark a problem report resolved
//   GET  /agents/cost-summary     → total today/week/month + by-model breakdown
//
// `:id` is the university_members.id (the agent member). Edits do NOT require a
// redeploy — the runner reads university_agent_config every tick.
// ---------------------------------------------------------------------------

import { Router } from "express";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import {
  universityMembers,
  universityAgentConfig,
  universityAgentUsage,
  universityAgentReports,
} from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { logAdminAccess } from "../middleware/log-admin-access.js";

const ALLOWED_MODELS = new Set([
  "claude-haiku-4-5",
  "claude-sonnet-4-6",
  "claude-opus-4-8",
  "claude-sonnet-5", // standardized agent-chat model (2026-07-15, migration 0154)
]);

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function clampProbability(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  return n.toFixed(3); // NUMERIC(4,3) takes a string
}

function clampHour(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 23) return null;
  return n;
}

export function universityAgentsAdminRoutes(db: Db) {
  const router = Router();

  // Access-log every attempt (incl. unauthenticated probes), then board-gate.
  router.use(logAdminAccess(db));
  router.use((req, res, next) => {
    if (req.actor?.type !== "board") {
      res.status(401).json({ error: "Admin only" });
      return;
    }
    next();
  });

  // -------------------- GET /agents --------------------
  router.get("/agents", async (_req, res) => {
    try {
      const dayStart = startOfUtcDay();

      const rows = await db
        .select({
          id: universityMembers.id,
          email: universityMembers.email,
          displayName: universityMembers.displayName,
          personaKey: universityMembers.agentPersonaKey,
          pausedAt: universityMembers.agentPausedAt,
          pauseReason: universityMembers.agentPauseReason,
          model: universityAgentConfig.model,
          postProbability: universityAgentConfig.postProbability,
          commentProbability: universityAgentConfig.commentProbability,
          activeStartHour: universityAgentConfig.activeStartHour,
          activeEndHour: universityAgentConfig.activeEndHour,
          voiceNote: universityAgentConfig.voiceNote,
        })
        .from(universityMembers)
        .leftJoin(
          universityAgentConfig,
          eq(universityAgentConfig.memberId, universityMembers.id),
        )
        .where(eq(universityMembers.isAgent, true))
        .orderBy(universityMembers.displayName);

      // Cost today per agent.
      const costRows = await db
        .select({
          memberId: universityAgentUsage.memberId,
          costToday: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)`,
        })
        .from(universityAgentUsage)
        .where(gte(universityAgentUsage.createdAt, dayStart))
        .groupBy(universityAgentUsage.memberId);
      const costByMember = new Map(costRows.map((c) => [c.memberId, Number(c.costToday)]));

      // Unresolved report count per agent.
      const reportRows = await db
        .select({
          memberId: universityAgentReports.memberId,
          unresolved: sql<string>`COUNT(*)`,
        })
        .from(universityAgentReports)
        .where(eq(universityAgentReports.isResolved, false))
        .groupBy(universityAgentReports.memberId);
      const unresolvedByMember = new Map(
        reportRows.map((r) => [r.memberId, Number(r.unresolved)]),
      );

      const agents = rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.displayName,
        personaKey: r.personaKey,
        paused: r.pausedAt !== null,
        pausedAt: r.pausedAt,
        pauseReason: r.pauseReason,
        config: r.model
          ? {
              model: r.model,
              postProbability: Number(r.postProbability),
              commentProbability: Number(r.commentProbability),
              activeStartHour: r.activeStartHour,
              activeEndHour: r.activeEndHour,
              voiceNote: r.voiceNote,
            }
          : null,
        costTodayUsd: costByMember.get(r.id) ?? 0,
        unresolvedReports: unresolvedByMember.get(r.id) ?? 0,
      }));

      res.json({ agents });
    } catch (err) {
      logger.error({ err }, "university-agents-admin: GET /agents failed");
      res.status(500).json({ error: "Failed to load agents" });
    }
  });

  // -------------------- GET /agents/:id --------------------
  router.get("/agents/:id", async (req, res) => {
    const id = req.params.id;
    try {
      const memberRows = await db
        .select({
          id: universityMembers.id,
          email: universityMembers.email,
          displayName: universityMembers.displayName,
          personaKey: universityMembers.agentPersonaKey,
          pausedAt: universityMembers.agentPausedAt,
          pauseReason: universityMembers.agentPauseReason,
          isAgent: universityMembers.isAgent,
        })
        .from(universityMembers)
        .where(eq(universityMembers.id, id))
        .limit(1);

      const member = memberRows[0];
      if (!member || !member.isAgent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      const configRows = await db
        .select()
        .from(universityAgentConfig)
        .where(eq(universityAgentConfig.memberId, id))
        .limit(1);

      const dayStart = startOfUtcDay();
      const costTodayRows = await db
        .select({ total: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)` })
        .from(universityAgentUsage)
        .where(
          and(
            eq(universityAgentUsage.memberId, id),
            gte(universityAgentUsage.createdAt, dayStart),
          ),
        );
      const costAllRows = await db
        .select({ total: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)` })
        .from(universityAgentUsage)
        .where(eq(universityAgentUsage.memberId, id));

      const reports = await db
        .select()
        .from(universityAgentReports)
        .where(eq(universityAgentReports.memberId, id))
        .orderBy(desc(universityAgentReports.reportedAt))
        .limit(50);

      const config = configRows[0];
      res.json({
        agent: {
          id: member.id,
          email: member.email,
          displayName: member.displayName,
          personaKey: member.personaKey,
          paused: member.pausedAt !== null,
          pausedAt: member.pausedAt,
          pauseReason: member.pauseReason,
        },
        config: config
          ? {
              model: config.model,
              postProbability: Number(config.postProbability),
              commentProbability: Number(config.commentProbability),
              activeStartHour: config.activeStartHour,
              activeEndHour: config.activeEndHour,
              voiceNote: config.voiceNote,
            }
          : null,
        cost: {
          todayUsd: Number(costTodayRows[0]?.total ?? 0),
          allTimeUsd: Number(costAllRows[0]?.total ?? 0),
        },
        reports,
      });
    } catch (err) {
      logger.error({ err, id }, "university-agents-admin: GET /agents/:id failed");
      res.status(500).json({ error: "Failed to load agent" });
    }
  });

  // -------------------- POST /agents/:id/config --------------------
  // Fine-tune upsert. Body: { model?, postProbability?, commentProbability?,
  // activeStartHour?, activeEndHour?, voiceNote? }. Only provided fields change.
  router.post("/agents/:id/config", async (req, res) => {
    const id = req.params.id;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const memberRows = await db
        .select({
          id: universityMembers.id,
          personaKey: universityMembers.agentPersonaKey,
          isAgent: universityMembers.isAgent,
        })
        .from(universityMembers)
        .where(eq(universityMembers.id, id))
        .limit(1);
      const member = memberRows[0];
      if (!member || !member.isAgent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      // Validate each provided field; reject the whole request on any bad value
      // (fail loud — never silently coerce a bad knob).
      const set: Partial<{
        model: string;
        postProbability: string;
        commentProbability: string;
        activeStartHour: number;
        activeEndHour: number;
        voiceNote: string | null;
      }> = {};

      if (body.model !== undefined) {
        if (typeof body.model !== "string" || !ALLOWED_MODELS.has(body.model)) {
          res.status(400).json({ error: "Invalid model" });
          return;
        }
        set.model = body.model;
      }
      if (body.postProbability !== undefined) {
        const p = clampProbability(body.postProbability);
        if (p === null) {
          res.status(400).json({ error: "postProbability must be 0..1" });
          return;
        }
        set.postProbability = p;
      }
      if (body.commentProbability !== undefined) {
        const p = clampProbability(body.commentProbability);
        if (p === null) {
          res.status(400).json({ error: "commentProbability must be 0..1" });
          return;
        }
        set.commentProbability = p;
      }
      if (body.activeStartHour !== undefined) {
        const h = clampHour(body.activeStartHour);
        if (h === null) {
          res.status(400).json({ error: "activeStartHour must be 0..23" });
          return;
        }
        set.activeStartHour = h;
      }
      if (body.activeEndHour !== undefined) {
        const h = clampHour(body.activeEndHour);
        if (h === null) {
          res.status(400).json({ error: "activeEndHour must be 0..23" });
          return;
        }
        set.activeEndHour = h;
      }
      if (body.voiceNote !== undefined) {
        if (body.voiceNote !== null && typeof body.voiceNote !== "string") {
          res.status(400).json({ error: "voiceNote must be a string or null" });
          return;
        }
        set.voiceNote = body.voiceNote as string | null;
      }

      const existing = await db
        .select({ id: universityAgentConfig.id })
        .from(universityAgentConfig)
        .where(eq(universityAgentConfig.memberId, id))
        .limit(1);

      if (existing[0]) {
        await db
          .update(universityAgentConfig)
          .set({ ...set, updatedAt: new Date() })
          .where(eq(universityAgentConfig.memberId, id));
      } else {
        // No config row yet — create one, defaulting any unset knobs.
        await db.insert(universityAgentConfig).values({
          memberId: id,
          personaKey: member.personaKey ?? "",
          model: set.model ?? "claude-haiku-4-5",
          postProbability: set.postProbability ?? "0.200",
          commentProbability: set.commentProbability ?? "0.200",
          activeStartHour: set.activeStartHour ?? 6,
          activeEndHour: set.activeEndHour ?? 22,
          voiceNote: set.voiceNote ?? null,
        });
      }

      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, id }, "university-agents-admin: POST /agents/:id/config failed");
      res.status(500).json({ error: "Failed to update config" });
    }
  });

  // -------------------- POST /agents/:id/toggle --------------------
  // Body: { enabled: boolean, reason?: string }. enabled=false pauses (sets
  // agent_paused_at); enabled=true resumes (clears it).
  router.post("/agents/:id/toggle", async (req, res) => {
    const id = req.params.id;
    const body = (req.body ?? {}) as { enabled?: unknown; reason?: unknown };
    if (typeof body.enabled !== "boolean") {
      res.status(400).json({ error: "enabled (boolean) is required" });
      return;
    }
    try {
      const memberRows = await db
        .select({ id: universityMembers.id, isAgent: universityMembers.isAgent })
        .from(universityMembers)
        .where(eq(universityMembers.id, id))
        .limit(1);
      if (!memberRows[0] || !memberRows[0].isAgent) {
        res.status(404).json({ error: "Agent not found" });
        return;
      }

      if (body.enabled) {
        await db
          .update(universityMembers)
          .set({ agentPausedAt: null, agentPauseReason: null, updatedAt: new Date() })
          .where(eq(universityMembers.id, id));
      } else {
        await db
          .update(universityMembers)
          .set({
            agentPausedAt: new Date(),
            agentPauseReason: typeof body.reason === "string" ? body.reason : null,
            updatedAt: new Date(),
          })
          .where(eq(universityMembers.id, id));
      }

      res.json({ ok: true, enabled: body.enabled });
    } catch (err) {
      logger.error({ err, id }, "university-agents-admin: POST /agents/:id/toggle failed");
      res.status(500).json({ error: "Failed to toggle agent" });
    }
  });

  // -------------------- POST /agents/reports/:id/resolve --------------------
  router.post("/agents/reports/:id/resolve", async (req, res) => {
    const reportId = req.params.id;
    try {
      const updated = await db
        .update(universityAgentReports)
        .set({ isResolved: true, resolvedAt: new Date() })
        .where(eq(universityAgentReports.id, reportId))
        .returning({ id: universityAgentReports.id });
      if (!updated[0]) {
        res.status(404).json({ error: "Report not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err, reportId }, "university-agents-admin: resolve report failed");
      res.status(500).json({ error: "Failed to resolve report" });
    }
  });

  // -------------------- GET /agents/cost-summary --------------------
  router.get("/agents/cost-summary", async (_req, res) => {
    try {
      const dayStart = startOfUtcDay();
      const weekStart = new Date(dayStart);
      weekStart.setUTCDate(weekStart.getUTCDate() - 7);
      const monthStart = new Date(dayStart);
      monthStart.setUTCDate(monthStart.getUTCDate() - 30);

      const sumSince = async (since: Date): Promise<number> => {
        const rows = await db
          .select({ total: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)` })
          .from(universityAgentUsage)
          .where(gte(universityAgentUsage.createdAt, since));
        return Number(rows[0]?.total ?? 0);
      };

      const byModelRows = await db
        .select({
          model: universityAgentUsage.model,
          total: sql<string>`COALESCE(SUM(${universityAgentUsage.costUsd}), 0)`,
        })
        .from(universityAgentUsage)
        .where(gte(universityAgentUsage.createdAt, monthStart))
        .groupBy(universityAgentUsage.model);

      res.json({
        todayUsd: await sumSince(dayStart),
        weekUsd: await sumSince(weekStart),
        monthUsd: await sumSince(monthStart),
        byModel: byModelRows.map((r) => ({ model: r.model, usd: Number(r.total) })),
      });
    } catch (err) {
      logger.error({ err }, "university-agents-admin: cost-summary failed");
      res.status(500).json({ error: "Failed to load cost summary" });
    }
  });

  return router;
}
