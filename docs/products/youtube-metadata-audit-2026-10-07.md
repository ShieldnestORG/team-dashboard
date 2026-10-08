# YouTube robot: metadata, packaging and growth audit (Track D, read-only)
> **Cluster:** YouTube pipeline audit · **Tags:** yt-audit, seo, thumbnails, oauth-scope, analytics, approval-gate · **Related:** [Channel measurements](youtube-channel-measurements-2026-10-07.md), [YouTube Pipeline](youtube-pipeline.md)
> Imported 2026-10-07 from the session's working folder; the helper scripts it mentions (`work/…`, `channel-data.json`) were not kept. Canonical page: [YouTube Pipeline](youtube-pipeline.md).

Stamped 2026-10-07 23:30 PDT (06:30 UTC 10-08). Code = team-dashboard `origin/master` 659d1219 (read with `git show`, nothing checked out). VERIFIED: all 29 files cited
(server, UI, schema, docs) are byte-identical (sha256 prefix) to the source copies inside the running `team-dashboard-server-1`, so file:line below is the running code.
Tags: **VERIFIED** (read or measured this session) · **INFERRED** (reasoned from verified facts) · **UNVERIFIED** (could not check). Probe scripts are kept in `work/`.

**TIME-SENSITIVE:** 3 old-style videos publish 2026-10-08 14:00Z (07:00 PDT; queue ids 32968f04, 64b300eb, 46087ea5), others 10-09 15:00Z and 10-11 10:00Z. Nothing
holds them (P0-1). Stopgap with no code: Queue tab Reschedule/Remove, or pause cron `yt:publish-queue` on the `/crons` page (CronManagement.tsx:150-170).

## Summary: top 8
1. P0-1 No approval gate: every produced video auto-publishes; three old-style ones go live 2026-10-08 14:00Z.
2. P0-2 Templated AI output at volume matches YouTube's Spam-policy "mass-production" example: 148 videos/180 days, 16% are exact repeats of an earlier title.
3. P0-3 Titles make false first-person and income claims ("I Tested ... Paid My Rent"); nothing checks them.
4. P0-4 `#toknsfi` and `tx ecosystem` plus filler tags on 148/148 videos, multi-word tags glued together; `#understanding` shows above the title on 10 of 14.
5. Analytics is empty: the OAuth token has only `youtube.upload`, the daily call gets 403, swallowed (cron says success). Zernio already holds views for 155 videos.
6. 140 custom thumbnails (43.8 MiB) and the SRTs are made but never uploaded; viewers see identical auto-picked slide frames. `thumbnails.set` works with today's token.
7. Chapters run past the video end on 14/14 live and 5/5 queued (planned 4-5 min vs real 2:49-3:32); titles carry junk ("- Toknsfi", "Tx", "Defi").
8. Growth data (small samples): TX content averages 14.7 views vs 1.8 for motivation (the biggest pillar); random slots collide at only three hours, UTC mislabelled as
   local.

## What I touched (read-only; disclosed per Rule 11)
- VPS over ssh: env var NAMES only; log greps; ls/ffprobe; SELECT-only node scripts via `docker exec` (DB ones used a temp file in the container's /tmp, deleted in the
  same command, none left: checked); copied 4 thumbnails to `work/thumbs/` to look at them.
- ONE authenticated read probe: refreshed the token inside the container with its own env credentials, then 2 GET calls (`videos.list` 1 id, Analytics `reports.query`).
  Printed only HTTP status, granted scopes, Google's error reason. No writes, no secrets or project ids printed.
- Public GETs: official YouTube pages; ~20 watch pages and channel pages of @coherencedaddy; one Browser-pane look at the channel grid (tab closed).

