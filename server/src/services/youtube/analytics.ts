/**
 * YouTube Pipeline — Analytics service
 *
 * Collects YouTube analytics, persists per-video insights to the DB,
 * and keeps yt_keyword_performance in sync so content strategy can
 * make data-driven topic selections.
 */

import type { Db } from "@paperclipai/db";
import {
  ytAnalytics,
  ytPublishQueue,
  ytKeywordPerformance,
  ytProductions,
  ytSeoData,
} from "@paperclipai/db";
import { eq, and, desc, inArray, isNotNull } from "drizzle-orm";
import { callOllamaChat } from "../ollama-client.js";
import { logger } from "../../middleware/logger.js";

const COMPANY_ID = process.env.TEAM_DASHBOARD_COMPANY_ID || "";
const YOUTUBE_CLIENT_ID = process.env.YOUTUBE_CLIENT_ID || "";
const YOUTUBE_CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET || "";
const YOUTUBE_REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN || "";

async function getAccessToken(): Promise<string | null> {
  if (!YOUTUBE_CLIENT_ID || !YOUTUBE_CLIENT_SECRET || !YOUTUBE_REFRESH_TOKEN) return null;
  try {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_CLIENT_ID,
        client_secret: YOUTUBE_CLIENT_SECRET,
        refresh_token: YOUTUBE_REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Collect analytics for all published videos and refresh keyword performance.
 */
export async function collectAnalytics(db: Db): Promise<number> {
  const published = await db
    .select()
    .from(ytPublishQueue)
    .where(
      and(
        eq(ytPublishQueue.companyId, COMPANY_ID),
        eq(ytPublishQueue.status, "published"),
      ),
    )
    .orderBy(desc(ytPublishQueue.publishedAt))
    .limit(50);

  if (published.length === 0) return 0;

  const token = await getAccessToken();
  if (!token) {
    logger.warn("YouTube API not configured — skipping analytics collection");
    return 0;
  }

  const videoIds = published
    .filter((p) => p.youtubeVideoId)
    .map((p) => p.youtubeVideoId!)
    .join(",");

  if (!videoIds) return 0;

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoIds}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      logger.error({ status: res.status }, "YouTube Analytics API failed");
      return 0;
    }

    const data = (await res.json()) as {
      items: Array<{
        id: string;
        snippet: { title: string };
        contentDetails: { duration?: string };
        statistics: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
    };

    let updated = 0;
    for (const video of data.items) {
      const views = parseInt(video.statistics.viewCount || "0", 10);
      const likes = parseInt(video.statistics.likeCount || "0", 10);
      const comments = parseInt(video.statistics.commentCount || "0", 10);
      const durationSec = parseDuration(video.contentDetails?.duration || "");

      await db
        .insert(ytAnalytics)
        .values({
          companyId: COMPANY_ID,
          youtubeVideoId: video.id,
          videoTitle: video.snippet.title,
          analyticsData: { views, likes, comments, watchTimeMinutes: Math.round(durationSec / 60) },
          performanceScore: calculatePerformanceScore(views, likes, comments),
          performanceGrade: gradePerformance(views),
          analyzedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [ytAnalytics.companyId, ytAnalytics.youtubeVideoId],
          set: {
            analyticsData: { views, likes, comments, watchTimeMinutes: Math.round(durationSec / 60) },
            performanceScore: calculatePerformanceScore(views, likes, comments),
            performanceGrade: gradePerformance(views),
            analyzedAt: new Date(),
          },
        });
      updated++;
    }

    logger.info({ updated }, "YouTube analytics collected");

    // Keep keyword performance table in sync with fresh view counts
    await refreshKeywordPerformance(db);

    return updated;
  } catch (err) {
    logger.error({ err }, "YouTube analytics collection failed");
    return 0;
  }
}

function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return (parseInt(match[1] || "0") * 3600) +
    (parseInt(match[2] || "0") * 60) +
    parseInt(match[3] || "0");
}

