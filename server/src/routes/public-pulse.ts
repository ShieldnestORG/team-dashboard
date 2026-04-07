import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { socialPulseService } from "../services/social-pulse.js";

// ---------------------------------------------------------------------------
// Public Pulse API — no auth required, for tokns.fi consumption
// ---------------------------------------------------------------------------

export function publicPulseRoutes(db: Db) {
  const router = Router();
  const svc = socialPulseService(db);

  // CORS for tokns.fi
  router.use((_req, res, next) => {
    const origin = _req.headers.origin ?? "";
    const allowed = [
      "https://tokns.fi",
      "https://app.tokns.fi",
      "https://shieldnest.io",
      "https://coherencedaddy.com",
      "https://freetools.coherencedaddy.com",
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3008",
    ];
    if (allowed.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Cache-Control", "public, max-age=300"); // 5 min cache
    if (_req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // GET /api/public/pulse/summary
  router.get("/summary", async (_req, res) => {
    try {
      const summary = await svc.getSummary(24);

      // Per-topic sentiment from real data
      const breakdown = await svc.getTopicBreakdown();
      const sentimentMap = new Map(
        breakdown.map((b) => [b.topic, b.avgSentiment])
      );

      // Compute trend direction per topic from recent aggregations
      const trendResults = await Promise.all(
        summary.topics.map(async (t) => {
          const agg = await svc.getAggregations(t.name, "hour", 12);
          let trend: "up" | "down" | "flat" = "flat";
          if (agg.length >= 4) {
            const mid = Math.floor(agg.length / 2);
            const prior = agg.slice(0, mid);
            const recent = agg.slice(mid);
            const avgCount = (arr: typeof agg) =>
              arr.reduce((s, d) => s + (d.tweetCount ?? 0), 0) / arr.length;
            const priorAvg = avgCount(prior);
            const recentAvg = avgCount(recent);
            if (priorAvg > 0) {
              const change = (recentAvg - priorAvg) / priorAvg;
              if (change >= 0.1) trend = "up";
              else if (change <= -0.1) trend = "down";
            }
          }
          return { name: t.name, trend };
        })
      );
      const trendMap = new Map(trendResults.map((r) => [r.name, r.trend]));

      const topics = summary.topics.map((t) => ({
        ...t,
        avgSentiment: sentimentMap.get(t.name) ?? 0.5,
        trend: (trendMap.get(t.name) ?? "flat") as "up" | "down" | "flat",
      }));

      // Get top tweet
      const trending = await svc.getTrendingTweets(undefined, 1);

      res.json({
        topics,
        totalTweets24h: summary.totalTweets24h,
        overallSentiment: summary.overallSentiment,
        topTweet: trending[0] ?? null,
        xrplBridgeMentions24h: summary.xrplBridgeMentions24h,
        updatedAt: summary.updatedAt,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to get pulse summary" });
    }
  });

  // GET /api/public/pulse/trending?topic=tx&limit=5
  router.get("/trending", async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const limit = Math.min(parseInt(req.query.limit as string) || 5, 20);
      const tweets = await svc.getTrendingTweets(topic, limit);
      res.json({ tweets });
    } catch (err) {
      res.status(500).json({ error: "Failed to get trending tweets" });
    }
  });

  // GET /api/public/pulse/xrpl-bridge
  router.get("/xrpl-bridge", async (_req, res) => {
    try {
      const stats = await svc.getXrplBridgeStats();
      res.json(stats);
    } catch (err) {
      res.status(500).json({ error: "Failed to get XRPL bridge stats" });
    }
  });

  // GET /api/public/pulse/chart?topic=tx&period=hour&hours=24
  router.get("/chart", async (req, res) => {
    try {
      const topic = req.query.topic as string | undefined;
      const period = (req.query.period as string) || "hour";
      const hours = Math.min(parseInt(req.query.hours as string) || 24, 168); // max 7 days
      const dataPoints = await svc.getAggregations(topic, period, hours);
      res.json({ dataPoints });
    } catch (err) {
      res.status(500).json({ error: "Failed to get chart data" });
    }
  });

  // GET /api/public/pulse/widget — compact payload for tokns.fi embed
  router.get("/widget", async (_req, res) => {
    try {
      const [summary, xrplStats, txTrending] = await Promise.all([
        svc.getSummary(24),
        svc.getXrplBridgeStats(),
        svc.getTrendingTweets("tx", 1),
      ]);

      const txTopic = summary.topics.find((t) => t.name === "tx");

      res.json({
        tx: {
          tweets24h: txTopic?.tweetCount24h ?? 0,
          sentiment: summary.overallSentiment,
          topTweet: txTrending[0] ?? null,
        },
        xrplBridge: {
          mentions24h: xrplStats.totalMentions24h,
          stakingPct: xrplStats.stakingMentionPct,
        },
        overall: {
          tweets24h: summary.totalTweets24h,
          sentiment: summary.overallSentiment,
        },
        updatedAt: summary.updatedAt,
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to get widget data" });
    }
  });

  // GET /api/public/pulse/tokens — TX chain token ecosystem data
  router.get("/tokens", async (_req, res) => {
    try {
      const tokens = [
        // Base tokens (CEX-listed)
        { symbol: "TX", name: "TX (Coreum)", type: "base", denom: "ucore", decimals: 6, coingeckoId: "tx", bridged: false },
        { symbol: "XRP", name: "XRP (Bridged)", type: "base", denom: null, decimals: 6, coingeckoId: "ripple", bridged: true, bridgeFrom: "XRPL", bridgeNote: "Hold XRP on TX chain and earn staking rewards via IBC bridge" },
        { symbol: "SARA", name: "Pulsara", type: "base", denom: null, decimals: 6, coingeckoId: "pulsara", bridged: false },
        { symbol: "SOLO", name: "Sologenic", type: "base", denom: null, decimals: 6, coingeckoId: "sologenic", bridged: false },
        // DEX tokens (pool-derived pricing)
        { symbol: "COZY", name: "COZY", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "CAT", name: "CAT", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "ROLL", name: "ROLL", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "KONG", name: "KONG", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "MART", name: "MART", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "SMART", name: "SMART", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        { symbol: "RLUSD", name: "RLUSD (Stablecoin)", type: "dex", denom: null, decimals: 6, coingeckoId: null, bridged: false },
        // IBC tokens
        { symbol: "USDC", name: "USDC (IBC)", type: "ibc", denom: null, decimals: 6, coingeckoId: "usd-coin", bridged: true, bridgeFrom: "Noble" },
      ];

      res.json({
        chain: "TX Blockchain (Cosmos SDK)",
        website: "https://tx.org",
        tradingPlatform: "https://tokns.fi",
        stakingValidator: "tokns.fi validator",
        tokens,
        xrplBridge: {
          supported: true,
          description: "XRP holders can bridge XRP to TX chain via IBC and earn staking rewards. Trade on tokns.fi DEX.",
          ctaUrl: "https://tokns.fi/swap",
        },
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to get token data" });
    }
  });

  return router;
}
