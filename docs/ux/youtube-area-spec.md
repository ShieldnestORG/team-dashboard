# YouTube area — UX spec (one place to review, schedule and look back)

> **Cluster:** UX · **Tags:** youtube, review, approval, queue, library, ux-spec · **Related:** [YouTube pipeline](../products/youtube-pipeline.md), [Design system (draft)](design-system.md)

**Status:** proposal, written 2026-10-09 (owner-local date). This document changes no code and deletes nothing.

**In plain words:** today the YouTube work is split over two pages that do not link to each other, and neither
page can play a video. This spec replaces both with **one YouTube area with four tabs: Review, Scheduled, Posted,
Files & settings**. Review opens first. It shows the new video with a player, the exact words that will go public,
and one **Approve** button.

**Trigger (owner, 2026-10-09):** "page doesnt show video, and the two areas are confusing and when i scroll on pages
it shifts left and right" and "we can clean up and delete old videos and otehr things not needed". This spec is the
"two areas are confusing" part. **Not in this spec:** the stopgap inline player and the sideways-scroll fix (the
orchestrator, same evening), the dashboard-wide revamp, the design-system doc itself, deleting anything, deploy.

**How to read the citations.** `P:` = `ui/src/pages/YouTubePipeline.tsx`, `V:` = `ui/src/pages/YouTubeVideos.tsx`,
`R:` = `server/src/routes/youtube.ts`. Other files are cited by full path the first time and by file name after
that; a bare `:95` continues the file named just before it. All line numbers are from `origin/master` at
`dc8beabc`.

**How sure each statement is.** Everything said about today's screens comes from **reading the cited lines**.
Nothing here was checked by clicking through the running dashboard, and the live server was not queried.
**INFERRED** marks a conclusion about how something behaves when running, or a number taken from a dated doc, that
the cited lines imply and that nobody watched happen for this spec. **UNVERIFIED** = could not be checked at all
from this worktree. **ASSUMED** = taken from the brief. The UX laws named in square brackets are the owner's list
(`ux-laws` skill), so each choice has a stated reason.

---

## 1. Who the user is

**The owner.** Not a programmer. Works on a Mac in a desktop browser (ASSUMED from the brief; phone use is not
ruled out, so the narrow layout is specified too). He comes here about once a day because one new video is made
every night (`server/src/services/youtube/yt-crons.ts:29-39`, schedule `0 6 * * *` UTC, which is 11 PM Pacific in
summer: `docs/products/youtube-pipeline.md:5`). Some days there are a few videos waiting.

What he wants to do, in his order:

1. **Watch** the new video.
2. **Read what will go public**: the title, the description with its chapter list, the tags.
3. **Decide**: approve it for the suggested time, change the time, or remove it.
4. Now and then, **look back** at what already posted.

What he does **not** want to see every day:

- Names of the voice and picture services ("TTS Providers", "Visual Backends": `P:400-436`).
- File names such as `video_d6d30d70-….mp4` (`V:199`) and sizes in bytes (`V:200`).
- Internal status codes printed as-is, such as `pending_review` (`P:54` prints the raw value).
- Words from the build side: "Pipeline", "Productions", "Queue item", "Assets", "VPS" (`P:472`, `P:479`, `V:108`).
- Counters nobody acts on ("Total Productions": `P:479-480`).

Others who may open the area: an agent or developer checking a failed night. Their needs go behind **Advanced**
and never shape the daily view. [Pareto: the daily 20% gets the default tab; Tesler: we absorb the complexity.]

---

## 2. Jobs to be done (ranked), today's path, and what is broken

| # | Job | Today's path | What is broken or confusing (evidence) |
|---|---|---|---|
| 1 | Watch the new video before it goes public | Open `/socials/youtube` → click the **Queue** tab → the card has no player → type `/youtube/videos` by hand → **Download** → open the file from the Downloads folder | Neither page contains a `<video>` element (grep of both files: none). The only way to see a video is a download sent as an attachment with no seeking support (`R:381-387`). No screen links to `/youtube/videos`: outside the API client, the path appears in `ui/src` only in the route table (`ui/src/App.tsx:306`). The canonical doc says that page is for "watch/download" (`docs/products/youtube-pipeline.md:20`); it can only download (`V:230-235`). |
| 2 | Check the words that will go public | Queue tab → the card shows the title on one line | Only the title is shown, cut off with `truncate` (`P:164`). The description and tags are already sent to the browser inside each queue row's `metadata` (`server/src/services/youtube/production.ts:385-392`, returned whole by `R:84-90`), and are not rendered anywhere. |
| 3 | Approve it for the suggested time | Queue tab → **Approve & schedule** → a date box opens → click a small tick button with no label | Three clicks, and the button named "Approve & schedule" does not approve: it opens an editor (`P:227-241`). The real approve is an icon-only button (`P:208-221`). The only button in the main colour is **Publish Now** (`P:187-198`), which uploads to YouTube as **public** at once (`server/src/services/platform-publishers/youtube.ts:59`) with no question asked. The safest action is the hardest to find; the one that cannot be undone is the easiest to hit. [Von Restorff, Fitts] |
| 4 | Change when it posts | Same date box | Works, and it is pre-filled in local time (`P:231-235`). Nothing stops a time in the past; the server accepts any valid date (`R:112-115`), and the posting job runs every 15 minutes (`yt-crons.ts:44`), so a past time means "posts within 15 minutes" without saying so. |
| 5 | Remove a video I do not want | Queue tab → red bin icon with no label → browser pop-up "Remove this video from the queue?" (`P:244-252`, text at `P:248`) | The pop-up does not say what happens next. In fact the queue row is deleted for good (`R:139-153`), the video file stays on the server for up to 30 days (`server/src/services/youtube/video-cleanup.ts:22`), and on the files page that video then loses its title and shows as "Video d6d30d70" (`R:325`). |
| 6 | See what is coming up | Same Queue tab | Videos waiting for approval, scheduled, posted and failed are one mixed list of the 50 most recently **made**, not ordered by posting time (`R:88-89`). The "Queue" number at the top counts only `scheduled` (`P:492`, `R:248`); videos waiting for the owner are counted nowhere. |
| 7 | Look back at what posted | Queue tab, scroll | A posted video shows its raw web address as the link text (`P:165-173`). The date it posted is stored (`packages/db/src/schema/youtube_pipeline.ts:143`) and not shown. History stops at 50 rows (`R:89`). |
| 8 | Know when something went wrong | Pipeline tab (a failed night) or Queue tab (a failed upload) | A night that failed is one row made of a length, a style word, an age and the word "failed" (`P:112-119`): no title, no reason, although the reason is in the same response (`error` column, `youtube_pipeline.ts:109`, sent by `R:47-53`). A failed upload shows a red badge next to the words "Scheduled: <time>" with no reason and no buttons (`P:156`, `P:175-178`, `P:185`). Neither page handles a failed click: no error handler and no error text exist in either file (grep for `onError`, `isError`: none). |
| 9 | Make an extra video now | Pipeline tab → optional topic → **Run Pipeline** (`P:83-99`) | The request stays open for the whole job (`R:66-67` awaits it; measured runs took 240 s and 619 s: `docs/products/youtube-pipeline.md:76`, `:203`). The button spins for minutes with no progress. Whether the browser or the proxy gives up first is UNVERIFIED. |
| 10 | Tidy up old files | `/youtube/videos` | The subtitle says "download or manage" (`V:108`); the only action is Download (`V:230-235`). There is no way to remove a file. |
| 11 | Check the set-up is healthy (rare) | Config tab (`P:361-439`) | Fine for a developer. It sits at the same level as the daily work. |

**Why "the two areas are confusing", in evidence:**