function calculatePerformanceScore(views: number, likes: number, comments: number): number {
  let score = 0;
  if (views > 10000) score += 30;
  else if (views > 1000) score += 20;
  else if (views > 100) score += 10;

  const engagement = views > 0 ? ((likes + comments) / views) * 100 : 0;
  if (engagement > 5) score += 30;
  else if (engagement > 2) score += 20;
  else if (engagement > 1) score += 10;

  if (likes > 100) score += 20;
  else if (likes > 10) score += 10;

  if (comments > 20) score += 20;
  else if (comments > 5) score += 10;

  return Math.min(100, score);
}

function gradePerformance(views: number): string {
  if (views > 100000) return "A+";
  if (views > 50000) return "A";
  if (views > 10000) return "B";
  if (views > 1000) return "C";
  if (views > 100) return "D";
  return "F";
}

/**
 * Recalculate yt_keyword_performance from all published+analyzed videos.
 * Joins publish queue → productions → seo_data to map keywords → views.
 * Safe to run repeatedly — full upsert on (company_id, keyword).
 */
export async function refreshKeywordPerformance(db: Db): Promise<void> {
  // 1. All published videos with their production's seo_id
  const published = await db
    .select({
      youtubeVideoId: ytPublishQueue.youtubeVideoId,
      seoId: ytProductions.seoId,
    })
    .from(ytPublishQueue)
    .innerJoin(ytProductions, eq(ytPublishQueue.productionId, ytProductions.id))
    .where(
      and(
        eq(ytPublishQueue.companyId, COMPANY_ID),
        eq(ytPublishQueue.status, "published"),
        isNotNull(ytPublishQueue.youtubeVideoId),
      ),
    );

  if (published.length === 0) return;

  // 2. Current view counts from analytics
  const videoIds = published.map((p) => p.youtubeVideoId!).filter(Boolean);
  const analyticsRows = await db
    .select({ youtubeVideoId: ytAnalytics.youtubeVideoId, analyticsData: ytAnalytics.analyticsData })
    .from(ytAnalytics)
    .where(
      and(
        eq(ytAnalytics.companyId, COMPANY_ID),
        inArray(ytAnalytics.youtubeVideoId, videoIds),
      ),
    );

  const viewsMap = new Map<string, number>(
    analyticsRows.map((a) => [
      a.youtubeVideoId,
      (a.analyticsData as { views?: number } | null)?.views ?? 0,
    ]),
  );

  // 3. SEO tag sets keyed by seo_id
  const seoIds = published.map((p) => p.seoId).filter(Boolean) as string[];
  if (seoIds.length === 0) return;

  const seoRows = await db
    .select({ id: ytSeoData.id, tags: ytSeoData.tags })
    .from(ytSeoData)
    .where(inArray(ytSeoData.id, seoIds));

  const seoTagMap = new Map<string, string[]>(
    seoRows.map((s) => [s.id, (s.tags ?? []) as string[]]),
  );

  // 4. Aggregate per keyword across all videos
  const kwStats = new Map<string, { uses: number; totalViews: number; bestVideoId: string; bestViews: number }>();

  for (const pub of published) {
    if (!pub.youtubeVideoId || !pub.seoId) continue;
    const tags = seoTagMap.get(pub.seoId) ?? [];
    const views = viewsMap.get(pub.youtubeVideoId) ?? 0;

    for (const tag of tags) {
      const kw = tag.toLowerCase().trim();
      if (!kw || kw.length < 3) continue;
      const existing = kwStats.get(kw) ?? { uses: 0, totalViews: 0, bestVideoId: pub.youtubeVideoId, bestViews: 0 };
      existing.uses++;
      existing.totalViews += views;
      if (views > existing.bestViews) {
        existing.bestViews = views;
        existing.bestVideoId = pub.youtubeVideoId;
      }
      kwStats.set(kw, existing);
    }
  }

  if (kwStats.size === 0) return;

  // 5. Upsert all keyword stats
  for (const [keyword, stats] of kwStats) {
    const avgViews = stats.uses > 0 ? stats.totalViews / stats.uses : 0;
    const score = Math.min(100, avgViews / 100);

    await db
      .insert(ytKeywordPerformance)
      .values({
        companyId: COMPANY_ID,
        keyword,
        totalUses: stats.uses,
        totalViews: stats.totalViews,
        averageViews: avgViews,
        bestVideoId: stats.bestVideoId,
        performanceScore: score,
        lastUsed: new Date(),
      })
      .onConflictDoUpdate({
        target: [ytKeywordPerformance.companyId, ytKeywordPerformance.keyword],
        set: {
          totalUses: stats.uses,
          totalViews: stats.totalViews,
          averageViews: avgViews,
          bestVideoId: stats.bestVideoId,
          performanceScore: score,
          lastUsed: new Date(),
        },
      });
  }

  logger.info({ keywords: kwStats.size }, "YT keyword performance refreshed");
}

