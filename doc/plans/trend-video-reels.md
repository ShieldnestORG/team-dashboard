# Trend Video Reels — Feature Plan

## Problem

The content pipeline only produces text. Agents can write tweets, blog posts, and threads, but can't create visual content (video shorts, reels, images). Short-form video is the highest-engagement format on every platform. Additionally, there's no way for users on coherencedaddy.com to grab pre-made trend content and post it themselves.

## Vision

1. **AI agents monitor trends** via the existing intel pipeline (Twitter, Reddit, News, CoinGecko, GitHub)
2. **Agents auto-generate viral short videos** from trending topics — with brand watermark baked in
3. **Videos land in the Content Studio** review queue for approval
4. **Approved videos appear on coherencedaddy.com** in a public "Trend Reels" section
5. **Users can grab and repost** these reels with attribution metadata already embedded

## Architecture

```
Intel Pipeline (existing)
  ↓ trending topics from 5 sources
Trend Scorer (new)
  ↓ ranks topics by viral potential
Video Script Generator (new — Ollama)
  ↓ writes short scripts from trend data
Visual Generator (new — Gemini/Grok API)
  ↓ generates images or video from scripts
Video Assembler (new — FFmpeg on VPS)
  ↓ composites: visuals + text overlays + watermark + metadata
Content Queue (existing, extended)
  ↓ review workflow (approve/flag)
Public Reels API (new)
  ↓ serves approved reels to coherencedaddy.com
coherencedaddy.com/reels (new page in coherencedaddy repo)
  → users browse, preview, download with metadata
```

## Implementation Phases

### Phase 1 — Video Script Generator + Image/Video Backend (COMPLETED 2026-04-04)

**Status**: Deployed to production. Both Gemini and Grok backends active on VPS.

**Goal**: Agents can generate video scripts, images, and videos from trending topics.

**New files:**
- `server/src/services/visual-backends/types.ts` — VisualBackend interface
- `server/src/services/visual-backends/gemini.ts` — Gemini Imagen 3 (images) + Veo 2 (video)
- `server/src/services/visual-backends/grok.ts` — xAI Grok image (grok-2-image) + video (grok-imagine-video)
- `server/src/services/visual-backends/index.ts` — Backend registry (auto-enable by env var)
- `server/src/services/visual-content.ts` — Visual content queue (parallel to text queue)
- `server/src/services/visual-jobs.ts` — Async job tracker (video gen takes minutes)
- `server/src/routes/visual-content.ts` — REST API for visual content

**Modified files:**
- `server/src/app.ts` — Register visual routes + job polling
- `server/src/services/content-crons.ts` — Add visual cron jobs
- `server/src/content-templates/blaze.ts` (and others) — Add `video_script` content type prompt

**Env vars:**
- `GEMINI_API_KEY` — Gemini free tier
- `GROK_API_KEY` — xAI image + video API (grok-2-image + grok-imagine-video)

**Content type additions:**
```
video_script — text script for visual content (overlay text, narration cues)
image_post — standalone generated image
short_video — 15-60s vertical video
```

### Phase 2 — FFmpeg Video Assembly + Watermark (VPS)

**Goal**: Compose final videos from generated images/video + text overlays + watermark.

**New files:**
- `server/src/services/video-assembler.ts` — FFmpeg pipeline
- `server/src/services/watermark.ts` — Brand watermark overlay
- `server/assets/watermark.png` — Coherence Daddy watermark asset

**FFmpeg pipeline:**
```
1. Take generated image/video as base
2. Add text overlays (trending stat, headline) via drawtext filter
3. Add Coherence Daddy watermark (bottom-right, semi-transparent)
4. Embed metadata: title, description, tags, source URL
5. Output 9:16 vertical MP4, H.264, 1080x1920
```

**Metadata baked into MP4:**
```
title: "BTC +12% This Week — What's Driving It?"
description: "Trend analysis by Coherence Daddy AI"
comment: "coherencedaddy.com/reels"
copyright: "Coherence Daddy"
keywords: "bitcoin,crypto,trends"
```