- **Two names, two addresses, two shells for one thing.** "YouTube Pipeline" at `/socials/youtube` sits inside the
  Socials hub, under its heading and its ten tabs (`ui/src/pages/socials/SocialsContentLayout.tsx:39-50`,
  `:99-108`), then adds its own heading and four more tabs (`P:470-473`, `P:504-522`). "Video Files" at
  `/youtube/videos` stands alone with a different heading size (`V:106` against `P:472`). `/youtube` itself
  redirects into the other tree (`ui/src/App.tsx:305`). [Jakob, Hick: 14 tabs on one screen]
- **No link in either direction** (see job 1). The breadcrumb on the files page leads back (`V:73`); nothing leads
  forward. The left menu has no YouTube item at all (`ui/src/config/company-sidebars.tsx:125-131`).
- **The first tab is not the daily job.** The page opens on "Pipeline" (`P:457`). The tab is kept in memory, not in
  the address, so a link cannot open the Queue and a refresh goes back to Pipeline. The link the owner was sent
  (`docs/handoffs/2026-10-09-youtube-animated-live.md:64-66`) therefore landed one click away from the video card.
- **Eight number tiles, same words, different numbers.** "Published" on page one counts database rows (`P:486`,
  `R:238`); "Published" on page two counts files still on disk (`V:97`), which drops as files are purged. The page-two
  "Published" and "Queued" tiles are also computed from the *searched* list (`V:84-98`), so they change while typing
  in the search box.
- **Two colour codes for the same status.** Page one: published is blue, scheduled purple, ready green
  (`P:43-51`). Page two: published is green, scheduled yellow, ready blue (`V:47-54`). [Law of similarity]
- **Two badges, sometimes three, per video** on page two: the build status, the style, and the posting status
  (`V:208-218`). The style badge shows the style that was *asked for* (`R:327`), so a night that fell back to slides
  still reads "animated" (the true value is in `assets.visualMode`: `production.ts:295`).
- **Three words for one video**: a "production", a "queue item" and a "video file".

---

## 3. Content inventory (every element on both pages today)

Verdicts: **KEEP** (stays, wording may change) · **MOVE** (to another view) · **MERGE** (folds into one shared
element) · **HIDE-BEHIND-"Advanced"** · **REMOVE**.

### Page one — `/socials/youtube` ("YouTube Pipeline")

| # | Element (where) | What it shows | Who needs it, how often | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | Socials hub wrapper: heading "Socials & Content" + 10 tabs (`SocialsContentLayout.tsx:99-108`) | The parent hub around the page | Nobody, for this job | MOVE | YouTube becomes its own area; the hub's "YouTube" tab becomes a way in (section 4). |
| 2 | Heading "YouTube Pipeline" + red icon (`P:470-473`) | Page name | Owner, daily | MERGE | One heading "YouTube" for the whole area. |
| 3 | Breadcrumb "YouTube Pipeline" (`P:455`) | Where am I | Owner, daily | MERGE | One breadcrumb "YouTube". |
| 4 | Tile "Total Productions" (`P:477-482`) | Lifetime count of videos made | Nobody | REMOVE | No decision hangs on it. |
| 5 | Tile "Published" (`P:483-488`) | Count of posted videos | Owner, rarely | MERGE | The Posted tab is the answer; no tile. |
| 6 | Tile "Queue" (`P:489-494`) | Count of scheduled videos only | Owner, daily | MERGE | Becomes the number on the Scheduled tab. |
| 7 | Tile "Failed" (`P:495-500`) | Count of nights that failed | Owner when it happens; developer | MOVE | A recent failure becomes a "Needs attention" card in Review; the full list goes under Advanced. |
| 8 | Hand-built tab bar (`P:504-522`) | Pipeline, Queue, Analytics, Config | Owner, daily | MERGE | Replaced by the area's four tabs (`Tabs` + `PageTabBar`), kept in the address. |
| 9 | Tab "Pipeline" (`P:444`) | List of runs | Developer, rarely | HIDE-BEHIND-"Advanced" | Build detail, not a daily job. |
| 10 | Tab "Queue" (`P:445`) | Waiting, scheduled, posted and failed, mixed | Owner, daily | MOVE | Split into Review, Scheduled and Posted. |
| 11 | Tab "Analytics" (`P:446`) | Views and tips | Owner, weekly, once it works | REMOVE | The table behind it has 0 rows (`docs/products/youtube-pipeline.md:306-308`), so the tab is always empty. Returns as a "Views" column in Posted (row 25). |
| 12 | Tab "Config" (`P:447`) | Set-up read-out | Developer, rarely | HIDE-BEHIND-"Advanced" | Not a daily job. |
| 13 | "Custom topic (optional)" box (`P:83-88`) | Topic for an extra video | Owner, rarely | MOVE | To Files & settings, under "Make a video now". |
| 14 | Button "Run Pipeline" (`P:89-99`) | Starts an extra video | Owner, rarely | MOVE | Same place, renamed **Make a video now**. |
| 15 | Run rows: length, style, age, status (`P:107-123`) | One line per run, no title, no reason | Developer, when a night fails | HIDE-BEHIND-"Advanced" | Becomes "Videos that could not be made", with title and reason. |
| 16 | "Loading..." and "No productions yet…" (`P:102-105`) | Text-only states | — | REMOVE | Replaced by the designed states in section 5. |
| 17 | Card title (`P:164`) | The public title, cut to one line | Owner, daily | KEEP | Shown in full; it wraps, it is never cut in Review. |
| 18 | Web address of a posted video as the link text (`P:165-173`) | The YouTube link | Owner, sometimes | MOVE | To Posted, as a button **Watch on YouTube**. |
| 19 | "Awaiting approval — proposed:" / "Scheduled:" + time (`P:175-178`) | When it will post | Owner, daily | KEEP | Reworded "Posts Sun, Oct 11 · 7:00 AM PDT". |
| 20 | Status badge, raw code (`P:181`, map `P:43-51`) | `pending_review`, `scheduled`… | Owner, daily | MERGE | One shared label-and-colour table for the whole area (section 4). |
| 21 | Button "Publish Now" (`P:187-198`) | Uploads at once, public | Owner, rarely | KEEP | Renamed **Post now**, no longer the main button, always asks first. |
| 22 | "Approve & schedule" / "Reschedule" + date box + tick + cross (`P:200-242`) | Approve or move the time | Owner, daily | KEEP | Split into a one-click **Approve** and a **Change time**. |
| 23 | Red bin icon + browser pop-up (`P:244-252`) | Remove from the queue | Owner, sometimes | KEEP | Labelled **Remove**, with a real dialog that says what happens to the file. |
| 24 | "Loading..." and "Publish queue is empty…" (`P:271-274`) | Text-only states | — | REMOVE | Replaced by the designed states in section 5. |
| 25 | Per-video views, likes, comments, grade, score (`P:336-354`) | Performance | Owner, weekly, once it works | MOVE | Later: a "Views" column in Posted. Grade and score are dropped. |
| 26 | Button "Collect Analytics" (`P:306-311`) | Fetches numbers now | Nobody | REMOVE | A daily job already does this (`yt-crons.ts:54-63`); today it gets nothing back (`youtube-pipeline.md:306-308`). |
| 27 | Card "Optimization Insights" (`P:313-328`) | Written tips | Nobody yet | REMOVE | With no numbers the server returns one stock sentence telling the owner to publish videos first (`server/src/services/youtube/analytics.ts:306`), while 152 are posted (`youtube-pipeline.md:199`). INFERRED. |
| 28 | "No analytics data yet." (`P:332-333`) | Empty text | — | REMOVE | Goes with the tab. |
| 29 | Card "Pipeline Configuration": enabled, style, YouTube connection (`P:372-398`) | Set-up read-out | Developer; owner only when broken | HIDE-BEHIND-"Advanced" | Shown in plain words under Advanced. A broken YouTube connection also raises a warning in Review. |
| 30 | Card "TTS Providers" (`P:400-416`) | Which voice services have keys | Developer | HIDE-BEHIND-"Advanced" | Not an owner decision. |
| 31 | Card "Visual Backends" (`P:418-436`) | Which picture services are on | Developer | HIDE-BEHIND-"Advanced" | Not an owner decision. |

