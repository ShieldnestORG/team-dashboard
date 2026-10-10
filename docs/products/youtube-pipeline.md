# YouTube Pipeline (daily videos)

> **Cluster:** youtube · **Tags:** youtube, tts, elevenlabs, slides, sync, beats, animated · **Related:** [Video Edit](video-edit.md), [Env vars](../deploy/env-vars.md), [Cron inventory](../operations/cron-inventory.md), [2026-10-09 animated go-live record](../handoffs/2026-10-09-youtube-animated-live.md)

**In plain words:** a robot on VPS4 writes a script every night (cron `0 6 * * *` UTC = 11 PM PDT, 10 PM PST; it
starts a few minutes after the hour), has Mark's cloned voice read it, turns it into
slides (or, in animated mode, a word-by-word animated picture), joins them into a video and queues it for the **Coherence Daddy** YouTube channel. Since 2026-10-07 each slide
is on screen exactly while its own sentence is spoken, and a new video waits for the owner's approval before it posts.

## What it is and where it runs

| Thing | Where |
|---|---|
| Code | `server/src/services/youtube/` — `production.ts` (orchestrator), `script-writer.ts`, `presentation-renderer.ts` (beats + slides), `tts.ts`, `yt-video-assembler.ts` (ffmpeg + sync gate), `animated-video.ts` + `word-timings.ts` + `animated/` (animated mode), `seo-optimizer.ts`, `publish-queue.ts`, `yt-crons.ts` |
| Runs in | VPS4 (`31.220.61.14`), container `team-dashboard-server-1`, container clock UTC |
| Crons (`yt-crons.ts`) | `yt:daily-production` 06:00 · `yt:publish-queue` every 15 min · `yt:daily-analytics` 09:00 · `yt:optimization` 22:00 · `yt:weekly-strategy` Sun 08:00 · `yt:cleanup-videos` 02:00 (all UTC); `YT_PIPELINE_ENABLED=false` silences them |
| Mode | **`YT_VISUAL_MODE=animated` on VPS4 since 2026-10-09 19:02 PDT** (owner: "make animated the default"; env backup `.env.production.bak-yt-animated-1791597734`; container recreated, env read back inside it): the nightly cron makes **animated** videos, slides only as the render-error fallback. *This row said until that evening:* `YT_VISUAL_MODE=presentation` on VPS4 (checked 2026-10-07, still so after the 2026-10-09 deploy): the nightly cron makes **slide** videos until the owner decides otherwise. `animated` is merged (#198), deployed and opt-in (env value, or the third argument of `runProductionPipeline`); see [Animated mode](#animated-mode-yt_visual_modeanimated) |
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
from the WAV (sample-exact) after `trimClipEdgesWav()` cuts breath and room tone off both ends (onset −32 dBFS with a
60 ms pre-roll, tail −40 dBFS with a 120 ms post-roll); clips are joined with a 0.6 s gap; slide i lasts `clip_i + 0.6 s`. The slideshow is
built with an `fps=30` filter and an explicit `-t`, and the merge is cut at the audio length, so the picture ends
with the narration. Word-count estimation remains only for the legacy image mode.

## Animated mode (`YT_VISUAL_MODE=animated`)

Same script, beats, voice and measured slide durations as the presentation mode; only the picture differs. Merged
2026-10-09 as #198 (`3a23e0e3`), deployed to VPS4 the same evening (18:23 PDT) and run there once by hand (below).
This section said "not yet run on VPS4" and "VPS4 speed is unmeasured" until that run.

- `production.ts` voices the beats exactly as in presentation mode, then calls `renderAnimatedVideo()`
  (`animated-video.ts`) **before** any slide is rendered. It cuts each beat's speech out of the track, asks
  ElevenLabs forced alignment (`POST /v1/forced-alignment`, key `ELEVENLABS_VOICE_KEY`) for per-word times on the
  beat's display text (`word-timings.ts`; up to 4 beats at once), writes `timeline_<id>.json` next to the video and
  renders `animated/scenes.html` frame by frame in Playwright Chromium (`animated/render.ts`, 1920x1080, 30 fps),
  muxing the voice track. A beat whose alignment fails, or returns a different word count, gets estimated word
  times for that beat only.
- **Any error in the animated render** is logged (`logger.error`) and the day falls through to the normal slide path
  (`generateVisualAssets` + `assembleYouTubeVideo`), so a video still ships. `yt_productions.assets.visualMode`
  records which path made it: `animated`, `presentation` or `presentation-fallback`.
- **Sync gate** (`verifySlideSync(..., { mode: "animated" })`): the two duration checks are unchanged; changes inside
  a beat (words lighting up) are not reported as drift, and 75% of the planned beat changes must be seen (slides: 50%;
  the bar was 90% from #198 until the evening of 2026-10-09, see Open items).
  A video that fails the gate fails the day; it does not fall back to slides (owner decision pending, Open items).
  Known weakness: smooth fades can read as "no change" to the scene score (measured 2026-10-09, Open items).
- Needs Playwright Chromium (the production image already ships build 1217 at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`, so nothing is installed on VPS4; the container's `/app` is read-only, output goes to `/paperclip/youtube/`) and
  `scenes.html` + `animated/assets/` next to the compiled `render.js` (the `server` build script copies them to
  `dist/services/youtube/animated/`). `YT_ANIMATED_CHROMIUM` overrides the browser path.
- Local proof 2026-10-09 (Mac, estimated word times, real audio of a live 29-beat video): 4,877 frames in 141.7 s wall
  (about 35 frames/s); video stream 162.533 s against 162.560 s of audio; the animated gate matched 28 of 28 planned
  beat changes.
- **On VPS4** (2026-10-09, container started 2026-10-10T01:23:50Z, repo `3a23e0e3`): before the deploy the render ran inside
  the live container at 10.2 frames/s on a 30 s window. First full animated production `d6d30d70-2ba7-4187-ba81-f76ea832aae9`,
  started 18:24 PDT, **619 s end to end**: script "Discipline Over Motivation: Small Habits That Stick" (pillar motivation,
  `gemma4:31b`, 3 attempts), 42 beats; forced alignment 42 aligned / 0 estimated in about 3 s; 5,311 frames = 177.04 s;
  render wall time 510.8 s (about 10.4 frames/s on 4 cores, roughly a third of the Mac's speed); 0 layout warnings; video
  stream 177.033 s vs audio 177.029 s; animated sync gate passed with 38 of 41 planned changes matched (92.7%, bar 90%),
  max offset 0.233 s; queued `pending_review` for 2026-10-11 14:00Z; `assets.visualMode = animated`; stored chapters
  00:00 Introduction, 00:18, 00:47, 01:15, 01:43, 02:07, 02:33 Takeaways.
- **No migration:** the only schema-adjacent change is the type of the `assets` jsonb column (adds `visualMode`).

## Voice

- **Mark's ElevenLabs clone** (`VOICE_REGISTRY.mark` in `voice-snippets.ts`, voice `n45mfBjBoGc0McY8O2Aw`
  "Mark_new_2026"), key `ELEVENLABS_VOICE_KEY` (no fallback to `ELEVENLABS_API_KEY`, a different account).
- Model **`eleven_v3`, "Creative"** (stability 0.0 · similarity 0.9 · style 0.0) since 2026-10-08 — the owner's pick
  (take D) for energy: about 180 wpm vs about 156 on v2; a 12-beat test read back by Whisper had 1.4% word errors and no
  badly misread clip. v3 **rejects** `previous_text`/`next_text` (HTTP 400, measured), so each beat is voiced on its own.
  `YT_ELEVENLABS_MODEL=eleven_multilingual_v2` restores the steady v2 voice (stability 0.45 · similarity 0.8 · style 0.0,
  with `previous_text`/`next_text` from the neighbouring beats). Why v2 was first: `GET /v1/voices/n45m…` with the server key (2026-10-07) lists
  the clone as *professional*, fine-tuned for multilingual_v2 / turbo / flash, and `eleven_v3` is **not** in its
  `high_quality_base_model_ids`. Settings are the owner's tested ZeroEdit "v2" preset
  (`6-2026-new-youtube-automation/tools/tts.py`). The Content Hub voice snippets still run this clone on
  `eleven_v3` — not changed here, flagged below.
- 429 / 5xx / network errors retry twice (1 s, 3 s); a beat that still fails fails the whole run (no silent gap,
  no quiet switch to another voice). `YT_TTS_PROVIDER=grok` brings back Grok "Rex".
- **Quota** (voice-owning account, read 2026-10-07): creator tier, 36,033 of 363,000 characters used this cycle,
  resets 2026-10-14. A 4-min video is ~2,900 characters (real render 2026-10-07), so 1/day ≈ 90k a month,
  3/day ≈ 270k, 5/day ≈ 450k (over this cycle's limit).

## How a script is made (script v2)

1. **Topic** (`content-strategy.ts`): pillar balanced to equal thirds (TX/tokns · crypto education · mindset) over the
   last 9 strategies; topic = the least-recently-used of that pillar's orchestrator-written seeds; the last 30 titles,
   and for crypto up to 5 recent crypto-ish headlines from `intel_reports`, are passed on.
2. **Script** (`script-writer.ts`): `SCRIPT_SYSTEM_PROMPT` (voice, honesty and title-contract rules) → JSON → `sanitizeScript`
   → `validateScript` (`script-validator.ts`). Violations go back to the model with exact reasons, up to 2 repairs; then
   the run fails with `script_validation` — there is no filler template any more. Scripts under `YT_MIN_SCRIPT_WORDS`
   (380) spoken words are sent back to be lengthened.
3. **Beats** add a disclosure slide after the title on TX/tokns scripts and a "not financial advice" slide before the CTA
   on crypto scripts; content slides show the script's `onScreen` text (≤ 7 words).
4. **Archive**: `archive/<YYYY-MM>/<id>/` keeps script, timeline, SEO, manifest, slides, thumbnail and captions.
5. **Slot**: the next free daily slot (`YT_PUBLISH_PER_DAY`, `YT_PUBLISH_HOURS`, `YT_PUBLISH_TZ`; default 1/day at 7 AM PT).

Measured 2026-10-08 with the production model (gemma4:31b via Ollama cloud): three seeds, all passed the checker (one hype
repair); with the length rule 395–450 words in 2–3 attempts. One full local render (TX seed, voice D, AI slides): 37
beats, 3:48, sync gate 36/36 within 0.034 s.

## Channel identity and pronunciation

- Channel: **Coherence Daddy** — TX ecosystem, tokns.fi, crypto news, self-improvement/mindset. Prompts in
  `script-writer.ts`, `content-strategy.ts`, `analytics.ts`, `walkthrough-writer.ts` say so.
- `sanitizeScript()` runs on every script: strips pronunciation asides the model writes ("DeFi—pronounced
  'de-fi'—"), drops any model-written sentence that mentions evntrace, and replaces a greeting that doesn't name
  Coherence Daddy with "What's up everyone, welcome back to Coherence Daddy."
- `applyPronunciationFixes()` respells words for the **voice only** (captions and slides keep the real spelling):
  tokns.fi → "tokens dot phi" (until 2026-10-09 "toe-kins dot fye", which eleven_v3 spelled out as F-Y-E), evntrace.com → "event trace dot com", DeFi → "de-fi", TX ecosystem → "T-X ecosystem",
  meme/memecoin(s) → "meem"/"meem-coin(s)" (Whisper heard "memcoin" before, 2026-10-08).
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

`verifySlideSync()` (`yt-video-assembler.ts`) runs after assembly in presentation mode (and, with `mode: "animated"`, on the animated render; see Animated mode for its relaxed rules). It fails the run (status
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
- **2026-10-08** — #191 merged (`03630f05`) and deployed. Owner heard sighs between slides: every clip of the real
  render ended in ~0.5 s of breath/room tone (15.0 s in total) → per-clip edge trim; "memecoin" respelled. On the 28
  real clips the trim changed no first/last word (Whisper). Drafted by an Ollama worker, gated here.
- **2026-10-08** — #192 merged (`0c1e957b`) and deployed ~22:04 PDT: Mark on `eleven_v3` take D (owner's pick),
  breath trim, "meem-coin". The 23:03 PDT run on it passed the sync gate (26/26 slide changes ≤ 0.033 s) and queued
  as `pending_review`; its script still came from the old writer (title "How to Buy Crypto in 2026: The Ultimate…").
- **2026-10-08** — #194 (script v2) merged (`cf22a901`) and deployed 23:17 PDT, after that run. Predeploy: no pending
  migrations. Checked on the live container without writing anything (topic picked from read-only queries, one
  `generateScript` call, `validateScript`): pillar `tx_blockchain` (2 of the last 9), seed "what staking on TX
  actually means, and what it does not", title "What TX Staking Actually Is", greeting "This is Coherence Daddy.",
  4 sections, 0 violations, 26 s on `gemma4:31b`. The first full video from it is the next nightly run.
- **2026-10-09** — Owner: "remove any old videos from cue". Removed the 4 unpublished rows (all scripted before
  #194): 2 `scheduled` (2026-10-11 10:00Z "Why Motivation Is a Scam…", 2026-10-15 14:00Z "Stop Losing Your Yield…")
  and 2 `pending_review` ("Proven Why Motivation Fails…", "How to Buy Crypto in 2026…"). Same delete as the
  dashboard's Remove; rows backed up to `/root/yt-queue-removed-2026-10-09.json` on VPS4; the 4 MP4s stay on disk
  until the 30-day cleanup. Queue after: 152 `published`, nothing else. VPS4 then ran `50a56d18` (#196), container
  up since 2026-10-09 06:48Z; `gemma4:31b` listed, YouTube refresh token OK (`youtube.upload` only); the
  ElevenLabs key lacks `user_read`, so remaining TTS credit can't be read from the server.
- **2026-10-09** — First full script-v2 video, run by hand at 16:03 PDT (same `runProductionPipeline(db)` call as the
  cron; production `d95fef7d`). 240 s end to end; script "What TX Staking Actually Is" (`gemma4:31b`, 2 attempts: the
  first failed `ADVICE_OR_HYPE` + `TOO_SHORT`); 29 beats, 162.56 s; spoken + on-screen disclosure at 5.2 s; sync gate
  28/28, max offset 0.033 s; video stream 162.53 s vs audio 162.56 s. Queued `pending_review` for 2026-10-10 14:00Z.
  **Metadata bugs it exposed** (all in `seo-optimizer.ts`; "not yet fixed" until #197, 2026-10-09 evening, see below): (1) chapters print `NaN:NaN`, because
  script v2 sections carry `duration: "35s"` (a string) and `generateChapters` does `current += section.duration`;
  (2) title rewritten to "Powerful What Tx Staking Actually Is (2026)" (power-word prefix, "Tx"); (3) the description
  has no disclosure line (owner decision: spoken, on screen AND in the description); (4) junk tags ("actually",
  "means", "does") and template filler ("insights about staking, actually, means"). Same beats rendered with the
  animated branch (`cfd61d9d`) on the owner's Mac: 4,877 frames = 162.56 s, 19 scenes, **0 layout warnings** (script
  v2's shorter lines cleared the 10 seen before), 125 s wall time. Animated defect seen: the follow-along splits
  "tokns.fi" into "tokns. fi".
- **2026-10-09** — Owner heard Mark spell "tokns.fi" as "tokens dot F-Y-E". The respelling IS live
  (`applyPronunciationFixes`: "tokns.fi" → "toe-kins dot fye"), but `eleven_v3` reads the non-word "fye" as letters
  (the isolated clip transcribes as "dot f y"). Four candidate respellings voiced on the live settings (`fie`,
  `phi`, `fy`, `fai`) waited on the owner's ear (settled the same day: take B, next entry); Whisper cannot judge them. The owner prefers the animated style.
  The animated follow-along needs per-word times (`words` on each beat); without them it falls back to caption pills
  under the slide text ("double captions"). The preview used whisper.cpp word times aligned to the display words
  (90% matched); production needs its own source (ElevenLabs forced alignment was the prototype's stated plan; built in #198, below).
  Quote scenes drew the sentence twice when words existed (big quote + bottom band) and split "tokns.fi" at the dot:
  fixed on `feat/yt-animated-scenes` `37d96ac2` (DOM gate 6/15 red before, 15/15 green after).
- **2026-10-09** — Owner picked take B ("phi") of the four voiced respellings: `applyPronunciationFixes` now says
  "tokens dot phi". Metadata fixes above (`youtube-seo-v2.test.ts`, 16 tests on the real d95fef7d script and its
  measured durations; breaking the chapter parse or the disclosure line turns the matching tests red). Drafted by an
  Ollama worker (nestd), the domain-keyword tag line and production step 8c written here.
- **2026-10-09** — **#197 merged (`b036b39d`) and #198 merged (`3a23e0e3`); both deployed to VPS4 at 18:23 PDT** (container
  started 2026-10-10T01:23:50Z, repo on the VPS at `3a23e0e3`). Predeploy: DNS ok, "Migrating database via DATABASE_URL",
  no pending migrations. `YT_VISUAL_MODE` on VPS4 is still `presentation`; the animated production below passed the mode
  explicitly. **#197:** `applyPronunciationFixes` says "tokens dot phi" for tokns.fi (owner picked take B of four voiced
  respellings; `eleven_v3` spelled the old "toe-kins dot fye" as the letters F-Y-E); `seo-optimizer.ts` keeps the script's
  title as written, has `parseDurationSec`, `chaptersFromBeats` + `withChapters`, `DISCLOSURE_LINE` near the top of the
  description for TX/tokns videos, "This is education, not financial advice." for crypto, no filler paragraph, no
  stopword/sentence tags; `production.ts` step 8c rewrites the description's chapters from measured beat times and updates
  `yt_seo_data`. **#198:** animated mode (new files `animated/{scenes.html,render.ts,assets/fonts}`, `animated-video.ts`
  with `buildAnimatedTimeline` + `renderAnimatedVideo`, `word-timings.ts` with `alignBeatWords` / `mapAlignedWords` /
  `estimateWords`, `server/scripts/yt-animated-demo.ts`); `verifySlideSync({mode:"animated"})`; `production.ts` mode
  `animated` with slide fallback on a render ERROR and `assets.visualMode`; the server build copies `scenes.html` + assets
  into `dist`. Read-only check of the deployed dist on the archived d95fef7d script: "we build tokens dot phi, so we
  gain"; title "What TX Staking Actually Is"; description with the promise line, the disclosure as its second paragraph and
  chapters 00:00 / 00:25 / 00:54 / 01:23 / 01:50 / 02:17; tags without "actually", "means", "does", "toknsfi". First
  animated production on VPS4: see Animated mode ("On VPS4"). **Finding:** the sync gate missed 3 of 41 planned changes
  on that video, all smooth fades (two section_title to content at 20.54 s and 48.64 s, one content to content at
  120.18 s); see Open items.

## Owner decisions, 2026-10-08

| Topic | Decision |
|---|---|
| Opening line | "This is Coherence Daddy." (forced by `sanitizeScript`) |
| Persona | "we" = Coherence Daddy, "you" = viewer, "I" only for a stated opinion — never an invented experience |
| Disclosure | TX/tokns videos: a short spoken line at normal speed near the start, the same words on screen, plus a description line (FTC: "in the video and not just in the description", "hard to miss"). Wording: "Quick honesty break: we run a TX validator and build tokns.fi, so we gain when you stake." |
| Mindset videos | Both honest "millionaire mindset" and anti-guru: healthy methods for mind, brain, body, people, coherence; no get-rich promises |
| Topic mix | 30% TX/tokns · 30% crypto news & education · 30% mindset · 10% our products (evntrace name-only until its video gate clears; cliqs.io and others need an owner-approved fact list first) |
| Cadence | 1 video/day while new-style videos are approved; scale toward 3–5/day only if retention/views hold (ElevenLabs quota caps ~4/day at today's plan) |
| Voice | Take D: `eleven_v3` "Creative" (#192) |
| Archive | Keep every script, timeline, slide, thumbnail and caption file; monthly review |
| Crypto news | From team-dashboard's own hourly news ingest (sources linked), not other channels' transcripts (YouTube ToS bans scraping; reused-content policy) |
| Repurposing | Approved videos also become tokns.fi articles (existing `tokns-app` blog target) and X threads (existing Twitter plugin / Zernio) |

## Open items

Evidence behind these items (2026-10-07): [channel measurements](youtube-channel-measurements-2026-10-07.md) ·
[metadata audit](youtube-metadata-audit-2026-10-07.md) (tags, thumbnails, chapters, analytics scope, builder spec B1–B8) ·
[script research](youtube-script-research-2026-10-07.md) (honesty, facts-from-code, format, topic engine, draft prompt).


- [x] **Animated scenes** — merged (#198, `3a23e0e3`), deployed and run once on VPS4 on 2026-10-09 (see Animated mode and the
  change log). Superseded text of this item (until 2026-10-09): "prototype on branch `feat/yt-animated-scenes` (not merged)";
  "Before production: the server build must copy `scenes.html` + `assets/` into `dist`; Chromium on VPS4; render time on VPS4;
  the sync gate's scene threshold vs smooth fades; short on-screen text per line". Status of those: build copy done; Chromium
  was already in the image; VPS4 render time measured (10.4 frames/s); script v2's short `onScreen` lines gave 0 layout
  warnings on two videos; the smooth-fade question is open (next item). Prototype history: first prototype `2a25862c`
  (`scenes.html` driven by one `seek(t)` clock via paused Web Animations, `render.ts` frame-stepper to ffmpeg; five
  templates from `coherencedaddy-landing/DESIGN.md` tokens, Geist fonts bundled, OFL); follow-along words with a coral
  underline (`24388b23`), counting numbers (`88ee67f4`), keyword-chosen icons (`cfd61d9d`). Measured 2026-10-07 on the
  real Mark-voice timeline: 7,707 frames = 256.90 s, all 27 sentence boundaries change the picture, 147 s wall time on
  the owner's Mac.
  The static slide template (fallback path) is still off-brand: `slide-templates.ts` uses the banned cyan `#00d4ff`,
  coral `#FF876D` (brand is `#FF6B4A`) and Inter (brand is Geist).
- [x] **Animated sync gate vs smooth fades** (found 2026-10-09; bar lowered to 75% the same evening, below) — the 3 unmatched changes on `d6d30d70` were gentle fades:
  ffmpeg's frame-to-frame scene score stays under 0.02 on a fade. With a 90% bar and about 4% misses per boundary (3 of
  69 over two videos) a good video would fail roughly 1 night in 30 (Poisson estimate from two samples only). Proposed
  fix: in animated mode compare a frame just before and just after each planned boundary instead of frame-to-frame scene
  scores; or lower the bar. *Done 2026-10-09:* the bar is 75%. A frame-pair check was measured first on `d6d30d70` and
  rejected: frames 0.9 s apart differ by 4.5–18.7 grey levels across a real boundary but up to 3.0 inside one beat
  (words lighting up), too thin a gap for a second test. Good videos scored 100% and 92.7%; the blank and shifted
  controls in `youtube-sync-gate-animated.test.ts` score 0 of 5 and 2 of 5.
- [x] **Owner decision: nightly mode** (decided 2026-10-09: animated is the default, see the Mode row) — make `YT_VISUAL_MODE=animated` the nightly default on VPS4, or keep slides. Today
  the cron makes slide videos. Weigh render time (about 8.5 min of wall time for a 3-minute video on 4 cores) and the gate item above.
- [ ] **Owner decision: gate failure in animated mode** — an animated video that renders but FAILS the sync gate fails the
  day (no slide fallback); only a render ERROR falls back. Decide whether a gate failure should fall back too.
- [x] **Do not approve `d95fef7d` as is** (removed from the queue 2026-10-09 19:01 PDT on the owner's word; row backed up in `/root/yt-queue-removed-2026-10-09-test-d95.log` on VPS4; its MP4 stays until the 30-day cleanup) — the first script-v2 test video (title "Powerful What Tx Staking Actually Is
  (2026)", `NaN:NaN` chapters in its stored description, made before #197) is still `pending_review` for 2026-10-10 14:00Z.
  Remove it, or fix the stored title/description first. (The animated `d6d30d70` is `pending_review` for 2026-10-11 14:00Z.)
- [ ] Icon keyword picks are crude on non-crypto scripts (e.g. coins on "reward" in a habits video).
- [ ] Tags still contain single topic words like "beats", "small", "stick".
- [ ] Forced-alignment cost per ElevenLabs call is unmeasured (42 calls on `d6d30d70`).
- [ ] `timeline_<id>.json` files in the videos folder are not purged by `yt:cleanup-videos`.
- [x] **Scripts and how the channel talks** — done in script v2 (#194, live 2026-10-08): see "How a script is made".
- [ ] **Metadata** — the custom thumbnail and the SRT are generated but never uploaded (publisher sends title,
  description, tags, category 28 only). Fixed 2026-10-09 (`fix/yt-seo-voice-2026-10-09`, merged as #197 `b036b39d`, live on VPS4): chapters now come from the
  measured beat times (step 8c, `chaptersFromBeats` + `withChapters`; until then script estimates, past the end on 14/14
  live videos and `NaN:NaN` on the first script-v2 video), the script's title is kept as written (no power word, year
  or keyword suffix), TX/tokns videos carry `DISCLOSURE_LINE` near the top of the description, and stopword/sentence
  /`toknsfi` tags are gone. Still open: thumbnail + SRT upload; `yt_analytics` has 0 rows because the OAuth token has only
  `youtube.upload` (daily 403, swallowed — the cron reports success). Owner step: re-consent with `youtube.readonly` +
  `yt-analytics.readonly`; meanwhile Zernio already holds views for 155 videos.
- [x] **Publishing cadence** — fixed local slots, 1/day by default (`YT_PUBLISH_PER_DAY` 1–5, #194). Scaling past
  1/day stays the owner's call once analytics work (YouTube's "inauthentic content" policy, renamed 2025-07-15,
  targets "mass-produced, generic, repetitive" videos). Rows queued before #194 keep the slot the old code
  proposed (e.g. 2026-10-14 14:00 UTC) unless it is changed at approval.
- [x] **Old-timing videos** — 5 were queued on 2026-10-07; removed 2026-10-09 on the owner's word (see change log).
- [ ] Exact in-beat captions from ElevenLabs `/with-timestamps` (captions are spread evenly inside each beat today).
- [ ] Mark's mastering chain (ZeroEdit `aggressive_post`) for a brand-VO sound.
- [ ] Content Hub snippets drive Mark's clone through `eleven_v3`, which the clone isn't fine-tuned for.
- [ ] Site-walker mode still overlays `TOKNS.FI` (`site-walker.ts`) and its narration has no evntrace line.
- [ ] `blog-slideshow-generator.ts` shares the slide builders, so its slide list now also has "In this video" slides.
