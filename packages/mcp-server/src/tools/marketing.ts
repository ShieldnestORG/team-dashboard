import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KeyInfo, MarketingClient } from "../marketing-client.js";

// ---------------------------------------------------------------------------
// Marketing tools — the "Eagan access" surface.
//
// Every tool is a thin wrapper over marketing-gate-allowlisted REST endpoints;
// ALL enforcement (role scoping, admin-only mutations, voice registry, daily
// quota) stays server-side. Descriptions are written for a non-engineer —
// they render in Claude Desktop's tool list.
//
// Expiry countdown (owner directive): when the board key has ≤14 days left,
// every tool response gets a one-line plain-English warning so Eagan knows to
// ask for an extension before the tools go dark.
// ---------------------------------------------------------------------------

const EXPIRY_WARN_DAYS = 14;
const KEY_INFO_CACHE_MS = 6 * 60 * 60 * 1000; // re-check twice a working day

const VOICE_KEYS = ["mark", "brianna", "mami", "remy", "solene"] as const;

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in row) out[key] = row[key];
  }
  return out;
}

function trimRows(value: unknown, listKey: string, keys: string[]): unknown {
  if (!value || typeof value !== "object") return value;
  const list = (value as Record<string, unknown>)[listKey];
  if (!Array.isArray(list)) return value;
  return { [listKey]: list.map((row) => (row && typeof row === "object" ? pick(row as Record<string, unknown>, keys) : row)) };
}