### Page two — `/youtube/videos` ("Video Files")

| # | Element (where) | What it shows | Who needs it, how often | Verdict | Reason |
|---|---|---|---|---|---|
| 32 | Heading "Video Files" + "Assembled videos on VPS — download or manage" (`V:105-110`) | Page name | Owner, rarely | MERGE | Becomes the "Files" part of Files & settings. |
| 33 | Breadcrumb "YouTube › Videos" (`V:72-75`) | Where am I | Owner | MERGE | One breadcrumb "YouTube". |
| 34 | Tile "Total Videos" (`V:114-126`) | Files on disk | Owner, rarely | MOVE | One summary line in Files: "30 video files · 144 MB" (the 2026-10-07 figures, section 9). |
| 35 | Tile "Disk Usage" (`V:127-139`) | Space used by the files | Owner, rarely | MOVE | Same summary line. |
| 36 | Tile "Published" (`V:140-152`) | Posted videos among the files shown | Nobody | REMOVE | Duplicates row 5 with a different number, and changes while searching. |
| 37 | Tile "Queued" (`V:153-165`) | Scheduled videos among the files shown | Nobody | REMOVE | Duplicates row 6. |
| 38 | Search box "by title, filename, or mode" (`V:169-177`) | Filter | Owner, rarely | MOVE | To Posted (search by title), the only list that grows long. [Miller] |
| 39 | Row icon (`V:193-195`) | Decoration | — | REMOVE | Replaced by the cover picture once it can be fetched. |
| 40 | Row title (`V:197`) | Video title | Owner | KEEP | In every list. |
| 41 | File name in code type (`V:199`) | `video_<id>.mp4` | Developer | HIDE-BEHIND-"Advanced" | Behind "Details" on a file row. |
| 42 | Size in bytes (`V:200`) | File size | Owner, only when tidying | MOVE | Files view only. |
| 43 | Made-on date (`V:201`) | When it was made | Owner | KEEP | Plus "Deletes itself on <date>" in Files. |
| 44 | Badge: build status (`V:208-210`) | `ready`, `published`, `failed`… | — | MERGE | One status per video (row 20). |
| 45 | Badge: style (`V:211-213`) | "Presentation", raw "animated" | Owner, when reviewing | MOVE | One plain line on the review card, "How it was made", from the true value. |
| 46 | Badge: posting status / "on YouTube" (`V:214-218`) | Second status | — | MERGE | One status per video (row 20). |
| 47 | Icon link to YouTube (`V:223-229`) | Opens the posted video | Owner | KEEP | Labelled **Watch on YouTube**. |
| 48 | Button "Download" (`V:230-235`) | Saves the file | Owner, rarely | MOVE | Files view, and the "More" menu on a card. |
| 49 | Files with no record ("orphans"; built at `R:335-356`) | A file named by its file name, status "unknown" | Owner, when tidying | MOVE | Own group at the bottom of Files: "Files we cannot match to a video". |
| 50 | Empty state (`V:180-184`) | "No videos yet…" | — | REMOVE | Replaced by the designed states. |
| 51 | Loading skeleton (`V:100`) | Grey placeholder | Everyone | KEEP | Kept as a pattern; shaped like each view so nothing jumps when data arrives. |

**Count (by script over the two tables):** 51 elements → KEEP 9 · MOVE 14 · MERGE 10 · HIDE-BEHIND-"Advanced" 7 ·
REMOVE 11. The 11 removed: rows 4, 11, 16, 24, 26, 27, 28, 36, 37, 39, 50.

---

## 4. Proposed structure: one YouTube area

### The four views

The first three tabs are the three steps in a video's life, left to right. [Goal-gradient, serial position]

| Tab | Address | One-line promise shown under the heading | What is in it |
|---|---|---|---|
| **Review** (opens first) | `/youtube/review` | "New videos wait here until you say yes." | Every video that needs the owner: waiting for approval (with a player), plus anything that went wrong. |
| **Scheduled** | `/youtube/scheduled` | "Approved videos, in the order they will post." | Approved videos, soonest first, grouped by day. Change time, Post now, Remove. |
| **Posted** | `/youtube/posted` | "What is on YouTube." | History, newest first, with **Watch on YouTube**. Search by title. Views later. |
| **Files & settings** | `/youtube/files` | "Video files on our server, making an extra video, and set-up." | File list with clean-up, "Make a video now", and a closed **Advanced** section. |

- The tab shows a number only when it calls for action or attention: `Review 1`, `Scheduled 2`. Posted and Files
  show none. These numbers replace all eight tiles. [Hick, Prägnanz]
- Chosen names against the alternatives: "Scheduled" and not "Schedule" or "Queue", because it is the same word as
  the status label and the word YouTube Studio uses [Jakob, similarity]. "Posted" and not "Published". "Files" and
  not "Library", "Assets" or "Productions".
- A video opens by link: `/youtube/review?video=<id>` scrolls to and highlights that video (or opens it from
  Scheduled or Posted). This is the link to hand the owner when a video is ready; today that link is sent by hand
  and can only point at the page (`docs/handoffs/2026-10-09-youtube-animated-live.md:64-66`).

### One route tree; old addresses redirect

| Address | Does |
|---|---|
| `/youtube` | Redirects to `/youtube/review` (today it redirects to `/socials/youtube`: `ui/src/App.tsx:305`). |
| `/youtube/review` · `/youtube/scheduled` · `/youtube/posted` · `/youtube/files` | The four views. |
| `/socials/youtube` (old) | Redirects to `/youtube/review`. |
| `/youtube/videos` (old) | Redirects to `/youtube/files`. |

`youtube` is already a known top-level route name (`ui/src/lib/company-routes.ts:51`), so no new root is added.

**Ways in** (owner decision 1):

- **Recommended:** a **YouTube** item in the left menu, in the "Content & Socials" group
  (`ui/src/config/company-sidebars.tsx:125-131`). Two clicks from anywhere to a playing video.
- The "YouTube" tab inside Socials & Content (`SocialsContentLayout.tsx:45`) stays as a second way in and goes to
  `/youtube/review`. The YouTube area then shows the breadcrumb "Socials & Content › YouTube" as the way back.
- The YouTube API is for board operators only (`R:34-40`). UNVERIFIED: whether a marketing-role user passes that
  check. If not, the menu item needs `adminOnly: true`, as Funnels has (`company-sidebars.tsx:127`, rule at `:66-71`).

### One video, one status, one label, one colour

Today a video has a build status and a posting status, shown with two colour codes (section 2). In the new area
each video shows **one** label. Colours come only from the shared map `statusBadge`
(`ui/src/lib/status-colors.ts:54-117`) through the existing `StatusBadge` component
(`ui/src/components/StatusBadge.tsx:4`, which already takes a `status` for the colour and a `label` for the words).

| What is true on the server | Label the owner sees | Colour key in `statusBadge` |
|---|---|---|
| Queue row `pending_review` | **Needs your OK** | `pending_review`: **NEW key** (amber, same classes as `pending_approval`, `status-colors.ts:79`). The shared map has no entry for it today, so `StatusBadge` would fall back to grey (`:119`). |
| Queue row `scheduled` | **Scheduled** | `scheduled` (`:95`, blue) |
| Queue row `publishing` | **Posting now** | `publishing` (`:96`, cyan) |
| Queue row `published` | **Posted** | `published` (`:98`, green) |
| Queue row `failed` | **Did not post** | `failed` (`:71`, red) |
| Queue row `paused` | **On hold** | `paused` (`:58`, orange). Nothing sets this status today (the only mention is `server/src/services/youtube/publish-queue.ts:19`); the label exists so it can never show as a raw code. |
| Run `processing`, no queue row yet | **Being made** | `running` (`:57`, cyan) |
| Run `failed`, no queue row | **Could not be made** | `failed` (`:71`, red) |
| Run finished, queue row removed | **Removed** | `archived` (`:63`, grey) |
| File with no record | **Unknown file** | `archived` (`:63`, grey) |

