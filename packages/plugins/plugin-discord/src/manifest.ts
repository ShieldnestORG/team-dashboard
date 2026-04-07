import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "coherencedaddy.discord";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Discord Bot",
  description:
    "Discord community moderation and ticketing bot for ShieldNest/TOKNS — auto-mod, warnings, support tickets, role management, and real-time dashboard integration.",
  author: "Coherence Daddy",
  categories: ["connector", "automation"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },

  // ── Instance config schema ────────────────────────────────────────────────

  instanceConfigSchema: {
    type: "object",
    required: ["discordToken", "guildId"],
    properties: {
      discordToken: {
        type: "string",
        title: "Discord Bot Token",
        description: "The bot token from the Discord Developer Portal.",
      },
      guildId: {
        type: "string",
        title: "Guild (Server) ID",
        description: "The ID of the Discord server to connect to.",
      },
      ticketChannelId: {
        type: "string",
        title: "Ticket Channel ID",
        description: "Channel where the ticket panel is posted and threads are created.",
        default: "",
      },
      ticketLogChannelId: {
        type: "string",
        title: "Ticket Log Channel ID",
        description: "Channel where ticket status updates are logged as embeds.",
        default: "",
      },
      supportChannelId: {
        type: "string",
        title: "Support Channel ID",
        description: "General support channel for ticket-related announcements.",
        default: "",
      },
      announcementsChannelId: {
        type: "string",
        title: "Announcements Channel ID",
        description: "Channel where moderation logs are posted.",
        default: "",
      },
      welcomeChannelId: {
        type: "string",
        title: "Welcome Channel ID",
        description: "Channel for new member welcome messages.",
        default: "",
      },
      roleMember: {
        type: "string",
        title: "Member Role ID",
        description: "Role auto-assigned to new members on join.",
        default: "",
      },
      roleModerator: {
        type: "string",
        title: "Moderator Role ID",
        description: "Role required for moderation commands.",
        default: "",
      },
      roleAdmin: {
        type: "string",
        title: "Admin Role ID",
        description: "Role required for admin-only commands (ban, clearwarnings, etc.).",
        default: "",
      },
      roleNftCollector: {
        type: "string",
        title: "NFT Collector Role ID",
        description: "Onboarding quiz role for NFT collectors.",
        default: "",
      },
      roleGamer: {
        type: "string",
        title: "Gamer Role ID",
        description: "Onboarding quiz role for gamers.",
        default: "",
      },
      roleDeveloper: {
        type: "string",
        title: "Developer Role ID",
        description: "Onboarding quiz role for developers.",
        default: "",
      },
      roleInvestor: {
        type: "string",
        title: "Investor Role ID",
        description: "Onboarding quiz role for investors.",
        default: "",
      },
      bannedWords: {
        type: "array",
        items: { type: "string" },
        title: "Banned Words",
        description: "Words that trigger auto-moderation when detected in messages.",
        default: ["spam", "scam", "rug", "phishing"],
      },
      spamThreshold: {
        type: "number",
        title: "Spam Threshold",
        description: "Number of messages within the spam window that triggers a warning.",
        default: 5,
      },
      spamWindowMs: {
        type: "number",
        title: "Spam Window (ms)",
        description: "Time window in milliseconds for spam detection.",
        default: 5000,
      },
      ticketAutoCloseMinutes: {
        type: "number",
        title: "Ticket Auto-Close (minutes)",
        description: "Minutes of inactivity before a ticket is automatically closed.",
        default: 5,
      },
      warningsBeforeMute: {
        type: "number",
        title: "Warnings Before Mute",
        description: "Number of warnings before a 10-minute auto-mute.",
        default: 3,
      },
      warningsBeforeKick: {
        type: "number",
        title: "Warnings Before Kick",
        description: "Number of warnings before an auto-kick.",
        default: 5,
      },
      enableFeeds: {
        type: "boolean",
        title: "Enable Live Feeds",
        description: "Enable live Twitter, price alert, and intel feeds in Discord channels.",
        default: false,
      },
      dashboardApiUrl: {
        type: "string",
        title: "Dashboard API URL",
        description: "Internal base URL of the team dashboard API (e.g. http://localhost:3100/api).",
        default: "http://localhost:3100/api",
      },
      twitterFeedChannelId: {
        type: "string",
        title: "Twitter Feed Channel ID",
        description: "Channel for Twitter feed. If empty, bot creates #twitter-feed.",
        default: "",
      },
      priceFeedChannelId: {
        type: "string",
        title: "Price Feed Channel ID",
        description: "Channel for price alerts. If empty, bot creates #price-alerts.",
        default: "",
      },
      intelFeedChannelId: {
        type: "string",
        title: "Intel Feed Channel ID",
        description: "Channel for intel feed (news, releases, trending). If empty, bot creates #intel-feed.",
        default: "",
      },
      feedCategoryId: {
        type: "string",
        title: "Feed Category ID",
        description: "Optional Discord category (channel group) ID to place feed channels under.",
        default: "",
      },
      priceFilterSlugs: {
        type: "array",
        items: { type: "string" },
        title: "Price Alert Token Filter",
        description: "Only show price alerts for these company slugs. Empty = show all tokens with >5% moves.",
        default: ["cosmos", "osmosis", "tx-blockchain", "xrpl-ripple", "keeta", "celestia", "injective", "akash-network", "dydx", "axelar", "sei-network"],
      },
      priceThresholdPct: {
        type: "number",
        title: "Price Alert Threshold (%)",
        description: "Minimum absolute % change to trigger a price alert. Default 3.",
        default: 3,
      },
    },
  },

  // ── Scheduled jobs ────────────────────────────────────────────────────────

  jobs: [
    {
      jobKey: "ticket-cleanup",
      displayName: "Ticket Cleanup",
      description: "Archives closed tickets older than 30 days from plugin state.",
      schedule: "0 3 * * *",
    },
    {
      jobKey: "daily-stats",
      displayName: "Daily Stats Rollup",
      description: "Aggregates daily moderation and ticket statistics.",
      schedule: "0 0 * * *",
    },
  ],

  // ── Agent tools ───────────────────────────────────────────────────────────

  tools: [
    {
      name: "get-open-tickets",
      displayName: "Discord: Get Open Tickets",
      description:
        "List all currently open support tickets with user, category, and timing info.",
      parametersSchema: {
        type: "object",
        properties: {
          category: {
            type: "string",
            enum: ["account", "nft", "p2e", "technical", "general"],
            description: "Filter by ticket category.",
          },
          limit: {
            type: "number",
            description: "Max results. Defaults to 50.",
            default: 50,
          },
        },
      },
    },
    {
      name: "get-warnings",
      displayName: "Discord: Get Warnings",
      description:
        "Get warning history for a specific Discord user by their user ID.",
      parametersSchema: {
        type: "object",
        required: ["userId"],
        properties: {
          userId: {
            type: "string",
            description: "Discord user ID to look up warnings for.",
          },
        },
      },
    },
    {
      name: "get-mod-stats",
      displayName: "Discord: Get Moderation Stats",
      description:
        "Get moderation action statistics over a time window.",
      parametersSchema: {
        type: "object",
        properties: {
          days: {
            type: "number",
            description: "Number of past days to include. Defaults to 7.",
            default: 7,
          },
        },
      },
    },
    {
      name: "get-bot-status",
      displayName: "Discord: Get Bot Status",
      description:
        "Check if the Discord bot is online, connected guild info, and uptime.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "send-announcement",
      displayName: "Discord: Send Announcement",
      description:
        "Send an announcement embed to a specified Discord channel.",
      parametersSchema: {
        type: "object",
        required: ["channelId", "text"],
        properties: {
          channelId: {
            type: "string",
            description: "Discord channel ID to post the announcement in.",
          },
          text: {
            type: "string",
            description: "Announcement message text.",
          },
        },
      },
    },
    {
      name: "close-ticket",
      displayName: "Discord: Close Ticket",
      description:
        "Close a support ticket by its thread ID.",
      parametersSchema: {
        type: "object",
        required: ["threadId"],
        properties: {
          threadId: {
            type: "string",
            description: "Discord thread ID of the ticket to close.",
          },
        },
      },
    },
    {
      name: "warn-user",
      displayName: "Discord: Warn User",
      description:
        "Issue a warning to a Discord user. Triggers auto-mute at 3 warnings and auto-kick at 5.",
      parametersSchema: {
        type: "object",
        required: ["userId", "reason"],
        properties: {
          userId: {
            type: "string",
            description: "Discord user ID to warn.",
          },
          reason: {
            type: "string",
            description: "Reason for the warning.",
          },
        },
      },
    },
    {
      name: "get-recent-mod-actions",
      displayName: "Discord: Recent Mod Actions",
      description:
        "Get the most recent moderation actions (warnings, mutes, kicks, bans).",
      parametersSchema: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Max results. Defaults to 20.",
            default: 20,
          },
        },
      },
    },
  ],
};

export default manifest;
