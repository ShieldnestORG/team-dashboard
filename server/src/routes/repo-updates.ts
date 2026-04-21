/**
 * Repo Update Suggestions API — advisory queue from the SEO/AEO audit cron.
 *
 * This endpoint is read/write for status transitions ONLY. Nothing here ever
 * touches a git repo. The admin approves / rejects / replies in the UI and
 * those decisions are recorded in the DB for Sage to act on.
 */

import { Router } from "express";
import { desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { repoUpdateSuggestions } from "@paperclipai/db";
import { auditUrl } from "../services/seo-audit.js";
import { persistAuditFailures } from "../services/repo-update-advisor.js";
import {
  draftPrForSuggestion,
  parsePrFromAdminResponse,
} from "../services/repo-update-pr-worker.js";
import { logger } from "../middleware/logger.js";

export function repoUpdateRoutes(db: Db) {
  const router = Router();

  // GET /repo-updates — list suggestions, newest first; optional ?status=pending
  router.get("/", async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      const rows = status
        ? await db
            .select()
            .from(repoUpdateSuggestions)
            .where(eq(repoUpdateSuggestions.status, status))
            .orderBy(desc(repoUpdateSuggestions.createdAt))
            .limit(200)
        : await db
            .select()
            .from(repoUpdateSuggestions)
            .orderBy(desc(repoUpdateSuggestions.createdAt))
            .limit(200);
      res.json({ suggestions: rows });
    } catch (err) {
      logger.error({ err }, "Failed to list repo update suggestions");
      res.status(500).json({ error: "Failed to list suggestions" });
    }
  });

  // GET /repo-updates/:id — full suggestion
  router.get("/:id", async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(repoUpdateSuggestions)
        .where(eq(repoUpdateSuggestions.id, req.params.id as string))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ suggestion: row });
    } catch (err) {
      logger.error({ err }, "Failed to get suggestion");
      res.status(500).json({ error: "Failed to get suggestion" });
    }
  });

  // POST /repo-updates/:id/approve — mark approved + optional admin_response
  router.post("/:id/approve", async (req, res) => {
    try {
      const adminResponse =
        typeof (req.body as { adminResponse?: string })?.adminResponse === "string"
          ? (req.body as { adminResponse: string }).adminResponse
          : null;
      const [row] = await db
        .update(repoUpdateSuggestions)
        .set({
          status: "approved",
          adminResponse,
          updatedAt: new Date(),
        })
        .where(eq(repoUpdateSuggestions.id, req.params.id as string))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ suggestion: row });
    } catch (err) {
      logger.error({ err }, "Failed to approve suggestion");
      res.status(500).json({ error: "Failed to approve suggestion" });
    }
  });

  // POST /repo-updates/:id/reject — mark rejected + reason
  router.post("/:id/reject", async (req, res) => {
    try {
      const reason = typeof (req.body as { reason?: string })?.reason === "string"
        ? (req.body as { reason: string }).reason
        : null;
      const [row] = await db
        .update(repoUpdateSuggestions)
        .set({
          status: "rejected",
          adminResponse: reason,
          updatedAt: new Date(),
        })
        .where(eq(repoUpdateSuggestions.id, req.params.id as string))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ suggestion: row });
    } catch (err) {
      logger.error({ err }, "Failed to reject suggestion");
      res.status(500).json({ error: "Failed to reject suggestion" });
    }
  });

  // POST /repo-updates/:id/reply — free-text admin response; moves to needs_revision
  router.post("/:id/reply", async (req, res) => {
    try {
      const message = typeof (req.body as { message?: string })?.message === "string"
        ? (req.body as { message: string }).message
        : "";
      if (!message.trim()) {
        res.status(400).json({ error: "message is required" });
        return;
      }
      const [row] = await db
        .update(repoUpdateSuggestions)
        .set({
          status: "needs_revision",
          adminResponse: message,
          updatedAt: new Date(),
        })
        .where(eq(repoUpdateSuggestions.id, req.params.id as string))
        .returning();
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      res.json({ suggestion: row });
    } catch (err) {
      logger.error({ err }, "Failed to post reply");
      res.status(500).json({ error: "Failed to post reply" });
    }
  });

  // POST /repo-updates/run-audit — ad-hoc trigger
  router.post("/run-audit", async (req, res) => {
    try {
      const url = typeof (req.body as { url?: string })?.url === "string"
        ? (req.body as { url: string }).url
        : null;
      if (!url) {
        res.status(400).json({ error: "url is required" });
        return;
      }
      const audit = await auditUrl(url);
      const runId = `adhoc-${Date.now()}`;
      const created = await persistAuditFailures(db, audit, runId);
      res.json({ audit, created });
    } catch (err) {
      logger.error({ err }, "Failed to run ad-hoc audit");
      res.status(500).json({ error: "Failed to run audit" });
    }
  });

  // POST /repo-updates/:id/draft-pr — create a GitHub PR for an approved
  // suggestion. Never merges — humans do that manually.
  router.post("/:id/draft-pr", async (req, res) => {
    try {
      const id = req.params.id as string;
      const result = await draftPrForSuggestion(db, id);
      res.json({
        suggestion: result.suggestion,
        pr: result.pr,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      logger.error({ err, suggestionId: req.params.id }, "Failed to draft PR");
      if (msg === "GITHUB_TOKEN not configured") {
        res.status(503).json({ error: msg });
        return;
      }
      if (msg === "Suggestion not found") {
        res.status(404).json({ error: msg });
        return;
      }
      if (
        msg.startsWith("Suggestion must be in 'approved'") ||
        msg === "Suggestion has no repo" ||
        msg === "Repo not in Sage's allowlist"
      ) {
        res.status(400).json({ error: msg });
        return;
      }
      // For admin-facing errors, surface GitHub's status + message (path is
      // stripped) so the operator can debug without server log access. The
      // github-client never includes the token or full response body in the
      // error message — only METHOD/PATH/STATUS/MESSAGE.
      if (msg.startsWith("GitHub ")) {
        const afterFailed = msg.split(" failed: ")[1];
        res.status(500).json({
          error: afterFailed ? `GitHub API: ${afterFailed}` : "GitHub API call failed",
        });
        return;
      }
      res.status(500).json({ error: "Failed to draft PR" });
    }
  });

  // Helper so UI can surface PR links without re-parsing admin_response.
  // Exposed via GET /repo-updates/:id/pr — returns { number, url } or 404.
  router.get("/:id/pr", async (req, res) => {
    try {
      const [row] = await db
        .select()
        .from(repoUpdateSuggestions)
        .where(eq(repoUpdateSuggestions.id, req.params.id as string))
        .limit(1);
      if (!row) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const pr = parsePrFromAdminResponse(row.adminResponse);
      if (!pr) {
        res.status(404).json({ error: "No PR linked" });
        return;
      }
      res.json({ pr });
    } catch (err) {
      logger.error({ err }, "Failed to get PR link");
      res.status(500).json({ error: "Failed to get PR link" });
    }
  });

  // GET /repo-updates/stats/summary — counts by status
  router.get("/stats/summary", async (_req, res) => {
    try {
      const rows = await db
        .select({
          id: repoUpdateSuggestions.id,
          status: repoUpdateSuggestions.status,
          severity: repoUpdateSuggestions.severity,
        })
        .from(repoUpdateSuggestions);
      const byStatus: Record<string, number> = {};
      const bySeverity: Record<string, number> = {};
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] || 0) + 1;
        bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
      }
      res.json({ total: rows.length, byStatus, bySeverity });
    } catch (err) {
      logger.error({ err }, "Failed to compute stats");
      res.status(500).json({ error: "Failed to compute stats" });
    }
  });

  return router;
}