## A. The five questions
### Q1 What an upload sends, and what is made but never sent
Sent: resumable `videos.insert?part=snippet,status` (platform-publishers/youtube.ts:41-64): title `.slice(0,100)` (:53) · description = seo.description + "\n\n" +
hashtag line (:54) · tags, max 30 (:55) · categoryId "28" (:56) · privacyStatus public, selfDeclaredMadeForKids false (:58-62; `madeForKids` is read-only in the videos
doc). NOT sent: defaultLanguage, containsSyntheticMedia, publishAt, localizations. Tags and hashtags both come from ONE list: `sanitizeTags(meta.tags)` → `#`+despaced
(publish-queue.ts:68,88) → `#` stripped again (youtube.ts:38). Afterwards nothing is called: a grep for `googleapis.com/…youtube` finds only `videos.insert`
(youtube.ts:42) and `videos.list` (analytics.ts:80) in the whole server. publishItem reads thumbnailPath/captionsPath (:66-67) and drops both.

| made at | what | where it dies | measured |
|---|---|---|---|
| production.ts:113-120 | `thumb_<id>.jpg` | never uploaded (publish-queue.ts:83-89) | 140 files; viewers get auto-picked slide frames (P1-1) |
| production.ts:151-164 | SRT | burned into pixels (yt-video-assembler.ts:107-113), never a caption track | 14/14 sampled videos: auto-generated English track only |
| seo-optimizer.ts:237-283 | curated `hashtags` | saved to yt_seo_data only; queue metadata keys on all 153 rows: tags, seoId, videoPath, description, captionsPath, thumbnailPath | unused |
| seo-optimizer.ts:289-305 | `chapters` | saved only; description rebuilds its own list (:163-173) without the "Conclusion" row | P1-4 |
| seo-optimizer.ts:358-365 | `endScreen` | saved only; Data API reference has no end-screen resource (nav: Activities … Watermarks), so Studio-only (INFERRED) | dead data |
| seo-optimizer.ts:381 | `pinnedCommentText` | no consumer (grep); CHANGELOG.md:205 lists it as shipped; Comments API has no pin method (list/insert/update/setModerationStatus/delete), so pinning is Studio-only (INFERRED) | dead data |

### Q2 How the text is built, and why each measured defect happens (148 published rows, SELECT on prod DB unless noted)
| defect | cause |
|---|---|
| Glued junk tags: 661 of 2,006 sent tags were multi-word and got glued; 212 are >25 chars (`cryptoportfoliostrategybeginners2026`) | publish-queue.ts:88 `t.replace(/\s+/g,"")`; also seo-optimizer.ts:198 builds a no-space topic tag |
| Filler/unrelated tags: `toknsfi` + `tx ecosystem` on 148/148 (so every mindset video too); explained/what is/understanding on 97; top 10/list/countdown on 10 | seo-optimizer.ts:225-226 (hard-coded), :200-206 typeTagMap, :228 script.keywords; keywords are naive topic words incl. "over", "better" (content-strategy.ts:267-277) |
| Above-title hashtags are junk: `#understanding` is one of the 3 on 10 of 14 sampled videos (watch-page JSON) | hashtag line = every tag (youtube.ts:54); YouTube picks 3 of them; median 14, max 18 hashtags |
| ` - Toknsfi/- Best/- Stake/- Building/- Successful` suffix on 35 titles (24%) | seo-optimizer.ts:93-96 appends `keywords[0]` = first long word of the topic; "tokns.fi" loses its dot so it never matches |
| "Tx" ×27, "Defi" ×5, "Coherencedaddy" ×3, lower-case after "(" ×18 e.g. "(stop Overthinking" | titleCase :102-113 lower-cases all but the first letter of every word and lower-cases small words even after ":" or "(" |
| Random "Ultimate/Proven/Secret" prefix ×10 ("Secret Why Willpower Fails"); "2026" in 132 titles; 99 titles >70 chars | :80-86 random power word; :88-91 forced year; no length target |
| Lower-cased angle pasted into description line 1; title appears twice before "Show more" | :153 `${script.title} - In this video, you'll discover ${strategy.angle.toLowerCase()}.` |
| "de-fi" in section names and chapters | script-writer.ts:189 system prompt says write "DeFi" "to be pronounced de-fi" (Track C owns the prompt; SEO needs a normalizer) |
| Chapters past the end: last description timestamp beyond the video on 14/14 live and 5/5 queued | :163-173 and :289-305 start at a hard-coded 20 s and add the LLM's planned `section.duration` (script-writer.ts:206,216 ask for 4-5 min); real audio 169-213 s (ffprobe of the 5 queued) |
| Same boilerplate "ABOUT" + B2B directory CTA on every video; dead LINKS; "(c) 2026 Tokns.fi" | :176-179, :181-185; :349 + aeo-cta.ts:15 (production.ts:104 passes no brand so 'cd'); bare domains not linked on 4/4 watch pages (only the https URL is) |

