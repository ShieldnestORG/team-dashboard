import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  real,
  boolean,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// ---------------------------------------------------------------------------
// yt_content_strategies — topic/angle/pillar selection for YouTube pipeline
// ---------------------------------------------------------------------------

export const ytContentStrategies = pgTable(
  "yt_content_strategies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    topic: text("topic").notNull(),
    angle: text("angle").notNull(),
    pillar: text("pillar").notNull().default("crypto"), // crypto | motivation | tx_blockchain
    contentType: text("content_type").notNull().default("Explainer"),
    targetAudience: text("target_audience"),
    keywords: jsonb("keywords").$type<string[]>().default([]),
    estimatedViews: integer("estimated_views"),
    bestPublishTime: timestamp("best_publish_time", { withTimezone: true }),
    competitorAnalysis: jsonb("competitor_analysis").$type<unknown>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyPillarIdx: index("yt_strategies_company_pillar_idx").on(
      table.companyId,
      table.pillar,
    ),
    createdIdx: index("yt_strategies_created_idx").on(table.createdAt),
  }),
);

// ---------------------------------------------------------------------------
// yt_seo_data — SEO metadata per video
// ---------------------------------------------------------------------------

export const ytSeoData = pgTable(
  "yt_seo_data",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    contentItemId: text("content_item_id"), // FK to contentItems.id
    title: text("title").notNull(),
    description: text("description"),
    tags: jsonb("tags").$type<string[]>().default([]),
    hashtags: jsonb("hashtags").$type<string[]>().default([]),
    chapters: jsonb("chapters").$type<Array<{ time: string; title: string; seconds: number }>>(),
    endScreen: jsonb("end_screen").$type<Record<string, unknown>>(),
    seoScore: integer("seo_score").default(0),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    contentItemIdx: index("yt_seo_content_item_idx").on(table.contentItemId),
    companyIdx: index("yt_seo_company_idx").on(table.companyId),
  }),
);

// ---------------------------------------------------------------------------
// yt_productions — pipeline state tracking
// ---------------------------------------------------------------------------

export const ytProductions = pgTable(
  "yt_productions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    strategyId: uuid("strategy_id").references(() => ytContentStrategies.id),
    contentItemId: text("content_item_id"), // FK to contentItems.id (script)
    seoId: uuid("seo_id").references(() => ytSeoData.id),
    status: text("status").notNull().default("pending"), // pending|processing|ready|published|failed
    visualMode: text("visual_mode").notNull().default("presentation"), // images|mixed|presentation
    priority: integer("priority").default(50),
    estimatedDuration: text("estimated_duration"),
    assets: jsonb("assets").$type<{
      scriptPath?: string;
      ttsPath?: string;
      audioPath?: string;
      thumbnailPath?: string;
      videoPath?: string;
      captionsPath?: string;
      visualAssets?: string[];
    }>(),
    timeline: jsonb("timeline").$type<{
      created?: string;
      scriptReady?: string;
      thumbnailReady?: string;
      audioGenerated?: string;
      videoGenerated?: string;
      captionsGenerated?: string;
      readyForUpload?: string;
      published?: string;
    }>(),
    scheduledPublishTime: timestamp("scheduled_publish_time", { withTimezone: true }),
    error: text("error"),
    filesPurgedAt: timestamp("files_purged_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("yt_productions_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    createdIdx: index("yt_productions_created_idx").on(table.createdAt),
    purgeCandidatesIdx: index("yt_productions_purge_candidates_idx").on(
      table.companyId,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// yt_publish_queue — scheduled publish queue
// ---------------------------------------------------------------------------

export const ytPublishQueue = pgTable(
  "yt_publish_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    productionId: uuid("production_id").notNull().references(() => ytProductions.id),
    title: text("title").notNull(),
    publishTime: timestamp("publish_time", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("scheduled"), // scheduled|publishing|published|failed|paused
    priority: integer("priority").default(50),
    youtubeVideoId: text("youtube_video_id"),
    youtubeUrl: text("youtube_url"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    error: text("error"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("yt_publish_queue_company_status_idx").on(
      table.companyId,
      table.status,
    ),
    publishTimeIdx: index("yt_publish_queue_publish_time_idx").on(table.publishTime),
  }),
);

// ---------------------------------------------------------------------------
// yt_analytics — video performance data
// ---------------------------------------------------------------------------

export const ytAnalytics = pgTable(
  "yt_analytics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    youtubeVideoId: text("youtube_video_id").notNull(),
    videoTitle: text("video_title"),
    analyticsData: jsonb("analytics_data").$type<{
      views?: number;
      likes?: number;
      comments?: number;
      watchTimeMinutes?: number;
      averageViewDuration?: number;
      ctr?: number;
      impressions?: number;
    }>(),
    thumbnailMetrics: jsonb("thumbnail_metrics").$type<Record<string, unknown>>(),
    seoMetrics: jsonb("seo_metrics").$type<Record<string, unknown>>(),
    insights: jsonb("insights").$type<string[]>(),
    performanceScore: integer("performance_score"),
    performanceGrade: text("performance_grade"),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    videoIdx: uniqueIndex("yt_analytics_video_idx").on(
      table.companyId,
      table.youtubeVideoId,
    ),
    analyzedIdx: index("yt_analytics_analyzed_idx").on(table.analyzedAt),
  }),
);

// ---------------------------------------------------------------------------
// yt_keyword_performance — keyword effectiveness tracking
// ---------------------------------------------------------------------------

export const ytKeywordPerformance = pgTable(
  "yt_keyword_performance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    keyword: text("keyword").notNull(),
    totalUses: integer("total_uses").notNull().default(0),
    totalViews: integer("total_views").notNull().default(0),
    averageViews: real("average_views").default(0),
    bestVideoId: text("best_video_id"),
    performanceScore: real("performance_score").default(0),
    lastUsed: timestamp("last_used", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeywordUq: uniqueIndex("yt_keyword_perf_company_keyword_uq").on(
      table.companyId,
      table.keyword,
    ),
    scoreIdx: index("yt_keyword_perf_score_idx").on(table.performanceScore),
  }),
);