/**
 * Generate optimization insights using Ollama.
 * Analyzes up to 50 videos (expanded from 10) and includes keyword trend data.
 * Persists generated insights to yt_analytics so future strategy runs can read them.
 */
export async function generateOptimizationInsights(db: Db): Promise<string[]> {
  const recent = await db
    .select()
    .from(ytAnalytics)
    .where(eq(ytAnalytics.companyId, COMPANY_ID))
    .orderBy(desc(ytAnalytics.performanceScore), desc(ytAnalytics.analyzedAt))
    .limit(50);

  if (recent.length === 0) return ["No analytics data available yet. Publish some videos first."];

  // Pull top keywords to include keyword trend context in the analysis
  const topKeywords = await db
    .select({
      keyword: ytKeywordPerformance.keyword,
      performanceScore: ytKeywordPerformance.performanceScore,
      totalViews: ytKeywordPerformance.totalViews,
    })
    .from(ytKeywordPerformance)
    .where(eq(ytKeywordPerformance.companyId, COMPANY_ID))
    .orderBy(desc(ytKeywordPerformance.performanceScore))
    .limit(10);

  try {
    // Include up to 30 videos in the summary text sent to Ollama
    const videoSummary = recent.slice(0, 30).map((r) => {
      const data = r.analyticsData as Record<string, number> | null;
      return `"${r.videoTitle}": ${data?.views || 0} views, ${data?.likes || 0} likes, score: ${r.performanceScore}/100`;
    }).join("\n");

    const keywordContext = topKeywords.length > 0
      ? `\nTop performing keywords by avg views: ${topKeywords.map((k) => `${k.keyword} (score ${k.performanceScore?.toFixed(1)})`).join(", ")}`
      : "";

    const result = await callOllamaChat(
      [
        {
          role: "system",
          content: `You are a YouTube analytics expert for the Tokns.fi channel (crypto, motivation, TX blockchain). You are analyzing ${recent.length} videos. Provide 5-7 actionable insights covering: what topics drive the most views, keyword patterns worth repeating, content gaps to fill, and optimal content types. Be concise — one line per insight.`,
        },
        {
          role: "user",
          content: `Analyze these video performances and provide optimization insights:\n\n${videoSummary}${keywordContext}`,
        },
      ],
      { temperature: 0.7, maxTokens: 800 },
    );

    const insights = result.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 5);

    if (insights.length > 0) {
      // Persist insights on the top-10 performers so content-strategy can read them
      const topTen = recent.slice(0, 10);
      for (const video of topTen) {
        await db
          .update(ytAnalytics)
          .set({ insights })
          .where(
            and(
              eq(ytAnalytics.companyId, COMPANY_ID),
              eq(ytAnalytics.youtubeVideoId, video.youtubeVideoId),
            ),
          );
      }
      logger.info({ count: insights.length, storedOn: topTen.length }, "YT insights generated and persisted");
    }

    return insights.length > 0 ? insights : ["Analytics collected but no specific insights generated."];
  } catch (err) {
    logger.warn({ err }, "Failed to generate optimization insights");
    return ["Analytics available but insight generation failed. Check Ollama connection."];
  }
}