### Q3 Why yt_analytics has 0 rows (crux verified live)
- API: YouTube Data API v3 `videos.list?part=statistics,snippet,contentDetails` (analytics.ts:79-82), NOT the YouTube Analytics API. Env var NAMES it uses:
  YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (all present in the container; no YOUTUBE_API_KEY exists). Cron `yt:daily-analytics` 09:00 UTC.
- Cause VERIFIED: daily log `ERROR YouTube Analytics API failed {"status":403}` then `updated:0`. My probe: token refresh 200, granted scope = ONLY
  `https://www.googleapis.com/auth/youtube.upload`; the cron's exact call returns 403 PERMISSION_DENIED `ACCESS_TOKEN_SCOPE_INSUFFICIENT` ("Request had insufficient
  authentication scopes"); Analytics `reports.query` returns the same 403.
- The publisher's scope cannot read analytics. Official scope tables: videos.insert and thumbnails.set accept youtube.upload (so thumbnails work today); captions.insert
  accepts only youtube.force-ssl/youtubepartner; playlists.insert, playlistItems.insert, videos.update need youtube or force-ssl (commentThreads.insert: force-ssl);
  Analytics samples use `yt-analytics.readonly`.
- Silent: analytics.ts:83-86,137-140 catch and return 0, so the cron registry shows 160 runs, 0 errors (system_crons): no alert, no circuit breaker. The UI button
  returns {updated:0}; the tab says "No analytics data yet". Docs claim CTR is collected (docs/guides/agent-cron-ownership.md:183); the code never reads it, and the
  Analytics metrics page lists no thumbnail impressions/CTR metric (INFERRED: Studio-only).
- A working source already exists: `zernio_post_analytics` holds 155 YouTube videos (143 join to the queue): views non-zero on 129, likes on 19, comments on 5, total
  1,724 views; impressions/retention empty.

### Q4 What the owner can do in the dashboard today
- Queue tab (YouTubePipeline.tsx:252-274; API routes/youtube.ts:82-94, last 50 rows): title, local scheduled time, badge. For `scheduled` rows only: Publish Now (:182),
  Reschedule (:195-234; PATCH :106-129), Remove with confirm (:236-244; hard DELETE :131-145).
- Video Files page (`/youtube/videos`, YouTubeVideos.tsx): list, search, Download mp4 as attachment (:230; routes:359-384). 30 files on disk (144 MB); older ones purged
  by video-cleanup.ts.
- Cron page (`/crons`): enable/disable, schedule override, trigger per job (CronManagement.tsx:150-170). Pipeline tab: Run Pipeline with a custom topic (sync HTTP call,
  about 3 min in the logs).
- Cannot: see description, tags, hashtags, chapters, thumbnail or script; edit any of them; hold or approve (schema comment lists `paused`, youtube_pipeline.ts:137, no
  code uses it); play the video inline.

