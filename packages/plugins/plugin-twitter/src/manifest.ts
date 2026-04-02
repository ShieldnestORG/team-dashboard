import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

export const PLUGIN_ID = "coherencedaddy.twitter";
export const PLUGIN_VERSION = "0.1.0";

const manifest: PaperclipPluginManifestV1 = {
  id: PLUGIN_ID,
  apiVersion: 1,
  version: PLUGIN_VERSION,
  displayName: "Twitter/X",
  description:
    "Twitter/X automation bridge for agents. Queue tweets, define engagement missions, extract data, and manage targets — all executed by the x-Ext Chrome extension running on X.com.",
  author: "Coherence Daddy",
  categories: ["connector", "automation"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "webhooks.receive",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  instanceConfigSchema: {
    type: "object",
    required: [],
    properties: {
      extensionSecret: {
        type: "string",
        title: "Extension Secret (optional)",
        description:
          "Optional shared secret for webhook authentication. Leave blank for local/internal use — only needed if the dashboard is exposed publicly.",
        default: "",
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
        description: "When true, engagement missions auto-execute when the extension polls. When false, missions require manual activation.",
        default: false,
      },
    },
  },

  // ── Webhooks (called by x-Ext Chrome extension) ──────────────────────────

  webhooks: [
    {
      endpointKey: "ext-poll",
      displayName: "Extension Poll",
    },
    {
      endpointKey: "ext-result",
      displayName: "Extension Result",
    },
    {
      endpointKey: "ext-progress",
      displayName: "Extension Progress",
    },
    {
      endpointKey: "ext-heartbeat",
      displayName: "Extension Heartbeat",
    },
  ],

  // ── Scheduled jobs ───────────────────────────────────────────────────────

  jobs: [
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
        "Queue a tweet for the x-Ext Chrome extension to post. Supports text, media URLs, hashtags, and optional scheduling. The extension picks it up on its next poll cycle.",
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
      description: "Queue a reply to a specific tweet. The extension navigates to the tweet and posts the reply.",
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
        "Define a multi-step engagement mission. Steps can include SEARCH, LIKE, FOLLOW, REPLY, EXTRACT, VISIT_PROFILE, etc. The extension executes steps sequentially.",
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
      description: "Check the content queue depth — pending, claimed, posted, and failed counts.",
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
  ],
};

export default manifest;
