import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve, sep } from "node:path";
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

// Media guardrails (defense-in-depth for upload_media). These MIRROR the
// server's own sniff+cap (services/socials/media-upload.ts) so a
// prompt-injected filePath can't turn this tool into an arbitrary local-file
// reader. The server remains the authoritative trust boundary (magic-byte
// sniff + per-kind cap); this just refuses obviously-wrong paths before any
// bytes are read off disk.
const ALLOWED_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const ALLOWED_VIDEO_EXTS = new Set([".mp4", ".m4v", ".mov"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10MB — SOCIAL_MEDIA_MAX_IMAGE_BYTES default
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200MB — SOCIAL_MEDIA_MAX_VIDEO_BYTES default

/** True if any path segment is hidden (dotfile/dotdir) — blocks ~/.ssh etc. */
function hasHiddenSegment(absPath: string): boolean {
  return absPath.split(sep).some((seg) => seg.startsWith(".") && seg !== "." && seg !== "..");
}

/**
 * Whole days until the key expires, computed CLIENT-SIDE from the key's
 * expiresAt (not the server's snapshot number). Ceil to match the server's
 * key-info arithmetic. null when we have no expiry.
 */
function daysLeft(info: KeyInfo | null): number | null {
  if (!info?.expiresAt) return null;
  const ms = new Date(info.expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

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
    // SUGGEST-2: derive days from the cached expiresAt on EVERY call, not from
    // the (possibly hours-stale) server-computed daysRemaining. This keeps the
    // ≤14-day threshold exact per call and lets a just-extended key stop
    // warning the instant its new expiry is cached — no extra request.
    const days = daysLeft(info);
    if (days === null || days > EXPIRY_WARN_DAYS) return "";
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
      // Computed client-side from expiresAt (SUGGEST-2) — exact even against a
      // cached KeyInfo.
      const days = daysLeft(info);
      const expiryLine =
        days === null
          ? "Your key has no expiry date set."
          : days <= 0
            ? "Your key expires TODAY — ask Mark to extend it now."
            : `Your key expires on ${info.expiresAt?.slice(0, 10)} (${days} day${days === 1 ? "" : "s"} remaining).${days <= EXPIRY_WARN_DAYS ? " Ask Mark to extend it soon." : ""}`;
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
      // LOW-1: a fileName must be a bare name, never a path — reject
      // separators and "..", so it can't escape the target folder into
      // arbitrary locations. contentPath is already locked to /api/assets/.
      const name = fileName?.trim() || `voice-clip-${Date.now()}.mp3`;
      if (/[\\/]/.test(name) || name.includes("..")) {
        return respond({
          error: "The file name can't contain folders or '..' — pass a plain name like clip.mp3 and use the directory field for the folder.",
        });
      }
      const bytes = await client.downloadAsset(contentPath);
      const dir = resolve(directory ?? join(homedir(), "Downloads"));
      await mkdir(dir, { recursive: true });
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
    "Upload a real photo or video file (.jpg .jpeg .png .webp .mp4 .m4v .mov) from a normal folder on this computer into the dashboard staging area, for use in a draft post. Only genuine media files in visible folders work — it cannot read documents, hidden/system files, or anything outside a media file. Returns an objectKey to pass to create_draft_post.",
    {
      filePath: z.string().describe("Path to a real image/video file in a normal (non-hidden) folder"),
    },
    async ({ filePath }) => {
      const abs = resolve(filePath);
      const ext = extname(abs).toLowerCase();
      const isImage = ALLOWED_IMAGE_EXTS.has(ext);
      const isVideo = ALLOWED_VIDEO_EXTS.has(ext);

      // Defense-in-depth against a prompt-injected path: only real media
      // extensions, never a hidden/system path. The server still sniffs the
      // bytes — this just refuses obvious non-media before reading them.
      if (!isImage && !isVideo) {
        return respond({
          error: `That isn't a supported media file. Allowed: ${[...ALLOWED_IMAGE_EXTS, ...ALLOWED_VIDEO_EXTS].join(", ")}.`,
        });
      }
      if (hasHiddenSegment(abs)) {
        return respond({
          error: "That path is inside a hidden or system folder — only pick media files from normal, visible folders (e.g. Downloads, Desktop, Movies).",
        });
      }

      // Size pre-check so a huge/booby-trapped path can't be slurped into
      // memory before the server rejects it. Mirrors the server's per-kind cap.
      let size: number;
      try {
        const info = await stat(abs);
        if (!info.isFile()) {
          return respond({ error: "That path isn't a file." });
        }
        size = info.size;
      } catch {
        return respond({ error: "Couldn't find a file at that path." });
      }
      const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (size > cap) {
        const capMb = Math.floor(cap / (1024 * 1024));
        return respond({
          error: `That ${isVideo ? "video" : "image"} is too big (${Math.round(size / (1024 * 1024))}MB — limit is ${capMb}MB).`,
        });
      }

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
