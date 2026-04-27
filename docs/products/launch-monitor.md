# Launch Comment Monitor

Surface: `/socials/launch-monitor` (admin-only, behind auth)
Cron: `launch-monitor:poll-comments` — every 3 minutes
Owner agent: `scribe` (launch-adjacent marketing agent)
Env flag: `LAUNCH_MONITOR_ENABLED=true` (default off)

## Purpose

When we ship a launch post (Hacker News Show HN, Reddit r/programming, dev.to
tutorial, etc.), the first 24-72 hours of comments determine whether the post
takes off or stalls. The same handful of pushback shapes show up over and over:
"why not Aider", "Cursor does this", "tokens are cheap", "Gemma is too weak",
etc.

This subsystem watches tracked posts, classifies each new comment against 8
known pushback patterns via Claude Haiku, and surfaces high-confidence matches
to the team-dashboard Inbox with a pre-formatted reply ready for human review.
The user approves, edits, or dismisses before posting upstream. We never auto-post.

## Surface map

```
team-dashboard
├─ /api/launch-monitor/comments?status=pending     GET — queue
├─ /api/launch-monitor/comments/:id/replied        POST — mark replied
├─ /api/launch-monitor/comments/:id/dismiss        POST — dismiss
├─ /api/launch-monitor/tracked-items               GET, POST
├─ /api/launch-monitor/tracked-items/:id           DELETE (soft, sets active=false)
└─ /socials/launch-monitor                         UI tab (PageTabBar)
```

DB:
- `launch_tracked_items` — one row per HN/Reddit/dev.to post being watched.
- `comment_replies` — one row per external comment seen, idempotent on
  `(platform, external_comment_id)`.

## How the classifier works

`server/src/services/launch-comment-monitor.ts` exports `classifyComment()`,
which sends each comment body to Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
with a system prompt that embeds all 8 pattern templates verbatim. The system
block is sent with `cache_control: { type: "ephemeral" }` so repeat polls
within a 5-minute window only pay variable user-prompt tokens.

Threshold (hard-coded at `CLASSIFIER_THRESHOLD = 0.85`):
- `confidence >= 0.85` AND known `patternId` → `suggestedReply` is forced to
  the canonical pattern reply text, byte-for-byte. Status: `pending`.
- Otherwise → `patternId` and `suggestedReply` are nulled. Status:
  `needs_custom`. The reviewer sees the comment but writes their own reply.

`enforceClassifierInvariants()` runs after the model returns and overrides
the model's `suggestedReply` with the canonical text from the `PATTERN_BANK`
constant — the model cannot drift the wording even if it tries to paraphrase.

## The 8 patterns

Defined in `PATTERN_BANK` in the same service file. Edit there, never inline.

| pattern_id | When it fires |
|---|---|
| `aider` | Compares to Aider/Cline/Continue/Codex/OpenHands |
| `cursor` | Compares to Cursor/Copilot/Codeium/Windsurf |
| `cheap_tokens` | "Tokens are cheap now" / Sonnet 4.5 / Haiku is fine |
| `gemma_bad` | Claims Gemma 7B can't code, cites benchmarks |
| `other_tool` | Asks "why not [tool not above]" |
| `latency` | Local LLM is too slow |
| `setup_hassle` | Setup is too involved |
| `obvious` | "Yet another", "any blog post can do this" |

## Polling

- **HN**: Algolia search — `https://hn.algolia.com/api/v1/search?tags=comment,story_${id}&hitsPerPage=200`. No auth.
- **Reddit**: `https://www.reddit.com/comments/${id}.json`. No auth, custom `User-Agent: team-dashboard-comment-monitor/1.0`.
- **dev.to**: `https://dev.to/api/comments?a_id=${id}`. Requires `DEVTO_API_KEY` env. Skipped silently if unset.

The cron iterates every active row in `launch_tracked_items` whose
`watch_until > now()`. Expired rows auto-flip `active=false`. Inserts use
`ON CONFLICT DO NOTHING` on `(platform, external_comment_id)` so re-polls are
idempotent.

## Discord notifications (optional)

Set `LAUNCH_MONITOR_DISCORD_WEBHOOK_URL` to receive an embed for each newly
classified comment. Skipped silently if unset. Embed includes platform,
comment body (truncated 500 chars), author, suggested reply, confidence, and
deep links to both the external comment and the team-dashboard Inbox.

## Env flags

| Var | Required | Effect |
|---|---|---|
| `LAUNCH_MONITOR_ENABLED` | yes (default off) | Registers the cron |
| `ANTHROPIC_API_KEY` | yes | Used by the Haiku classifier |
| `DEVTO_API_KEY` | optional | Enables dev.to polling |
| `LAUNCH_MONITOR_DISCORD_WEBHOOK_URL` | optional | Mirror new rows to Discord |
| `TEAM_DASHBOARD_PUBLIC_URL` | optional | Used in Discord deep-links |

## Adding a tracked post

Either via the UI form at the top of `/socials/launch-monitor`, or curl:

```bash
curl -X POST https://team.coherencedaddy.com/api/launch-monitor/tracked-items \
  -H "Content-Type: application/json" \
  -d '{"platform":"hn","externalId":"40123456","title":"Show HN: …","postUrl":"https://news.ycombinator.com/item?id=40123456","watchHours":72}'
```

External ID format:
- HN: numeric story id (the `id` query param on the news.ycombinator.com URL)
- Reddit: the post id (the `1abc2de` segment in `/r/foo/comments/1abc2de/...`)
- dev.to: the numeric article id (`/api/articles?username=...` to look up)

## Manual ops

- **Pause polling**: `DELETE /api/launch-monitor/tracked-items/:id` (soft — sets `active=false`).
- **Catch up after downtime**: nothing to do. Each cycle re-fetches the full
  comment list from the platform API; only previously-unseen
  `external_comment_id`s create rows.
- **Force a poll cycle**: temporarily lower the cron schedule, or trigger the
  registered cron via the cron management UI.