The label is always written out; colour is never the only signal. This table lives in one small file used by all
four views (NEW helper, for example `ui/src/lib/youtube-status.ts`); no view defines its own colours.

---

## 5. The review card, in detail

The most important screen in the area. One card per video that needs the owner. Newest first; usually one.

### 5.1 What is on it, in order

Reading order, which is also the order in the page for keyboard and screen-reader users:

| # | Part | Content | Where the data comes from today |
|---|---|---|---|
| 1 | **Player** | The video, 16:9, the browser's own controls, not auto-playing, sound on. Never wider than its column. | Needs a route that can stream with seeking (section 10, gap 1). The file is the one named in `metadata.videoPath` (`production.ts:388`). The real length comes from the player once it has loaded. |
| 2 | **Title** | The public title in full, wrapped, as a heading. If it is longer than 100 characters: "YouTube allows 100 characters. The end will be cut off." | `title` on the queue row. The server cuts at 100 when posting (`publish-queue.ts:89`, `platform-publishers/youtube.ts:53`). |
| 3 | **Description** | The text exactly as it will post, plain text with its line breaks, chapter list included. Long text shows the first lines and a **Show all** link. | `metadata.description` (`production.ts:391`), which already holds chapters at measured times (`production.ts:238-244`). When posting, the server adds a blank line and a line of `#hashtags` built from the tags (`platform-publishers/youtube.ts:54`). The card must show that last line too; until the server returns the finished text (gap 2) the tags row carries the note below. |
| 4 | **Tags** | Small chips that wrap. Note: "These are also added as #hashtags at the end of the description." More than 12: show 12 and "+N more". | `metadata.tags` (`production.ts:390`). Cleaned and capped at 30 when posting (`publish-queue.ts:71`, `platform-publishers/youtube.ts:55`). |
| 5 | **Cover picture** | The generated picture, small. Plain note: "This picture is not sent to YouTube yet. YouTube picks a frame from the video." | Made and saved (`production.ts:127-132`) and not uploaded (`docs/products/youtube-pipeline.md:301`). No route serves it (gap 3). |
| 6 | **How it was made** | One plain line: "Animated (words light up as they are spoken)" · "Slides" · "Slides (the animated version failed, so slides were used)" · "Website walk-through". | `assets.visualMode` on the run: `animated`, `presentation`, `presentation-fallback` (`production.ts:178`, `:295`). Not on the queue row (gap 2). |
| 7 | **When it posts** | "Posts **Sun, Oct 11 · 7:00 AM PDT** (in 2 days)". Weekday, date, time and time-zone letters, in the time zone of the owner's computer. | `publishTime` on the queue row. The suggested slot is the next free daily slot, 7 AM Pacific by default (`server/src/services/youtube/publish-slots.ts:19-21`). |
| 8 | **Actions** | See 5.2. | |

Not on the card: file name, file size, service names, the internal id, the raw status code.

### 5.2 Actions, in order of use

| Order | Button | Style | What it does | Today |
|---|---|---|---|---|
| 1 | **Approve** | The one main button on the card | One click. Keeps the suggested time and marks the video approved. | Needs three clicks (section 2, job 3). Same server call as today: the schedule route with the unchanged time (`R:106-137`). |
| 2 | **Change time** | Secondary | Opens a date-and-time box, already filled with the suggested time. **Approve for this time** saves it. Times in the past cannot be picked; the box says why. | `P:200-242`. Keep the local-time fill (`P:231-235`). |
| 3 | **Post now** | Secondary | Asks first (dialog below), then uploads. | `P:187-198`: main button, no question. |
| 4 | **Remove** | Plain red text, set apart from the others | Asks first (dialog below). | `P:244-252`: unlabelled bin, browser pop-up. |
| — | **More** menu | Small | **Download the file** · **Copy link to this video**. | Download is on the other page (`V:230-235`). |

**Helper text under Approve, one sentence:**
"Puts this video on YouTube, for everyone to see, on Sun, Oct 11 at 7:00 AM." The date and time are the live
values and change when the time is changed. [Occam: the default is pre-chosen; Von Restorff: one main button]

**If the suggested time has already passed** (the owner comes back days later): the main button becomes
**Pick a time** and the helper reads "The suggested time has passed. Pick a new time, or post it now." This removes
the silent "posts within 15 minutes" case. [Postel: prevent the error]

**After Approve** the card does not just vanish. It folds into one line: "Approved. Posts Sun, Oct 11 at
7:00 AM. · Change time · See it in Scheduled". If nothing else is waiting, the "all caught up" state follows.
[Peak-end]

**Dialog for Post now** (`AlertDialog`): title "Post this video now?" · text "It goes on YouTube right away and
everyone can see it. You cannot take it back from this dashboard." · buttons **Not now** / **Post now**.

**Dialog for Remove** (`AlertDialog`), saying what happens to the file:

- Title: "Remove this video?"
- Text: "It will not be posted. The video file stays on our server until **Nov 8** and then deletes itself. Until
  then you can find it under Files."
- Buttons: **Keep it** / **Remove**.
- The date is the day the video was made plus 30 days (`video-cleanup.ts:22`, `:47-59`).
- **Conflict, named.** The brief asks for a real confirm dialog. The owner's own design law 15 says a destructive
  action should get an undo, because confirms get clicked through. Chosen: **both**. The dialog stays, because it
  is the only place that tells the owner what happens to the file. The undo (**Put back**) is added as soon as the
  server can remove without erasing (gap 10); the dialog text then gains "You can put it back from Files until
  then." Today Remove erases the row (`R:139-153`), and the only way back is a hand-made backup file on the server
  (`docs/products/youtube-pipeline.md:198`).

### 5.3 States

Every state says what happened and what to do next. [Postel, second half]

