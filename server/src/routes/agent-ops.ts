import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentOpsService } from "../services/agent-ops.js";
import { assertCompanyAccess } from "./authz.js";

export function agentOpsRoutes(db: Db) {
  const router = Router();
  const svc = agentOpsService(db);

  router.get("/companies/:companyId/agent-ops", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const overview = await svc.overview(companyId);
    res.json(overview);
  });

  return router;
}
