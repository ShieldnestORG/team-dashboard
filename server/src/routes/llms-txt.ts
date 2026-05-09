// ---------------------------------------------------------------------------
// llms.txt + agents.json generator routes — mounted at /api/llms-txt.
//
// Public surface (no auth) for the email-capture / public-form entry point
// of this product. Rate-limited per IP. Customer portal will call these
// same endpoints with an authenticated session once Worker A's auth
// integration lands; this layer doesn't need to change.
// ---------------------------------------------------------------------------

import { Router } from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import type { Db } from "@paperclipai/db";
import { llmsTxtJobs, llmsTxtOutputs } from "@paperclipai/db";
import { llmsTxtGenerator, normalizeDomain } from "../services/llms-txt-generator.js";
import { logger } from "../middleware/logger.js";

// Per-IP: 10 generations per hour. Status / file fetches are cheap and
// covered by the global rate limit only.
const generateRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many generation requests. Try again in an hour." },
});

export function llmsTxtRoutes(db: Db): Router {
  const router = Router();
  const svc = llmsTxtGenerator(db);

  // POST /api/llms-txt/generate
  // Body: { domain: string, sitemapUrl?: string, email?: string, accountId?: string }
  // Returns: { jobId }
  router.post("/generate", generateRateLimit, async (req: Request, res: Response) => {
    try {
      const rawDomain = typeof req.body?.domain === "string" ? req.body.domain : "";
      const sitemapUrl =
        typeof req.body?.sitemapUrl === "string" ? req.body.sitemapUrl : undefined;
      const accountId =
        typeof req.body?.accountId === "string" && req.body.accountId.trim()
          ? req.body.accountId.trim()
          : undefined;
      const email =
        typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";

      const domain = normalizeDomain(rawDomain);
      if (!domain) {
        res.status(400).json({ error: "Valid domain required (e.g. https://example.com)" });
        return;
      }

      // No accountId? Require an email so we can attribute / contact.
      if (!accountId && !email) {
        res.status(400).json({ error: "Either accountId or email required" });
        return;
      }

      const result = await svc.generateForDomain(domain, { accountId, sitemapUrl });
      res.status(202).json({ jobId: result.jobId });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to queue generation";
      logger.error({ err }, "llms-txt: generate failed");
      res.status(500).json({ error: msg });
    }
  });

  // GET /api/llms-txt/jobs/:id
  router.get("/jobs/:id", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    try {
      const rows = await db.select().from(llmsTxtJobs).where(eq(llmsTxtJobs.id, id)).limit(1);
      if (rows.length === 0) {
        res.status(404).json({ error: "Job not found" });
        return;
      }
      const row = rows[0];
      let pageCount: number | null = null;
      if (row.status === "complete") {
        const outRows = await db
          .select({ pageCount: llmsTxtOutputs.pageCount })
          .from(llmsTxtOutputs)
          .where(eq(llmsTxtOutputs.jobId, id))
          .limit(1);
        pageCount = outRows[0]?.pageCount ?? null;
      }
      res.json({
        id: row.id,
        domain: row.domain,
        status: row.status,
        requestedAt: row.requestedAt,
        completedAt: row.completedAt,
        error: row.error,
        pageCount,
      });
    } catch (err) {
      logger.error({ err, id }, "llms-txt: jobs/:id failed");
      res.status(500).json({ error: "Failed to load job" });
    }
  });

  // GET /api/llms-txt/jobs/:id/llms.txt
  router.get("/jobs/:id/llms.txt", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await serveOutput(db, id, "llms_txt", "text/plain; charset=utf-8", res);
  });

  // GET /api/llms-txt/jobs/:id/llms-full.txt
  router.get("/jobs/:id/llms-full.txt", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await serveOutput(db, id, "llms_full_txt", "text/plain; charset=utf-8", res);
  });

  // GET /api/llms-txt/jobs/:id/agents.json
  router.get("/jobs/:id/agents.json", async (req: Request, res: Response) => {
    const id = req.params.id as string;
    await serveOutput(db, id, "agents_json", "application/json; charset=utf-8", res);
  });

  return router;
}

type OutputColumn = "llms_txt" | "llms_full_txt" | "agents_json";

async function serveOutput(
  db: Db,
  jobId: string,
  column: OutputColumn,
  contentType: string,
  res: Response,
): Promise<void> {
  try {
    const rows = await db
      .select()
      .from(llmsTxtOutputs)
      .where(eq(llmsTxtOutputs.jobId, jobId))
      .limit(1);
    if (rows.length === 0) {
      res.status(404).type("text/plain").send("Not ready or not found");
      return;
    }
    const row = rows[0];
    const body =
      column === "llms_txt"
        ? row.llmsTxt
        : column === "llms_full_txt"
          ? row.llmsFullTxt
          : row.agentsJson;
    if (!body) {
      res.status(404).type("text/plain").send("Output column empty for this job");
      return;
    }
    res.set("Content-Type", contentType);
    res.set("Cache-Control", "public, max-age=300");
    res.send(body);
  } catch (err) {
    logger.error({ err, jobId, column }, "llms-txt: serveOutput failed");
    res.status(500).type("text/plain").send("Failed to load output");
  }
}
