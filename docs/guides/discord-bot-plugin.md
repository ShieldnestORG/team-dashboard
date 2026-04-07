# Discord Bot Plugin (`plugin-discord`)

## Overview

The Discord bot plugin integrates community moderation and ticketing for the Next.ai Discord server (ShieldNest x TOKNS) into the Team Dashboard as a Paperclip plugin. It runs as a Discord.js client inside the plugin worker process — no separate deployment needed.

**Plugin ID**: `coherencedaddy.discord`
**Server**: Next.ai (`1481053410152288422`)
**Bot User**: Shield#2627

## Features

### Auto-Moderation
- Banned words detection (configurable, default: spam/scam/rug/phishing)
- Spam detection (5+ messages in 5 seconds)
- Discord invite link blocking
- @everyone/@here mention blocking (non-mods only)

### Warning System
- Warnings persist in PostgreSQL via plugin state
- 3 warnings = 10-minute auto-mute
- 5 warnings = auto-kick
- Configurable thresholds via plugin settings

### Support Ticketing
- Button-based ticket creation in #submit-a-ticket
- 5 categories: Account, NFT, P2E, Technical, General
- Private thread per ticket
- Auto-close after 5 minutes of inactivity (configurable)
- Status embeds in #ticket-logs
- DM notifications to ticket owner
- Reopen detection when thread is unarchived

### Commands (17 total)

| Command | Permission | Description |
|---------|-----------|-------------|
| `!warn @user [reason]` | Mod | Issue warning |
| `!warnings @user` | Mod | View warning history |
| `!mute @user [duration]` | Mod | Timeout (10m, 1h, 1d) |
| `!unmute @user` | Mod | Remove timeout |
| `!kick @user [reason]` | Mod | Kick member |
| `!purge [1-100]` | Mod | Bulk delete messages |
| `!close` | Mod | Close ticket thread |
| `!tickets` | Mod | List open tickets (DM) |
| `!ban @user [reason]` | Admin | Ban member |
| `!unban [userID]` | Admin | Unban |
| `!clearwarnings @user` | Admin | Reset warnings |
| `!announce #channel [msg]` | Admin | Post announcement embed |
| `!setup-tickets` | Admin | Post ticket panel button |
| `!closeall` | Admin | Close all open tickets |
| `!addrole / !removerole` | Admin | Manage roles |
| `!serverinfo / !userinfo` | All | Server/member stats |
| `!help` | All | Command list (DM) |

### Dashboard Integration
- **Discord page** (`/discord`) with bot status, open tickets, mod action feed
- 8 agent tools for AI-powered community management
- Polling-based real-time updates (15-30s intervals)

### Agent Tools
| Tool | Description |
|------|-------------|
| `get-open-tickets` | List open tickets with filters |
| `get-warnings` | Warning history for a user |
| `get-mod-stats` | Moderation stats over time window |
| `get-bot-status` | Bot online status and guild info |
| `send-announcement` | Post announcement embed to channel |
| `close-ticket` | Close ticket by thread ID |
| `warn-user` | Issue warning with auto-escalation |
| `get-recent-mod-actions` | Recent mod action feed |

### Scheduled Jobs
| Job | Schedule | Description |
|-----|----------|-------------|
| `ticket-cleanup` | Daily 3 AM | Archive closed tickets older than 30 days |
| `daily-stats` | Daily midnight | Aggregate mod/ticket statistics |

## Architecture

```
packages/plugins/plugin-discord/
  src/
    manifest.ts      # Plugin config schema, 8 tools, 2 jobs
    worker.ts        # Discord.js client, tool handlers, data endpoints
    types.ts         # TypeScript interfaces
    moderation.ts    # Auto-mod, warnings, spam tracker
    ticketing.ts     # Ticket CRUD, auto-close, log embeds
    commands.ts      # 17 ! commands
```

**Data storage**: All state (warnings, tickets, mod logs, stats) stored via `ctx.state` API which maps to the `plugin_state` PostgreSQL table. Spam tracker is in-memory only (ephemeral by design).

**Event flow**: Discord.js gateway events -> handler modules -> plugin state writes + Discord API responses -> dashboard queries via plugin data endpoints.

## Environment Variables

All configured in `.env` (local) or `.env.production` (VPS):

```bash
# Required
DISCORD_TOKEN=<bot token from Developer Portal>
DISCORD_GUILD_ID=1481053410152288422

# Channels
DISCORD_TICKET_CHANNEL_ID=1481546406161547415
DISCORD_TICKET_LOG_CHANNEL_ID=1482445199685845174
DISCORD_ANNOUNCEMENTS_CHANNEL_ID=1481542039022866513
DISCORD_WELCOME_CHANNEL_ID=1481542663110000671
DISCORD_SUPPORT_CHANNEL_ID=1483025048762581003
DISCORD_GENERAL_CHANNEL_ID=1481053411184214138

# Roles
DISCORD_ROLE_MEMBER=1481589579596435608
DISCORD_ROLE_MODERATOR=1481587904617910412
DISCORD_ROLE_ADMIN=1481587732282212392
DISCORD_ROLE_NFT_COLLECTOR=1481400343471587514
DISCORD_ROLE_GAMER=1481401356312121344
DISCORD_ROLE_DEVELOPER=1481401499757187072
DISCORD_ROLE_INVESTOR=1481401610348396666
```

## Setup Steps

### 1. Discord Developer Portal
1. Application: https://discord.com/developers/applications/1490839903506927897
2. Bot tab: Server Members Intent ON, Message Content Intent ON
3. OAuth2 Code Grant: OFF
4. Bot invited with Administrator permission

### 2. Install Plugin (after deploy)
```bash
# Via API
curl -X POST http://localhost:3100/api/plugins/install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "@paperclipai/plugin-discord"}'
```

Or install via the Plugin Manager page in the dashboard UI.

### 3. Configure Plugin
Set the Discord config values in Plugin Settings UI, or via API:
```bash
curl -X PATCH http://localhost:3100/api/plugins/coherencedaddy.discord/config \
  -H "Content-Type: application/json" \
  -d '{
    "discordToken": "<token>",
    "guildId": "1481053410152288422",
    "ticketChannelId": "1481546406161547415",
    ...
  }'
```

### 4. Verify
- Bot appears online in Discord with "Protecting ShieldNest x TOKNS" status
- Dashboard `/discord` page shows bot status as Online
- Run `!help` in any channel to test commands
- Run `!setup-tickets` in #submit-a-ticket to post the ticket panel

## Migrated From

Originally `ShieldnestORG/staunchbot` — a standalone 772-line Node.js monolith with JSON file storage. Integrated into the team dashboard plugin system on 2026-04-06. The standalone repo is now superseded by this plugin.

## Troubleshooting

- **Bot offline**: Check `DISCORD_TOKEN` is valid. Token may need regeneration from Developer Portal.
- **Ticket threads fail**: Ensure bot has "Create Private Threads" and "Manage Threads" permissions.
- **Commands not working**: Verify Message Content Intent is enabled in Developer Portal.
- **Warnings not persisting**: Check plugin state table in database. Plugin must be in `ready` status.
