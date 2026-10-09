# YouTube channel measurements (2026-10-07)
> **Cluster:** youtube · **Tags:** youtube, channel, views, metadata, policy · **Related:** [YouTube Pipeline](youtube-pipeline.md), [Metadata audit](youtube-metadata-audit-2026-10-07.md)
> Imported 2026-10-07 from the session's working folder; the helper scripts it mentions (`work/…`, `channel-data.json`) were not kept. Canonical page: [YouTube Pipeline](youtube-pipeline.md).

Channel: youtube.com/@coherencedaddy (channelId UCyVD-xDTyoMkXMQR6-RNaXA) — 21 subscribers, 157 videos (public header).

## Views (public channel grid, latest 90 videos ≈ 2 months, read 2026-10-07 ~23:00 PDT)
- total 793 views; median 2 per video; 17 videos at 0; max 132.
- Top: "Ultimate Why the Tx Ecosystem Is the Next Major Wealth Cycle in 2026" 132 · "The 3 Chart Patterns That Predicted 90% of
  Bitcoin's Biggest Moves…" 112 · "Why the Tx Blockchain Is the Final Piece of the Web3 Puzzle Explained (2026)" 79 · "The Only 5 Altcoins
  Worth Holding for the 2026 Bull Run…" 56 · TX Web3 Puzzle (second copy) 30 · "Stop Staking: Top 5 High-yield Passive Income…" 26.
- Latest three: 0 (15 h), 6 (1 d), 2 (3 d).

## Pipeline records (read-only DB snapshot: channel-data.json in this folder)
- yt_publish_queue: 148 published (first 2026-04-15), 5 scheduled (3 at 2026-10-08 14:00Z, 1 at 10-09 15:00Z, 1 at 10-11 10:00Z).
- yt_analytics: 0 rows — the analytics/feedback loop collects nothing, so "data-driven" strategy has no data.
- Publish slot = random pick of Tue–Sun "best times" 1–7 days ahead (`content-strategy.ts:279-295`) → collisions (3 in one slot), no Mondays.

## One published video's metadata (XKyRJe55i8Y, from the watch page player response)
- category "Science & Technology" (publisher hard-codes categoryId 28).
- tags: beginners, bitcoin, blockchain, crypto, cryptocurrency, cryptoportfoliostrategybeginners, cryptoportfoliostrategybeginners2026,
  explained, investing, portfolio, strategy, toknsfi, txecosystem, understanding, whatis  (concatenated + filler tags).
- description opens "… - In this video, you'll discover stop gambling: the exact 2026 crypto portfolio blueprint…" (title pasted in
  lower case); "de-fi" respelling leaked into section names; TIMESTAMPS 00:00 / 00:20 / 01:35 / 02:35 / 03:35 on a 3:12 video (last one
  is past the end; real section starts were ~0:33, 1:11, 1:41, 2:11 — chapters come from script estimates, not audio).
- captions: only YouTube's auto-generated track (no uploaded captions).
- publisher (`server/src/services/platform-publishers/youtube.ts`) sends snippet{title, description + hashtags, tags ≤30, categoryId 28},
  status{privacyStatus public, madeForKids false}; it never calls thumbnails.set or captions.insert, never sets defaultLanguage /
  defaultAudioLanguage / containsSyntheticMedia, no playlists — although production generates thumb_<id>.jpg and an SRT.

## Titles seen on the grid (patterns)
- Formula repetition: "Stop …: the … 2026 …", "Why 99% … (2026)", "… Explained for 2026".
- Near-duplicates: two "Stop Gambling … Crypto Portfolio" videos; two "Why 99% … Millionaire Mindset"; two "TX … Final Piece of the Web3
  Puzzle"; two "Bitcoin vs Ethereum in 2026".
- Keyword junk appended: "- Toknsfi", "- Best", "- Ecosystem", "- Stake", "- Building", "- Crypto"; leading junk "Ultimate", "Proven",
  "Secret". Casing: "Tx", "Defi".
- FALSE first-person claims: "I Tested 5 Crypto Passive Income Methods for 90 Days - Here's Which One Actually Paid My Rent" (an AI
  script; nobody tested anything); "Inside Coherencedaddy's 2026 Portfolio: High-conviction Crypto Picks".

## YouTube facts (official pages, fetched 2026-10-07)
- Monetization policy: on 2025-07-15 "repetitious content" was renamed "inauthentic content" "to better clarify this includes content
  that is repetitive or mass-produced"; content must "Not be mass-produced, generic, repetitive, or manipulative." (support.google.com/youtube/answer/1311392)
- Synthetic-content disclosure: required when realistic content "Makes a real person appear to say or do something they didn't do";
  NOT required for "Cloning one's own voice to create voice overs or dubs", nor for AI-written scripts, thumbnails, titles, captions.
  (support.google.com/youtube/answer/14328491). API field `status.containsSyntheticMedia` is writable on insert/update.
- `snippet.tags`: max 500 characters in total; commas count; a tag with a space counts its implied quotes.
- Quota page (developers.google.com/youtube/v3/determine_quota_cost) contradicts itself: table says videos.insert has its own bucket of
  100/day at 1 each; the summary says 1600 units. thumbnails.set 50, captions.insert 400, playlistItems.insert 50, videos.update 50;
  default 10,000 units/day for the rest. UNVERIFIED which applies to this project (Cloud console quota page would say).
