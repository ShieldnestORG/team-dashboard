# YouTube pipeline — animated mode goes live (2026-10-09)

> **Cluster:** YouTube pipeline · **Tags:** youtube, animated, vps4, deploy, owner-feedback, run-log · **Related:** [YouTube pipeline (canonical)](../products/youtube-pipeline.md), [VPS cheat sheet](../deploy/vps-cheat-sheet.md)

What happened on 2026-10-09 (owner-local, PDT), written down the same evening because the run log lived only in
the container's `/tmp` (a tmpfs, lost when the container was recreated at 19:02) and the owner's feedback lived
only in chat. The canonical description of the pipeline is `docs/products/youtube-pipeline.md`; this file is the
record of the day.

## Timeline (measured)

| PDT | What |
|---|---|
| ~15:55 | Owner: "remove any old videos from cue". 4 unpublished rows removed (2 scheduled, 2 pending_review); backup `/root/yt-queue-removed-2026-10-09.json` on VPS4. |
| 16:03 | First full script-v2 video by hand (production `d95fef7d`, slides): 240 s, gate 28/28. It exposed the SEO bugs (`NaN:NaN` chapters, "Powerful … (2026)" title, no disclosure line, junk tags). |
| 17:19–18:16 | PRs #197 (pronunciation + metadata) and #198 (animated mode, icon tiles, quote fix) built, tested and merged. |
| 18:23 | **Deploy to VPS4**: repo at `3a23e0e3`, container started 2026-10-10T01:23:50Z. Predeploy: DNS ok, "Migrating database via DATABASE_URL", no pending migrations. |
| 18:24–18:35 | **First animated production on VPS4** (`d6d30d70`), mode passed explicitly. Log below. |
| 19:01 | Owner: "make animated the default and remove the old test". Test row `d95fef7d` removed from the queue (backup `/root/yt-queue-removed-2026-10-09-test-d95.log`). |
| 19:02 | `YT_VISUAL_MODE=animated` in `/opt/team-dashboard/.env.production` (backup `.env.production.bak-yt-animated-1791597734`), applied with `docker compose up -d`; container started 2026-10-10T02:02:24Z, value read back inside it; "YouTube pipeline crons registered (6 jobs)". |

## Run log of the first animated production on VPS4 (`d6d30d70`, times UTC)

Copied from the container before it was recreated (per-chunk TTS lines and per-frame progress lines left out):

```
[01:24:36] INFO: YT Pipeline: generating content strategy...
[01:24:37] INFO: Content strategy generated {"topic":"discipline beats motivation: small habits that stick","pillar":"motivation","contentType":"Explainer","recentTitles":30,"sources":0,"insightsAvailable":0}
[01:24:38] INFO: YT Pipeline: generating script... {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9"}
[01:24:55] INFO: YouTube script generated {"title":"Discipline Over Motivation: Small Habits That Stick","attempts":3}
[01:24:56] INFO: YT Pipeline: optimizing SEO... {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9"}
[01:24:56] INFO: SEO optimization complete {"title":"Discipline Over Motivation: Small Habits That Stick","seoScore":50,"tagCount":16}
[01:24:56] INFO: YT Pipeline: generating thumbnail... {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9"}
[01:25:03] INFO: Thumbnail generated via visual backend {"backend":"grok"}
[01:26:15] INFO: YT Pipeline: rendering animated video... {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","beats":42}
[01:26:18] INFO: animated: word timings: 42 beats aligned, 0 estimated {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9"}
[01:26:19] INFO: animated: 20 scenes, 1164 animations, 0 counting numbers, 0 caption cues; rendering 5311 frames (0s to 177.040s at 30 fps) {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9"}
[01:34:46] INFO: YT Pipeline: animated video rendered {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","wallSec":510.81462866800007,"aligned":42,"estimated":0,"warnings":[]}
[01:34:46] INFO: Caption alignment OK {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","ok":true,"srtEndSec":177.039,"audioDurationSec":177.04,"driftSec":-0.0010000000000047748,"entries":84,"issues":[]}
RESULT {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","status":"ready","title":"Discipline Over Motivation: Small Habits That Stick","video":{"path":"/paperclip/youtube/videos/video_d6d30d70-2ba7-4187-ba81-f76ea832aae9.mp4"},"secs":619}
[01:34:55] INFO: Slide sync gate passed {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","ok":true,"issues":[],"expectedCount":41,"detectedCount":64,"matchedCount":38,"medianOffsetSec":0.10666699999999452,"maxOffsetSec":0.233333000000016}
[01:34:55] INFO: Video queued for owner review {"productionId":"d6d30d70-2ba7-4187-ba81-f76ea832aae9","publishTime":"2026-10-11T14:00:00.000Z","awaitingReview":true}
```

Checked afterwards from outside the pipeline: video stream 177.033 s vs audio 177.029 s (ffprobe on the
downloaded file); `yt_productions.assets.visualMode = animated`, 0 slide assets; `yt_seo_data` title as the script
wrote it and 7 chapters at measured times (00:00, 00:18, 00:47, 01:15, 01:43, 02:07, 02:33); queue row
`pending_review` for 2026-10-11 14:00Z. The 3 unmatched beat changes were gentle fades (two section_title→content
at 20.54 s and 48.64 s, one content→content at 120.18 s).

## Owner feedback on the videos, in the owner's words

- On the first animated preview (no word timings were fed to it, so it showed caption pills under the slide text):
  "still saying tokns.f,y,e spelling out we fixed all things but maybe they arent live on vps yet? def better on the
  mac but it still isnt the word by word light up and expand feature built last night because right now its like
  having double captions. def like second video better so far."
- On a frame of the word-by-word version (two icons drawn on top of each other, far from the sentence): "all will
  need to verified flow on vps where all runs; sayb; the symbols can also be better placed and stylized better".
  ("sayb" was read as take B of the four voiced respellings: "tokens dot phi".)
- "let me see a new video done so can determine any other fixes"
- On the Mac preview that reused the afternoon's voice track: "this vide stilll says .fye (eef y ee)" — expected for
  that file; the live code now sends "tokens dot phi" (clip recorded through the deployed code and sent to the owner).
- "make animated the default and remove the old test"
- "WHERE TO SEE VIDEO , QUE THe tower to run git tests there" → the video is in the dashboard
  (`https://api.coherencedaddy.com/socials/youtube`, queue card; `/youtube/videos` to watch or download); the tower
  request is ticket DEV-112 (the tower's merge-check service serves MDB_3.0 only today).

**Not yet heard from the owner:** whether "tokens dot phi" SOUNDS right; a verdict on the first VPS-made animated
video (`d6d30d70`, "Discipline Over Motivation: Small Habits That Stick"); whether an animated video that fails the
sync gate should fall back to slides.

## Next steps

1. Merge and deploy #200 (animated gate bar 0.9 → 0.75) before the 23:00 PDT nightly run; never deploy between
   23:00 and the end of that run.
2. Read the nightly run's result the next morning: `assets.visualMode`, the gate line, the queue row. It is the
   first cron-started animated video.
3. Owner: approve or reject `d6d30d70` in the dashboard; say whether "phi" is right.
4. Open items in the canonical doc: icon picks on non-crypto scripts, single-word tags, forced-alignment cost,
   `timeline_<id>.json` purge, thumbnail + SRT upload, analytics scopes.
5. DEV-112: team-dashboard's PR checks on the office tower.

Note for whoever reads PRs here: Vercel's pull-request comments were switched off on all ShieldNESTorg projects on
2026-10-09 (~17:25 PDT, owner request, relayed by the OR3 session), so a PR with no vercel[bot] comment is expected;
deployments still post a status.
