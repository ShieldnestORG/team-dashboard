/**
 * YouTube Pipeline — Analytics service
 *
 * Collects YouTube analytics and generates optimization insights via Ollama.
 */

import type { Db } from "@paperclipai/db";
import { ytAnalytics, ytPublishQueue, ytKeywordPerformance } from "@paperclipai/db";
import { eq, and, desc, sql } from "drizzle-orm";
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
 * Collect analytics for all published videos.
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
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}`,
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

      await db
        .insert(ytAnalytics)
        .values({
          companyId: COMPANY_ID,
          youtubeVideoId: video.id,
          videoTitle: video.snippet.title,
          analyticsData: { views, likes, comments },
          performanceScore: calculatePerformanceScore(views, likes, comments),
          performanceGrade: gradePerformance(views),
          analyzedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [ytAnalytics.companyId, ytAnalytics.youtubeVideoId],
          set: {
            analyticsData: { views, likes, comments },
            performanceScore: calculatePerformanceScore(views, likes, comments),
            performanceGrade: gradePerformance(views),
            analyzedAt: new Date(),
          },
        });
      updated++;
    }

    logger.info({ updated }, "YouTube analytics collected");
    return updated;
  } catch (err) {
    logger.error({ err }, "YouTube analytics collection failed");
    return 0;
  }
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
 * Generate optimization insights using Ollama.
 */
export async function generateOptimizationInsights(db: Db): Promise<string[]> {
  const recent = await db
    .select()
    .from(ytAnalytics)
    .where(eq(ytAnalytics.companyId, COMPANY_ID))
    .orderBy(desc(ytAnalytics.analyzedAt))
    .limit(10);

  if (recent.length === 0) return ["No analytics data available yet. Publish some videos first."];

  try {
    const summary = recent.map((r) => {
      const data = r.analyticsData as Record<string, number> | null;
      return `"${r.videoTitle}": ${data?.views || 0} views, ${data?.likes || 0} likes, score: ${r.performanceScore}/100`;
    }).join("\n");

    const result = await callOllamaChat(
      [
        {
          role: "system",
          content: "You are a YouTube analytics expert for the Tokns.fi channel (crypto, motivation, TX blockchain). Provide 3-5 actionable insights. Be concise — one line per insight.",
        },
        {
          role: "user",
          content: `Analyze these recent video performances and provide optimization insights:\n\n${summary}`,
        },
      ],
      { temperature: 0.7, maxTokens: 500 },
    );

    const insights = result.content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 5);

    return insights.length > 0 ? insights : ["Analytics collected but no specific insights generated."];
  } catch (err) {
    logger.warn({ err }, "Failed to generate optimization insights");
    return ["Analytics available but insight generation failed. Check Ollama connection."];
  }
}