### Q5 Thumbnails
thumbnail.ts: Ollama writes an image prompt that says "no text" (:35-48), then the first available image backend is used (:56-78). Only `GROK_API_KEY` exists among
GEMINI/GROK/CANVA keys (names listed) and the log says `Thumbnail generated via visual backend {"backend":"grok"}` (grok-imagine-image, grok.ts:54; request carries no
size, :53-58). On disk (`/paperclip/youtube/assets/thumb_*`): **140 files, 45,885,796 bytes (43.8 MiB)**, min 93,366 / median 318,727 / max 513,168 B; real JPEGs: 122
at 1280×720, 17 at 1408×768, 1 portrait 832×1248. No text overlay exists anywhere (grep), although thumbnail.ts:40 says "added separately". I looked at two: dark AI art
with no headline (one draws the word "Motivation" on a sign, the other has garbled chart glyphs).

## B. Prioritized findings (P0 harms channel or breaks policy · P1 clear growth lever · P2 polish)
### P0-1 No approval gate: every produced video auto-publishes
- Problem: queue rows are created `scheduled` (production.ts:219-233); `yt:publish-queue` (*/15, yt-crons.ts:41-51) posts whatever is due (publish-queue.ts:21-35). The
  owner cannot review before it posts (Q4).
- Fix: CODE spec B1 (new `pending_review` status, same vocabulary as marketing_drafts.ts:23-40; review card; approve/reject/edit routes; cleanup exemption because
  video-cleanup.ts:47-59 purges ANY production >30 d). [M] Manual stopgap now [S].

### P0-2 Policy exposure: templated, repetitive AI output at volume
- Evidence (official, Spam Policy): "Using automated tools or AI to churn out high volumes of similar content with minimal changes"; example "repetitive AI generated
  imagery across many videos, with each video reading out an AI-generated script"; consequence "we may suspend your monetization or terminate your channel or account".
  YPP page: "Generic or repetitive content includes content that looks like it's made with a template".
- Measured: 148 videos in 180 days (a post on 93 days, 0-6 per day, 6 on 04-12) from a 30-topic pool (37 distinct topics over 210 strategy runs, top topic ×10;
  content-strategy.ts:23-60,155-160); 24 of 148 titles (16%) are exact repeats of another title, 30 share all their significant words (one title ×5: Apr 24, Jun 5, Jul
  14, Aug 5, Sep 27; "Inside Tokns.fi" ×3 on 04-12); 61 of 148 have a near-duplicate (word-set Jaccard ≥0.6, my heuristic); the 6 grid thumbnails I looked at are the
  same dark slide; one boilerplate paragraph on all.
- Whether YouTube would act: UNVERIFIED (no threshold published; I did not look inside Studio). Fix: CODE B3 (no topic or title within 90 d, weekly cap), owner picks
  cadence: fewer, more distinct videos (INFERRED safe direction). [M]

### P0-3 False or unearned claims in titles
- Evidence: "I Tested 5 Crypto Passive Income Methods for 90 Days - Here's Which One Actually Paid My Rent" (l1IHmAObc5Y) when nobody tested anything; "Inside
  Coherencedaddy's 2026 Portfolio: High-conviction Crypto Picks" (HvBbjkn2M4Y). The angle prompt only says "while being honest" at temperature 0.9 with no check
  (content-strategy.ts:203-221). Official: "Be accurate. Make sure your title accurately represents the video" (12340300); Spam Policy "Malicious clickbait … does not
  deliver what was promised" and "Promoting 'get rich quick' investment schemes". Income promises also appear ("$100/day" published; "Which One Actually Makes You
  Rich?" queued). Enforcement outcome: INFERRED risk.
- Fix: CODE `validateTitle()` (B4): rules for first-person experience claims, income/return promises, "guaranteed"; one regeneration, then force human review. [S]

### P0-4 Unrelated and over-tagged tags/hashtags on every video
- Evidence: Q2 rows 2-3. Official hashtags page: "Don't add hashtags that are not directly related to the video … Misleading or unrelated hashtags may result in the
  removal of your video"; "The more tags you add, the less relevant they become". The "ignore all above 60 hashtags" limit is NOT hit (max 18). Tags page: "tags play a
  minimal role in your video's discovery"; "excessive tags to your video description is against our policies".
