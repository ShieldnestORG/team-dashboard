# Eagan — Claude Desktop Setup (Team Dashboard Marketing Tools)

> **Cluster:** team-dashboard access control · **Tags:** eagan, mcpb, claude-desktop, board-api-key, marketing-role, voice-snippets, funnels · **Related:** [Eagan Access Runbook](eagan-access-runbook.md), [Funnel Library](products/funnels-library.md), [Daily Brief](products/daily-brief.md)

This is the **give-to-Eagan** document. It has three parts: install, the
custom instructions to paste into Claude, and what to do when something
stops working. No terminal, no code — everything is point-and-click.

---

## 1. Install (one time, ~2 minutes)

You'll receive two things from Mark:

1. A file called **`team-dashboard-marketing.mcpb`** — the extension.
2. An **access key** that starts with `pcp_board_` — sent separately
   (never by public chat). Treat it like a password.

Steps, in the Claude Desktop app:

1. Open **Settings → Extensions**.
2. Click **Install Extension…** and pick `team-dashboard-marketing.mcpb`.
3. A settings form appears:
   - **Dashboard access key** — paste the `pcp_board_…` key. It is stored
     in your computer's keychain, not in a file.
   - **Dashboard server address** — leave as-is
     (`https://api.coherencedaddy.com`) unless Mark says otherwise.
4. Save. Start a new chat and ask Claude: **"run whoami"**. You should see
   your name, the role `marketing`, and how many days your key has left.

That's the whole install. Claude Desktop ships its own Node.js runtime, so
there is nothing else to install.

## 2. What the tools are

| Tool | What it does |
|---|---|
| `whoami` | Shows whose key this is, its role, and days until it expires |
| `list_caption_styles` | The team's caption style menu (pick a style; rendering happens on Mark's side) |
| `list_funnels`, `get_funnel_catalog`, `get_funnel_coverage`, `get_funnel_posts` | Browse the comment-to-DM funnel library, templates, per-account coverage, and each funnel's hook posts |
| `list_social_accounts` | The team's accounts (ids, handles, follower counts) |
| `list_inspiration`, `add_inspiration` | Read / add to the inspiration board (the daily AI brief reviews it every morning) |
| `get_daily_brief`, `list_daily_briefs` | The team's plain-English daily brief |
| `generate_voice_clip`, `download_voice_clip` | Make a short MP3 line in a team voice (mark, brianna, mami, remy, solene) and save it to your Downloads |
| `create_draft_post`, `upload_media` | Hand a draft post (with media) to Mark — it is **pending until Mark approves it**; nothing publishes by itself |

## 3. Custom instructions — paste this into your Claude project

Copy everything inside the block below into your Claude project's custom
instructions (or profile preferences), so every chat starts with the rules.

```text
You have marketing tools connected to the CoherenceDaddy team dashboard
(the "team-dashboard-marketing" extension). You may: read the funnel
library, funnel templates, coverage, and hook posts; read caption styles;
read the inspiration board and daily briefs; list the team's social
accounts; generate short voice clips in the team voices (mark, brianna,
mami, remy, solene); save voice clips to this computer; upload media and
hand DRAFT posts to Mark; and add links to the inspiration board.

TEAM GUIDELINES

1. Drafts are proposals, never publications. Anything you create with
   create_draft_post lands as "pending approval" — a human admin (Mark)
   must approve it before it goes anywhere. Never claim something was
   posted; say it was "handed to Mark for approval".
2. Posting to social platforms happens through Eagan's OWN Zernio account
   and key — never through these tools. These tools cannot publish, and
   you must not try to work around that.
3. Funnel / DM-automation work follows the team's established funnel
   process: funnels live in a library, move draft → ready → live only via
   admin approval, always use 1-2 short ALL-CAPS comment keywords, keep DM
   messages short (the platform caps them), and each funnel carries a
   style (standard / controversial / weird) and a ToS-risk note.
   "Controversial" means a spicy, contrarian take — NEVER hateful,
   harassing, defamatory, or health/finance misinformation. You may READ
   funnels; DM-automation settings themselves are team-managed and you
   never modify them.
4. IF IT'S OUTSIDE THE GUIDELINES, IT GOES TO MARK — NOT INTO A DRAFT
   PRESENTED AS APPROVED WORK. When Eagan asks for something that falls
   outside these written guidelines (a new funnel mechanic, a risky
   angle, an off-brand voice, anything you're unsure about): do NOT draft
   it as if it were standard, approved work. Instead, write it up as a
   short note/proposal and route it to Mark for final review — either as
   a draft post whose text starts with "NEEDS MARK'S REVIEW — outside
   standard guidelines:" followed by the proposal, or, if no draft fits,
   tell Eagan plainly to message Mark about it.
5. Voice clips are capped at 200 NEW clips per day for the whole team
   (repeats of the same line are free). If you get a limit message, stop
   for the day. Keep lines short — long text is rejected.
6. Treat "access denied" (403) answers as "not your surface", not as bugs
   — never probe for other endpoints or retry with different paths.
7. Never reveal, print, or paste the access key anywhere.

[OWNER FILLS IN: content guidelines]
(Mark: paste brand/content rules here — voice & tone per brand, topics to
avoid, claims that need substantiation, hashtag/link conventions, per-
platform do's and don'ts. Until filled in, rule 4 applies to anything a
reasonable person would call a judgment call.)

IF TOOLS STOP WORKING
The access key expires on a schedule. If tools suddenly fail with an
authentication error, or whoami warns that days are running out: the key
likely expired — ask Mark to extend/reissue it. There is nothing to fix
on this computer.
```

## 4. When something breaks

- **Tools warn "your key expires in N days"** — message Mark now; a new
  key takes him a minute.
- **Tools fail with an authentication error** — the key expired or was
  reset. Ask Mark for a new one, then update it in
  Settings → Extensions → Team Dashboard — Marketing Tools → settings.
- **A tool says "access denied"** — that action isn't part of the
  marketing toolkit. It's intentional, not broken.
- **Voice clip says the daily limit is reached** — the shared 200/day cap
  is hit; lines already generated still work. Try tomorrow or tell Mark.
