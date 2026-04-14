import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { agentMemoryService } from "../services/agent-memory.js";

export function agentMemoryRoutes(db: Db) {
  const router = Router();
  const memory = agentMemoryService(db);

  // GET /api/agent-memory/stats
  router.get("/stats", async (_req, res) => {
    try {
      const stats = await memory.stats();
      res.json({ stats });
    } catch (err) {
      console.error("agent-memory stats error:", err);
      res.status(500).json({ error: "Failed to fetch memory stats" });
    }
  });

  // GET /api/agent-memory/:agentName
  router.get("/:agentName", async (req, res) => {
    try {
      const agentName = req.params.agentName as string;
      const limit = Math.min(Number(req.query.limit) || 50, 200);
      const offset = Number(req.query.offset) || 0;
      const subject = req.query.subject as string | undefined;

      if (subject) {
        const facts = await memory.recallBySubject(agentName, subject);
        res.json({ memories: facts });
        return;
      }

      const facts = await memory.list(agentName, limit, offset);
      res.json({ memories: facts });
    } catch (err) {
      console.error("agent-memory list error:", err);
      res.status(500).json({ error: "Failed to list memories" });
    }
  });

  // GET /api/agent-memory/:agentName/search?q=cosmos
  router.get("/:agentName/search", async (req, res) => {
    try {
      const agentName = req.params.agentName as string;
      const q = req.query.q as string;
      if (!q) { res.status(400).json({ error: "q parameter required" }); return; }
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const results = await memory.recall(agentName, q, limit);
      res.json({ memories: results });
    } catch (err) {
      console.error("agent-memory search error:", err);
      res.status(500).json({ error: "Memory search failed" });
    }
  });

  // POST /api/agent-memory/:agentName
  router.post("/:agentName", async (req, res) => {
    try {
      const agentName = req.params.agentName as string;
      const { subject, predicate, object, confidence, source, expiresAt, embed } = req.body as {
        subject: string;
        predicate: string;
        object: string;
        confidence?: number;
        source?: string;
        expiresAt?: string;
        embed?: boolean;
      };

      if (!subject || !predicate || !object) {
        res.status(400).json({ error: "subject, predicate, object required" });
        return;
      }

      const fact = await memory.remember(agentName, subject, predicate, object, {
        confidence,
        source,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
        embed,
      });
      res.json({ memory: fact });
    } catch (err) {
      console.error("agent-memory create error:", err);
      res.status(500).json({ error: "Failed to create memory" });
    }
  });

  // DELETE /api/agent-memory/:agentName/:id
  router.delete("/:agentName/:id", async (req, res) => {
    try {
      const agentName = req.params.agentName as string;
      const id = Number(req.params.id as string);
      const deleted = await memory.forget(agentName, id);
      res.json({ ok: deleted });
    } catch (err) {
      console.error("agent-memory delete error:", err);
      res.status(500).json({ error: "Failed to delete memory" });
    }
  });

  return router;
}