- Fix: CODE B4: ≤8 tags with spaces kept (include brand spellings, the one real use of tags), 3-5 topical hashtags, TX/Tokns tags only on TX-pillar videos, never derive
  tags from hashtags. [S]

### P1-1 Custom thumbnail never uploaded; the art is generic
- Problem: viewers see YouTube's auto-picked mid-video slide (section-title slide plus a half-sentence burned subtitle), identical across the grid (screenshot).
  Official: "90% of the best-performing videos have custom thumbnails"; "overlay your images with your branding and descriptive text".
- Facts: thumbnails.set (~50 units) accepts the current youtube.upload scope, jpeg/png, 50 MB; Help says uploading your own needs a verified account and there is a
  daily limit. A full https URL is clickable in our descriptions, which the videos doc ties to verification or Advanced Features (eligibility INFERRED, not proven).
- Fix: CODE B6 + B7 (normalise to 1280×720, overlay ≤4-word headline, upload after insert, non-fatal). Manual M3. [M]

### P1-2 / P1-3 Titles and descriptions: junk suffix/prefix, casing, length, boilerplate, dead links, wrong CTA
- Evidence: Q2. Official: titles "put the most important words near the beginning" (the grid shows "…" at mobile width); descriptions "Be sure that each video has a unique
  description" and "use the first few lines … to describe your video". The directory-listing CTA (aeo-cta.ts:15) shows on mindset videos; `tokns`/`tx`/`optimizeme`
  variants already exist (:18-58).
- Fix: CODE B4: smartTitleCase with protected terms, drop :80-96, target ≤60 chars; unique 2-sentence summary from script.hook / conclusion.recap, full `https://` links,
  CTA by pillar, drop "(c) Tokns.fi" (channel is Coherence Daddy; Track A owns spoken naming). [S-M]

### P1-4 Chapters are wrong and the last section is never chaptered
- Evidence: official rules "starts with 00:00", "at least three timestamps … ascending", "minimum length … 10 seconds". Page JSON of 14 live videos: the out-of-range
  last timestamp is left unlinked; 13 of 14 still got chapters from the earlier ones (the two I opened had 4 each); the newest (XKyRJe55i8Y) has none after 16 h (cause
  UNVERIFIED). The orchestrator measured real section starts ~0:33/1:11/1:41/2:11 against chapter times 0:20/1:35/2:35 on that video, so clicks land in the wrong
  section.
- Fix: CODE B5 (derive from the real slide timeline, clamp to duration−10 s; compute after assembly). Coordinate with Track A. [M]

### P1-5 The feedback loop is blind (and fails silently)
- Evidence: Q3; strategy log shows `"dataWeighted":false,"insightsAvailable":0`; yt_keyword_performance empty. Even working analytics could not map views to topics:
  queue metadata has no strategy link and `strategyId` is never set (production.ts:92-100).
- Fix: CODE B2 (throw on 403, Zernio join now, record strategyId) [S]; MANUAL M2 (re-consent for retention and captions) [S].

### P1-6 Use what the data already says
- Zernio views joined to queue titles (143 videos; pillar guessed from title words, INFERRED): TX/brand avg 14.7 views (35 videos, max 126), crypto 8.8 (51, max 112),
  motivation/other 1.8 (57, max 14, 17 with zero), yet motivation is the largest pillar (81 of 210 strategy runs, random pick: content-strategy.ts:121-124). Samples are
  tiny; treat as direction only. Hours used: only 10Z, 14Z, 15Z, so Zernio's `best-time` can only rank those three and cannot find better ones. Fix: CODE B3 (weights
  from mean views with an exploration floor). [S]