| State | When | What the owner sees | Source / note |
|---|---|---|---|
| **Loading** | First load | A grey placeholder shaped like the card: a 16:9 block, three text lines, a button row. Same height as the real card, so nothing jumps. | `Skeleton`. Today: the word "Loading..." (`P:271-272`). |
| **Nothing to review** | No video needs the owner | "You are all caught up. The next video is made tonight at about 11:00 PM and shows up here about 10 minutes later." Below: "Next to post: <title> · Sat, Oct 10 · 7:00 AM" with a link to Scheduled, when there is one. | The next run time already exists: job `yt:daily-production`, field `nextRunAt` (`ui/src/api/system-crons.ts:3-17`, served by `server/src/routes/system-crons.ts:23-31`). "About 10 minutes" is from the two measured runs, 240 s and 619 s (`youtube-pipeline.md:76`, `:203`). |
| **Daily videos are off** | The nightly job is switched off | In place of the "next video" sentence: "Daily videos are switched off, so no new video will be made." | `enabled` on the same job, and `enabled` from the config route (`R:219`). |
| **Being made** | A run is in progress | A slim card: "Tonight's video is being made. This takes about 5 to 10 minutes." No buttons. It turns into the review card by itself. | `running` on the job (`ui/src/api/system-crons.ts:16`) or a run with status `processing` (`production.ts:77`). INFERRED: a run cut short by a restart may stay `processing`; after 30 minutes show the "could not be made" card with the reason "It stopped part-way." |
| **Video file is gone** | The file was deleted (30 days) or cannot be found | The player area becomes a grey 16:9 box: "The video file is no longer on our server. Files are deleted 30 days after a video is made." Approve and Post now are switched off with the reason "Cannot post: the file is gone." **Remove** stays. | `filesPurgedAt` on the run (`youtube_pipeline.ts:110`); a video still waiting after 30 days is purged too (`youtube-pipeline.md:149-150`). Posting a missing file fails (`publish-queue.ts:74-76`). The card needs a yes/no from the server (gap 2). |
| **Could not be made** | A night's run failed; there is no video to approve | Card under "Needs attention": "Last night's video could not be made." + one plain reason + **Make a new one** + a closed "Technical detail" line. Plain reasons: "The picture and the voice did not line up, so it was held back." · "The script did not pass our honesty and length checks." · "The pictures could not be made." · "Something went wrong while making it." | `error` on the run. Known texts: `sync gate: …` (`production.ts:277`), `script_validation: …` (`server/src/services/youtube/script-writer.ts:493`), "No visual assets or video assembly failed" (`production.ts:306`). The plain sentence should come from the server (gap 7). Shown until a newer video exists. |
| **Posting now** | Upload in progress | The card locks: "Posting to YouTube now…" with a spinner; all buttons off. Refreshes every 5 seconds. When done: "Posted. Watch on YouTube." If it is still posting after 15 minutes: "This is taking too long and may be stuck." + the technical detail. | Status `publishing` (`publish-queue.ts:81-84`). INFERRED: a failed **Post now** can leave the row stuck in `publishing`, because that path has no failure handling (`publish-queue.ts:128-141`; the scheduled path has it at `:43-55`). See gap 12. |
| **Did not post** | A scheduled upload failed | Card under "Needs attention": "This video did not post." + one plain reason ("YouTube is not connected." · "The video file is missing." · "YouTube refused it.") + **Remove**. **Try again** appears once the server offers a safe retry (gap 12). | `error` on the queue row (`publish-queue.ts:48-54`). Known texts: `publish-queue.ts:64`, `:75`, `:95`. Today such a row cannot be re-scheduled or re-posted, on purpose, to avoid a double upload (`R:116-118`, `R:130-132`). |
| **Approve did not work** | The click failed | A red line inside the card, under the buttons, not only a pop-up toast. If the video changed meanwhile (server answers 409: `R:130-132`): "This video was already posted or removed. Refresh to see where it is." + **Refresh**. Otherwise: "That did not save. Nothing was changed. Try again." + **Try again**. The buttons come back to life. | Today a failed click shows nothing (no error handling in `P:133-150`). |
| **YouTube is not connected** | The connection keys are missing | A warning strip at the top of Review: "YouTube is not connected, so approved videos cannot post." + link to Advanced. Shown only when broken. | `youtubeConfigured` (`R:223-227`). Today a tick or cross on the Config tab (`P:389-396`). |

---

## 6. User flow and journey

### The daily flow

1. The owner opens **YouTube** from the left menu, or follows a link he was sent. He lands on **Review**.
2. The newest video is at the top, with the label "Needs your OK". He presses play. *(click 1)*
3. While it plays, or after, he reads the title, the description with its chapters, and the tags, on the same screen.
4. He checks the line "Posts Sun, Oct 11 · 7:00 AM PDT".
5. He presses **Approve**. *(click 2)* The helper sentence under the button has already told him what that does.
6. The card folds into "Approved. Posts Sun, Oct 11 at 7:00 AM." The Scheduled tab's number goes up by one.
7. If another video is waiting it is next on the page. If not: "You are all caught up", with the time of the next video.
8. He leaves. The video posts by itself at its time and then appears under **Posted** with **Watch on YouTube**.

Side paths from step 4: **Change time** (pick, then "Approve for this time") · **Post now** (dialog, then it posts)
· **Remove** (dialog, then it is gone from Review and listed under Files).

### Journey

