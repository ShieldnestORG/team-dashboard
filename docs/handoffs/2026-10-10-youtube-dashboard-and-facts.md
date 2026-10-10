# YouTube pipeline — dashboard area, clean-up and the TX facts pack (2026-10-09 evening to 2026-10-10)

> **Cluster:** YouTube pipeline · **Tags:** youtube, dashboard, review, cleanup, tx-facts, vps4, deploy, owner-decisions · **Related:** [YouTube pipeline (canonical)](../products/youtube-pipeline.md), [YouTube area spec](../ux/youtube-area-spec.md), [Design system](../ux/design-system.md), [2026-10-09 record](2026-10-09-youtube-animated-live.md)

The record of the night after animated mode went live: what the owner saw, what was measured, what shipped and
what is still the owner's call. The canonical description stays in `docs/products/youtube-pipeline.md`; times are
owner-local (PDT) unless marked UTC.

## Timeline (measured)

| PDT | What |
|---|---|
| 10-09 19:51 | Owner clicked **Publish Now** on the first animated video (`d6d30d70`, queue row `eb052795`): posted as <https://youtube.com/shorts/QvoML0poRFU>. |
| 10-09 23:03 | **First cron-made animated video** (`c42a126f`, queue row `0796d180`, "How TX Reward Splits Work"), `pending_review` for 2026-10-10 14:00Z. |
| 10-10 00:29 | #202 merged (`b6188dc2`); deployed 00:37, after the nightly run (it missed the 23:00 cut-off because the session waited on CI without a wake-up). |
| 10-10 01:51 | #203 merged (`5ad59407`, DEV-114): an animated video that fails the sync gate becomes a slide video that night. #204: design system v1 + the YouTube area spec. |
| 10-10 02:29 | #205 merged (`68c8108a`, DEV-115/116/117): TX facts pack, `PATCH /queue/:id`, the 30-day purge also removes pictures. Container started 09:39:45Z. |
| 10-10 02:44 / 03:09 | #206 (`6a80158c`, DEV-118, the four views) and #207 (`0aa38f68`, five script attempts) merged. |
| 10-10 03:19 | **Deploy of #206 + #207**: container started 10:19:36Z, healthy. Read back inside it: `YT_VISUAL_MODE=animated`, `MAX_SCRIPT_ATTEMPTS = 5`, `facts/tx-facts.json` in `dist`, "Files & settings" in the UI bundle, "YouTube pipeline crons registered (6 jobs)". Predeploy: DNS ok, "Migrating database via DATABASE_URL", no pending migrations. |
| 10-10 03:25 / 03:31 | #208 merged (`7f216c6c`, DEV-119, the review card) and deployed: container started 10:31:08Z, healthy, "Needs your OK" found in the served UI bundle (it was absent before the deploy, the control). |

## What the owner reported, and what it turned out to be

- **"page doesnt show video"** — true: neither YouTube page had a player. The earlier claim that videos could be
  watched in the dashboard repeated a doc line and was checked only as "the page answers 200". Fixed by #202
  (`GET /videos/:filename/stream`, Range-capable, admin-only; a player on the queue card).
- **"when i scroll on pages it shifts left and right"** — the ten-tab Socials row is 1,150 px wide inside
  `<main overflow-auto>`: 158 px of sideways scroll at a 1,280 px window. It only reproduced with the page mounted
  inside its real `SocialsContentLayout`; a guess about long file names was wrong. Fixed in `PageTabBar` (#202).
- **"the two areas are confusing"** — two pages became one area with four views (#206). The review card
  (#208, DEV-119) gives each waiting video a player, plain labels ("Needs your OK") and four actions.

## Clean-up (owner chose "Delete right away")

The owner ran `/root/yt-cleanup-2026-10-10.sh --apply` on VPS4 on 2026-10-10: **323 paths deleted, the YouTube
folder went from 1,209 MB to 186 MB.** Checked afterwards: the queued video, `archive/` and the audio files were
intact. The list was built from the database (unposted videos, server copies of already-posted videos, old slide
and thumbnail pictures); the assistant prepared the list and the script and deleted nothing itself. Old-style
videos on the channel are the owner's to hide or delete in YouTube Studio (a CSV was handed over).

## TX facts: the fact-check of `c42a126f` and the rule that followed

The script of "How TX Reward Splits Work" described rewards as a split between two parties, never mentioned the 5%
community-pool tax or PSE, and three spoken lines were wrong. **Recommendation to the owner: do not post it as is.**
It is still `pending_review`; nothing posts without an approval. Facts re-read on 2026-10-10 from the chain's code
and parameters: `community_tax` 0.05; `min_commission_rate` 0.05; unbonding 604,800 s (7 days); PSE (`x/pse`,
tx-chain v7.0.0) pays stakers by score with no commission term (`x/pse/keeper/distribute.go:228,390,424`).

With the facts rule live, how often does the script writer pass on the TX seed topics (deployed code on VPS4,
read-only, script generation only; the pillar has ten seeds)?

| When | Attempts allowed | Passed | Notes |
|---|---|---|---|
| 10-10 ~02:45 | 3 | 13 of 15 | Two batches (the first 5 seeds, then all 10). Nearly every pass used the last attempt. |
| 10-10 03:22 | 5 | **10 of 10** | One batch, all 10 seeds. Attempts used: 2, 2, 3, 3, 3, 3, 3, 3, 3, 4. One script needed the 4th try. Small sample. |

Every one of the ten first drafts was sent back as `TOO_SHORT`, so each script costs at least one repair. Asking for
the length up front in the prompt is an open item in the canonical doc.

## Owner decisions recorded on the sheet (2026-10-10)

The first animated video stays public; a failed animated gate makes a slide video; clean-up of all four groups, deleted right
away; YouTube stays a tab inside Socials & Content; view names are good; Approve in one click at the suggested
time; Post now on the card behind an are-you-sure box; edit title and description before approving; both themes,
opening in dark; roomier spacing; rounded cards; five status colours; publish a trimmed design system without the
private project summaries. Build rule from the same night: builds go to Ollama workers, Agent Ops tickets, Haiku or Sonnet
first.

## Still open

1. **Owner:** what to do with "How TX Reward Splits Work" (remove it, or post it with a correction).
2. **Owner:** the old-style videos on the channel (YouTube Studio).
3. Build slices left in the area spec: the edit dialog (server half is DEV-120), Scheduled and Posted, Files &
   settings, the token work items W1–W4.
4. Until the facts pack has a longer record, fact-check a TX-topic video before approving it.
5. DEV-112: team-dashboard's PR checks on the office tower.
