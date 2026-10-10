# YouTube area — UX spec (one tab inside Socials & Content to review, schedule and look back)

> **Cluster:** UX · **Tags:** youtube, review, approval, queue, library, ux-spec, socials-tab · **Related:** [YouTube pipeline](../products/youtube-pipeline.md), [Design system](design-system.md), [Socials hub](../products/socials-hub.md)

## Owner decisions — answered 2026-10-10

The owner answered the decision sheet on 2026-10-10 (about 00:25 PDT). The middle column is his answer, word for
word. The right column says what the answer changes in this spec. Two project names inside his design answers are
shown as "[project name withheld]" because this repository is public.

| Question (short name on the sheet) | The owner's answer | What it changes in this spec |
|---|---|---|
| The first animated video went public on 2026-10-09 at 19:51 PDT through Publish Now. Keep it? (`published`) | "Yes, keep it public" | Nothing to undo. The surprise it came from is closed: Post now asks first (live as a browser `confirm()` since #202, section 2 job 3; becomes a proper dialog, 5.2). *The 19:51 time is from the sheet; not re-checked here.* |
| An animated video fails its sync gate: skip the night or make something else? (`gatefail`) | "Make a regular slide video instead" | A gate failure no longer ends the night: the same run makes a slide video and checks that one. Only when the slide video fails too does the card say "Could not be made". Sections 5.1 row 2, 5.3, 10 (gap 15), 12 (slice 8). |
| What does "clean up old videos" mean? (`cleanup`) | "5 videos made but never posted (25 MB) + 29 server copies of videos already on YouTube (152 MB) + Slide + thumbnail pictures from past videos (888 MB) + Old-style videos on the YouTube channel itself" | Section 9 records these four groups. Not ticked: the 29 stuck or failed entries in the list, and "Nothing yet" for everything else. The sheet's figures replace the 2026-10-07 figure (30 files, 144 MB) as the current numbers; none was re-measured here. |
| How should the clean-up be done? (`cleanhow`) | "Delete right away" | No holding folder, no 7-day wait, no Put back for files. The 7-day proposal is dropped (section 9, one line). Deleting is carried out by the owner: server files by one command from an exact list, channel videos in YouTube Studio. |
| Where does YouTube live in the dashboard? (`where`) | "Stay a tab inside Socials & Content" | Reworks sections 4, 6, 7, 8 and 12. No left-menu item. The area is at `/socials/youtube` with four sub-tabs; `/youtube` and `/youtube/videos` redirect into it. The Socials frame supplies the one `<h1>` and the first tab row, so the area adds neither. |
| Are the four view names right? (`names`) | "Names are good" | Review · Scheduled · Posted · Files & settings stay (section 4). |
| Approve: one click, or ask for a time first? (`approve`) | "Approve in one click at the suggested time" | **Approve** is the one primary button on the review card and keeps the suggested time (5.2). |
| Post now: where, and how safe? (`postnow`) | "On the card, with an are-you-sure box" | **Post now** stays on the card as a secondary button, behind an `AlertDialog` that says it goes public immediately (5.2). It replaces the browser `confirm()` that #202 added. |
| Change the title or description before approving? (`edit`) | "I want that" | In scope now, no longer "later": new 5.4 (edit dialog, limits, preview) and the server need `PATCH /queue/:id` (gap 14). |
| The black-and-coral look (`look`) | "Yes" | The area takes its colours, type and spacing from the design-system tokens, never from this spec (section 7). |
| Dark and light (`theme`) | "Keep both, open in dark" | Every view is built and checked in both themes (criterion 17). |
| Density (`density`) | "Roomier, like [project name withheld]" | The roomier spacing steps apply. Fewer rows fit per screen; section 7 redoes the above-the-fold arithmetic with that and the Socials frame counted. |
| Corners (`corners`) | "Rounded cards like [project name withheld]" | Cards, dialogs and the side panel in this spec are rounded. This depends on the design system's corner-size fix. |
| Status colours (`status`) | "Five only: red, yellow, green, blue, grey" | Section 4's status table uses only those five (red problem, yellow needs you, green done, blue running, grey idle). |
| Accept the adjusted rules as a set? (`rules`) | "Accept that as a set" | Nothing in this spec; it is applied in the design system. |
| Publish the design-system draft? (`publishdoc`) | "Publish a trimmed version without the [project name withheld] summaries" | Nothing in this spec beyond one rule: this spec names the design system and does not quote private rules. |

**Not on the sheet — the default this spec took** (say so and it changes):

- **Remove on the card** works as today: the queue row is erased and the video file follows the 30-day clean-up, or
  the Files delete. No Put back (old decision 5). It is not asked whether Remove should also delete the file at once.
- **Cover picture** is shown with the note that it is not sent to YouTube yet (old decision 8).
- **Views and tips** stay out until the YouTube numbers work (old decision 10).
- **Which of the five colours each label gets** is this spec's mapping (section 4).
- **A marketing-only account** that can open the Socials hub but not the YouTube API gets one plain "admin only"
  state, or no YouTube tab (section 4).

---

**Status:** v2, revised 2026-10-10 with the owner's decisions above. First written 2026-10-09 (owner-local date).
The starting point is `origin/master` after #202 (merged and deployed 2026-10-10 about 00:35 PDT; the deploy time is from the brief, not re-checked). This document
changes no code and deletes nothing.

**In plain words:** the YouTube work was split over two pages that did not link to each other. #202 gave the Queue
tab a player, but the owner still has to find that tab, and the files page has no player. This spec replaces both
pages with **one YouTube tab inside Socials & Content, with four views: Review, Scheduled, Posted, Files &
settings**. Review opens first. It shows the new video with a player, the exact words that will go public (which the
owner can edit), and one **Approve** button.

**Trigger (owner, 2026-10-09):** "page doesnt show video, and the two areas are confusing and when i scroll on pages
it shifts left and right" and "we can clean up and delete old videos and otehr things not needed". This spec is the
"two areas are confusing" part, plus the clean-up plan. **Already done, outside this spec (#202):** an inline player on
the Queue card, a "Description that will post" drop-down, a confirm on Publish Now, and tab rows that wrap instead of
widening the page. **Not in this spec:** the dashboard-wide revamp, the design-system document itself, deploying, and
deleting anything (deletions are prepared as an exact list plus one command that the owner runs).

**How to read the citations.** `P:` = `ui/src/pages/YouTubePipeline.tsx`, `V:` = `ui/src/pages/YouTubeVideos.tsx`,
`R:` = `server/src/routes/youtube.ts`. Other files are cited by full path the first time and by file name after
that; a bare `:95` continues the file named just before it. All line numbers are from `origin/master` at
`b6188dc2` (after #202). Sections 2 and 3 describe the screens as they were on the evening of 2026-10-09, at
`dc8beabc`, before #202; a row that #202 changed says **since #202**, and the `P:` numbers in those sections were
renumbered to the merged file.

**How sure each statement is.** Everything said about the screens comes from **reading the cited lines**.
Nothing here was checked by clicking through the running dashboard, and the live server was not queried.
**INFERRED** marks a conclusion about how something behaves when running, or a number taken from a dated doc, that
the cited lines imply and that nobody watched happen for this spec. **UNVERIFIED** = could not be checked at all
from this worktree. **ASSUMED** = taken from the owner's sheet or the brief. The UX laws named in square brackets are
the owner's list (`ux-laws` skill), so each choice has a stated reason. The YouTube limits in 5.4 were read on 2026-10-10 from
the YouTube Data API reference (videos resource), through a page-fetch summary, not in a browser.

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

- Names of the voice and picture services ("TTS Providers", "Visual Backends": `P:421-457`).
- File names such as `video_d6d30d70-….mp4` (`V:199`) and sizes in bytes (`V:200`).
- Internal status codes printed as-is, such as `pending_review` (`P:54` prints the raw value).
- Words from the build side: "Pipeline", "Productions", "Queue item", "Assets", "VPS" (`P:493`, `P:500`, `V:108`).
- Counters nobody acts on ("Total Productions": `P:500-501`).

Others who may open the area: an agent or developer checking a failed night. Their needs go behind **Advanced**
and never shape the daily view. [Pareto: the daily 20% gets the default tab; Tesler: we absorb the complexity.]

---

## 2. Jobs to be done (ranked), today's path, and what is broken

*Baseline: this section describes the screens as they were on the evening of 2026-10-09, at `dc8beabc`, before #202. A row #202 touched says **since #202** and what still holds. The `P:` numbers are from the merged file.*

| # | Job | Today's path | What is broken or confusing (evidence) |
|---|---|---|---|
| 1 | Watch the new video before it goes public | **Since #202:** open `/socials/youtube` → click the **Queue** tab → the card has a player. *At `dc8beabc`:* the card had no player; type `/youtube/videos` by hand → **Download** → open the file from the Downloads folder | At `dc8beabc` neither page contained a `<video>` element (grep of both files: none). **Since #202** the Queue card has one (`P:186-194`), fed by a new route that answers Range requests, so the video can be skipped through (`R:394-423`; its test asserts a 206 answer: `server/src/__tests__/youtube-video-stream.test.ts:65-77`, read, not run). **Still true:** the player is on the Queue tab, one click away from the page's opening tab, "Pipeline" (`P:478`); it shows on failed rows too (the test is `!isPublished`, `P:187`; INFERRED); the files page still has only a Download, sent as an attachment with no seeking (`R:367-392`); and no screen links to `/youtube/videos` (outside the API client the path appears in `ui/src` only in the route table: `ui/src/App.tsx:306`). The canonical doc used to call that page a place to "watch/download" (`docs/products/youtube-pipeline.md:20`, corrected on master after `dc8beabc`); it can only download (`V:230-235`). |
| 2 | Check the words that will go public | Queue tab → the card shows the title on one line and, **since #202**, a closed drop-down "Description that will post" | The title is still cut off with `truncate` (`P:166`). The tags are sent to the browser inside each queue row's `metadata` (`server/src/services/youtube/production.ts:385-392`, returned whole by `R:84-90`) and are still shown nowhere. The new drop-down shows `metadata.description` (`P:195-200`), but the upload adds a blank line and a line of `#hashtags` to it (`server/src/services/platform-publishers/youtube.ts:54`), so what it labels "Description that will post" lacks that last line (INFERRED from the two code paths; not compared on a real upload). |
| 3 | Approve it for the suggested time | Queue tab → **Approve & schedule** → a date box opens → click a small tick button with no label | Three clicks, and the button named "Approve & schedule" does not approve: it opens an editor (`P:248-262`). The real approve is an icon-only button (`P:229-242`). The only button in the main colour is **Publish Now** (`P:205-219`), which uploads to YouTube as **public** at once (`server/src/services/platform-publishers/youtube.ts:59`). At `dc8beabc` it asked nothing; the code comment #202 added records that one click published a video by surprise on 2026-10-09 (`P:208`). **Since #202** it asks the browser's `confirm()` (`P:207-210`). Still true: the safest action is the hardest to find, and the one that cannot be undone is the easiest to hit. [Von Restorff, Fitts] |
| 4 | Change when it posts | Same date box | Works, and it is pre-filled in local time (`P:252-256`). Nothing stops a time in the past; the server accepts any valid date (`R:112-115`), and the posting job runs every 15 minutes (`yt-crons.ts:44`), so a past time means "posts within 15 minutes" without saying so. |
| 5 | Remove a video I do not want | Queue tab → red bin icon with no label → browser pop-up "Remove this video from the queue?" (`P:265-273`, text at `P:269`) | The pop-up does not say what happens next. In fact the queue row is deleted for good (`R:139-153`), the video file stays on the server for up to 30 days (`server/src/services/youtube/video-cleanup.ts:22`), and on the files page that video then loses its title and shows as "Video d6d30d70" (`R:325`). |
| 6 | See what is coming up | Same Queue tab | Videos waiting for approval, scheduled, posted and failed are one mixed list of the 50 most recently **made**, not ordered by posting time (`R:88-89`). The "Queue" number at the top counts only `scheduled` (`P:513`, `R:248`); videos waiting for the owner are counted nowhere. |
| 7 | Look back at what posted | Queue tab, scroll | A posted video shows its raw web address as the link text (`P:167-175`). The date it posted is stored (`packages/db/src/schema/youtube_pipeline.ts:143`) and not shown. History stops at 50 rows (`R:89`). |
| 8 | Know when something went wrong | Pipeline tab (a failed night) or Queue tab (a failed upload) | A night that failed is one row made of a length, a style word, an age and the word "failed" (`P:112-119`): no title, no reason, although the reason is in the same response (`error` column, `youtube_pipeline.ts:109`, sent by `R:47-53`). A failed upload shows a red badge next to the words "Scheduled: <time>" with no reason and no buttons (`P:156`, `P:177-180`, `P:203`). Neither page handles a failed click: no error handler and no error text exist in either file (grep for `onError`, `isError`: none). |
| 9 | Make an extra video now | Pipeline tab → optional topic → **Run Pipeline** (`P:83-99`) | The request stays open for the whole job (`R:66-67` awaits it; measured runs took 240 s and 619 s: `docs/products/youtube-pipeline.md:76`, `:203`). The button spins for minutes with no progress. Whether the browser or the proxy gives up first is UNVERIFIED. |
| 10 | Tidy up old files | `/youtube/videos` | The subtitle says "download or manage" (`V:108`); the only action is Download (`V:230-235`). There is no way to remove a file. |
| 11 | Check the set-up is healthy (rare) | Config tab (`P:382-460`) | Fine for a developer. It sits at the same level as the daily work. |

**Why "the two areas are confusing", in evidence:**

- **Two names, two addresses, two shells for one thing.** "YouTube Pipeline" at `/socials/youtube` sits inside the
  Socials hub, under its heading and its ten tabs (`ui/src/pages/socials/SocialsContentLayout.tsx:39-50`,
  `:99-108`), then adds its own heading and four more tabs (`P:491-494`, `P:525-543`). "Video Files" at
  `/youtube/videos` stands alone with a different heading size (`V:106` against `P:493`). `/youtube` itself
  redirects into the other tree (`ui/src/App.tsx:305`). [Jakob, Hick: 14 tabs on one screen]
- **Three page titles on one screen.** The top bar prints a single breadcrumb as an `<h1>` (`ui/src/components/BreadcrumbBar.tsx:68-77`), the Socials hub prints "Socials & Content" as another (`SocialsContentLayout.tsx:101`), and the page prints "YouTube Pipeline" as a third (`P:493`). Since #202 the hub's ten-tab row wraps instead of widening the page (`PageTabBar.tsx:38-46`); the page's own second, hand-built row is still there.
- **No link in either direction** (see job 1). The breadcrumb on the files page leads back (`V:73`); nothing leads
  forward. The left menu has no YouTube item at all (`ui/src/config/company-sidebars.tsx:125-131`).
- **The first tab is not the daily job.** The page opens on "Pipeline" (`P:478`). The tab is kept in memory, not in
  the address, so a link cannot open the Queue and a refresh goes back to Pipeline. The link the owner was sent
  (`docs/handoffs/2026-10-09-youtube-animated-live.md:65-67`) therefore landed one click away from the video card (since #202 that card has the player; the page still opens on Pipeline).
- **Eight number tiles, same words, different numbers.** "Published" on page one counts database rows (`P:507`,
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
| 1 | Socials hub wrapper: heading "Socials & Content" + 10 tabs (`SocialsContentLayout.tsx:99-108`) | The parent hub around the page | Nobody, for this job | KEEP | The hub stays the home of the area (owner decision "where"). It supplies the page's one `<h1>` and the first tab row; the area adds neither (section 4). |
| 2 | Heading "YouTube Pipeline" + red icon (`P:491-494`) | Page name | Owner, daily | REMOVE | The hub's heading is the page's one `<h1>`. The one-line promise under the area's tab row says what each view is for. |
| 3 | Breadcrumb "YouTube Pipeline" (`P:476`) | Where am I | Owner, daily | MERGE | Two crumbs, "Socials & Content" › "YouTube", which also stops the top bar printing yet another `<h1>` (`BreadcrumbBar.tsx:68-83`). |
| 4 | Tile "Total Productions" (`P:498-503`) | Lifetime count of videos made | Nobody | REMOVE | No decision hangs on it. |
| 5 | Tile "Published" (`P:504-509`) | Count of posted videos | Owner, rarely | MERGE | The Posted tab is the answer; no tile. |
| 6 | Tile "Queue" (`P:510-515`) | Count of scheduled videos only | Owner, daily | MERGE | Becomes the number on the Scheduled tab. |
| 7 | Tile "Failed" (`P:516-521`) | Count of nights that failed | Owner when it happens; developer | MOVE | A recent failure becomes a "Needs attention" card in Review; the full list goes under Advanced. |
| 8 | Hand-built tab bar (`P:525-543`) | Pipeline, Queue, Analytics, Config | Owner, daily | MERGE | Replaced by the area's four tabs: a second-level `PageTabBar` row in the `pill` variant, kept in the address (section 4). |
| 9 | Tab "Pipeline" (`P:465`) | List of runs | Developer, rarely | HIDE-BEHIND-"Advanced" | Build detail, not a daily job. |
| 10 | Tab "Queue" (`P:466`) | Waiting, scheduled, posted and failed, mixed | Owner, daily | MOVE | Split into Review, Scheduled and Posted. |
| 11 | Tab "Analytics" (`P:467`) | Views and tips | Owner, weekly, once it works | REMOVE | The table behind it has 0 rows (`docs/products/youtube-pipeline.md:306-308`), so the tab is always empty. Returns as a "Views" column in Posted (row 25). |
| 12 | Tab "Config" (`P:468`) | Set-up read-out | Developer, rarely | HIDE-BEHIND-"Advanced" | Not a daily job. |
| 13 | "Custom topic (optional)" box (`P:83-88`) | Topic for an extra video | Owner, rarely | MOVE | To Files & settings, under "Make a video now". |
| 14 | Button "Run Pipeline" (`P:89-99`) | Starts an extra video | Owner, rarely | MOVE | Same place, renamed **Make a video now**. |
| 15 | Run rows: length, style, age, status (`P:107-123`) | One line per run, no title, no reason | Developer, when a night fails | HIDE-BEHIND-"Advanced" | Becomes "Videos that could not be made", with title and reason. |
| 16 | "Loading..." and "No productions yet…" (`P:102-105`) | Text-only states | — | REMOVE | Replaced by the designed states in section 5. |
| 17 | Card title (`P:166`) | The public title, cut to one line | Owner, daily | KEEP | Shown in full; it wraps, it is never cut in Review. |
| 18 | Web address of a posted video as the link text (`P:167-175`) | The YouTube link | Owner, sometimes | MOVE | To Posted, as a button **Watch on YouTube**. |
| 19 | "Awaiting approval — proposed:" / "Scheduled:" + time (`P:177-180`) | When it will post | Owner, daily | KEEP | Reworded "Posts Sun, Oct 11 · 7:00 AM PDT". |
| 20 | Status badge, raw code (`P:183`, map `P:43-51`) | `pending_review`, `scheduled`… | Owner, daily | MERGE | One shared label-and-colour table for the whole area (section 4). |
| 21 | Button "Publish Now" (`P:205-219`) | Uploads at once, public | Owner, rarely | KEEP | Renamed **Post now**, no longer the main button, behind a proper `AlertDialog` (since #202 it asks with the browser's `confirm()`, `P:207-210`). |
| 22 | "Approve & schedule" / "Reschedule" + date box + tick + cross (`P:221-263`) | Approve or move the time | Owner, daily | KEEP | Split into a one-click **Approve** and a **Change time**. |
| 23 | Red bin icon + browser pop-up (`P:265-273`) | Remove from the queue | Owner, sometimes | KEEP | Labelled **Remove**, with a real dialog that says what happens to the file. |
| 24 | "Loading..." and "Publish queue is empty…" (`P:292-295`) | Text-only states | — | REMOVE | Replaced by the designed states in section 5. |
| 25 | Per-video views, likes, comments, grade, score (`P:357-375`) | Performance | Owner, weekly, once it works | MOVE | Later: a "Views" column in Posted. Grade and score are dropped. |
| 26 | Button "Collect Analytics" (`P:327-332`) | Fetches numbers now | Nobody | REMOVE | A daily job already does this (`yt-crons.ts:54-63`); today it gets nothing back (`youtube-pipeline.md:306-308`). |
| 27 | Card "Optimization Insights" (`P:334-349`) | Written tips | Nobody yet | REMOVE | With no numbers the server returns one stock sentence telling the owner to publish videos first (`server/src/services/youtube/analytics.ts:306`), while 152 are posted (`youtube-pipeline.md:199`). INFERRED. |
| 28 | "No analytics data yet." (`P:353-354`) | Empty text | — | REMOVE | Goes with the tab. |
| 29 | Card "Pipeline Configuration": enabled, style, YouTube connection (`P:393-419`) | Set-up read-out | Developer; owner only when broken | HIDE-BEHIND-"Advanced" | Shown in plain words under Advanced. A broken YouTube connection also raises a warning in Review. |
| 30 | Card "TTS Providers" (`P:421-437`) | Which voice services have keys | Developer | HIDE-BEHIND-"Advanced" | Not an owner decision. |
| 31 | Card "Visual Backends" (`P:439-457`) | Which picture services are on | Developer | HIDE-BEHIND-"Advanced" | Not an owner decision. |

### Page two — `/youtube/videos` ("Video Files")

| # | Element (where) | What it shows | Who needs it, how often | Verdict | Reason |
|---|---|---|---|---|---|
| 32 | Heading "Video Files" + "Assembled videos on VPS — download or manage" (`V:105-110`) | Page name | Owner, rarely | MERGE | Becomes the "Files" part of Files & settings. |
| 33 | Breadcrumb "YouTube › Videos" (`V:72-75`) | Where am I | Owner | MERGE | The same two crumbs as row 3. |
| 34 | Tile "Total Videos" (`V:114-126`) | Files on disk | Owner, rarely | MOVE | One summary line in Files: "30 video files · 144 MB" (the 2026-10-07 figures, used as the example; section 9 has the owner's newer sheet). |
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

### Added to the Queue card by #202 (2026-10-10)

| # | Element (where) | What it shows | Who needs it, how often | Verdict | Reason |
|---|---|---|---|---|---|
| 52 | Inline player (`P:186-194`) | The video, from the new stream route | Owner, daily | MERGE | Becomes `VideoPreview` inside the review card (5.1 row 1); the bare `<video>` goes. |
| 53 | Drop-down "Description that will post" (`P:195-200`) | The description, closed by default, without the hashtag line | Owner, daily | MERGE | Becomes the open description on the review card, hashtag line included (5.1 row 6). |

**Count (by script over the three tables):** 53 elements → KEEP 10 · MOVE 13 · MERGE 11 · HIDE-BEHIND-"Advanced" 7 ·
REMOVE 12. The 12 removed: rows 2, 4, 11, 16, 24, 26, 27, 28, 36, 37, 39, 50.

---

## 4. Proposed structure: one YouTube tab inside Socials & Content

### Where it lives (owner decision "where")

YouTube stays a tab of the Socials & Content hub. **No item is added to the left menu** (the menu has no YouTube
item today: `ui/src/config/company-sidebars.tsx:125-131`). The way in is: left menu "Socials & Content"
(`company-sidebars.tsx:126`) → the hub's existing **YouTube** tab (`SocialsContentLayout.tsx:45`) → the area opens on
Review. A link to one video opens it directly (below).

**What the hub already supplies, and the area must not repeat.**

- **One `<h1>`**: "Socials & Content" (`SocialsContentLayout.tsx:101`). The area adds **no `<h1>`** and no page-level
  title. Its sections use `<h2>` and below.
- **One tab row**: the hub's ten tabs (`SocialsContentLayout.tsx:106-108`). The area adds no tab row *at that level*.
- **The page padding**: the hub wraps every tab in `p-6` (`SocialsContentLayout.tsx:99`). The area adds none.
- **The top bar**: the area sets two breadcrumbs, "Socials & Content" (linking to `/socials`) › "YouTube", the same
  form the Affiliates admin pages use (`ui/src/pages/AffiliateAdminCampaigns.tsx:109`). With two crumbs the top bar
  prints a trail instead of its own `<h1>` (`BreadcrumbBar.tsx:68-83`), so the screen has exactly one `<h1>`.
  Today it has three (section 2).

### The four views: a second-level tab row

The four views are a **second-level tab row**, visually subordinate to the hub's row: the hub row stays the
underlined text row with icons; the area's row is a quieter muted "pill" row, text only, directly under it.

- **Component:** the existing `PageTabBar` (`ui/src/components/PageTabBar.tsx`) with one small addition, an optional
  `variant` prop: `line` (today's look, the default, used by the hub) and `pill` (the muted segmented look that
  `TabsList variant="default"` already draws: `ui/src/components/ui/tabs.tsx:30-33`). `PageTabBar` hard-codes `line`
  today (`PageTabBar.tsx:41`). The addition goes into the design-system catalogue first. On phones `PageTabBar`
  already turns into a drop-down (`PageTabBar.tsx:21-35`), so the two rows become two drop-downs, one under the other;
  labels must be plain text ("Review (1)"), because an element label falls back to the internal key
  (`PageTabBar.tsx:30`).
- **No second hand-built row.** The area's old hand-built row (`P:525-543`) goes away with the old page.
- The first three tabs are the three steps in a video's life, left to right. [Goal-gradient, serial position]

| Tab | Address | One-line promise shown under the tab row | What is in it |
|---|---|---|---|
| **Review** (opens first) | `/socials/youtube/review` | "New videos wait here until you say yes." | Every video that needs the owner: waiting for approval (with a player), plus anything that went wrong. |
| **Scheduled** | `/socials/youtube/scheduled` | "Approved videos, in the order they will post." | Approved videos, soonest first, grouped by day. Change time, Post now, Remove. |
| **Posted** | `/socials/youtube/posted` | "What is on YouTube." | History, newest first, with **Watch on YouTube**. Search by title. Views later. |
| **Files & settings** | `/socials/youtube/files` | "Video files on our server, making an extra video, and set-up." | File list with clean-up, "Make a video now", and a closed **Advanced** section. |

- The promise is one line of plain muted text, like the hub's own subtitle (`SocialsContentLayout.tsx:102-104`), not
  a heading.
- The tab shows a number only when it calls for action or attention: `Review 1`, `Scheduled 2`. Posted and Files
  show none. These numbers replace all eight tiles. [Hick, Prägnanz]
- Names (owner: "Names are good"): "Scheduled" and not "Schedule" or "Queue", because it is the same word as the status
  label and the word YouTube Studio uses [Jakob, similarity]. "Posted" and not "Published". "Files" and not
  "Library", "Assets" or "Productions".
- A video opens by link: `/socials/youtube/review?video=<id>` scrolls to and highlights that video (or opens it
  from Scheduled or Posted). This is the link to hand the owner when a video is ready; today that link is sent by
  hand and can only point at the page (`docs/handoffs/2026-10-09-youtube-animated-live.md:65-67`).

### One route tree; old addresses redirect

| Address | Does |
|---|---|
| `/socials/youtube` | Redirects (index route) to `/socials/youtube/review`. Today it renders `YouTubePipeline` (`ui/src/App.tsx:259`). |
| `/socials/youtube/review` · `/scheduled` · `/posted` · `/files` | The four views: children of one `youtube` route inside the hub's `socials` route (`App.tsx:253-259`), so the hub's frame stays mounted while the views change. |
| `/youtube` (old) | Redirects to `/socials/youtube/review`. Today it redirects to `/socials/youtube` (`App.tsx:305`). |
| `/youtube/videos` (old) | Redirects to `/socials/youtube/files`. Today it renders `YouTubeVideos` (`App.tsx:306`). |

- The hub highlights the YouTube tab from the first path segment after `socials` only
  (`SocialsContentLayout.tsx:52-61`), so `/socials/youtube/review` keeps the hub's YouTube tab lit with no change to
  the hub (read, not run).
- `youtube` stays a known top-level route name (`ui/src/lib/company-routes.ts:51`), so the two old addresses keep
  resolving.

### Who sees the tab

The YouTube API is for board operators only (`R:34-40`). A **marketing-only** account may open `socials` routes
(`App.tsx:347`), so it sees the hub's YouTube tab, but the marketing gate's allowlist has no `/api/youtube` entry
(`server/src/middleware/marketing-role-gate.ts:37-54`): every call from the area would be refused with 403 and the
screen would be a wall of failed requests. (This already happens today on `/socials/youtube`; read, not run.) Fix,
either: hide the hub's YouTube tab for such accounts (preferred; the hub can read `isMarketingOnly` from
`useBoardAccess`, `ui/src/hooks/useBoardAccess.ts:38`), or show one plain state "This area is for admins." with no
calls. Whichever is chosen, the area makes no request for such an account.

### One video, one status, one label, one colour

Today a video has a build status and a posting status, shown with two colour codes (section 2). In the new area
each video shows **one** label. The colour is one of the owner's five (red problem, yellow needs you, green done,
blue running, grey idle), taken from the shared map `statusBadge` (`ui/src/lib/status-colors.ts:54-117`) through
the existing `StatusBadge` component (`ui/src/components/StatusBadge.tsx:4`, which already takes a `status` for the
colour and a `label` for the words). The shared map today has more hues than five (cyan, orange); the design system
collapses it, and until then the nearest existing key is used.

| What is true on the server | Label the owner sees | Colour (five-colour rule) | Key in `statusBadge` |
|---|---|---|---|
| Queue row `pending_review` | **Needs your OK** | yellow | `pending_review`: **NEW key**. The shared map has no entry for it today, so `StatusBadge` would fall back to grey (`:119`). |
| Queue row `scheduled` | **Scheduled** | blue | `scheduled` (`:95`) |
| Queue row `publishing` | **Posting now** | blue | `publishing` (`:96`, cyan today) |
| Queue row `published` | **Posted** | green | `published` (`:98`) |
| Queue row `failed` | **Did not post** | red | `failed` (`:71`) |
| Queue row `paused` | **On hold** | yellow | `paused` (`:58`, orange today). Nothing sets this status today (the only mention is `server/src/services/youtube/publish-queue.ts:19`); the label exists so it can never show as a raw code. |
| Run `processing`, no queue row yet | **Being made** | blue | `running` (`:57`, cyan today) |
| Run `failed`, no queue row | **Could not be made** | red | `failed` (`:71`) |
| Run finished, queue row removed | **Removed** | grey | `archived` (`:63`) |
| File with no record | **Unknown file** | grey | `archived` (`:63`) |

The label is always written out; colour is never the only signal. This table lives in one small file used by all
four views (NEW helper, for example `ui/src/lib/youtube-status.ts`); no view defines its own colours.

---

## 5. The review card, in detail

The most important screen in the area. One card per video that needs the owner. Newest first; usually one.

**Starting point (since #202).** The Queue card already shows an inline player (`P:186-194`), a closed drop-down
"Description that will post" (`P:195-200`), and a Publish Now that asks the browser's `confirm()` (`P:207-210`). The
review card below replaces those three stopgaps with the real parts.

### 5.1 What is on it, in order

Reading order, which is also the order in the page for keyboard and screen-reader users. At 1280 px and wider the
card is two columns (section 7), but the order below is the same in one column and in two: the left column holds
rows 1 and 2, the right column the rest. The card has no `<h1>`; the title is a heading below the view's `<h2>`.

| # | Part | Content | Where the data comes from today |
|---|---|---|---|
| 1 | **Player** | The video, 16:9, the browser's own controls, not auto-playing, sound on. Never wider than its column. | The stream route added by #202 (`R:394-423`, Range-capable, admin-only), addressed by file name; the file name comes from `metadata.videoPath` (`production.ts:388`), as the stopgap does (`P:158-159`). The real length comes from the player once it has loaded. Wrapped as `VideoPreview` (section 7). |
| 2 | **How it was made** | One plain line under the player: "Animated (words light up as they are spoken)" · "Slides" · "Slides (the animated version did not work out, so slides were used)" · "Website walk-through". With the length and the made-on time: "2:57 · made Fri, Oct 9 · 6:34 PM". | `assets.visualMode` on the run: `animated`, `presentation`, `presentation-fallback` (`production.ts:178`, `:295`). Not on the queue row (gap 2). `presentation-fallback` already means "the animated render failed" (`:175-199`); after the owner's gate decision it also means "the animated video failed the sync gate" (gap 15). |
| 3 | **Title** | The public title in full, wrapped, as a heading. A small **Edit** button at its end (5.4). If it is longer than 100 characters: "YouTube allows 100 characters. The end will be cut off." (Cannot happen after an edit: 5.4.) | `title` on the queue row. The server cuts at 100 when posting (`publish-queue.ts:89`, `platform-publishers/youtube.ts:53`). |
| 4 | **When it posts** | "Posts **Sun, Oct 11 · 7:00 AM PDT** (in 2 days)". Weekday, date, time and time-zone letters, in the time zone of the owner's computer. | `publishTime` on the queue row. The suggested slot is the next free daily slot, 7 AM Pacific by default (`server/src/services/youtube/publish-slots.ts:19-21`). |
| 5 | **Actions** | See 5.2. They sit right after the title and the time, so the player and the main button are on one screen (section 7). | |
| 6 | **Description** | The text exactly as it will post, plain text with its line breaks, chapter list included. A small **Edit** button (5.4). Long text shows the first lines and a **Show all** link. | `metadata.description` (`production.ts:391`), which already holds chapters at measured times (`production.ts:238-244`). When posting, the server adds a blank line and a line of `#hashtags` built from the tags (`platform-publishers/youtube.ts:54`). The card must show that last line too (the stopgap drop-down does not: section 2, job 2); until the server returns the finished text (gap 2) the tags row carries the note below. |
| 7 | **Tags** | Small chips that wrap. Note: "These are also added as #hashtags at the end of the description." More than 12: show 12 and "+N more". Read-only in the first edit slice (5.4). | `metadata.tags` (`production.ts:390`). Cleaned and capped at 30 when posting (`publish-queue.ts:71`, `platform-publishers/youtube.ts:55`). |
| 8 | **Cover picture** | The generated picture, small. Plain note: "This picture is not sent to YouTube yet. YouTube picks a frame from the video." | Made and saved (`production.ts:127-132`) and not uploaded (`docs/products/youtube-pipeline.md:301`). No route serves it (gap 3). |

Not on the card: file name, file size, service names, the internal id, the raw status code.

### 5.2 Actions, in order of use

| Order | Button | Style | What it does | Today |
|---|---|---|---|---|
| 1 | **Approve** | The one main button on the card | One click, at the suggested time (owner: "Approve in one click at the suggested time"). Keeps the suggested time and marks the video approved. | Needs three clicks (section 2, job 3). Same server call as today: the schedule route with the unchanged time (`R:106-137`). |
| 2 | **Change time** | Secondary | Opens a date-and-time box, already filled with the suggested time. **Approve for this time** saves it. Times in the past cannot be picked; the box says why. | `P:221-263`. Keep the local-time fill (`P:252-256`). |
| 3 | **Post now** | Secondary, on the card | Asks first (dialog below), then uploads. | `P:205-219`: asks the browser's `confirm()` since #202 (`P:207-210`); main-coloured. |
| 4 | **Remove** | Plain red text, set apart from the others | Asks first (dialog below). | `P:265-273`: unlabelled bin, browser pop-up. |
| — | **More** menu | Small | **Download the file** · **Copy link to this video**. | Download is on the other page (`V:230-235`). |
| — | **Edit** (title, description) | Small text buttons beside the text they change | Opens the dialog in 5.4. | Not possible today. |

**Helper text under Approve, one sentence:**
"Puts this video on YouTube, for everyone to see, on Sun, Oct 11 at 7:00 AM." The date and time are the live
values and change when the time is changed. [Occam: the default is pre-chosen; Von Restorff: one main button]

**If the suggested time has already passed** (the owner comes back days later): the main button becomes
**Pick a time** and the helper reads "The suggested time has passed. Pick a new time, or post it now." This removes
the silent "posts within 15 minutes" case. [Postel: prevent the error]

**After Approve** the card does not just vanish. It folds into one line: "Approved. Posts Sun, Oct 11 at
7:00 AM. · Change time · See it in Scheduled". If nothing else is waiting, the "all caught up" state follows.
[Peak-end]

**Dialog for Post now** (`AlertDialog`; owner: "On the card, with an are-you-sure box"): title "Post this video
now?" · text "It goes on YouTube right away and everyone can see it. You cannot take it back from this dashboard."
· buttons **Not now** / **Post now**. It replaces the browser `confirm()` that #202 added ("Post this video publicly
on YouTube right now?", `P:209`).

**Dialog for Remove** (`AlertDialog`), saying what happens to the file:

- Title: "Remove this video?"
- Text: "It will not be posted. The video file stays on our server until **Nov 8** and then deletes itself. You can
  delete it sooner under Files."
- Buttons: **Keep it** / **Remove**.
- The date is the day the video was made plus 30 days (`video-cleanup.ts:22`, `:47-59`).
- **Decision, named.** The first draft proposed a dialog **and** an undo (**Put back**), because a confirm is the
  weaker protection (people click through it) and an undo the stronger. The owner asked for the confirm dialog and,
  for clean-up, chose "Delete right away". So: **dialog only.** Put back (the old gap 10) is dropped. Remove erases
  the queue row as it does today (`R:139-153`); the only way back is a hand-made backup file on the server
  (`docs/products/youtube-pipeline.md:198`). Revisit only if the owner asks for an undo.

### 5.3 States

Every state says what happened and what to do next. [Postel, second half]

| State | When | What the owner sees | Source / note |
|---|---|---|---|
| **Loading** | First load | A grey placeholder shaped like the card: a 16:9 block, three text lines, a button row. Same height as the real card, so nothing jumps. | `Skeleton`. Today: the word "Loading..." (`P:292-293`). |
| **Nothing to review** | No video needs the owner | "You are all caught up. The next video is made tonight at about 11:00 PM and shows up here about 10 minutes later." Below: "Next to post: <title> · Sat, Oct 10 · 7:00 AM" with a link to Scheduled, when there is one. | The next run time already exists: job `yt:daily-production`, field `nextRunAt` (`ui/src/api/system-crons.ts:3-17`, served by `server/src/routes/system-crons.ts:23-31`). "About 10 minutes" is from the two measured runs, 240 s and 619 s (`youtube-pipeline.md:76`, `:203`). |
| **Daily videos are off** | The nightly job is switched off | In place of the "next video" sentence: "Daily videos are switched off, so no new video will be made." | `enabled` on the same job, and `enabled` from the config route (`R:219`). |
| **Being made** | A run is in progress | A slim card: "Tonight's video is being made. This takes about 5 to 10 minutes." No buttons. It turns into the review card by itself. | `running` on the job (`ui/src/api/system-crons.ts:16`) or a run with status `processing` (`production.ts:77`). INFERRED: a run cut short by a restart may stay `processing`; after 30 minutes show the "could not be made" card with the reason "It stopped part-way." |
| **Video file is gone** | The file was deleted (30 days) or cannot be found | The player area becomes a grey 16:9 box: "The video file is no longer on our server. Files are deleted 30 days after a video is made." Approve and Post now are switched off with the reason "Cannot post: the file is gone." **Remove** stays. | `filesPurgedAt` on the run (`youtube_pipeline.ts:110`); a video still waiting after 30 days is purged too (`youtube-pipeline.md:149-150`). Posting a missing file fails (`publish-queue.ts:74-76`). The stream route answers 404 for a missing file (`R:405-408`). The card needs a yes/no from the server (gap 2). |
| **Slide video instead** | The animated video failed the sync gate and the same night made a slide video (owner: "Make a regular slide video instead") | A normal review card. The "How it was made" line reads "Slides (the animated version did not work out, so slides were used)". No warning strip: the owner asked for exactly this. | `assets.visualMode = presentation-fallback` (`production.ts:198`); the gate's reason stays in the run's record (gap 15). Today a gate failure ends the night (`production.ts:277-281`). |
| **Could not be made** | A night's run failed and no video came out. After the owner's gate decision, this means the animated video **and** the slide video both failed, or something else broke earlier | Card under "Needs attention": "Last night's video could not be made." + one plain reason + **Make a new one** + a closed "Technical detail" line. Plain reasons: "Neither the animated video nor the slide video lined up with the voice, so nothing was queued." · "The script did not pass our honesty and length checks." · "The pictures could not be made." · "Something went wrong while making it." | `error` on the run. Known texts: `sync gate: …` (`production.ts:277`), `script_validation: …` (`server/src/services/youtube/script-writer.ts:493`), "No visual assets or video assembly failed" (`production.ts:306`). The plain sentence should come from the server (gap 7). Shown until a newer video exists. |
| **Posting now** | Upload in progress | The card locks: "Posting to YouTube now…" with a spinner; all buttons off. Refreshes every 5 seconds. When done: "Posted. Watch on YouTube." If it is still posting after 15 minutes: "This is taking too long and may be stuck." + the technical detail. | Status `publishing` (`publish-queue.ts:81-84`). INFERRED: a failed **Post now** can leave the row stuck in `publishing`, because that path has no failure handling (`publish-queue.ts:128-141`; the scheduled path has it at `:43-55`). See gap 12. |
| **Did not post** | A scheduled upload failed | Card under "Needs attention": "This video did not post." + one plain reason ("YouTube is not connected." · "The video file is missing." · "YouTube refused it.") + **Remove**. **Try again** appears once the server offers a safe retry (gap 12). | `error` on the queue row (`publish-queue.ts:48-54`). Known texts: `publish-queue.ts:64`, `:75`, `:95`. Today such a row cannot be re-scheduled or re-posted, on purpose, to avoid a double upload (`R:116-118`, `R:130-132`). |
| **Approve did not work** | The click failed | A red line inside the card, under the buttons, not only a pop-up toast. If the video changed meanwhile (server answers 409: `R:130-132`): "This video was already posted or removed. Refresh to see where it is." + **Refresh**. Otherwise: "That did not save. Nothing was changed. Try again." + **Try again**. The buttons come back to life. | Today a failed click shows nothing (no error handling in `P:133-150`). |
| **Edit did not save** | The save in 5.4 failed | The dialog stays open with the owner's text kept, and a red line inside it: "That did not save. Nothing was changed. Try again." If the server answers 409 (the video is posting or posted): "This video is already posting or posted, so it can no longer be edited." | Gap 14. |
| **YouTube is not connected** | The connection keys are missing | A warning strip at the top of Review: "YouTube is not connected, so approved videos cannot post." + link to Advanced. Shown only when broken. | `youtubeConfigured` (`R:223-227`). Today a tick or cross on the Config tab (`P:410-417`). |
| **Admin only** | A marketing-only account opens the tab (section 4) | One plain state: "This area is for admins." No request is made. Or the tab is hidden for that account. | `marketing-role-gate.ts:37-54` has no `/api/youtube` entry. |

### 5.4 Edit the title and description before approving (owner: "I want that")

**Where.** A small **Edit** button at the end of the title and one beside the description (5.1 rows 3 and 6). Both
open the same dialog. Offered while the video is waiting or scheduled (the statuses that can still be changed:
`PUBLISHABLE_QUEUE_STATUSES`, `publish-queue.ts:19`), never while it is posting, posted or failed.

**Dialog, not inline.** A small `Dialog`. One line of reason: a description of up to 5,000 bytes needs room and a
live preview, typing inline would push the Approve button out of view and leave a half-edit sitting on the card,
and a dialog has one Save and one Cancel so nothing changes until the owner says so. [Postel, Doherty]

**What is in the dialog.**

- **Title** (`Input`) with a counter "73 / 100".
- **Description** (`Textarea`) with a counter in bytes, "1,204 / 5,000 bytes", and one hint: "Keep the lines that
  start with a time. They are the chapter list."
- **Preview, "Exactly what will go on YouTube"**: the title and the description as the upload will send them,
  hashtag line included, updating as the owner types. It comes from the same function the upload uses (gap 2), so
  the preview cannot drift from the post. The same text appears on the card after Save.
- **Save changes** (main) and **Cancel**. Save is off while anything is invalid, with the reason beside it. Saving
  does **not** approve: Approve stays its own click. After Save the card reads "Saved. Not approved yet."
- Tags are shown but not editable in this slice (the owner asked for title and description).

**Limits** (YouTube's, from the Data API reference for the videos resource, read 2026-10-10: title "a maximum
length of 100 characters"; description "a maximum length of 5000 bytes"; both "may contain all valid UTF-8
characters except < and >"). The owner's figures are 100 and 5,000, which match. The dialog enforces them and the
server enforces them again:

- **Title:** not empty after trimming; at most **100 characters**; no `<` or `>`. Over the limit: "YouTube allows
  100 characters. Shorten it by 12." (The silent cut at 100 in the publisher stays as a last safety net.)
- **Description:** at most **5,000 bytes**, counted in UTF-8 on the **final** text, meaning the description plus
  the blank line and hashtag line the upload appends (`platform-publishers/youtube.ts:54`), because that whole
  string is what YouTube measures. An accented letter or an emoji counts as 2 to 4 bytes, so a counter in
  characters would be wrong. No `<` or `>`. Over the limit: "Too long for YouTube by 140 bytes."

**Server:** `PATCH /queue/:id` (gap 14).

---

## 6. User flow and journey

### The daily flow

1. The owner opens **Socials & Content** from the left menu and clicks its **YouTube** tab, or follows a link he was sent. He lands on **Review**.
2. The newest video is at the top, with the label "Needs your OK". He presses play. *(click 1)*
3. While it plays, or after, he reads the title, the description with its chapters, and the tags, on the same screen.
4. He checks the line "Posts Sun, Oct 11 · 7:00 AM PDT".
5. He presses **Approve**. *(click 2)* The helper sentence under the button has already told him what that does.
6. The card folds into "Approved. Posts Sun, Oct 11 at 7:00 AM." The Scheduled tab's number goes up by one.
7. If another video is waiting it is next on the page. If not: "You are all caught up", with the time of the next video.
8. He leaves. The video posts by itself at its time and then appears under **Posted** with **Watch on YouTube**.

Side paths from step 4: **Change time** (pick, then "Approve for this time") · **Post now** (dialog, then it posts)
· **Edit** (the title or the description, then Save; the card shows the saved text, still waiting for Approve) · **Remove** (dialog, then it is gone from Review; its file stays until it deletes itself or is deleted under Files).

### Journey

| Step | What he sees | What he thinks | What could go wrong | How the design answers |
|---|---|---|---|---|
| Arrives | The hub's heading and tab row with YouTube lit, the area's four views under it, Review open with a "1" | "There is one for me." | He lands somewhere else and cannot find it (today: the Pipeline tab, `P:478`). | Review is the default; the view is in the address; a link can open the video itself. |
| Watches | A player at the top of the card | "Does it look and sound right?" | The video will not play or seek; the file is gone. | A streaming route with seeking; the "Video file is gone" state. |
| Reads | Title, description with chapters, tags, beside the player | "Is this what I want the world to read?" | He approves without seeing the description (today it is not shown at all). | The public text is on the card, in the form it will post. |
| Checks the time | "Posts Sun, Oct 11 · 7:00 AM PDT (in 2 days)" | "Is that when I want it?" | Wrong time zone; the time already passed. | The computer's time zone with its letters; the passed-time guard. |
| Decides | One main button, **Approve**, with a sentence under it | "One click and it is done." | He hits the wrong button and it goes public at once (today's "Publish Now", `P:205-219`). | Approve is the only main button; Post now and Remove both ask first. |
| Gets an answer | "Approved. Posts Sun, Oct 11 at 7:00 AM." | "Good, done." | The click fails without a word (today). | A red line in the card with a way forward. |
| Comes back later | Posted, newest first, **Watch on YouTube** | "Did it go out?" | It failed overnight and he never learns. | A failed upload comes back to Review under "Needs attention", and the Review number counts it. |

---

## 7. Layout spec

**Rules for every view in the area**

- **Nothing scrolls sideways.** No element is wider than its column. The page shell's content pane is set to
  scroll in both directions (`ui/src/components/Layout.tsx:453`), so one child that is too wide lets the whole page
  slide left and right (INFERRED from the class). The biggest known cause, the hub's ten tabs (1,150 px wide, which
  pushed the pane 158 px sideways in a 1280 px window), was fixed by #202: `PageTabBar` now wraps
  (`PageTabBar.tsx:38-46`; the two numbers are from that code comment, measured by the orchestrator, not re-measured
  here). Likely causes left in the old pages (the unbroken link text at `P:167-175`, the file name at `V:199`) go
  away with those pages (INFERRED).
- **One `<h1>` per page, and it is the hub's** ("Socials & Content"). The area adds none; its breadcrumb has two
  crumbs so the top bar prints a trail instead of another `<h1>` (section 4).
- **Long text wraps or is cut with "…"**; it never pushes the layout. Titles wrap (cut to two lines in lists, never
  in Review). The description and "Technical detail" use wrapping that also breaks long unbroken strings (web
  addresses, ids). File names appear only behind "Details", wrapped. Every flex row that holds text can shrink.
- **No fixed width wider than the column.** The player is fluid: full column width, 16:9 kept by ratio, never a
  pixel width. Pictures are capped at the column width. The date box may be at most the column width. The edit
  dialog is at most the column width on a phone.
- **One main button per card or view.** [Von Restorff]
- **Tokens only.** Use the theme's named colours (`ui/src/index.css:47-66`: background, foreground, card, primary,
  muted, destructive, border) and the `statusBadge` map. No raw palette classes of the kind used today
  (`P:43-51`, `P:172`, `P:272`, `V:47-54`, `V:117-157`). Exact token names, the roomier spacing steps and the
  rounded corner sizes follow `docs/ux/design-system.md` (v1, the owner's decisions of 2026-10-10 applied; its own
  change, not on master when this was written).
- **Owner's look decisions.** Black-and-coral look; roomier spacing; rounded cards; five status colours; dark and
  light both kept, opening in dark (section "Owner decisions"). Every view, dialog and state is checked in both
  themes (criterion 17).
- **The area adds no padding of its own.** The pane already pads (`Layout.tsx:452`) and the hub adds a second layer
  (`SocialsContentLayout.tsx:99`). That double layer is the hub's; the widths below already count it.
- **Dates** go through the shared helpers (`ui/src/lib/utils.ts:14`, `:22`, `:32`), not page-local copies
  (`P:32-40`, `V:35-45`). A small addition is needed for "weekday + time-zone letters".
- **Button size:** the standard height (40 px, `ui/src/components/ui/button.tsx:24`) for card actions, not the
  small size used today (36 px, `:26`) or icon-only buttons (`P:229-245`). [Fitts]

**Widths to design for.** The left rail is 72 px (`ui/src/components/CompanyRail.tsx:270`) and the menu 240 px
(`ui/src/components/Sidebar.tsx:52`); the pane pads 24 px a side on desktop (`Layout.tsx:452`) and the hub pads
another 24 (`SocialsContentLayout.tsx:99`). So the content column is about **872 px in a 1280 px window** and about
**616 px in a 1024 px window**. Below 768 px the app is in its phone layout (`ui/src/context/SidebarContext.tsx:12`):
16 px pane padding plus the hub's 24, about **310 px at 390 px**. (The first draft said 920, 664 and 358: it left
out the hub's own padding, which now counts.)

**Above the fold, redone with the hub's frame counted (INFERRED arithmetic, nothing measured).** Before the card
starts, the stack is the top bar (48 px, `ui/src/components/BreadcrumbBar.tsx:50`), the pane and hub padding (24 + 24),
the hub's heading and subtitle (about 52), the hub's tab row, which wraps to two lines at 872 px since #202 (about
80), gaps (about 40), then the area's pill row, its promise line and their gaps (about 90): roughly **350 px**. A
1280 × 720 viewport (a 1280 × 800 window less the browser's own bar) leaves about 370 px for the card. That is why
the first draft's card (player on the left at 58%, buttons under it) no longer fits: the buttons would sit near
y = 740. The card therefore puts the title, the posting time and the buttons at the top of the **right** column, beside the
player. Estimated: the player spans y = 380 to 650 and **Approve** sits at about y = 480 to 520, both inside 720. The
builder measures this; if it does not hold, the promise line is dropped on Review first, then the player narrows.

### Shared frame (all four views)

| Region, top to bottom | Component | Notes |
|---|---|---|
| Top bar breadcrumb | existing `BreadcrumbBar` via `useBreadcrumbs` | Two crumbs: "Socials & Content" (links to `/socials`) › "YouTube". |
| Hub heading, subtitle and hub tab row | existing `SocialsContentLayout` | Supplied by the hub; unchanged. The YouTube tab is lit. |
| Second-level tab row | existing `PageTabBar` with the new `variant="pill"` | The four views; the address changes with the tab (section 4). Text labels only ("Review (1)"). |
| One-line promise | plain muted text | Changes per tab (section 4). Not a heading. |
| Warning strip (only when something is broken) | **NEW `Notice`** (tones: info, warning, error; text + one action) | No such component exists in `ui/src/components/ui`. |
| View content | below | |

### Review

| Region | Component | Behaviour |
|---|---|---|
| "Needs attention" group (only if any) | `Notice` or `Card` + `StatusBadge` + `Button` | "Could not be made" and "Did not post" cards. Above the videos. |
| "Needs your OK" group | **NEW `ReviewCard`** = `Card` + **NEW `VideoPreview`** + `StatusBadge` + `Button` + `Badge` (tags) + `Collapsible` (Show all) + `DropdownMenu` (More) + `AlertDialog` (dialogs) + `Dialog` with `Input` and `Textarea` (edit, 5.4) | One per video, newest first. More than three: the first three open, the rest folded to a title line. [Miller] |
| "Next to post" line | text + link | Only when something is scheduled. |
| Empty / loading | `EmptyState` (`ui/src/components/EmptyState.tsx:12`) / `Skeleton` | `EmptyState` has no secondary link today; a small extension is needed for "See what is scheduled". |

**`VideoPreview` (NEW; add to the design-system catalogue first).** A 16:9 box with the browser's video controls,
an optional poster, and three built-in states (loading, file gone, cannot play). Fluid width. The nearest thing in
the repo is the stopgap's bare `<video>` (`P:188-193`) and another in `ui/src/pages/ContentReview.tsx:718`.

**Responsive behaviour of the card**

- **Window 1280 px and wider (two columns, content column about 872 px).** Left, about 55%: the player, and under
  it the "How it was made" line with the length and made-on time. Right, about 45%: the title with **Edit**, the
  "Posts…" line, the buttons and the helper sentence, then the description with **Edit**, the tags and the cover
  picture. The DOM order is left column then right column, which is the order of 5.1.
- **Narrower than 1280 px, including 1024 px (one column, about 616 px).** The card is at most about 760 px wide. The
  same order as 5.1 from top to bottom. The description shows six lines and "Show all"; tags show two rows and "+N more".
- **Phone (under 768 px, about 310 px).** Same single column. **Approve** is full width. **Change time** and **Post
  now** share a row and wrap to two rows if they do not fit. **Remove** is on its own line at the end of the buttons.

**Wireframe: Review, desktop (content column about 870 px)**

```
Socials & Content                                                   <- the hub's one <h1>
Unified hub for social accounts, content review, analytics, ...
Overview  Content  Analytics  Twitter/X  Discord  [YouTube]  Marketing Pushes  House Ads
Auto-Reply  Launch Monitor                          <- the hub's row; it wraps since #202
----------------------------------------------------------------------------------------
( Review 1 | Scheduled 2 | Posted | Files & settings )            <- the area's quieter pill row
New videos wait here until you say yes.

Needs your OK
+----------------------------------------------------------------------------------------+
| +-----------------------------------------+   (Needs your OK)                           |
| |                                         |                                             |
| |                                         |   Discipline Over Motivation:       [Edit]  |
| |             VIDEO   16:9                |   Small Habits That Stick                   |
| |          (browser controls)             |                                             |
| |                                         |   Posts Sun, Oct 11 · 7:00 AM PDT (in 2 d)  |
| |                                         |                                             |
| +-----------------------------------------+   [ Approve ] [ Change time ] [ Post now ]  |
|  Animated (words light up as they are         Puts this video on YouTube, for everyone  |
|  spoken) · 2:57 · made Fri, Oct 9, 6:34 PM    to see, on Sun, Oct 11 at 7:00 AM.        |
|                                               Remove                       More v       |
|                                                                                         |
|                                               DESCRIPTION                     [Edit]    |
|                                               <first lines of the text>                 |
|                                               00:00 Introduction                        |
|                                               00:18 ...                                 |
|                                               Show all                                  |
|                                               TAGS                                      |
|                                               (tag) (tag) (tag) (tag) +12 more          |
|                                               Also added as #hashtags at the end.       |
|                                               COVER PICTURE [ small ] Not sent yet.     |
+----------------------------------------------------------------------------------------+
Next to post: <title> · Sat, Oct 10 · 7:00 AM                        See all scheduled ->
```

The title, length, posting time and the first chapter in this picture are the recorded values of the first
animated video (`docs/products/youtube-pipeline.md:74-81`); the made-on time is the end of its run log
(`docs/handoffs/2026-10-09-youtube-animated-live.md:42-43`). The other chapter titles, the description text and
the tags are not recorded in the docs, so they are left as placeholders.

**Wireframe: Review, narrow (390 px wide, content about 310 px)**

```
Socials & Content
Unified hub for social accounts,
content review, analytics, ...
[ YouTube                      v ]      <- the hub's row, a drop-down on phones
[ Review (1)                   v ]      <- the area's row, a drop-down too
New videos wait here until you
say yes.
----------------------------------
Needs your OK
+--------------------------------+
| +----------------------------+ |
| |        VIDEO  16:9         | |
| |     (browser controls)     | |
| +----------------------------+ |
| Animated · 2:57                |
| (Needs your OK)                |
| Discipline Over Motivation:    |
| Small Habits That Stick [Edit] |
| Posts Sun, Oct 11 · 7:00 AM PDT|
| [          Approve           ] |
| Puts this video on YouTube,    |
| for everyone to see, on Sun,   |
| Oct 11 at 7:00 AM.             |
| [ Change time ] [ Post now ]   |
| Remove                  More v |
|                                |
| DESCRIPTION             [Edit] |
| <six lines of the text>        |
| Show all                       |
| TAGS                           |
| (tag) (tag) (tag) (tag)        |
| (tag) (tag) +10 more           |
| COVER PICTURE  [ small ]       |
| Not sent to YouTube yet.       |
+--------------------------------+
```

**Wireframe: the edit dialog (5.4), desktop**

```
+--------------------------------------------------------------+
| Edit title and description                                   |
|                                                              |
| Title                                                        |
| [ Discipline Over Motivation: Small Habits That Stick     ]  |
|                                                    52 / 100  |
| Description                                                  |
| [ <the text, with its chapter lines>                      ]  |
| [                                                         ]  |
| Keep the lines that start with a time. They are the          |
| chapter list.                                  1,204 / 5,000 |
|                                                    bytes     |
| Exactly what will go on YouTube                              |
| +----------------------------------------------------------+ |
| | Discipline Over Motivation: Small Habits That Stick      | |
| | <description as sent, then a blank line and #hashtags>   | |
| +----------------------------------------------------------+ |
|                                  [ Cancel ] [ Save changes ] |
+--------------------------------------------------------------+
```

### Scheduled

| Region | Component | Behaviour |
|---|---|---|
| Day groups: "Today", "Tomorrow", then "Sun, Oct 11" | group headings (`<h2>`) + `Card` rows | Soonest first. |
| Row: small cover picture (when it can be fetched), title (two lines at most), "7:00 AM PDT", `StatusBadge` "Scheduled", **Change time**, **More** (Edit, Post now, Remove) | `Card`, `StatusBadge`, `Button`, `DropdownMenu`, `AlertDialog` | Clicking the row opens the full card (player, public text, actions) in a side panel: `Sheet`. On a phone the buttons drop under the title. |
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
| Summary line: "30 video files · 144 MB on our server. Files delete themselves 30 days after a video is made. Posted videos stay on YouTube." | `MetricCard` (`ui/src/components/MetricCard.tsx:14`) or plain text | Replaces four tiles. The two numbers are the 2026-10-07 figures, used here as the example; the owner's sheet of 2026-10-10 counts more (section 9). |
| File groups: "Waiting or scheduled (kept safe)" · "Already on YouTube" · "Removed or never posted" · "Could not be finished" · "Files we cannot match to a video" | group headings + `Card` rows | Each row: title, "Made Oct 9", size, "Deletes itself on Nov 8", **Watch**, **Download**, **Delete file** (not offered in the first group). **Delete file** asks first and deletes at once: "Delete this file now? This cannot be undone." (owner: "Delete right away"). "Details" opens the file name, wrapped. |
| "Make a video now": topic box (optional) + button + "Takes about 5 to 10 minutes. The new video shows up in Review." | `Input`, `Button` | Not the main action of the area; plain secondary button. |
| **Advanced** (closed by default) | `Collapsible` | "How it is set up": daily videos on or off · video style (Animated or Slides) · YouTube connection · voice services · picture services. Then "Videos that could not be made", with the technical detail. A link to the Cron Jobs page for schedules. |

Responsive: one column at every width. A file row keeps title and dates on the first line and its buttons on the
second; under 768 px the size and the dates stack under the title. File names, only ever behind "Details", wrap.

---

## 8. Success criteria (testable)

1. **Three clicks to a playing video.** From any dashboard page: "Socials & Content" in the left menu (1), the
   YouTube tab (2), play (3). From the hub's own row: two. From a link to the video: play (1). (The first draft said
   two, with a menu item of its own; the owner chose to stay inside the hub.)
2. **Approve without leaving.** The owner can watch, read the title, description and tags, and approve on the
   Review view: no second page, no new browser tab, no download.
3. **Approve is one click** at the suggested time. Changing the time takes at most three.
4. **No surprise publishing.** The only single click that leads to a public video is **Approve**, and the sentence
   under it states the day and time. **Post now** and **Remove** always open an `AlertDialog` first (not the
   browser's `confirm()`); Post now's text says it goes public at once.
5. **The Remove dialog says what happens to the file**, with the real date. Choosing "Keep it" changes nothing.
6. **No sideways scroll at 1280, 1024 and 390 px wide** in any of the four views, in the side panel and in the edit
   dialog: the content pane's scroll width equals its visible width. Tested with stress data: a 100-character
   title, a 5,000-byte description that contains a 200-character unbroken string, 30 tags, a 46-character file name.
7. **One label and one colour per status, everywhere, from the owner's five.** A test renders every status in every
   view and compares it with the table in section 4. A search of the area's files finds no raw palette colour class.
8. **One main button** per card and per view.
9. **Old links still work.** `/socials/youtube` and `/youtube` open Review; `/youtube/videos` opens Files.
10. **Every state is designed.** Loading, nothing to review, daily videos off, being made, file gone, slide video
    instead, could not be made, posting now, did not post, approve failed, edit failed, YouTube not connected,
    admin only: each shows what happened and what to do next. One test or story per state.
11. **The view is in the address.** A refresh keeps the view; `/socials/youtube/review?video=<id>` opens that video.
12. **No build words in the daily views.** Review, Scheduled and Posted contain none of: `.mp4`, a byte size,
    `pending_review`, `presentation-fallback`, "Pipeline", "Production", a service name.
13. **Above the fold.** In a 1280 × 720 viewport, with the hub's heading and both tab rows above it, the player and
    the Approve button are both visible without scrolling the pane (section 7 estimates this; the builder measures it).
14. **Times are right.** Times show the weekday and time-zone letters of the viewer's computer; approving without
    changing the time saves the same moment (tested with the browser in a non-UTC zone).
15. **Quick answer.** After a click on Approve the button shows a "working" state within 400 ms, measured.
    [Doherty]
16. **Keyboard.** Every action is reachable with Tab, in the order of 5.1; dialogs hold focus and close with Esc.
17. **Both themes.** Every view, dialog and state is checked in dark (the default) and in light; text and status
    labels stay readable in both.
18. **One `<h1>`, one hub-level tab row.** With the area open, the page has exactly one `<h1>` ("Socials & Content")
    and the area's own row uses the `pill` variant. A test counts the `<h1>` elements.
19. **Edit is safe.** A title over 100 characters, or a description over 5,000 bytes (counted on the final text),
    or either containing `<` or `>`, cannot be saved, in the page and at the server. A test compares the text the
    preview shows with the text the upload sends: they are identical. A video that is posting or posted refuses an edit.
20. **Gate failure falls back.** A test forces the sync gate to fail for an animated video: a slide video is queued
    with `assets.visualMode = presentation-fallback`. Only when that one also fails is nothing queued.

---

## 9. Clean-up the owner asked about (his choice is recorded; nothing has been deleted)

### What the owner chose (sheet, 2026-10-10)

His words: "5 videos made but never posted (25 MB) + 29 server copies of videos already on YouTube (152 MB) + Slide +
thumbnail pictures from past videos (888 MB) + Old-style videos on the YouTube channel itself", and for how:
"Delete right away". The sizes are the sheet's; none was re-measured for this spec (UNVERIFIED).

| # | Group (letters as in the first draft; P is new) | Sheet figure | Who deletes it, and how |
|---|---|---|---|
| A | Video files of videos that were removed and never posted | 5 videos, 25 MB | The owner, with one command run against an exact list (below). |
| B | Server copies of videos that are already on YouTube | 29 copies, 152 MB | Same. |
| P | Slide and thumbnail pictures from past videos | 888 MB | Same, once. Then the nightly clean-up takes over (build item 1 below). |
| G | Old-style videos on the YouTube channel itself | not sized | The owner, in YouTube Studio. |

**Not chosen, so left alone:** the 29 stuck or failed entries in the list (database rows, not files); leftovers of
nights that failed (D); the small `timeline_<id>.json` side files (E); files with no record (C: they stay visible
and playable in Files); waiting or scheduled videos whose file is already gone (F). The owner wrote "Nothing yet"
for anything else.

**A correction.** The first draft said cover and slide pictures "are small" and kept them on purpose (it cited 140
cover pictures at 43.8 MiB on 2026-10-07: `docs/products/youtube-metadata-audit-2026-10-07.md`, section Q5). The
sheet's 888 MB for slide and thumbnail pictures together shows the slide pictures are not small. That statement is
withdrawn. The first draft's only evidence was a code comment (`video-cleanup.ts:5-7`) and the cover-picture figure;
nobody had measured the slide folders.

### How it will be done (the assistant does not delete anything)

1. **Server files (A, B, P).** The assistant prepares a read-only listing, built on the server from the database and
   the folders, saved as a file the owner can open. One line per file: the video's title, made-on date, size, and why it is
   listed (A: no queue row and never posted; B: queue row `published` with a YouTube address; P: pictures of a video
   older than the retention). It shows a total per group so the owner can compare it with the sheet. Nothing is deleted at
   this step.
2. **One command**, printed with the list. It deletes exactly the files named in that list and nothing else, refuses
   any path outside the YouTube data folder and anything under `archive/`, and prints what it removed. The owner reads
   the list, then runs the command. Nothing runs from the dashboard.
3. **Channel videos (G)** are deleted by the owner in YouTube Studio; the dashboard cannot do it, because its YouTube
   permission is upload-only (`docs/products/youtube-pipeline.md:200`). **Set to Private** is the reversible
   alternative: viewers stop seeing the video, but it stays in Studio with its views and comments and can be made
   public again. Deleting loses the views, comments and links for good. Which videos are "old-style" is the owner's
   call (the first draft guessed: made before the timing fix, INFERRED); the assistant can list candidates from the
   Posted history but cannot judge them.

**Check before the command runs (UNVERIFIED today).** The archive keeps its own copy of each script-v2 video's
slides and thumbnail (`server/src/services/youtube/archive.ts:88-108`), and the owner decided on 2026-10-08 to keep
every one (`youtube-pipeline.md:257`). Group P must be the *working* copies (`assets/<id>/` and the `thumb_*` files:
`youtube-pipeline.md:18`, audit doc line 89), never `archive/`. Whether the sheet's 888 MB counts the archive copies
as well is not known; the listing prints sizes per folder so the owner sees which. Videos made before the archive
existed have no archive copy, so deleting their pictures is final.

### Build items that follow from the choice

1. **Pictures pile up forever today: assets are never purged.** The nightly clean-up (`yt:cleanup-videos`, 2 AM:
   `server/src/services/youtube/yt-crons.ts:89-99`) deletes video, audio and caption files after 30 days and keeps
   thumbnails and slide pictures by design (`video-cleanup.ts:1-9`). Extend it to purge, for productions older than the
   retention, the slide pictures in `assets/<id>/` and the `thumb_*` files, and leave `archive/` alone. The retention
   for pictures is the owner's call; default, the same 30 days. Trap: the job only visits rows whose `filesPurgedAt`
   is empty (`video-cleanup.ts:57`), so rows already purged would never be revisited for their pictures; the picture
   purge needs its own marker or a pass over those rows.
2. **Delete file in Files** (section 7): immediate, after a confirm dialog; never offered for waiting or scheduled
   videos (gap 11).

**Declined.** The first draft proposed a 7-day holding folder with a Put back button. The owner chose "Delete right
away", so it is dropped (the old gaps 10 and 11 changed accordingly).

**Not candidates (keep):**

- **The archive** of scripts, timelines, slides, cover pictures and captions: an owner decision of 2026-10-08
  (`docs/products/youtube-pipeline.md:257`).
- **Database rows of posted videos**: they are the Posted history and hold the YouTube links.
- **The backup files of removed rows on the server** (`youtube-pipeline.md:198`, `:293`): today the only undo.

**Goes with the build, not a deletion:** the screen elements marked REMOVE in section 3 and, once the new area
replaces them, the two old pages; and unused code (two API calls no screen uses, `ui/src/api/youtube.ts:15-17`, and
an unused folder constant, `R:24`).

**Rules for any delete in the dashboard**

1. **Keep the automatic 30-day delete** exactly as it is (plus the picture purge above).
2. **Delete file** asks first, says it cannot be undone, and deletes at once.
3. **Never offered** for a video that is waiting or scheduled.
4. **No "delete all" button.** One file at a time, each after seeing its title, or playing it.
5. Files with no record (C) are shown and playable; nothing removes them by itself.
6. Group G (the YouTube channel) stays out of the dashboard unless the owner asks for it by name.

---

## 10. API gaps (for the back-end builder)

What the new area needs that the server does not give today. The first slice needs none of them: it runs on the
data the queue route already sends and on the stream route that #202 added.

1. **A video stream that can seek — done in #202.** `GET /videos/:filename/stream` (`R:394-423`) is admin-only
   (`R:34-40`), answers Range requests through `res.sendFile`, and returns 404 for a missing file; its test asserts a
   206 answer for a byte range and 401 for an anonymous caller (`server/src/__tests__/youtube-video-stream.test.ts:65-85`,
   read, not run). The UI helper is `youtubeApi.getVideoStreamUrl` (`ui/src/api/youtube.ts:49-50`). Left, optional: address
   it by video id, so the page never handles file names (the stopgap derives the name from `metadata.videoPath`:
   `P:158-159`).
2. **One "video to review" answer.** The queue row joined with its run and its SEO record: title; whether the
   title will be cut at 100; **the description exactly as it will post**, hashtag line included; the tags as they
   will be sent; chapters as a list (`youtube_pipeline.ts:59`); how it was made (`assets.visualMode`); made-on time;
   posting time; status; YouTube link; posted-on time; error; **is the file still there**; the date the file will
   delete itself; a cover-picture address. The preview text and the real upload must come from the **same**
   function, so the preview can never drift from what is posted (`publish-queue.ts:67-92` builds it at posting
   time today). The edit dialog (5.4) depends on this function.
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
10. **Dropped: remove without erasing, and Put back.** The first draft wanted a "removed" state in place of the hard
    delete (`R:139-153`). The owner chose a confirm dialog and "Delete right away" and asked for no undo, so Remove
    stays as it is.
11. **Delete file, immediately** (replaces the first draft's 7-day holding folder, which the owner declined). A
    route that deletes one named video file at once, admin-only like the rest. It refuses a file whose video is
    waiting, scheduled or posting; it sets `assets.videoPath` empty and `filesPurgedAt` the way the nightly job does
    (`video-cleanup.ts:57`), so the row does not show a missing file as a fault; and it also works for files with no
    record. It refuses a path outside the videos folder (the same filename checks as `R:399-402`).
12. **A safe "Try again" for a failed upload**, which first checks that YouTube does not already have the video.
    And make a failed **Post now** end as "failed", not stay "publishing" (`publish-queue.ts:128-141`; INFERRED,
    not reproduced).
13. **Refuse a posting time in the past** on the schedule route (`R:112-115`), or say plainly that it will post
    within 15 minutes.
14. **Edit title and description before approving** (owner: "I want that"): `PATCH /queue/:id`, body
    `{ title?, description? }`.
    - **Only for unpublished rows**: the statuses in `PUBLISHABLE_QUEUE_STATUSES` (`pending_review`, `scheduled`,
      `paused`: `publish-queue.ts:19`), the same guard the schedule route uses (`R:126`). Any other status: 409
      with a plain message, as `R:130-132` does.
    - **What it writes, in one transaction.** The queue row's `title` (the upload reads it: `publish-queue.ts:89`),
      the queue row's `metadata.description` (the upload reads it: `publish-queue.ts:72`), and the `yt_seo_data` row
      named by `metadata.seoId` (`production.ts:386`; columns `title` and `description`:
      `packages/db/src/schema/youtube_pipeline.ts:55-56`), so the SEO record stays in step. No `seoId` on the row:
      update the queue row only. Tags, chapters and the archive copy (written when the video was made) are not touched.
    - **Validation, the same as the dialog (5.4):** title trimmed, not empty, at most 100 characters, no `<` or `>`;
      description at most 5,000 UTF-8 bytes counted on the final text (description, blank line, hashtag line), no `<`
      or `>`. Failing: 400 with the reason.
    - **Answer:** the updated row plus the finished text from gap 2, so the card shows what will post.
    - **UI helper** `youtubeApi.updateQueueItem` next to `rescheduleQueueItem` (`ui/src/api/youtube.ts:9-10`).
15. **Gate failure falls back to a slide video** (owner: "Make a regular slide video instead"). Today an animated
    video that renders but fails the sync gate ends the night: `gateError` is set, nothing is queued
    (`production.ts:261-281`). Only a render error falls back (`production.ts:175-199`). Change: when the gate fails
    for an animated video, run the slide path the render-error fallback already falls into (visual assets and
    assembly, `production.ts:203-259`) on the same script and voice track (INFERRED to be reusable: the render-error
    fallback does the same), run the gate again in slide mode, and queue that video with
    `assets.visualMode = "presentation-fallback"`. If the second gate also fails, behave as today. Keep the failed
    animated file out of the queue; it ages out with the 30-day clean-up. The open question in
    `docs/products/youtube-pipeline.md:291` is answered by this.
16. **Purge slide and thumbnail pictures** in the nightly clean-up (section 9, build item 1), with the
    `filesPurgedAt` trap named there.
17. **Optional, still open:** move an approved video back to "Needs your OK"; edit the tags; view counts for Posted
    (the YouTube numbers table is empty for lack of permission, and Zernio already holds views for 155 videos:
    `docs/products/youtube-pipeline.md:306-308`).

---

## 11. Owner decisions — the first draft's list, with the answers

Answered on 2026-10-10 (the top of this document has the words and the effects). Kept here so the first draft's
numbering still reads.

1. **Where does YouTube live?** Its own item in the left menu (recommended), or only a tab inside "Socials & Content" as today? — **Answered: "Stay a tab inside Socials & Content".** The recommendation was not taken.
2. **Are the four names right?** Review · Scheduled · Posted · Files & settings. — **Answered: "Names are good".**
3. **One-click Approve at the suggested time** (recommended), or always ask for the time first? — **Answered: "Approve in one click at the suggested time".**
4. **Post now:** keep it on the card behind an "are you sure?" (recommended), or tuck it away in the More menu? — **Answered: "On the card, with an are-you-sure box".**
5. **Remove:** is it right that a removed video can be put back until its file deletes itself (30 days)? — **Not on the sheet. Default taken: no Put back.** The sheet's "Delete right away" and the request for a confirm dialog point the other way (5.2).
6. **"Clean up old videos": which did you mean?** (A) files of removed, never-posted videos · (B) our copies of videos already on YouTube · (C) files we cannot match to a video · (G) old videos on the YouTube channel itself · or several of these. — **Answered: A, B, the slide and thumbnail pictures (new group P) and G. Not C.** Section 9.
7. **Is a 7-day holding folder before a file is gone for good the right safety net?** — **Answered by "Delete right away": no.** Declined (section 9).
8. **Cover picture:** it is made but not sent to YouTube today. Show it with that note (recommended), or hide it until sending works? — **Not on the sheet. Default taken: show it with the note.**
9. **Do you want to be able to change the title or description before approving?** Not possible today. — **Answered: "I want that".** Now in scope (5.4, gap 14).
10. **Views and tips:** leave them out until the YouTube numbers work (recommended)? — **Not on the sheet. Default taken: leave them out.**

Added by the sheet and answered there: whether the first public video stays (yes); what a gate failure does (make a
slide video); and the design choices (look, theme, density, corners, status colours).

---

## 12. Build order (one slice at a time)

**Starting point: `origin/master` at `b6188dc2`, with #202 live.** The Queue card already has a player
(`P:186-194`), a description drop-down (`P:195-200`), a Publish Now confirm (`P:207-210`), and tab rows that wrap
(`PageTabBar.tsx:38-46`). The slices below *replace* those stopgaps; they do not redo them.

Each slice ships alone and passes criterion 6 (no sideways scroll), criterion 7 (labels and colours) and criterion 18
(one `<h1>`) before the next starts. New components go into the design-system catalogue before they go onto a page.

| Slice | What ships | Server work | Done when |
|---|---|---|---|
| **1. The frame and Review** | The route tree under `/socials/youtube` with the four sub-tabs (a `variant` prop on `PageTabBar`), the two-crumb breadcrumb, and the redirects from `/socials/youtube` (index), `/youtube` and `/youtube/videos`. The **Review** view in full: `VideoPreview` replacing the bare `<video>`, full title, description and tags from the data the queue route already sends, the "Posts…" line, one-click **Approve** with its sentence, **Change time**, **Post now** and **Remove** behind `AlertDialog`s, the red line for a failed click, loading and "all caught up" (with the next video time), the `pending_review` colour and the status table. The other three tabs exist from the start and show the old pages' content inside the frame (Scheduled and Posted: the queue cards filtered by status; Files & settings: the old files list plus the Pipeline and Config bodies), so nothing becomes unreachable. The old pages' own `<h1>`, breadcrumb and hand-built tab row go in this slice, because the frame now supplies them. | None. | Criteria 2, 3, 4, 5, 6, 9, 11, 13, 14, 17, 18 pass for Review. |
| **2. Scheduled and Posted, properly** | Scheduled with day groups, rows and the side panel; Posted with **Watch on YouTube** and search by title. | Gap 4 for history beyond 50 rows. | Criteria 1, 12 pass for the three daily views. |
| **3. Files & settings, properly** | File groups, Download, **Delete file** (immediate, after a confirm), "Make a video now", Advanced. The old page files are deleted. | Gap 11 for Delete file. None for the list (`R:264-364`). | The area has no screen from the old pages left; inventory rows marked REMOVE are gone. |
| **4. Edit before approving** | The edit dialog (5.4) and **Edit** on Review, Scheduled and the side panel. | Gap 14, and the "finished text" function of gap 2 that the preview and the upload share (build that function first). | Criterion 19 passes. |
| **5. The joined answer** | The card switches to the single "video to review" answer: description exactly as posted, "How it was made", cover picture, "file is gone", and the "Needs attention" cards with plain reasons. | Gaps 2, 3, 5, 7, 8, 12 (second half), 13. | Criterion 10 passes. |
| **6. Make a video now, without waiting** | The button returns at once; the "Being made" card shows progress. | Gap 9. | A run started from the page shows "Being made" and then a review card, with no request open for minutes. |
| **7. Pictures purge** (server only; can ship any time) | The nightly clean-up also removes old slide and thumbnail pictures. | Gap 16. | A test shows the pictures of a 31-day-old production gone, `archive/` untouched, and a row with `filesPurgedAt` already set still handled. |
| **8. Gate failure falls back to slides** (server only; can ship any time) | An animated video that fails the sync gate becomes a queued slide video. | Gap 15. | Criterion 20 passes. |
| **9. Later** | Views in Posted; safe "Try again"; editing tags. | Gap 12 (first half), gap 17. After the owner asks. | — |

**Maps to correct when slices ship** (not done by this spec): the "Admin UI" row of
`docs/products/youtube-pipeline.md:20` (corrected for #202 already; it must name the new area when slice 1 ships);
its open item on gate failure (`:291`), which the owner has now answered; the Socials hub doc
`docs/products/socials-hub.md` (the YouTube tab now holds four views); the design-system catalogue for `VideoPreview`,
`Notice`, `ReviewCard` and the `PageTabBar` variant.

### New components and additions named in this spec (for the design-system catalogue)

| Name | New or existing | Note |
|---|---|---|
| `PageTabBar` `variant` prop | existing component, small addition (`ui/src/components/PageTabBar.tsx`) | `line` (today) and `pill` (the second-level row). |
| `VideoPreview` | NEW | 16:9, browser controls, three states. |
| `Notice` | NEW | Info, warning, error strip with one action. |
| `ReviewCard` | NEW (YouTube area) | Built only from catalogue parts. |
| `youtube-status` label table | NEW helper | One file; section 4. |
| `StatusBadge` | existing (`ui/src/components/StatusBadge.tsx:4`) | Needs the `pending_review` colour key in `ui/src/lib/status-colors.ts`. |
| `EmptyState` | existing | Needs an optional secondary link. |
| Date helper | existing (`ui/src/lib/utils.ts:22`) | Needs a "weekday + time-zone letters" form. |
| `Card`, `Button`, `Badge`, `Tabs`, `AlertDialog`, `Dialog`, `Input`, `Textarea`, `Sheet`, `Collapsible`, `DropdownMenu`, `Skeleton`, `MetricCard`, `HelpTip` | existing | Used as they are. |

`PageHeader`, which the first draft listed as NEW, is not used in this area: the hub supplies the page heading
(section 4). It may still be needed for pages that have no hub.

### Not verified for this spec

- **The live server.** File counts, sizes and row counts are from docs dated 2026-10-07 and 2026-10-09 and from the
  owner's sheet of 2026-10-10.
- **The running screens.** Nothing was clicked through; the sideways-scroll fix of #202 and the above-the-fold
  arithmetic in section 7 were not measured here.
- **The stream route in use.** Its test was read, not run.
- **`docs/ux/design-system.md`**: a separate change, not on master when this was written; token and component names
  there may differ from the role names used here.
- **Whether the sheet's 888 MB includes the archive copies** of slides and thumbnails (section 9).
- **A stuck "Posting now" after a failed Post now** (section 5.3): read from code, not reproduced.
- **Whether the owner reviews on a phone.**
- **Whether a gate-failure slide video can reuse the voice track** without a new text-to-speech call (gap 15).

### Where this doc is registered

There is no docs index: `docs/` has no README or index file, and `docs/docs.json` is the menu of the public docs
site and lists no product docs. The list that registers product docs is "Reference Docs" in the repo's root
`CLAUDE.md`; this document has a line there. The forward link from the "Admin UI" row of
`docs/products/youtube-pipeline.md:20` to this spec exists since #202.
