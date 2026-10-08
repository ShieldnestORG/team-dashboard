# YouTube Pipeline (daily videos)

> **Cluster:** youtube · **Tags:** youtube, tts, elevenlabs, slides, sync, beats · **Related:** [Video Edit](video-edit.md), [Env vars](../deploy/env-vars.md), [Cron inventory](../operations/cron-inventory.md)

**In plain words:** a robot on VPS4 writes a script every morning, has Mark's cloned voice read it, turns it into
slides, joins them into a video and queues it for the **Coherence Daddy** YouTube channel. Since 2026-10-07 each slide
is on screen exactly while its own sentence is spoken, and a new video waits for the owner's approval before it posts.

## What it is and where it runs

| Thing | Where |
|---|---|
| Code | `server/src/services/youtube/` — `production.ts` (orchestrator), `script-writer.ts`, `presentation-renderer.ts` (beats + slides), `tts.ts`, `yt-video-assembler.ts` (ffmpeg + sync gate), `seo-optimizer.ts`, `publish-queue.ts`, `yt-crons.ts` |
| Runs in | VPS4 (`31.220.61.14`), container `team-dashboard-server-1`, container clock UTC |
| Crons (`yt-crons.ts`) | `yt:daily-production` 06:00 · `yt:publish-queue` every 15 min · `yt:daily-analytics` 09:00 · `yt:optimization` 22:00 · `yt:weekly-strategy` Sun 08:00 · `yt:cleanup-videos` 02:00 (all UTC); `YT_PIPELINE_ENABLED=false` silences them |
| Mode | `YT_VISUAL_MODE=presentation` on VPS4 (checked 2026-10-07) |
| Files | `/paperclip/youtube/audio/audio_<id>.wav`, `/paperclip/youtube/assets/<id>/pres_NNN_<type>.png`, `/paperclip/youtube/videos/video_<id>.mp4`; captions in `/tmp/yt-temp/` (tmpfs, gone on restart) |
| Queue | `yt_publish_queue.status`: `pending_review` → (owner approves) `scheduled` → `publishing` → `published` · or `failed` / `paused` |
| Admin UI | `/socials/youtube` (`YouTubePipeline.tsx`): queue cards with Publish Now, Reschedule / Approve & schedule, Remove · `youtube/videos` (`YouTubeVideos.tsx`): watch/download finished videos |

`yt_publish_queue.publishTime` comes from `calculateBestPublishTime()` (`content-strategy.ts`): a **random** Tue–Sun
slot 1–7 days ahead. Several videos can land in one slot and Mondays get none (on 2026-10-07 three queued videos
shared 2026-10-08 14:00Z). Open item below.

## The beat rule

One **beat** = one slide = one voice clip. `buildBeats(script)` (`presentation-renderer.ts`) is the single source for
both the slides and the narration, so nothing is shown that isn't spoken and nothing is spoken without its slide.

| Beat | Slide | Spoken text |
|---|---|---|
| title | title card | the hook (the title itself is never read) |
| intro ×1–3 | "In this video" bullets, current one highlighted | topicIntro / valueProposition / credibility; the greeting rides on the first |
| section_title | section card | `<section title>.` |
| content ×N | the section's bullets (chunks of 3), current one highlighted | that line (lines starting `[` are stage directions: never shown, never spoken) |
| conclusion | key takeaways | the recap lines |
| hook (closing) | quote card | `finalThought` |
| cta | subscribe card | subscribe + like + comment, then the evntrace line |

Timing is **measured, never estimated**: each beat is voiced separately, decoded to PCM WAV (44.1 kHz mono) and timed
from the WAV (sample-exact); clips are joined with a 0.6 s gap; slide i lasts `clip_i + 0.6 s`. The slideshow is
built with an `fps=30` filter and an explicit `-t`, and the merge is cut at the audio length, so the picture ends
with the narration. Word-count estimation remains only for the legacy image mode.

## Voice

- **Mark's ElevenLabs clone** (`VOICE_REGISTRY.mark` in `voice-snippets.ts`, voice `n45mfBjBoGc0McY8O2Aw`
  "Mark_new_2026"), key `ELEVENLABS_VOICE_KEY` (no fallback to `ELEVENLABS_API_KEY`, a different account).
