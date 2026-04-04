import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { structureService } from "../services/structure.js";
import { assertCompanyAccess } from "./authz.js";

export function structureRoutes(db: Db) {
  const router = Router();
  const svc = structureService(db);

  // GET /api/companies/:companyId/structure
  router.get("/companies/:companyId/structure", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const diagram = await svc.getDiagram(companyId);
      res.json({ diagram });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err) throw err;
      console.error("structure get error:", err);
      res.status(500).json({ error: "Failed to fetch structure diagram" });
    }
  });

  // PUT /api/companies/:companyId/structure
  router.put("/companies/:companyId/structure", async (req, res) => {
    try {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const { body, changeSummary } = req.body as {
        body: string;
        changeSummary?: string;
      };
      if (!body || typeof body !== "string") {
        res.status(400).json({ error: "body is required" });
        return;
      }
      const agentId =
        req.actor.type === "agent" ? req.actor.agentId : undefined;
      const userId =
        req.actor.type === "board" ? req.actor.userId ?? undefined : undefined;
      const diagram = await svc.upsertDiagram(companyId, body, {
        agentId,
        userId,
        changeSummary,
      });
      res.json({ diagram });
    } catch (err: unknown) {
      if (err && typeof err === "object" && "statusCode" in err) throw err;
      console.error("structure upsert error:", err);
      res.status(500).json({ error: "Failed to update structure diagram" });
    }
  });

  // GET /api/companies/:companyId/structure/revisions
  router.get(
    "/companies/:companyId/structure/revisions",
    async (req, res) => {
      try {
        const companyId = req.params.companyId as string;
        assertCompanyAccess(req, companyId);
        const revisions = await svc.getRevisions(companyId);
        res.json({ revisions });
      } catch (err: unknown) {
        if (err && typeof err === "object" && "statusCode" in err) throw err;
        console.error("structure revisions error:", err);
        res
          .status(500)
          .json({ error: "Failed to fetch structure revisions" });
      }
    },
  );

  return router;
}