**VPS requirement:** FFmpeg must be installed in the Docker image. Add to Dockerfile:
```dockerfile
RUN apt-get update && apt-get install -y ffmpeg
```

### Phase 3 — Public Reels API + coherencedaddy.com Page

**Goal**: Approved reels are served publicly so users can browse and download them.

**New in this repo (Team Dashboard):**
- `server/src/routes/public-reels.ts` — Public API (no auth required)
  - `GET /api/reels` — List approved reels (paginated, filterable by topic/platform)
  - `GET /api/reels/:id` — Single reel metadata
  - `GET /api/reels/:id/download` — Download MP4 with embedded metadata
  - `GET /api/reels/:id/thumbnail` — Thumbnail image

**New in coherencedaddy repo:**
- `/reels` page — Public gallery of trend reels
  - Grid layout with video thumbnails
  - Click to preview (inline player)
  - "Download & Post" button — downloads MP4 with all metadata
  - Platform-specific share buttons (copy to clipboard for TikTok, YouTube Shorts, etc.)
  - "Powered by Coherence Daddy AI" attribution

**Reel metadata served to frontend:**
```json
{
  "id": "uuid",
  "title": "BTC breaks $100K resistance — what the data says",
  "topic": "bitcoin price action",
  "platform": "youtube_shorts",
  "thumbnailUrl": "/api/reels/uuid/thumbnail",
  "videoUrl": "/api/reels/uuid/download",
  "duration": 30,
  "resolution": "1080x1920",
  "hashtags": ["bitcoin", "crypto", "trends"],
  "createdAt": "2026-04-03T...",
  "source": "Intel Pipeline — CoinGecko + Twitter"
}
```

### Phase 4 — Canva Template Integration

**Goal**: Agent can use Canva templates for higher-polish designs.

- `scripts/canva-generator.py` — Python script on VPS using Canva Connect API
- `server/src/services/visual-backends/canva.ts` — Node bridge via child_process.spawn
- Templates for: data cards, stat overlays, quote graphics, comparison charts

### Phase 5 — Automated Platform Publishing

**Goal**: Approved reels auto-publish to YouTube Shorts, TikTok, Instagram, Twitter.

- YouTube Data API v3 (Shorts upload)
- TikTok Content Posting API
- Instagram Graph API (Reels)
- Twitter/X API v2 (video tweets)
- OAuth flows stored in company secrets

## Trend Scoring System

Extend the intel pipeline to score topics by viral potential:

```typescript
interface TrendScore {
  topic: string;
  score: number;        // 0-100
  velocity: number;     // how fast it's trending
  sentiment: string;    // positive/negative/neutral
  sources: string[];    // which intel sources mention it
  lastMentionedAt: string;
}
```

**Scoring factors:**
- Mentioned across multiple sources (Twitter + Reddit + News) = high
- Price movement > 5% in 24h = high
- GitHub activity spike = medium
- Novel topic not covered recently = bonus
- Relevance to ecosystem properties = bonus

## Cron Schedule (Phase 1)

Add to content-crons.ts:
```
content:video:trend    "0 11,14,18 * * *"    — 3x daily trend reel generation
content:video:market   "0 9 * * 1-5"         — weekday morning market recap
content:video:weekly   "0 10 * * 6"          — Saturday weekly roundup
```

## CRITICAL: Build Rules

Per CLAUDE.md concurrent session guidelines:
1. ALL work on a **feature branch** (`feat/trend-reels`)
2. Verify `npx tsc --noEmit --project server/tsconfig.json` = zero errors before merging
3. Verify `cd ui && npx tsc --noEmit` = zero errors
4. Stage specific files only (no `git add -A`)
5. One agent session at a time on this branch

## File Summary

| Phase | New Files | Modified Files |
|-------|-----------|----------------|
| 1 | 7 (backends, visual service, jobs, routes) | 3 (app.ts, content-crons, templates) |
| 2 | 3 (assembler, watermark, asset) | 1 (Dockerfile) |
| 3 | 1 route + coherencedaddy repo page | 0 |
| 4 | 2 (canva script + backend) | 1 (backend registry) |
| 5 | 4 (platform publishers) | 1 (routes) |