- Model **`eleven_multilingual_v2`**, settings stability 0.45 · similarity 0.8 · style 0.0, with `previous_text` /
  `next_text` from the neighbouring beats. Why v2: `GET /v1/voices/n45m…` with the server key (2026-10-07) lists
  the clone as *professional*, fine-tuned for multilingual_v2 / turbo / flash, and `eleven_v3` is **not** in its
  `high_quality_base_model_ids`. Settings are the owner's tested ZeroEdit "v2" preset
  (`6-2026-new-youtube-automation/tools/tts.py`). The Content Hub voice snippets still run this clone on
  `eleven_v3` — not changed here, flagged below.
- 429 / 5xx / network errors retry twice (1 s, 3 s); a beat that still fails fails the whole run (no silent gap,
  no quiet switch to another voice). `YT_TTS_PROVIDER=grok` brings back Grok "Rex".
- **Quota** (voice-owning account, read 2026-10-07): creator tier, 36,033 of 363,000 characters used this cycle,
  resets 2026-10-14. A 4-min video is ~2,900 characters (real render 2026-10-07), so 1/day ≈ 90k a month,
  3/day ≈ 270k, 5/day ≈ 450k (over this cycle's limit).

## Channel identity and pronunciation

- Channel: **Coherence Daddy** — TX ecosystem, tokns.fi, crypto news, self-improvement/mindset. Prompts in
  `script-writer.ts`, `content-strategy.ts`, `analytics.ts`, `walkthrough-writer.ts` say so.
- `sanitizeScript()` runs on every script: strips pronunciation asides the model writes ("DeFi—pronounced
  'de-fi'—"), drops any model-written sentence that mentions evntrace, and replaces a greeting that doesn't name
  Coherence Daddy with "What's up everyone, welcome back to Coherence Daddy."
- `applyPronunciationFixes()` respells words for the **voice only** (captions and slides keep the real spelling):
  tokns.fi → "toe-kins dot fye", evntrace.com → "event trace dot com", DeFi → "de-fi", TX ecosystem → "T-X ecosystem".
  Local Whisper on the 2026-10-07 render heard "Welcome back to Coherence Daddy", "DeFi", "tokens.fi",
  "CoherenceDaddy.com", "EventTrace.com".

## The evntrace line

`EVNTRACE_CTA_LINE` = "Also, check out evntrace.com." (`script-writer.ts`), spoken at the end of the CTA beat, plus an
`evntrace.com` link in the description. **Name only, on purpose:** evntrace's claims register (Digital Forensics
repo, branch `marketing/foundation`, `marketing/claims-register.md`, "Video gate") allows no evntrace *claim* in a
published video until its terms, data agreement and privacy policy exist and counsel has read them. Change the
wording only after that gate clears, with a claim ID from the register.

## Owner approval

`YT_REQUIRE_REVIEW` (default on): a finished video enters the queue as `pending_review` with a proposed time; the publish
queue only takes `scheduled` rows. Approve in the dashboard with **Approve & schedule** (sets the time and
`scheduled`) or **Publish Now**. `YT_REQUIRE_REVIEW=false` restores automatic scheduling.
Both actions only work on `pending_review`, `scheduled` or `paused` rows (route answers 409, `forcePublish` throws), so a
published or failed video can't be uploaded twice. The time box is pre-filled in local time (it used to pre-fill UTC into
a local picker, so an unchanged approval moved the video 7 hours later in PDT). A `pending_review` video older than
30 days is still purged by `yt:cleanup-videos` — approve within a month.

## The sync gate

`verifySlideSync()` (`yt-video-assembler.ts`) runs after assembly in presentation mode. It fails the run (status
`failed`, error `sync gate: …`, not queued, files kept) when: slide durations don't add up to the audio (> 0.15 s);
the **video stream** is not as long as the audio (> 0.25 s — `format=duration` would hide it behind the audio); any
detected slide change is > 1 s from every planned start; or fewer than half the planned changes are detected
(blank/broken slides). Detection: ffmpeg `scene > 0.02` on the top 74% of the frame (the bottom holds captions).

## How to check a published video

```bash
ssh root@31.220.61.14 'docker exec team-dashboard-server-1 ffmpeg -hide_banner -i /paperclip/youtube/videos/video_<id>.mp4 -an -vf "crop=1920:800:0:0,scale=480:200,select=gt(scene\,0.02),showinfo" -f null - 2>&1 | grep -o "pts_time:[0-9.]*"'
```

Compare those slide-change times with YouTube's transcript (watch page → Show transcript) at each section title.