export function registerMarketingTools(server: McpServer, client: MarketingClient): void {
  let keyInfoCache: { info: KeyInfo; fetchedAt: number } | null = null;

  async function cachedKeyInfo(force = false): Promise<KeyInfo | null> {
    if (!force && keyInfoCache && Date.now() - keyInfoCache.fetchedAt < KEY_INFO_CACHE_MS) {
      return keyInfoCache.info;
    }
    try {
      const info = await client.keyInfo();
      keyInfoCache = { info, fetchedAt: Date.now() };
      return info;
    } catch {
      // Never let the countdown check break a working tool call.
      return keyInfoCache?.info ?? null;
    }
  }

  /** One-line warning appended to every tool response when ≤14 days remain. */
  async function expiryNotice(): Promise<string> {
    const info = await cachedKeyInfo();
    const days = info?.daysRemaining;
    if (typeof days !== "number" || days > EXPIRY_WARN_DAYS) return "";
    const when = days <= 0 ? "today" : days === 1 ? "in 1 day" : `in ${days} days`;
    return `\n\nHeads up: your dashboard access key expires ${when} — ask Mark to extend it.`;
  }

  async function respond(data: unknown): Promise<ToolResult> {
    const notice = await expiryNotice();
    return {
      content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) + notice }],
    };
  }

  // ----- Identity / healthcheck -----

  server.tool(
    "whoami",
    "Check your dashboard access: who the key belongs to, what role it has, when it expires, and how many days are left.",
    {},
    async () => {
      const info = await cachedKeyInfo(true);
      if (!info) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Couldn't reach the dashboard to check your key. Either the server is briefly down or the key expired/was revoked — if this keeps happening, ask Mark.",
            },
          ],
        };
      }
      const days = info.daysRemaining;
      const expiryLine =
        typeof days === "number"
          ? days <= 0
            ? "Your key expires TODAY — ask Mark to extend it now."
            : `Your key expires on ${info.expiresAt?.slice(0, 10)} (${days} day${days === 1 ? "" : "s"} remaining).${days <= EXPIRY_WARN_DAYS ? " Ask Mark to extend it soon." : ""}`
          : "Your key has no expiry date set.";
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                keyName: info.name,
                user: info.user,
                roles: info.memberships.map((m) => m.role ?? "member"),
                expiresAt: info.expiresAt,
                daysRemaining: days,
              },
              null,
              2,
            ) + `\n\n${expiryLine}`,
          },
        ],
      };
    },
  );

  // ----- Reads -----

  server.tool(
    "list_caption_styles",
    "See the team's caption style menu (names + settings) to pick a style when drafting captioned clips. The actual caption rendering happens on Mark's side.",
    {},
    async () => respond(await client.captionStyles()),
  );

  server.tool(
    "list_funnels",
    "Browse the team's comment-to-DM funnel library. Optionally filter by status (draft, ready, live, rejected, retired) or by account handle.",
    {
      status: z.enum(["draft", "ready", "live", "rejected", "retired"]).optional().describe("Only funnels in this status"),
      accountHandle: z.string().optional().describe("Only funnels for this account handle (without the @)"),
    },
    async (params) => {
      const result = await client.listFunnels(params);
      return respond(
        trimRows(result, "funnels", [
          "id",
          "name",
          "accountHandle",
          "status",
          "style",
          "keywords",
          "matchMode",
          "dmMessage",
          "destinationUrl",
          "postHooks",
          "tosRisk",
          "notes",
          "updatedAt",
        ]),
      );
    },
  );

  server.tool(
    "get_funnel_catalog",
    "See the master catalog of proven funnel templates the team seeds new funnels from.",
    {},
    async () => respond(await client.funnelCatalog()),
  );

  server.tool(
    "get_funnel_coverage",
    "See how many ready-to-go funnels each account has (the team's target is 5 ready per account).",
    {},
    async () => respond(await client.funnelCoverage()),
  );

  server.tool(
    "get_funnel_posts",
    "See the hook posts already published or queued for one funnel (the posts that tell people to comment the keyword).",
    {
      funnelId: z.string().describe("The funnel's id (from list_funnels)"),
      limit: z.number().int().min(1).max(100).optional().describe("Max posts to return (default 20)"),
    },
    async ({ funnelId, limit }) => respond(await client.funnelPosts(funnelId, limit)),
  );

  server.tool(
    "list_social_accounts",
    "List the team's social accounts (brand, platform, handle, follower count). Use this to find the account id when handing a draft post to Mark.",
    {},
    async () => {
      const result = await client.listAccounts();
      return respond(
        trimRows(result, "accounts", [
          "id",
          "brand",
          "platform",
          "handle",
          "status",
          "routing",
          "latestFollowerCount",
        ]),
      );
    },
  );

  server.tool(
    "list_inspiration",
    "Read the team's inspiration board — saved post links with notes that feed the daily AI brief.",
    {
      status: z.string().optional().describe("Filter by status (e.g. new, archived)"),
    },
    async ({ status }) => {
      const result = await client.listInspiration(status);
      return respond(trimRows(result, "items", ["id", "url", "note", "status", "createdAt"]));
    },
  );

  server.tool(
    "list_daily_briefs",
    "List the dates of recent daily AI briefs so you can pull a specific one.",
    {
      limit: z.number().int().min(1).max(90).optional().describe("How many to list (default 30)"),
    },
    async ({ limit }) => respond(await client.listBriefs(limit)),
  );

  server.tool(
    "get_daily_brief",
    "Read the team's daily AI brief — a plain-English summary of the last 7 days across socials, leads, and email. Latest by default, or pass a date.",
    {
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional()
        .describe("A specific brief date (YYYY-MM-DD). Leave out for the latest."),
    },
    async ({ date }) => respond(date ? await client.briefByDate(date) : await client.latestBrief()),
  );

  // ----- Voice generation -----

  server.tool(
    "generate_voice_clip",
    "Turn one short spoken line into an MP3 voice clip in a team voice (mark, brianna, mami, remy, or solene). Shared limit of 200 new clips per day — repeated lines are free.",
    {
      voiceKey: z.enum(VOICE_KEYS).describe("Which team voice to use"),
      text: z.string().min(1).describe("The spoken line (keep it short — long text is rejected)"),
    },
    async ({ voiceKey, text }) => respond(await client.generateVoiceClip(voiceKey, text)),
  );

  server.tool(
    "download_voice_clip",
    "Save a generated voice clip as an MP3 file on this computer (defaults to the Downloads folder) so it can be used in an edit.",
    {
      contentPath: z
        .string()
        .startsWith("/api/assets/")
        .describe("The contentPath returned by generate_voice_clip"),
      fileName: z.string().optional().describe("File name to save as (default: voice-clip-<time>.mp3)"),
      directory: z.string().optional().describe("Folder to save into (default: your Downloads folder)"),
    },
    async ({ contentPath, fileName, directory }) => {
      const bytes = await client.downloadAsset(contentPath);
      const dir = resolve(directory ?? join(homedir(), "Downloads"));
      await mkdir(dir, { recursive: true });
      const name = fileName?.trim() || `voice-clip-${Date.now()}.mp3`;
      const target = join(dir, name.endsWith(".mp3") ? name : `${name}.mp3`);
      await writeFile(target, bytes);
      return respond({ saved: true, path: target, byteSize: bytes.byteLength });
    },
  );

  // ----- Draft handoff (everything lands as pending approval) -----

  server.tool(
    "create_draft_post",
    "Hand a draft social post to Mark. It is saved as PENDING APPROVAL — nothing is published until Mark approves it in the dashboard.",
    {
      socialAccountId: z.string().describe("The account id (from list_social_accounts)"),
      text: z.string().min(1).describe("The post text / caption"),
      mediaUrls: z
        .array(z.string())
        .optional()
        .describe("Media for the post: objectKeys from upload_media, or already-public URLs"),
      altTexts: z.array(z.string()).optional().describe("Alt text per media item (accessibility)"),
      replyToUrl: z.string().optional().describe("If this is a reply, the URL of the post being replied to"),
      scheduledAt: z
        .string()
        .optional()
        .describe("Suggested publish time (ISO date-time). Mark can change it when approving."),
    },
    async (params) => respond(await client.createDraftPost(params)),
  );

  server.tool(
    "upload_media",
    "Upload a photo or video from this computer into the dashboard's staging area, for use in a draft post. Returns an objectKey to pass to create_draft_post.",
    {
      filePath: z.string().describe("Path to the image/video file on this computer"),
    },
    async ({ filePath }) => {
      const { readFile } = await import("node:fs/promises");
      const { basename } = await import("node:path");
      const abs = resolve(filePath);
      const bytes = new Uint8Array(await readFile(abs));
      return respond(await client.uploadMedia(basename(abs), bytes));
    },
  );

  server.tool(
    "add_inspiration",
    "Save a link (a post you liked, a reference, an idea) to the team's inspiration board with an optional note. The daily AI brief reviews the board every morning.",
    {
      url: z.string().url().describe("The http(s) link to save"),
      note: z.string().optional().describe("Why it's interesting (one or two lines)"),
    },
    async ({ url, note }) => respond(await client.addInspiration(url, note)),
  );
}
