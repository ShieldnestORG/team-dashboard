import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { socialPulseService } from "../services/social-pulse.js";

export function socialPulseRoutes(db: Db) {
  const router = Router();
  const svc = socialPulseService(db);

  // GET /pulse/summary — full dashboard summary
  router.get("/summary", async (_req, res) => {
    try {
      const hours = parseInt(_req.query.hours as string) || 24;
      const summary = await svc.getSummary(hours);
      res.json(summary);
    } catch (err) {
      res.status(500).json({ error: "Failed to get pulse summary" });
    }
  });

  // GET /pulse/tweets — paginated tweets
  router.get("/tweets", async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const page = parseInt(req.query.page as string) || 1;
      const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
      const tweets = await svc.getTweets({ topic, page, limit });
      res.json({ tweets, page, limit });
    } catch (err) {
      res.status(500).json({ error: "Failed to get pulse tweets" });
    }
  });

  // GET /pulse/tweets/trending — top engagement tweets
  router.get("/tweets/trending", async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
      const tweets = await svc.getTrendingTweets(topic, limit);
      res.json({ tweets });
    } catch (err) {
      res.status(500).json({ error: "Failed to get trending tweets" });
    }
  });

  // GET /pulse/aggregations — time series
  router.get("/aggregations", async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const period = (req.query.period as string) || "hour";
      const hours = parseInt(req.query.hours as string) || 24;
      const dataPoints = await svc.getAggregations(topic, period, hours);
      res.json({ dataPoints });
    } catch (err) {
      res.status(500).json({ error: "Failed to get aggregations" });
    }
  });

  // GET /pulse/xrpl-bridge — XRPL bridge analytics
  router.get("/xrpl-bridge", async (_req, res) => {
    try {
      const stats = await svc.getXrplBridgeStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: "Failed to get XRPL bridge stats" });
    }
  });

  // GET /pulse/topics — topic breakdown
  router.get("/topics", async (_req, res) => {
    try {
      const topics = await svc.getTopicBreakdown();
      res.json({ topics });
    } catch (err) {
      res.status(500).json({ error: "Failed to get topic breakdown" });
    }
  });

  // GET /pulse/spikes — recent volume spike alerts
  router.get("/spikes", async (_req, res) => {
    try {
      const spikes = await svc.detectVolumeSpikes();
      res.json({ spikes });
    } catch (err) {
      res.status(500).json({ error: "Failed to detect spikes" });
    }
  });

  // POST /pulse/force-poll — manual trigger
  router.post("/force-poll", async (_req, res) => {
    try {
      const result = await svc.pollSearches();
      res.json({ success: true, ...result });
    } catch (err) {
      res.status(500).json({ error: "Failed to force poll" });
    }
  });

  return router;
}