| Measured | Section 1 | Section 2 | Section 3 | Section 4 | Recap |
|---|---|---|---|---|---|
| 2026-10-07, published c6e0b897 (old code) | 17 s early | 14 s early | 7 s early | on time | 7 s late |
| 2026-10-07, same script, new code, local render | all 27 slide changes within 0.03 s of plan; speech starts 0.01–0.11 s after each change | | | | |

Live videos also ran 0.34–1.9 s past their audio (frozen end card) before the length fix.

## Change log

- **2026-10-07** — Measured the drift above. Root cause: one TTS call for the whole script, slide lengths guessed
  from word counts over a word list that counted the unspoken title and missed the intro and closing thought.
- **2026-10-07** (branch `fix/yt-beat-sync`) — beats + measured timing; Mark's clone on multilingual_v2;
  Coherence Daddy naming and sanitizer; claim-free evntrace line; sync gate; owner-approval queue status; the
  finished video is exactly as long as its narration. Owner decisions the same day: Mark's voice; channel is
  Coherence Daddy; evntrace may be mentioned; new-style videos are approved before they post; old queued videos may
  be removed after approval.

## Open items

Evidence behind these items (2026-10-07): [channel measurements](youtube-channel-measurements-2026-10-07.md) ·
[metadata audit](youtube-metadata-audit-2026-10-07.md) (tags, thumbnails, chapters, analytics scope, builder spec B1–B8) ·
[script research](youtube-script-research-2026-10-07.md) (honesty, facts-from-code, format, topic engine, draft prompt).


- [ ] **Animated scenes** — prototype on branch `feat/yt-animated-scenes` (commit `2a25862c`, not merged):
  `server/src/services/youtube/animated/` (`scenes.html` driven by one `seek(t)` clock via paused Web Animations,
  `render.ts` frame-stepper → ffmpeg) + `server/scripts/yt-animated-demo.ts`. Five templates (title, section, list
  with moving highlight, quote, end card) from `coherencedaddy-landing/DESIGN.md` tokens, Geist fonts bundled (OFL).
  Measured 2026-10-07 on the real Mark-voice timeline: 7,707 frames = 256.90 s (matches the audio), all 27 sentence
  boundaries change the picture (median 6.1 grey levels) while frames hold still inside a sentence (max 0.27); 0 layout
  warnings; 147 s wall time on the owner's Mac (VPS4 speed unmeasured). Exits start 0.25 s before the next beat by
  design. Before production: the server build must copy `scenes.html` + `assets/` into `dist`; Chromium on VPS4;
  render time on VPS4; the sync gate's scene threshold vs smooth fades (the prototype measured with a pixel-change
  method); short on-screen text per line (the script redesign's `onScreen`), since full sentences render small.
  The current static slide template is off-brand: `slide-templates.ts` uses the banned cyan `#00d4ff`, coral
  `#FF876D` (brand is `#FF6B4A`) and Inter (brand is Geist).
- [ ] **Scripts and how the channel talks** — the prompt still produces formula titles, near-duplicate topics and
  invented first-person claims ("I Tested 5 … for 90 Days"); redesign pending research.
- [ ] **Metadata** — the custom thumbnail and the SRT are generated but never uploaded (publisher sends title,
  description, tags, category 28 only); chapters come from script estimates (past the end on 14/14 live videos); tags
  include concatenated junk and `toknsfi` on every video; `yt_analytics` has 0 rows because the OAuth token has only
  `youtube.upload` (daily 403, swallowed — the cron reports success). Owner step: re-consent with `youtube.readonly` +
  `yt-analytics.readonly`; meanwhile Zernio already holds views for 155 videos.
- [ ] **Publishing cadence** — replace the random slot with N per day; owner wants 3–5/day after approval;
  recommendation is 1/day for 1–2 weeks with analytics working, then scale (YouTube's "inauthentic content"
  policy, renamed 2025-07-15, targets "mass-produced, generic, repetitive" videos).
- [ ] **Old-timing videos** — 5 were queued on 2026-10-07; pause/remove after the owner approves the new style.
- [ ] Exact in-beat captions from ElevenLabs `/with-timestamps` (captions are spread evenly inside each beat today).
- [ ] Mark's mastering chain (ZeroEdit `aggressive_post`) for a brand-VO sound.
- [ ] Content Hub snippets drive Mark's clone through `eleven_v3`, which the clone isn't fine-tuned for.
- [ ] Site-walker mode still overlays `TOKNS.FI` (`site-walker.ts`) and its narration has no evntrace line.
- [ ] `blog-slideshow-generator.ts` shares the slide builders, so its slide list now also has "In this video" slides.
