import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "coherencedaddy.moltbook",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Moltbook",
  description:
    "Moltbook social network integration for Coherence Daddy — safe content posting, community engagement, and presence management on the AI agent social platform. All outbound content passes through safety filters and approval queues.",
  author: "Coherence Daddy",
  categories: ["connector", "automation"],
  capabilities: [
    "agent.tools.register",
    "http.outbound",
    "plugin.state.read",
    "plugin.state.write",
    "jobs.schedule",
    "secrets.read-ref",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },

  // ─── Config schema ────────────────────────────────────────────────────────
  instanceConfigSchema: {
    type: "object",
    required: ["apiKeyRef"],
    properties: {
      apiKeyRef: {
        type: "string",
        title: "Moltbook API Key",
        description:
          "Secret reference for the Moltbook API key. Resolved at runtime via the Paperclip secret provider.",
      },
      agentName: {
        type: "string",
        title: "Agent Name",
        description: "Display name on Moltbook (used during registration).",
        default: "Coherence Daddy",
      },
      agentDescription: {
        type: "string",
        title: "Agent Description",
        description: "Agent bio on Moltbook (used during registration).",
        default:
          "Faith-driven technology for a more coherent world. Building private, secure self-help products that teach real skills and broaden awareness.",
      },
      autoApproveContent: {
        type: "boolean",
        title: "Auto-Approve Content",
        description:
          "If true, posts/comments skip the approval queue and are sent immediately. If false (default), content goes to pending queue for manual review.",
        default: false,
      },
      rateLimitMultiplier: {
        type: "number",
        title: "Rate Limit Safety Multiplier",
        description:
          "Fraction of Moltbook's API limits to actually use. 0.5 = use only half the allowed rate. Lower = safer.",
        default: 0.5,
        minimum: 0.1,
        maximum: 1.0,
      },
      maxPostsPerDay: {
        type: "number",
        title: "Max Posts / Day",
        description: "Maximum posts per day. Moltbook allows 1/30min ≈ 48/day; this caps us lower.",
        default: 4,
        minimum: 1,
        maximum: 48,
      },
      maxCommentsPerDay: {
        type: "number",
        title: "Max Comments / Day",
        description: "Maximum comments per day. Moltbook allows 50/day.",
        default: 20,
        minimum: 1,
        maximum: 50,
      },
      maxVotesPerDay: {
        type: "number",
        title: "Max Votes / Day",
        description: "Maximum upvotes/downvotes per day.",
        default: 50,
        minimum: 1,
        maximum: 200,
      },
      blockedPatterns: {
        type: "array",
        title: "Blocked Content Patterns",
        description:
          "Regex patterns to block in outbound content. Defaults catch API keys, internal IPs, env var names, and common secret formats.",
        items: { type: "string" },
        default: [
          "[A-Za-z0-9_-]{20,}(?:key|token|secret)",
          "(?:31\\.220|168\\.231|147\\.79)\\.\\d+\\.\\d+",
          "(?:DATABASE_URL|ANTHROPIC_API_KEY|SMTP_|STRIPE_|DISCORD_TOKEN|GITHUB_TOKEN|GROK_API_KEY|GEMINI_API_KEY|CONTENT_API_KEY|INTEL_INGEST_KEY|EMBED_API_KEY|OLLAMA_API_KEY)",
          "sk-[a-zA-Z0-9]{20,}",
          "ghp_[a-zA-Z0-9]{20,}",
          "moltbook_[a-zA-Z0-9]{10,}",
          "Bearer\\s+[A-Za-z0-9._-]{20,}",
        ],
      },
    },
  },

  // ─── Scheduled jobs ───────────────────────────────────────────────────────
  jobs: [
    {
      jobKey: "content-dispatcher",
      displayName: "Content Dispatcher",
      description:
        "Process the approved content queue — posts, comments, and votes are sent to Moltbook API.",
      schedule: "*/5 * * * *",
    },
    {
      jobKey: "heartbeat",
      displayName: "Heartbeat",
      description: "Fetch heartbeat.md from Moltbook to maintain agent presence.",
      schedule: "*/30 * * * *",
    },
    {
      jobKey: "daily-cleanup",
      displayName: "Daily Cleanup",
      description:
        "Archive old entities, reset daily budget counters, and roll up analytics.",
      schedule: "0 0 * * *",
    },
  ],

  // ─── Agent tools ──────────────────────────────────────────────────────────
  tools: [
    {
      name: "moltbook-register",
      displayName: "Moltbook: Register Agent",
      description:
        "Register Coherence Daddy on Moltbook. One-time operation. Returns API key (stored as secret) and claim URL for human verification.",
      parametersSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Agent name on Moltbook.",
            default: "Coherence Daddy",
          },
          description: {
            type: "string",
            description: "Agent bio/description.",
          },
        },
      },
    },
    {
      name: "moltbook-status",
      displayName: "Moltbook: Check Status",
      description:
        "Check agent claim/verification status and current rate limit usage.",
      parametersSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "moltbook-post",
      displayName: "Moltbook: Create Post",
      description:
        "Queue a post for a submolt. Goes to approval queue unless auto-approve is enabled. Content is safety-filtered before sending.",
      parametersSchema: {
        type: "object",
        required: ["submolt_name", "title"],
        properties: {
          submolt_name: {
            type: "string",
            description: "Target submolt (community) name.",
          },
          title: {
            type: "string",
            description: "Post title.",
          },
          content: {
            type: "string",
            description: "Post body text.",
          },
          url: {
            type: "string",
            description: "Optional link URL for link posts.",
          },
          type: {
            type: "string",
            enum: ["text", "link", "image"],
            description: "Post type. Defaults to text.",
          },
        },
      },
    },
    {
      name: "moltbook-comment",
      displayName: "Moltbook: Comment",
      description:
        "Queue a comment on a post. Supports threaded replies via parent_id. Content is safety-filtered.",
      parametersSchema: {
        type: "object",
        required: ["post_id", "content"],
        properties: {
          post_id: {
            type: "string",
            description: "ID of the post to comment on.",
          },
          content: {
            type: "string",
            description: "Comment text.",
          },
          parent_id: {
            type: "string",
            description: "Parent comment ID for threaded replies.",
          },
        },
      },
    },
    {
      name: "moltbook-vote",
      displayName: "Moltbook: Vote",
      description: "Upvote or downvote a post or comment.",
      parametersSchema: {
        type: "object",
        required: ["target_id", "direction"],
        properties: {
          target_id: {
            type: "string",
            description: "ID of the post or comment to vote on.",
          },
          direction: {
            type: "string",
            enum: ["up", "down"],
            description: "Vote direction.",
          },
          target_type: {
            type: "string",
            enum: ["post", "comment"],
            description: "Whether voting on a post or comment. Defaults to post.",
          },
        },
      },
    },
    {
      name: "moltbook-feed",
      displayName: "Moltbook: Read Feed",
      description:
        "Read the Moltbook feed. Supports sorting (hot/new/top/rising) and filtering (following-only).",
      parametersSchema: {
        type: "object",
        properties: {
          sort: {
            type: "string",
            enum: ["hot", "new", "top", "rising"],
            description: "Feed sort order. Defaults to hot.",
          },
          limit: {
            type: "number",
            description: "Number of posts to fetch. Defaults to 25.",
          },
          filter: {
            type: "string",
            enum: ["following"],
            description: "Optional filter. 'following' shows only posts from followed agents.",
          },
        },
      },
    },
    {
      name: "moltbook-search",
      displayName: "Moltbook: Search",
      description: "Semantic search across Moltbook posts and comments.",
      parametersSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: {
            type: "string",
            description: "Search query (semantic, not just keyword).",
          },
          type: {
            type: "string",
            enum: ["posts", "comments", "all"],
            description: "What to search. Defaults to all.",
          },
          limit: {
            type: "number",
            description: "Max results. Defaults to 20.",
          },
        },
      },
    },
    {
      name: "moltbook-subscribe",
      displayName: "Moltbook: Subscribe/Unsubscribe",
      description: "Subscribe to or unsubscribe from a submolt (community).",
      parametersSchema: {
        type: "object",
        required: ["submolt_name", "action"],
        properties: {
          submolt_name: {
            type: "string",
            description: "Submolt name.",
          },
          action: {
            type: "string",
            enum: ["subscribe", "unsubscribe"],
            description: "Whether to subscribe or unsubscribe.",
          },
        },
      },
    },
    {
      name: "moltbook-create-submolt",
      displayName: "Moltbook: Create Community",
      description:
        "Create a new submolt (community) on Moltbook. Crypto content is disabled by default.",
      parametersSchema: {
        type: "object",
        required: ["name", "display_name", "description"],
        properties: {
          name: {
            type: "string",
            description: "Submolt slug (URL-safe, lowercase).",
          },
          display_name: {
            type: "string",
            description: "Human-readable display name.",
          },
          description: {
            type: "string",
            description: "Community description.",
          },
          allow_crypto: {
            type: "boolean",
            description:
              "Allow cryptocurrency content. Defaults to false (auto-removed).",
          },
        },
      },
    },
    {
      name: "moltbook-profile",
      displayName: "Moltbook: View Profile",
      description: "View your own profile or another agent's profile.",
      parametersSchema: {
        type: "object",
        properties: {
          agent_name: {
            type: "string",
            description:
              "Agent name to look up. Omit to view your own profile.",
          },
        },
      },
    },
    {
      name: "moltbook-notifications",
      displayName: "Moltbook: Notifications",
      description:
        "Check the dashboard/notifications, or mark notifications as read.",
      parametersSchema: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["check", "read-all", "read-post"],
            description:
              "Action: check (get dashboard), read-all (mark all read), read-post (mark specific post's notifications read).",
          },
          post_id: {
            type: "string",
            description: "Post ID for read-post action.",
          },
        },
      },
    },
  ],
};

export default manifest;
