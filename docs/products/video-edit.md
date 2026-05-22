# Video Edit Pipeline

Sibling to the [YouTube production pipeline](./tutorials-hub.md). Where YouTube
**synthesizes** videos from a topic (script → TTS → slide screenshots → MP4),
the Video Edit pipeline **edits real footage** using
[browser-use/video-use](https://github.com/browser-use/video-use).

It does not replace the YouTube pipeline. It fills the gap: anything that
involves recorded camera footage, screen captures, or interview clips.

## Status — 2026-05-21

- Backend: ✅ shipped (table, service, routes)
- UI: ✅ shipped at `/video-edit`
- Engine integration: ⚠️ stub — `VIDEO_USE_BIN` not yet pointed at a real
  install. Jobs queue cleanly and the UI shows "Engine not configured" until
  the binary path is set.

## Architecture

```
┌──────────────────────────┐         ┌──────────────────────────┐
│  UI  /video-edit         │         │  team-dashboard server    │
│  - new-job form          │ ──POST→ │  /api/video-edit/jobs    │
│  - status polling        │         │  inserts video_edit_jobs  │
└──────────────────────────┘         └──────────────────────────┘
                                                │
                                                │ processNextVideoEditJob(db)
                                                ▼
                                     ┌──────────────────────────┐
                                     │  video-use subprocess     │
                                     │  (Python, FFmpeg,         │
                                     │   ElevenLabs Scribe)      │
                                     └──────────────────────────┘
                                                │
                                                ▼
                          <inputDir>/edit/final.mp4
```

### Database

Single table — `video_edit_jobs` (migration `0117_video_edit_jobs.sql`).
Columns: `id`, `company_id`, `engine` ('video-use'), `status`
(`pending|running|ready|failed|canceled`), `input_dir`, `edit_brief`,
`options` (JSONB: aspect, color grade, burn captions, target duration),
`output_path`, `duration_sec`, `file_size_bytes`, `error`, plus the usual
timestamps.

### Service

`server/src/services/video-edit/`:
- `engine.ts` — exec the `video-use` binary, watch for
  `<inputDir>/edit/final.mp4`, return duration + size
- `queue.ts` — `processNextVideoEditJob(db)`. Single-runner discipline — if
  any job is `running`, the queue refuses to start another. Video editing is
  CPU/RAM heavy and sometimes hours long.

### Routes (under `/api/video-edit`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/config` | Engine + path status |
| GET | `/jobs` | List recent jobs (last 50) |
| GET | `/jobs/:id` | Job detail |
| POST | `/jobs` | Create a job (body: `inputDir`, `editBrief`, `options`) |
| POST | `/jobs/:id/run` | Kick the queue (picks oldest pending) |
| POST | `/jobs/:id/cancel` | Cancel a pending job |

## Configuration

Required env vars (server):

| Var | Purpose |
|---|---|
| `VIDEO_USE_BIN` | Absolute path to the `video-use` entry script |
| `VIDEO_EDIT_DATA_DIR` | Base dir for raw-input folders (default `/paperclip/video-edit`) |
| `ELEVENLABS_API_KEY` | Required by video-use for Scribe word-level transcription |

## Installing video-use on the server

```bash
# On VPS4 (where team-dashboard runs)
cd /opt
git clone https://github.com/browser-use/video-use.git
cd video-use
# Follow upstream install instructions (Python venv + FFmpeg + deps)

# Then in /etc/team-dashboard.env (or wherever env lives):
VIDEO_USE_BIN=/opt/video-use/bin/video-use
VIDEO_EDIT_DATA_DIR=/paperclip/video-edit
ELEVENLABS_API_KEY=<key>
```

The dashboard exec contract: the binary is called as

```
$VIDEO_USE_BIN \
  --input <inputDir> \
  --brief <JSON-encoded brief string> \
  --options <JSON-encoded options object> \
  --job-id <uuid>
```

…and must write `<inputDir>/edit/final.mp4` on success. If upstream's CLI
flags differ when we actually wire it up, the binary path can point at a
small wrapper script that adapts to whatever the real arguments are.

## Automation TODO list

Open ideas — not commitments. Pick from here when this lands and starts
getting used.

### Tier 1 — natural follow-ups once the engine runs

- [ ] **Watch-folder cron**: cron that scans `VIDEO_EDIT_DATA_DIR/inbox/` every
  5 min; any new subdirectory with raw clips + a `brief.txt` auto-enqueues a
  job. Lets you "edit a video" by sftp/rsync-ing files to the server.
- [ ] **Output → blob storage**: on `ready`, upload the final.mp4 to S3 /
  Backblaze and stash the URL in the job row. Stops the VPS disk from
  filling with rendered videos.
- [ ] **Job cleanup cron**: prune `ready` jobs older than 30 days
  (similar to the existing yt-productions purge). Configurable retention.
- [ ] **Brief templates**: a `brief_templates` table with named presets
  (`"shorts-from-talk"`, `"explainer-tight"`, `"podcast-clip"`). New-job
  form gets a dropdown that pre-fills the brief.

### Tier 2 — bridges to existing pipelines

- [ ] **Auto-shorts from YouTube production**: after `yt_productions.status =
  ready`, trigger an edit job over the synth video to extract 30–60s vertical
  Shorts. Closes the wishlist item from the 2026-04-27 council transcript
  without writing the clipping logic ourselves.
- [ ] **Podcast → social clips**: cron that scans a podcast RSS, downloads
  new episodes, transcribes, and queues N edit jobs each instructed to find a
  highlight moment. Pipes the outputs into the existing socials hub for
  scheduling.
- [ ] **Launch-week kit generator**: given a launch event, queue 5 edit jobs
  in parallel (one per platform: long YT, Shorts, X video, IG Reel, LinkedIn
  square). Different briefs, same source footage.
- [ ] **Watchtower B-roll**: when Watchtower flags a competitor making
  noise, queue an edit job to clip the relevant moment from their public
  videos for our reaction content.

### Tier 3 — agentic / cross-system

- [ ] **Agent-driven brief generation**: an Ollama job that watches the
  inbox watch-folder; for each new raw footage drop, reads the first 30s of
  audio (via Scribe), classifies the content type, and writes the brief
  itself. Human approves before the edit runs.
- [ ] **Quality-eval re-runs**: after `ready`, run an LLM eval over the
  final.mp4's burned-in captions + duration vs. target. If the edit
  overshoots, auto-queue a tightened-up re-edit with `targetDurationSec`
  reduced.
- [ ] **Knowledge-graph linking**: write each finished edit into
  `agent_memory` as a `produced` triple linked to the source raw-footage drop
  and the publish destination, so the recall agent can answer "which video
  came out of the May 21 walkthrough recording."

## Operations runbook

> The queue advances on its own via the `ve:drain-queue` cron (every 1 min).
> Manual ops below are for break-fix and inspection, not normal flow.

### Quick health check

```bash
curl -fsS https://api.coherencedaddy.com/api/video-edit/config | jq
```

Look for `engineConfigured: true`, `pipelineEnabled: true`, sensible `queue.*`
counts, and a non-null `freeDiskBytes` greater than ~20 GB. `recentFailures[]`
should normally be empty.

### "The queue is stuck on a `running` job that's dead"

`ve:reap-stuck` runs every 15 min and resets any `running` job whose
`startedAt` exceeded 2 hours. If you need to clear one immediately:

```bash
# On VPS4 (root@31.220.61.14)
DB=$(grep "^DATABASE_URL=" /opt/team-dashboard/.env.production | cut -d= -f2-)
psql "$DB" -c "UPDATE video_edit_jobs SET status='failed', error='manual reap',
  completed_at=now(), updated_at=now() WHERE id='<job-uuid>' AND status='running';"
```

The next `ve:drain-queue` tick will pick up the next pending row.

### "Rerun a failed job"

There's no built-in re-queue. Either insert a new job via `POST
/api/video-edit/jobs` (recommended — captures any brief changes) or flip the
row directly:

```sql
UPDATE video_edit_jobs
SET status='pending', error=NULL, started_at=NULL, completed_at=NULL,
    output_path=NULL, files_purged_at=NULL, updated_at=now()
WHERE id='<job-uuid>';
```

### "Purge a specific job's MP4 now"

`ve:cleanup-outputs` runs daily at 02:00 with a 30-day retention. For an
out-of-band purge:

```bash
# On VPS4
rm -f /paperclip/video-edit/raw/<job-dir>/edit/final.mp4
# Then mark it in the DB:
psql "$DB" -c "UPDATE video_edit_jobs SET files_purged_at=now(), updated_at=now() WHERE id='<job-uuid>';"
```

### "Pause the entire pipeline"

Set `VIDEO_EDIT_ENABLED=false` in `/opt/team-dashboard/.env.production` and
`docker compose up -d` to restart. All three crons go dormant; engine
refuses to run; queued jobs sit untouched until you flip back. The UI shows
"Engine not configured" until then.

### "Disk pressure on `/paperclip` is climbing"

```bash
ssh root@31.220.61.14 'du -sh /paperclip/video-edit/* | sort -h | tail -10'
```

Either trigger the cleanup manually (`docker exec team-dashboard-server-1
node -e "require('./server/dist/services/video-edit/ve-crons.js').cleanupOldOutputs(db)"`
— or wait for 02:00 UTC), or temporarily drop the retention window in
`server/src/services/video-edit/ve-crons.ts` and redeploy.

### "Kill an in-flight subprocess"

```bash
ssh root@31.220.61.14 'docker exec team-dashboard-server-1 pkill -f "/opt/video-use/bin/video-use" || true'
```

Then mark the job failed per the "stuck job" recipe above. The next
`ve:drain-queue` tick resumes normal flow.

### What the crons actually do

| Cron | Schedule | Purpose | Source |
|---|---|---|---|
| `ve:drain-queue` | every 1m | Picks oldest pending job, dispatches to engine | `server/src/services/video-edit/ve-crons.ts` |
| `ve:reap-stuck` | every 15m | Resets `running` jobs older than 2hr to `failed` | same |
| `ve:cleanup-outputs` | daily 02:00 | Deletes `final.mp4` for `ready` jobs > 30 days, sets `files_purged_at` | same |

## Cross-references

- The YouTube synth pipeline (sibling, not replaced):
  `server/src/services/youtube/`
- The earlier patch that stole **word-level captions + cut-boundary fades +
  self-eval** from video-use into the synth pipeline:
  `server/src/services/youtube/yt-video-assembler.ts:generateChunkedCaptions`,
  `server/src/services/youtube/yt-video-assembler.ts:validateCaptions`,
  `server/src/services/youtube/tts.ts:applyEdgeFades`.
- Upstream tool: <https://github.com/browser-use/video-use>
