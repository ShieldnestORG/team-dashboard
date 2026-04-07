import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "coherencedaddy.twitter";
export const PLUGIN_VERSION = "0.2.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Twitter/X",
  description:
    "Twitter/X automation for agents via X API v2. Queue tweets, define engagement missions, extract data, and manage targets — all executed directly through the X API.",
  author: "Coherence Daddy",
  categories: ["connector", "automation"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
    "webhooks.receive",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    required: [],
    properties: {
      xApiEnabled: {
        type: "boolean",
        title: "X API Enabled",
        description:
          "Enable direct X API v2 posting and engagement. Requires OAuth setup first.",
        default: false,
      },
      rateLimitMultiplier: {
        type: "number",
        title: "Rate Limit Multiplier",
        description:
          "Fraction of official API rate limits to use (0.1-1.0). Lower = safer. Default 0.5 uses 50% of limits.",
        default: 0.5,
      },
      defaultVenture: {
        type: "string",
        title: "Default Venture",
        description: "Which Coherence Daddy venture tweets belong to by default.",
        enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
        default: "coherencedaddy",
      },
      maxQueueSize: {
        type: "number",
        title: "Max Queue Size",
        description: "Maximum number of pending items in the content queue. Prevents runaway scheduling.",
        default: 100,
      },
      enableAutoEngage: {
        type: "boolean",
        title: "Enable Auto-Engage",
        description: "When true, engagement missions and target cycles auto-execute on schedule.",
        default: false,
      },
      maxPostsPerDay: {
        type: "number",
        title: "Max Posts Per Day",
        description: "Maximum tweets to post per day. Prevents over-posting.",
        default: 8,
      },
      minPostGapMinutes: {
        type: "number",
        title: "Min Post Gap (minutes)",
        description: "Minimum time between consecutive posts. Ensures human-like pacing.",
        default: 30,
      },
      maxPostGapMinutes: {
        type: "number",
        title: "Max Post Gap (minutes)",
        description: "Maximum time between auto-scheduled posts. Used for random spread.",
        default: 120,
      },
      postingWindowStart: {
        type: "number",
        title: "Posting Window Start (hour)",
        description: "Earliest hour of day to auto-schedule posts (0-23).",
        default: 6,
      },
      postingWindowEnd: {
        type: "number",
        title: "Posting Window End (hour)",
        description: "Latest hour of day to auto-schedule posts (0-24).",
        default: 24,
      },
      cycleIntervalMin: {
        type: "number",
        title: "Cycle Interval Min (seconds)",
        description: "Minimum time between engagement actions. Lower = more responsive, but more detectable.",
        default: 12,
      },
      cycleIntervalMax: {
        type: "number",
        title: "Cycle Interval Max (seconds)",
        description: "Maximum time between engagement actions. Higher = more human-like.",
        default: 25,
      },
      dailyLikesLimit: {
        type: "number",
        title: "Daily Likes Limit",
        description: "Maximum likes per day per account. X.com may flag accounts over ~50.",
        default: 40,
      },
      dailyFollowsLimit: {
        type: "number",
        title: "Daily Follows Limit",
        description: "Maximum follows per day. X.com aggressively limits follows.",
        default: 15,
      },
      dailyRepliesLimit: {
        type: "number",
        title: "Daily Replies Limit",
        description: "Maximum replies per day per account.",
        default: 20,
      },
      dailyRepostsLimit: {
        type: "number",
        title: "Daily Reposts Limit",
        description: "Maximum reposts per day per account.",
        default: 10,
      },
      breathingPauseMinActions: {
        type: "number",
        title: "Breathing Pause After (min actions)",
        description: "Minimum consecutive actions before a breathing pause.",
        default: 5,
      },
      breathingPauseMaxActions: {
        type: "number",
        title: "Breathing Pause After (max actions)",
        description: "Maximum consecutive actions before a forced breathing pause.",
        default: 10,
      },
      breathingPauseMinSeconds: {
        type: "number",
        title: "Breathing Pause Min (seconds)",
        description: "Minimum duration of a breathing pause.",
        default: 30,
      },
      breathingPauseMaxSeconds: {
        type: "number",
        title: "Breathing Pause Max (seconds)",
        description: "Maximum duration of a breathing pause.",
        default: 90,
      },
    },
  },

  // ── Webhooks ─────────────────────────────────────────────────────────────

  webhooks: [
    {
      endpointKey: "ext-heartbeat",
      displayName: "Extension Heartbeat",
      description:
        "Receives periodic heartbeat pings from the Chrome extension bot. " +
        "Acknowledges the call and persists the latest session status in plugin state.",
    },
  ],

  // ── Scheduled jobs ───────────────────────────────────────────────────────

  jobs: [
    {
      jobKey: "post-dispatcher",
      displayName: "Post Dispatcher",
      description: "Process scheduled tweet queue via X API v2.",
      schedule: "*/2 * * * *",
    },
    {
      jobKey: "engagement-cycle",
      displayName: "Engagement Cycle",
      description: "Execute engagement actions on targets via X API v2.",
      schedule: "*/5 * * * *",
    },
    {
      jobKey: "queue-cleanup",
      displayName: "Queue Cleanup",
      description: "Archives completed/failed queue items older than 7 days.",
      schedule: "0 */6 * * *",
    },
    {
      jobKey: "analytics-rollup",
      displayName: "Analytics Rollup",
      description: "Aggregates daily posting and engagement stats from action logs.",
      schedule: "0 0 * * *",
    },
  ],

  // ── Agent tools ──────────────────────────────────────────────────────────

  tools: [
    {
      name: "queue-post",
      displayName: "Twitter: Queue Post",
      description:
        "Queue a tweet for posting via X API v2. Supports text, media URLs, hashtags, and optional scheduling. If X API is enabled and no scheduledAt is set, posts immediately.",
      parametersSchema: {
        type: "object",
        required: ["text"],
        properties: {
          text: {
            type: "string",
            description: "Tweet text (max 280 characters).",
            maxLength: 280,
          },
          mediaUrls: {
            type: "array",
            items: { type: "string" },
            description: "URLs of images to attach (max 4). Must be publicly accessible.",
            maxItems: 4,
          },
          hashtags: {
            type: "array",
            items: { type: "string" },
            description: "Hashtags to append (without # prefix).",
          },
          scheduledAt: {
            type: "string",
            description: "ISO 8601 timestamp to schedule the post. Omit for immediate.",
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
            description: "Which venture this post is for. Defaults to plugin config default.",
          },
        },
      },
    },
    {
      name: "queue-reply",
      displayName: "Twitter: Queue Reply",
      description: "Queue a reply to a specific tweet. Posts via X API v2.",
      parametersSchema: {
        type: "object",
        required: ["replyToUrl", "text"],
        properties: {
          replyToUrl: {
            type: "string",
            description: "Full URL of the tweet to reply to (e.g. https://x.com/user/status/123).",
          },
          text: {
            type: "string",
            description: "Reply text (max 280 characters).",
            maxLength: 280,
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
          },
        },
      },
    },
    {
      name: "queue-repost",
      displayName: "Twitter: Queue Repost",
      description: "Queue a repost (retweet) of a specific tweet.",
      parametersSchema: {
        type: "object",
        required: ["repostUrl"],
        properties: {
          repostUrl: {
            type: "string",
            description: "Full URL of the tweet to repost.",
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
          },
        },
      },
    },
    {
      name: "create-mission",
      displayName: "Twitter: Create Mission",
      description:
        "Define a multi-step engagement mission. Steps can include SEARCH, LIKE, FOLLOW, REPLY, EXTRACT, VISIT_PROFILE, etc. API-compatible steps execute via X API v2; DOM-specific steps are logged as no-ops.",
      parametersSchema: {
        type: "object",
        required: ["steps"],
        properties: {
          name: {
            type: "string",
            description: "Human-readable name for this mission.",
          },
          steps: {
            type: "array",
            items: {
              type: "object",
              required: ["action"],
              properties: {
                action: {
                  type: "string",
                  enum: [
                    "SEARCH", "GOTO", "SCROLL", "WAIT", "CLICK_TWEET",
                    "LIKE", "REPOST", "FOLLOW", "REPLY", "POST",
                    "VISIT_PROFILE", "EXTRACT", "BULK_EXTRACT", "NAVIGATE_BACK",
                  ],
                },
                params: {
                  type: "object",
                  description: "Action-specific parameters (e.g. { query: '#web3' } for SEARCH, { text: 'Great post!' } for REPLY).",
                },
                expected_view: {
                  type: "string",
                  description: "Expected page view before this step (HOME, EXPLORE, PROFILE, TWEET, SEARCH).",
                },
              },
            },
            description: "Ordered list of mission steps.",
          },
        },
      },
    },
    {
      name: "add-target",
      displayName: "Twitter: Add Target",
      description: "Add a Twitter account to the engagement target list.",
      parametersSchema: {
        type: "object",
        required: ["handle"],
        properties: {
          handle: {
            type: "string",
            description: "Twitter handle (without @).",
          },
          displayName: {
            type: "string",
            description: "Display name of the account.",
          },
          engageActions: {
            type: "array",
            items: { type: "string", enum: ["LIKE", "FOLLOW", "REPLY", "REPOST"] },
            description: "Which engagement actions to perform. Defaults to [LIKE].",
            default: ["LIKE"],
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
          },
        },
      },
    },
    {
      name: "remove-target",
      displayName: "Twitter: Remove Target",
      description: "Remove a Twitter account from the engagement target list.",
      parametersSchema: {
        type: "object",
        required: ["handle"],
        properties: {
          handle: {
            type: "string",
            description: "Twitter handle to remove.",
          },
        },
      },
    },
    {
      name: "list-targets",
      displayName: "Twitter: List Targets",
      description: "Query the engagement target list. Filter by status or venture.",
      parametersSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["active", "paused", "removed"],
            description: "Filter by target status. Defaults to active.",
            default: "active",
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
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
      name: "query-extracts",
      displayName: "Twitter: Query Extracted Data",
      description:
        "Search previously extracted tweet and profile data. Filter by entity type, author, keyword, or time range.",
      parametersSchema: {
        type: "object",
        properties: {
          entityType: {
            type: "string",
            enum: ["extracted-tweet", "extracted-profile"],
            description: "Type of extracted data. Defaults to extracted-tweet.",
            default: "extracted-tweet",
          },
          limit: {
            type: "number",
            description: "Max results. Defaults to 20.",
            default: 20,
          },
        },
      },
    },
    {
      name: "get-queue-status",
      displayName: "Twitter: Queue Status",
      description: "Check the content queue depth — pending, claimed, posted, and failed counts. Includes X API connection and rate limit status.",
      parametersSchema: {
        type: "object",
        properties: {
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
            description: "Filter by venture.",
          },
        },
      },
    },
    {
      name: "get-analytics",
      displayName: "Twitter: Get Analytics",
      description: "Retrieve posting and engagement analytics over a time window.",
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
      name: "queue-thread",
      displayName: "Twitter: Queue Thread",
      description: "Queue a thread (multiple connected tweets). Posts as a connected thread via X API v2.",
      parametersSchema: {
        type: "object",
        required: ["tweets"],
        properties: {
          tweets: {
            type: "array",
            items: { type: "string" },
            description: "Array of tweet texts in order. Each max 280 chars. Max 25 tweets.",
            maxItems: 25,
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
          },
        },
      },
    },
    {
      name: "generate-tweets",
      displayName: "Twitter: Generate Tweet Context",
      description:
        "Gather context for generating unique tweets. Pulls recent posts (to avoid repetition) and scraped content from Firecrawl (if available). Returns structured data the agent uses to write original tweets, then calls queue-post for each.",
      parametersSchema: {
        type: "object",
        required: ["topic"],
        properties: {
          topic: {
            type: "string",
            description: "What to write about (e.g. 'tokns.fi staking launch', 'web3 privacy').",
          },
          count: {
            type: "number",
            description: "How many tweet drafts to generate. Defaults to 5, max 10.",
            default: 5,
          },
          venture: {
            type: "string",
            enum: ["shieldnest", "tokns", "smartnotes", "token", "brand", "coherencedaddy"],
            description: "Filter scraped context by venture.",
          },
          style: {
            type: "string",
            enum: ["informative", "engaging", "promotional", "thread"],
            description: "Tone for the tweets. Defaults to engaging.",
            default: "engaging",
          },
        },
      },
    },
    {
      name: "get-bot-config",
      displayName: "Twitter: Get Bot Config",
      description: "Returns anti-bot behavior settings and X API rate limit status.",
      parametersSchema: { type: "object", properties: {} },
    },
    {
      name: "get-media-drops",
      displayName: "Twitter: Get Media Drops",
      description:
        "Fetch available media drops (images/videos uploaded for posting). Returns drops with captions, hashtags, and file URLs. Use with queue-post to post media content.",
      parametersSchema: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description: "Filter by status: available, queued, posted.",
            default: "available",
          },
          platform: {
            type: "string",
            description: "Filter by platform.",
            default: "twitter",
          },
          limit: {
            type: "number",
            description: "Max drops to return.",
            default: 10,
          },
        },
      },
    },
  ],
};

export default manifest;