### P1-7 Schedule: random slot, collisions, UTC mislabelled as local
- Evidence: random pick of 6 slots 1-7 days out, no collision check (content-strategy.ts:279-295): 96 distinct hours for 148 videos, 40 slots shared, max 5 in one slot;
  Mondays 2 of 148; container clock is UTC, so "2pm/10am" means 07:00/03:00 PDT. Official upload-schedule page: "Consistency: Are you consistent about both your upload
  and content schedules?" Fix: CODE B3 (fixed weekly slots in a named zone, next free slot). Manual M4 picks the hour. [S]

### P1-8 Queue route and UI hazards
- PATCH `/queue/:id/schedule` sets `status:"scheduled"` on any row (routes:116-124) and `forcePublish` has no status check (publish-queue.ts:125-134): a published or
  failed row can be re-uploaded as a duplicate. UI Reschedule pre-fills UTC into a local picker (YouTubePipeline.tsx:227 vs :207), so confirming unchanged shifts the
  time by the UTC offset (code-read, not executed). Fix: CODE B1 guards. [S]

### P1-9 Captions: SRT never uploaded, YouTube has ASR only
- captions.insert needs force-ssl (400 units); SRT timing is word-rate estimation (yt-video-assembler.ts:142-174) and validateCaptions only logs the final end time
  (production.ts:167-172), so uploading today would publish drifting captions on top of the burned-in copy. Fix: after Track A delivers measured timings and M2 is done,
  upload the SRT (basic UTF-8 .srt is supported; API `sync` is deprecated) and stop burning one of the two. [M, blocked on Track A]

### P2 polish
- P2-1 `defaultLanguage` ("en") and explicit `containsSyntheticMedia:false` are writable on insert; `defaultAudioLanguage` is in the resource but not in the writable
  list, so do not send it. Studio upload defaults only affect browser uploads. AI disclosure is not required for AI-written scripts/titles/thumbnails or one's own
  cloned voice, but is for realistic depictions of real people: ask Tracks A/B whether any voice or scene is a real person's. [S]
- P2-2 Playlists: none seem to exist (public tabs are Videos/Shorts only, INFERRED). Official description tips: "Link out to playlists of related videos".
  playlists.insert and playlistItems.insert cost 50 units each and need M2. One playlist per pillar. [M]
- P2-3 Pinned CTA comment: pin is Studio-only; auto-posting the same text under every video could itself look repetitive. End screens (video ≥25 s, Editor → End screen)
  and A/B tests are Studio-only; A/B is pointless at 2 views per video. [manual]
- P2-4 Category 28 for finance/mindset content (INFERRED low impact; videoCategories.list gives valid ids). Stored URL is `/shorts/<id>` (youtube.ts:91; HTTP 303 to the
  watch page). Upload as private + `publishAt` so HD processing finishes before go-live (INFERRED benefit; publishAt needs private, never-published). [S]
- P2-5 Cosmetics: `estimatedViews` is random 5000-15000 and drives priority (content-strategy.ts:376); seoScore is a vanity number (seo-optimizer.ts:311-326);
  `watchTimeMinutes` stores video length (analytics.ts:114); `yt:optimization` stores the placeholder "No analytics data available yet" as an insight (analytics.ts:306;
  UI :305-319); the shared publisher posts Shorts too (platform-publishers/index.ts:10-24, public-reels.ts:133), so edit it additively. [S]