| Step | What he sees | What he thinks | What could go wrong | How the design answers |
|---|---|---|---|---|
| Arrives | Heading "YouTube", four tabs, Review open with a "1" | "There is one for me." | He lands somewhere else and cannot find it (today: the Pipeline tab, `P:457`). | Review is the default; the tab is in the address; a link can open the video itself. |
| Watches | A player at the top of the card | "Does it look and sound right?" | The video will not play or seek; the file is gone. | A streaming route with seeking; the "Video file is gone" state. |
| Reads | Title, description with chapters, tags, beside the player | "Is this what I want the world to read?" | He approves without seeing the description (today it is not shown at all). | The public text is on the card, in the form it will post. |
| Checks the time | "Posts Sun, Oct 11 · 7:00 AM PDT (in 2 days)" | "Is that when I want it?" | Wrong time zone; the time already passed. | The computer's time zone with its letters; the passed-time guard. |
| Decides | One main button, **Approve**, with a sentence under it | "One click and it is done." | He hits the wrong button and it goes public at once (today's "Publish Now", `P:187-198`). | Approve is the only main button; Post now and Remove both ask first. |
| Gets an answer | "Approved. Posts Sun, Oct 11 at 7:00 AM." | "Good, done." | The click fails without a word (today). | A red line in the card with a way forward. |
| Comes back later | Posted, newest first, **Watch on YouTube** | "Did it go out?" | It failed overnight and he never learns. | A failed upload comes back to Review under "Needs attention", and the Review number counts it. |

---

## 7. Layout spec

**Rules for every view in the area**

- **Nothing scrolls sideways.** No element is wider than its column. The page shell's content pane is set to
  scroll in both directions (`ui/src/components/Layout.tsx:453`), so one child that is too wide lets the whole page
  slide left and right (INFERRED from the class; not measured in a browser, and the fix for today's pages is the
  orchestrator's track).
- **Long text wraps or is cut with "…"**; it never pushes the layout. Titles wrap (cut to two lines in lists, never
  in Review). The description and "Technical detail" use wrapping that also breaks long unbroken strings (web
  addresses, ids). File names appear only behind "Details", wrapped. Every flex row that holds text can shrink.
- **No fixed width wider than the column.** The player is fluid: full column width, 16:9 kept by ratio, never a
  pixel width. Pictures are capped at the column width. The date box may be at most the column width.
- **One main button per card or view.** [Von Restorff]
- **Tokens only.** Use the theme's named colours (`ui/src/index.css:47-66`: background, foreground, card, primary,
  muted, destructive, border) and the `statusBadge` map. No raw palette classes of the kind used today
  (`P:43-51`, `P:170`, `P:251`, `V:47-54`, `V:117-157`). Exact token names follow `docs/ux/design-system.md` once
  it lands (UNVERIFIED: not in this worktree yet).
- **No double padding.** The content pane already pads (`Layout.tsx:452`); the area adds none of its own (the
  Socials wrapper adds a second layer today: `SocialsContentLayout.tsx:99`).
- **Dates** go through the shared helpers (`ui/src/lib/utils.ts:14`, `:22`, `:32`), not page-local copies
  (`P:32-40`, `V:35-45`). A small addition is needed for "weekday + time-zone letters".
- **Button size:** the standard height (40 px, `ui/src/components/ui/button.tsx:24`) for card actions, not the
  small size used today (36 px, `:26`) or icon-only buttons (`P:208-224`). [Fitts]

**Widths to design for.** The left rail is 72 px (`ui/src/components/CompanyRail.tsx:270`) and the menu 240 px
(`ui/src/components/Sidebar.tsx:52`); the pane pads 24 px a side on desktop (`Layout.tsx:452`). So the content
column is about **920 px in a 1280 px window** and about **664 px in a 1024 px window**. Below 768 px the app is in
its phone layout (`ui/src/context/SidebarContext.tsx:12`): full width, 16 px padding, about **358 px at 390 px**.

### Shared frame (all four views)

| Region, top to bottom | Component | Notes |
|---|---|---|
| Breadcrumb | existing `BreadcrumbBar` via `useBreadcrumbs` | "YouTube", or "Socials & Content › YouTube" (decision 1). |
| Heading + one-line promise | **NEW `PageHeader`** | Title "YouTube"; the promise changes per tab (section 4). Three different hand-made headings exist today (`P:472`, `V:106`, `SocialsContentLayout.tsx:101`). |
| Warning strip (only when something is broken) | **NEW `Notice`** (tones: info, warning, error; text + one action) | No such component exists in `ui/src/components/ui`. |
| Tabs | `Tabs` + `PageTabBar` (`ui/src/components/PageTabBar.tsx`) | The address changes with the tab. On phones `PageTabBar` becomes a drop-down and needs **text** labels, or it prints the internal key (`PageTabBar.tsx:29`): pass "Review (1)", not an icon element. |
| View content | below | |

### Review

| Region | Component | Behaviour |
|---|---|---|
| "Needs attention" group (only if any) | `Notice` or `Card` + `StatusBadge` + `Button` | "Could not be made" and "Did not post" cards. Above the videos. |
| "Needs your OK" group | **NEW `ReviewCard`** = `Card` + **NEW `VideoPreview`** + `StatusBadge` + `Button` + `Badge` (tags) + `Collapsible` (Show all) + `DropdownMenu` (More) + `AlertDialog` (dialogs) | One per video, newest first. More than three: the first three open, the rest folded to a title line. [Miller] |
| "Next to post" line | text + link | Only when something is scheduled. |
| Empty / loading | `EmptyState` (`ui/src/components/EmptyState.tsx:12`) / `Skeleton` | `EmptyState` has no secondary link today; a small extension is needed for "See what is scheduled". |

**`VideoPreview` (NEW; add to the design-system catalogue first).** A 16:9 box with the browser's video controls,
an optional poster, and three built-in states (loading, file gone, cannot play). Fluid width. The nearest thing in
the repo is a bare `<video>` tag in `ui/src/pages/ContentReview.tsx:718`.

**Responsive behaviour of the card**

- **Window 1280 px and wider (two columns).** Left, about 58%: player; under it the "How it was made" line, the
  "Posts…" line, the buttons and the helper sentence. Right, about 42%: title, description, tags, cover picture.
  The player and the **Approve** button are both on screen without scrolling at 1280 × 800.
- **Narrower than 1280 px, including 1024 px (one column).** The card is at most about 760 px wide. Order as in
  5.1. The description shows six lines and "Show all"; tags show two rows and "+N more".
- **Phone (under 768 px).** Same single column. **Approve** is full width. **Change time** and **Post now** share
  a row and wrap to two rows if they do not fit. **Remove** is on its own line at the end.

**Wireframe: Review, desktop (content column about 920 px)**

```
YouTube
New videos wait here until you say yes.

[ Review 1 ]   Scheduled 2   Posted   Files & settings
------------------------------------------------------------------------------------------
Needs your OK
+----------------------------------------------------------------------------------------+
| +------------------------------------------------+   (Needs your OK)                   |
| |                                                |                                     |
| |                                                |   Discipline Over Motivation:       |
| |              VIDEO   16:9                      |   Small Habits That Stick           |
| |          (browser controls)                    |                                     |
| |                                                |   DESCRIPTION                       |
| |                                                |   <first lines of the text>         |
| +------------------------------------------------+   00:00 Introduction                |
|  Animated (words light up as they are spoken)        00:18 ...                         |
|  2:57 · made Fri, Oct 9 · 6:34 PM                    00:47 ...                         |
|                                                      Show all                          |
|  Posts Sun, Oct 11 · 7:00 AM PDT (in 2 days)                                           |
|                                                      TAGS                              |
|  [  Approve  ]  [ Change time ]  [ Post now ]        (tag) (tag) (tag) (tag) +12 more  |
|  Puts this video on YouTube, for everyone to         Also added as #hashtags at the    |
|  see, on Sun, Oct 11 at 7:00 AM.                     end of the description.           |
|                                                                                        |
|  Remove                              More v          COVER PICTURE  [ small picture ]  |
|                                                      Not sent to YouTube yet.          |
+----------------------------------------------------------------------------------------+
Next to post: <title> · Sat, Oct 10 · 7:00 AM                        See all scheduled ->
```

The title, length, posting time and the first chapter in this picture are the recorded values of the first
animated video (`docs/products/youtube-pipeline.md:74-81`); the made-on time is the end of its run log
(`docs/handoffs/2026-10-09-youtube-animated-live.md:41-42`). The other chapter titles, the description text and
the tags are not recorded in the docs, so they are left as placeholders.

**Wireframe: Review, narrow (390 px wide, content about 358 px)**

```
YouTube
New videos wait here until you say yes.
[ Review (1)                  v ]
----------------------------------
Needs your OK
+--------------------------------+
| +----------------------------+ |
| |        VIDEO  16:9         | |
| |     (browser controls)     | |
| +----------------------------+ |
| (Needs your OK)                |
| Discipline Over Motivation:    |
| Small Habits That Stick        |
|                                |
| DESCRIPTION                    |
| <six lines of the text>        |
| Show all                       |
|                                |
| TAGS                           |
| (tag) (tag) (tag) (tag)        |
| (tag) (tag) +10 more           |
|                                |
| COVER PICTURE  [ small ]       |
| Not sent to YouTube yet.       |
|                                |
| Animated · 2:57                |
| Posts Sun, Oct 11 · 7:00 AM PDT|
| [          Approve           ] |
| Puts this video on YouTube,    |
| for everyone to see, on Sun,   |
| Oct 11 at 7:00 AM.             |
| [ Change time ] [ Post now ]   |
| Remove                  More v |
+--------------------------------+
```

### Scheduled

| Region | Component | Behaviour |
|---|---|---|
| Day groups: "Today", "Tomorrow", then "Sun, Oct 11" | group headings + `Card` rows | Soonest first. |
| Row: small cover picture (when it can be fetched), title (two lines at most), "7:00 AM PDT", `StatusBadge` "Scheduled", **Change time**, **More** (Post now, Remove) | `Card`, `StatusBadge`, `Button`, `DropdownMenu`, `AlertDialog` | Clicking the row opens the full card (player, public text, actions) in a side panel: `Sheet`. On a phone the buttons drop under the title. |
| Empty | `EmptyState` | "Nothing is scheduled. Videos you approve wait here until their time." |

Responsive: one list at every width. Under 768 px the cover picture is hidden and the time moves under the title.

### Posted

| Region | Component | Behaviour |
|---|---|---|
| Search by title | `Input` | Full column width, never wider. |
| Rows, newest first: title, "Posted Thu, Oct 8", **Watch on YouTube** | `Card` rows + `Button` (link) | Opens YouTube in a new tab. The web address is never shown as text. Later: a "Views" number at the right. |
| Row click | `Sheet` | The same card, read-only. The player works while the file is still on the server (30 days); after that only **Watch on YouTube**. |
| Load more | `Button` | 25 at a time. Today the server stops at 50 rows of all kinds (`R:89`; gap 4). |
| Empty | `EmptyState` | "Nothing has posted yet." |

Responsive: one list at every width. Under 768 px **Watch on YouTube** drops under the title, full width.

### Files & settings

| Region | Component | Behaviour |
|---|---|---|
| Summary line: "30 video files · 144 MB on our server. Files delete themselves 30 days after a video is made. Posted videos stay on YouTube." | `MetricCard` (`ui/src/components/MetricCard.tsx:14`) or plain text | Replaces four tiles. The two numbers are the 2026-10-07 figures (section 9), used here as the example. |
| File groups: "Waiting or scheduled (kept safe)" · "Already on YouTube" · "Removed or never posted" · "Could not be finished" · "Files we cannot match to a video" | group headings + `Card` rows | Each row: title, "Made Oct 9", size, "Deletes itself on Nov 8", **Watch**, **Download**, **Remove file** (not offered in the first group). "Details" opens the file name, wrapped. |
| "Make a video now": topic box (optional) + button + "Takes about 5 to 10 minutes. The new video shows up in Review." | `Input`, `Button` | Not the main action of the area; plain secondary button. |
| **Advanced** (closed by default) | `Collapsible` | "How it is set up": daily videos on or off · video style (Animated or Slides) · YouTube connection · voice services · picture services. Then "Videos that could not be made", with the technical detail. A link to the Cron Jobs page for schedules. |

Responsive: one column at every width. A file row keeps title and dates on the first line and its buttons on the
second; under 768 px the size and the dates stack under the title. File names, only ever behind "Details", wrap.

---

## 8. Success criteria (testable)

1. **Two clicks to a playing video.** From any dashboard page: the YouTube menu item (1), play (2). From a link
   to the video: play (1).
2. **Approve without leaving.** The owner can watch, read the title, description and tags, and approve on the
   Review view: no second page, no new browser tab, no download.
3. **Approve is one click** at the suggested time. Changing the time takes at most three.
4. **No surprise publishing.** The only single click that leads to a public video is **Approve**, and the sentence
   under it states the day and time. **Post now** and **Remove** always open a dialog first.
5. **The Remove dialog says what happens to the file**, with the real date. Choosing "Keep it" changes nothing.
6. **No sideways scroll at 1280, 1024 and 390 px wide** in any of the four views and in the side panel: the content
   pane's scroll width equals its visible width. Tested with stress data: a 100-character title, a 5,000-character
   description that contains a 200-character unbroken string, 30 tags, a 46-character file name.
7. **One label and one colour per status, everywhere.** A test renders every status in every view and compares it
   with the table in section 4. A search of the area's files finds no raw palette colour class.
8. **One main button** per card and per view.
9. **Old links still work.** `/socials/youtube` opens Review; `/youtube/videos` opens Files.
10. **Every state is designed.** Loading, nothing to review, daily videos off, being made, file gone, could not be
    made, posting now, did not post, approve failed, YouTube not connected: each shows what happened and what to
    do next. One test or story per state.
11. **The tab is in the address.** A refresh keeps the tab; `/youtube/review?video=<id>` opens that video.
12. **No build words in the daily views.** Review, Scheduled and Posted contain none of: `.mp4`, a byte size,
    `pending_review`, `presentation-fallback`, "Pipeline", "Production", a service name.
13. **Above the fold.** In a 1280 × 800 window the player and the Approve button are both visible without scrolling.
14. **Times are right.** Times show the weekday and time-zone letters of the viewer's computer; approving without
    changing the time saves the same moment (tested with the browser in a non-UTC zone).
15. **Quick answer.** After a click on Approve the button shows a "working" state within 400 ms, measured.
    [Doherty]
16. **Keyboard.** Every action is reachable with Tab; dialogs hold focus and close with Esc.

---

## 9. Clean-up the owner asked about (proposal only; nothing has been deleted)

"Old videos and other things not needed" can mean several different things **in this area**. They are not equally
safe, so they are listed apart. Server numbers below come from docs dated 2026-10-07 and 2026-10-09; **none was
re-measured today** (UNVERIFIED).

| # | Candidate | What deleting it would lose | Can it be undone? |
|---|---|---|---|
| A | **Video files of videos that were removed and never posted.** At least 5 such files per the log: 4 removed on 2026-10-09 plus the test video `d95fef7d` (`docs/products/youtube-pipeline.md:195-199`, `:293`). | The only copy of that video. Script, slides, cover picture and captions stay in the archive (`server/src/services/youtube/archive.ts:5-7`; the archive records the file path and does not copy the video: `:127`). | No, once the file is gone. They delete themselves at 30 days anyway. |
| B | **Video files of videos already on YouTube.** | Our local copy. The video stays on YouTube. | Yes, in effect: the owner can download it again from YouTube. |
| C | **Files with no record** ("orphans", `R:335-356`). INFERRED: the 30-day clean-up never removes these, because it walks the list of runs, not the folder (`video-cleanup.ts:50-59`). | Unknown until watched; that is why Files lets the owner play one first. | No. |
| D | **Leftovers of nights that failed.** A video that fails the sync check keeps its files for inspection (`docs/products/youtube-pipeline.md:155`). | The evidence for fixing that failure. | No. |
| E | **Small side files** `timeline_<id>.json` in the videos folder, which the clean-up skips (`youtube-pipeline.md:299`). | Nothing the owner uses. | No, and not needed. |
| F | **Waiting or scheduled videos whose file is already gone.** | Nothing: they can no longer post (`publish-queue.ts:74-76`). | The row can be kept as history. |
| G | **Videos on the YouTube channel itself** (older videos made before the timing fix). | Their views, comments and links, for good. | No. The dashboard cannot do this today: its YouTube permission is upload-only (`youtube-pipeline.md:200`). Listed only so the owner can say whether this is what he meant. |
| H | **Screen clutter**: the 11 elements marked REMOVE in section 3 and, once the new area replaces them, the two old pages. | Nothing on the server. | Yes, by code. |
| I | **Unused code**: two API calls no screen uses (`ui/src/api/youtube.ts:15-17`) and an unused folder constant (`R:24`). | Nothing. | Yes, by code. |

**Not candidates (keep):**

- **The archive** of scripts, timelines, slides, cover pictures and captions: an owner decision of 2026-10-08
  (`docs/products/youtube-pipeline.md:257`).
- **Cover pictures and slide pictures**: kept on purpose, they are small (`video-cleanup.ts:5-7`; 140 cover
  pictures were 43.8 MiB on 2026-10-07: `docs/products/youtube-metadata-audit-2026-10-07.md`, section Q5).
- **Database rows of posted videos**: they are the Posted history and hold the YouTube links.
- **The backup files of removed rows on the server** (`youtube-pipeline.md:198`, `:293`): today the only undo.

**How much space is at stake:** 30 files, 144 MB, on 2026-10-07
(`docs/products/youtube-metadata-audit-2026-10-07.md:79`). INFERRED: this clean-up is about a tidy list, not about
running out of space.

**Proposed safe default**

1. **Keep the automatic 30-day delete** exactly as it is.
2. Add **Remove file** in Files. It does not delete: it moves the file into a holding folder for **7 days**. During
   that time the row shows "Removed, gone for good on <date>" and a **Put back** button. A nightly job empties the
   holding folder after 7 days.
3. **Remove file is never offered** for a video that is waiting or scheduled.
4. **No "delete all" button.** One file at a time, each after seeing its title, or playing it.
5. Files with no record (C) are shown and playable; nothing removes them by itself.
6. Group G (the YouTube channel) stays out of the dashboard unless the owner asks for it by name.

---

## 10. API gaps (for the back-end builder)

What the new area needs that the server does not give today. The first slice needs only gap 1.

1. **A video stream that can seek.** In-page playback with HTTP Range support, addressed by video id, so the page
   never handles file names. Today: download only, as an attachment, with no Range (`R:367-392`). The orchestrator's
   stopgap route (2026-10-09) is not in this worktree; its name is UNVERIFIED. Reuse it if it fits.
2. **One "video to review" answer.** The queue row joined with its run and its SEO record: title; whether the
   title will be cut at 100; **the description exactly as it will post**, hashtag line included; the tags as they
   will be sent; chapters as a list (`youtube_pipeline.ts:59`); how it was made (`assets.visualMode`); made-on time;
   posting time; status; YouTube link; posted-on time; error; **is the file still there**; the date the file will
   delete itself; a cover-picture address. The preview text and the real upload must come from the **same**
   function, so the preview can never drift from what is posted (`publish-queue.ts:67-92` builds it at posting
   time today).
3. **A cover-picture route.** None exists; the pictures sit in a folder the routes file names and never uses (`R:24`).
4. **Lists by kind, in the right order, in pages.** Waiting; scheduled by posting time; posted by posted-on time,
   newest first. Today: the 50 most recently made rows of every kind (`R:84-90`).
5. **Numbers for the tabs.** Waiting for approval and failed uploads are not counted by the stats route (`R:246-253`).
6. **Next video time.** Already available (`ui/src/api/system-crons.ts:19-20`, fields `nextRunAt`, `running`,
   `enabled`, `lastError`). Either reuse it or repeat it in the YouTube answer so the area makes one call. Also
   missing: whether approval is required at all (`YT_REQUIRE_REVIEW`, `production.ts:36`) is not in the config
   answer (`R:217-229`); if it is off, Review should say "Videos are set to post without your OK".
7. **Reasons in plain words.** For a run and for an upload: a short code, a plain sentence and the technical text.
   Known technical texts are listed in section 5.3.
8. **Failed nights with a title.** The run list has no title (`R:47-53`); the title is in the SEO record.
9. **"Make a video now" that answers at once.** Start the job, return its id, and let the page ask for progress.
   Both ways of starting a run hold the request open until the video is finished (`R:66-67`;
   `server/src/services/cron-registry.ts:425-437`). INFERRED: the button route does not mark the nightly job as
   running, so a manual run and the nightly run can overlap; guard against two at once.
10. **Remove without erasing, and Put back.** A "removed" state in place of the hard delete (`R:139-153`), so the
    title stays with the file (`R:325`) and the owner can undo.
11. **Remove file, with a 7-day holding folder and Put back**, as in section 9. Refuse for waiting and scheduled
    videos. Include files with no record. Also clear the small `timeline_<id>.json` files.
12. **A safe "Try again" for a failed upload**, which first checks that YouTube does not already have the video.
    And make a failed **Post now** end as "failed", not stay "publishing" (`publish-queue.ts:128-141`; INFERRED,
    not reproduced).
13. **Refuse a posting time in the past** on the schedule route (`R:112-115`), or say plainly that it will post
    within 15 minutes.
14. **Optional, behind owner decisions:** move an approved video back to "Needs your OK"; edit the title,
    description and tags before approving (not possible today:
    `docs/products/youtube-metadata-audit-2026-10-07.md`, section Q4); view counts for Posted (the YouTube numbers
    table is empty for lack of permission, and Zernio already holds views for 155 videos:
    `docs/products/youtube-pipeline.md:306-308`).

---

## 11. Owner decisions

1. **Where does YouTube live?** Its own item in the left menu (recommended), or only a tab inside "Socials & Content" as today?
2. **Are the four names right?** Review · Scheduled · Posted · Files & settings.
3. **One-click Approve at the suggested time** (recommended), or always ask for the time first?
4. **Post now:** keep it on the card behind an "are you sure?" (recommended), or tuck it away in the More menu?
5. **Remove:** is it right that a removed video can be put back until its file deletes itself (30 days)?
6. **"Clean up old videos": which did you mean?** (A) files of removed, never-posted videos · (B) our copies of videos already on YouTube · (C) files we cannot match to a video · (G) old videos on the YouTube channel itself · or several of these. See section 9.
7. **Is a 7-day holding folder before a file is gone for good the right safety net?**
8. **Cover picture:** it is made but not sent to YouTube today. Show it with that note (recommended), or hide it until sending works?
9. **Do you want to be able to change the title or description before approving?** Not possible today.
10. **Views and tips:** leave them out until the YouTube numbers work (recommended)?

---

## 12. Build order (one slice at a time)

Each slice ships alone and passes criterion 6 (no sideways scroll) and criterion 7 (labels and colours) before
the next starts. New components go into the design-system catalogue before they go onto a page.

| Slice | What ships | Server work | Done when |
|---|---|---|---|
| **1. Review with a player** | `/youtube/review` showing the videos that need approval: `VideoPreview`, full title, description and tags from the data the queue route already sends, the "Posts…" line, one-click **Approve** with its sentence, **Change time**, **Post now** and **Remove** behind dialogs, the red line for a failed click, loading and "all caught up" (with the next video time). `PageHeader`, `VideoPreview`, the status table and the `pending_review` colour land here. The two old pages stay reachable. | Gap 1 only (or the stopgap route). | Criteria 2, 3, 4, 5, 6, 13, 14 pass for Review. |
| **2. One area** | The four-tab frame with the tab in the address; **Scheduled** (same queue data, filtered and sorted in the page); redirects from the two old addresses; the left-menu item (decision 1); the Socials tab becomes a way in. | None. | Criteria 1, 9, 11 pass. |
| **3. Posted** | Posted list with **Watch on YouTube** and search by title. | Gap 4 for history beyond 50 rows. | Criterion 12 passes for the three daily views. |
| **4. Files & settings** | File groups, Download, "Make a video now", Advanced. The old page files and the hand-built tab bar are deleted. | None for the list (`R:264-364`). | The area has no screen from the old pages left; inventory rows marked REMOVE are gone. |
| **5. The joined answer** | The card switches to the single "video to review" answer: description exactly as posted, "How it was made", cover picture, "file is gone", and the "Needs attention" cards with plain reasons. | Gaps 2, 3, 5, 7, 8, 12 (second half), 13. | Criterion 10 passes. |
| **6. Safe removal** | **Put back** for removed videos; **Remove file** with the 7-day holding folder. | Gaps 10, 11. After decisions 5, 6, 7. | A removed video and a removed file can each be put back in a test. |
| **7. Make a video now, without waiting** | The button returns at once; the "Being made" card shows progress. | Gap 9. | A run started from the page shows "Being made" and then a review card, with no request open for minutes. |
| **8. Later** | Views in Posted; editing before approval; safe "Try again". | Gap 12 (first half), gap 14. After decisions 9, 10. | — |

**Maps to correct when slices ship** (not done by this spec): the "Admin UI" row of
`docs/products/youtube-pipeline.md:20`, which names the two old pages and says the files page can "watch" videos;
the Socials hub doc if the tab changes; the design-system catalogue for `PageHeader`, `VideoPreview`, `Notice`,
`ReviewCard`.

### New components and additions named in this spec (for the design-system catalogue)

| Name | New or existing | Note |
|---|---|---|
| `PageHeader` | NEW | Title + one-line promise. |
| `VideoPreview` | NEW | 16:9, browser controls, three states. |
| `Notice` | NEW | Info, warning, error strip with one action. |
| `ReviewCard` | NEW (YouTube area) | Built only from catalogue parts. |
| `youtube-status` label table | NEW helper | One file; section 4. |
| `StatusBadge` | existing (`ui/src/components/StatusBadge.tsx:4`) | Needs the `pending_review` colour key in `ui/src/lib/status-colors.ts`. |
| `EmptyState` | existing | Needs an optional secondary link. |
| Date helper | existing (`ui/src/lib/utils.ts:22`) | Needs a "weekday + time-zone letters" form. |
| `Card`, `Button`, `Badge`, `Tabs`, `PageTabBar`, `AlertDialog`, `Sheet`, `Collapsible`, `DropdownMenu`, `Skeleton`, `Input`, `MetricCard`, `HelpTip` | existing | Used as they are. |

### Not verified for this spec

- **The live server.** File counts, sizes and row counts are from docs dated 2026-10-07 and 2026-10-09.
- **The running screens.** Nothing was clicked through; the sideways-scroll causes in particular were not measured.
- **The stopgap player and its stream route** (orchestrator, 2026-10-09): not in this worktree, name unknown.
- **`docs/ux/design-system.md`**: not in this worktree; token and component names there may differ from the ones
  used here. The Daddy Dash styling guides and the MDB design-system rules the owner named were not read for this
  spec; they belong to that document.
- **Marketing-role access** to the YouTube API (section 4).
- **Whether "Run Pipeline" times out** in the browser or the proxy (section 2, job 9).
- **A stuck "Posting now" after a failed Post now** (section 5.3): read from code, not reproduced.
- **Whether the owner reviews on a phone.**

### Where this doc is registered

There is no docs index to add a line to: `docs/` has no README or index file, and `docs/docs.json` is the menu of
the public docs site and lists no product docs. The list that does register product docs is "Reference Docs" in
the repo's root `CLAUDE.md`; it was left untouched by this spec and needs one line there, added by the owner or the
orchestrator. A forward link from the "Admin UI" row of `docs/products/youtube-pipeline.md` is the other missing
pointer.