## C. Manual owner steps (code cannot do these)
- M1 Now: hold the 5 queued old-style videos (Queue tab, or pause `yt:publish-queue` on `/crons`).
- M2 OAuth re-consent (Google Cloud OAuth flow, then update YOUTUBE_REFRESH_TOKEN on the server; never printed, I did not change it): stage 1 (analytics):
  `youtube.upload` + `youtube.readonly` ("View your YouTube account", INFERRED enough for videos.list; the 09:00 UTC cron will prove it) + `yt-analytics.readonly`;
  enable "YouTube Analytics API" in the project (UNVERIFIED if on). Stage 2 only when captions/playlists ship: add `youtube.force-ssl` (official text: "See, edit, and
  permanently delete your YouTube videos, ratings, comments and captions"), so add it last. Not needed for thumbnails.
- M3 Studio → Settings → Channel → Feature eligibility: confirm custom thumbnails / Advanced features (UNVERIFIED).
- M4 Studio → Analytics → Audience "When your viewers are on YouTube" and the Reach tab (impressions and CTR in the first 24 h; CTR is not in the API) to pick one fixed
  slot.
- M5 Channel page: the public description describes a faith-based "full-spectrum human" framework and private tools while the videos are crypto/TX/motivation
  slideshows; no Home or Playlists tab, no channel keywords (public page JSON). Align the promise with the content.
- M6 Look in Studio for any policy warning or restriction (I cannot see Studio).

## D. Builder spec, in the order I would do it (one PR each; a regression test per measured defect; env names are proposals)
- **B1 Gate (P0-1, P1-8)**: production.ts:219-233 insert `status = YT_REQUIRE_REVIEW !== "false" ? "pending_review" : "scheduled"` and add metadata {topic, pillar,
  contentType, angle, strategyId, hashtags, chapters}. routes/youtube.ts: POST `/queue/:id/approve` {publishTime?}, POST `/queue/:id/reject`, PATCH
  `/queue/:id/metadata` (title/description/tags/hashtags, validated), GET `/queue/:id`, GET `/videos/:filename/stream` (Range support) and GET
  `/thumbnails/:productionId.jpg`; publish-now and schedule only from scheduled|pending_review|paused. video-cleanup.ts: skip pending_review|paused|scheduled. UI
  QueueItemCard (YouTubePipeline.tsx:128-250): thumbnail, `<video controls>`, title/description/tags/chapters, Approve/Edit/Reject; fix :207/:227 timezone. Test:
  processPublishQueue never selects pending_review.
- **B2 Honest feedback (P1-5)**: analytics.ts: on !ok read the body, log the reason, THROW on 403 so cron error_count and the breaker work; route returns
  {updated,error}; add `collectFromZernio(db)` (zernio_post_analytics where platform='youtube' joined on youtube_video_id) writing views/likes/comments; rename
  watchTimeMinutes; after M2 add Analytics `reports.query` (averageViewDuration, averageViewPercentage, subscribersGained). Test: mocked 403 fails the job loudly.
- **B3 Strategy, dedupe, cadence (P0-2, P1-6, P1-7)**: content-strategy.ts:380-390 `.returning({id})` and set productions.strategyId (production.ts:96); selectTopic
  skips topics used <90 d and titles with Jaccard ≥0.6 against the last 90 published; pillar weights from mean views with a 20% exploration floor; `YT_MAX_PER_WEEK`;
  calculateBestPublishTime :279-295 becomes fixed weekly slots in `YT_PUBLISH_TZ` (default America/Los_Angeles), next free slot from yt_publish_queue, never two in one
  slot.
- **B4 SEO text (P0-3, P0-4, P1-2, P1-3)**: seo-optimizer.ts: smartTitleCase with protected terms (TX, DeFi, Tokns.fi, Coherence Daddy, BTC, ETH, DCA, NFT, DAO, AI)
  replacing :102-113; delete :80-86, :88-91 (year only for time-bound topics), :93-96; extractKeywords keeps phrases; `validateTitle()`; normalizer for every SEO string
  (de-fi→DeFi, T-X→TX); description from script.hook/recap, full https links, CTA by pillar via getAeoCta(brand) (production.ts:104), no "(c) Tokns.fi" line; tags ≤8
  spaced; hashtags 3-5 kept separate from tags in queue metadata.
- **B5 Chapters (P1-4)**: pure `deriveChapters(slides, wordCounts, audioDurationSec)` mirroring the assembler (yt-video-assembler.ts:79-86; section starts = cumulative
  duration before each `section_title` slide); enforce ≥3, first 00:00, gaps ≥10 s, last ≤ duration−10; run after assembly (production.ts step 9) and patch description
  + yt_seo_data; consume Track A's measured per-slide starts when they land. Test: the 5 queued videos (169.4-212.6 s) produce no timestamp ≥ duration.
- **B6 Publisher (P1-1, P2-1)**: leave `youtubePublisher` alone (shared with Shorts); add `youtube/uploader.ts` used only by publish-queue.ts: tags as given,
  categoryId, defaultLanguage "en", containsSyntheticMedia false (override), watch URL; then `thumbnails.set` (POST upload/youtube/v3/thumbnails/set?videoId=,
  image/jpeg; non-fatal; save thumbnailUploaded/error in queue metadata; works with today's token). Behind flags until M2: captions.insert, playlistItems.insert.
- **B7 Thumbnails (P1-1)**: thumbnail.ts: crop to 1280×720 JPEG (reject portrait), overlay ≤4-word headline + brand with the Playwright renderer already used for
  slides; text-only branded card when the image backend fails. Use the design-system tokens (UI-work rule).
- **B8 Maps (Rule 16)**: docs/guides/agent-cron-ownership.md:183 (says CTR), CHANGELOG.md:205 (pinned comment), pipeline doc, rebuild the code graph.

## E. Not verified / open
UNVERIFIED: channel verification and Advanced-features state; whether the Analytics API is enabled in the Cloud project (probe failed on scope first); consent-screen
status (token has worked 175+ days, INFERRED production); why XKyRJe55i8Y has no chapters; real section starts for the queued videos (Track A); audience geography; any
Studio warning; project quota allocation (the quota page contradicts itself: its table and the videos.insert page say a separate bucket of 100 uploads/day at 1 unit,
one sentence still says 1600). Zernio also wraps YouTube retention/demographics endpoints (zernio.ts:847-850) but stores no YouTube snapshots; add-on state UNVERIFIED.

## Sources (official, fetched 2026-10-07/08)
Help: [hashtags](https://support.google.com/youtube/answer/6390658) · [tags](https://support.google.com/youtube/answer/146402) ·
[chapters](https://support.google.com/youtube/answer/9884579) · [title & thumbnail tips](https://support.google.com/youtube/answer/12340300) · [description
tips](https://support.google.com/youtube/answer/12948449) · [custom thumbnails](https://support.google.com/youtube/answer/72431) · [Spam
Policy](https://support.google.com/youtube/answer/2801973) · [monetization policies](https://support.google.com/youtube/answer/1311392) · [AI
disclosure](https://support.google.com/youtube/answer/14328491) · [thumbnails policy](https://support.google.com/youtube/answer/9229980) · [end
screens](https://support.google.com/youtube/answer/6388789) · [A/B test](https://support.google.com/youtube/answer/16391400) · [upload
schedule](https://support.google.com/youtube/answer/13616979) · [audience report](https://support.google.com/youtube/answer/9314416) · [upload
defaults](https://support.google.com/youtube/answer/2660027) · [captions](https://support.google.com/youtube/answer/2734796) · [caption
formats](https://support.google.com/youtube/answer/2734698).
API: [OAuth scopes](https://developers.google.com/identity/protocols/oauth2/scopes) · [videos resource](https://developers.google.com/youtube/v3/docs/videos) ·
[videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) · [videos.update](https://developers.google.com/youtube/v3/docs/videos/update) ·
[thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set) · [captions.insert](https://developers.google.com/youtube/v3/docs/captions/insert) ·
[playlists.insert](https://developers.google.com/youtube/v3/docs/playlists/insert) ·
[playlistItems.insert](https://developers.google.com/youtube/v3/docs/playlistItems/insert) ·
[commentThreads.insert](https://developers.google.com/youtube/v3/docs/commentThreads/insert) · [quota
costs](https://developers.google.com/youtube/v3/determine_quota_cost) · [Analytics
reports.query](https://developers.google.com/youtube/analytics/reference/reports/query) · [Analytics metrics](https://developers.google.com/youtube/analytics/metrics).
