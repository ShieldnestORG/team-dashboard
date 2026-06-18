import { randomUUID } from "node:crypto";
import { logger } from "../../middleware/logger.js";
import type {
  PlatformPublisher,
  PublishOptions,
  PublishResult,
  PublishTextOptions,
} from "./types.js";

// Zernio is the working multi-account publish path already used by IG_Auditor
// (post_brand.py / post_girls.py / crosspost.py). Unlike the dead native-Meta
// `instagram_reels` stub, it publishes IG (and TikTok/YouTube/X) by handing
// Zernio a PUBLIC media URL which Zernio fetches itself.
//
// Per-account auth: Zernio uses one Bearer key per accountId. We mirror
// IG_Auditor's `.env.posting-keys` (POST_KEY_<accountId>) as env vars
// `ZERNIO_KEY_<zernioAccountId>`, read at call time. This is the first
// publisher that genuinely needs per-account creds, so it resolves the
// Zernio accountId from the team-dashboard account's `oauthRef` pointer
// ("zernio:<id>"), forwarded by the relayer.

const ZERNIO_API_BASE = process.env.ZERNIO_API_BASE || "https://zernio.com/api/v1";

// team-dashboard platform string (social_accounts.platform) → Zernio platform
// string. team-dashboard uses "x" for X; Zernio uses "twitter" (crosspost.py).
const PLATFORM_MAP: Record<string, string> = {
  instagram: "instagram",
  tiktok: "tiktok",
  youtube: "youtube",
  x: "twitter",
  twitter: "twitter",
};

function zernioKeyFor(zernioAccountId: string): string | undefined {
  // Mirrors IG_Auditor's POST_KEY_<accountId>; read at call time so newly
  // provisioned keys are picked up without a restart of resolution logic.
  return process.env[`ZERNIO_KEY_${zernioAccountId}`];
}

function parseZernioAccountId(oauthRef?: string): string | undefined {
  if (!oauthRef?.startsWith("zernio:")) return undefined;
  const id = oauthRef.slice("zernio:".length).trim();
  return id.length > 0 ? id : undefined;
}

function mediaType(url: string): "video" | "image" {
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(url) ? "video" : "image";
}

// Defense-in-depth on the media URLs Zernio fetches SERVER-SIDE. Beyond the
// `^https?://` shape check, reject hosts that are obviously internal/non-public
// so they fail fast HERE with a clear local error instead of confusingly at
// Zernio (or as an SSRF-adjacent footgun). Public CDN hosts (R2 `.r2.dev`, the
// public reels-stream URL) must still pass.
function isNonPublicMediaUrl(u: string): boolean {
  if (!/^https?:\/\//i.test(u)) return true;
  let host: string;
  try {
    host = new URL(u).hostname.toLowerCase();
  } catch {
    return true; // unparseable → reject
  }
  // IPv6 loopback (URL strips the surrounding brackets from hostname).
  if (host === "::1") return true;
  // Hostname suffixes that are never publicly routable.
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    host.endsWith(".local")
  ) {
    return true;
  }
  // IPv4 literals in private / loopback / link-local / unspecified ranges.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  }
  return false;
}

export const zernioPublisher: PlatformPublisher = {
  // Matches social_accounts.platform === "instagram" so existing IG rows route
  // here. No collision with the dead native stub, whose name is
  // "instagram_reels" (instagram.ts:8).
  // TODO(verify): if Zernio should also take over TikTok/YouTube/X in
  // team-dashboard, those account rows' `platform` strings would each need a
  // publisher whose `name` matches — getPublisher() matches one name per row.
  name: "instagram",

  isConfigured() {
    // Multi-account: configured if ANY per-account Zernio key is present.
    // The relayer also re-checks isConfigured() before dispatch.
    return Object.keys(process.env).some((k) => k.startsWith("ZERNIO_KEY_"));
  },

  // Asset/Buffer path is unused — Zernio pulls media from a public URL, it does
  // not accept an uploaded Buffer. Mirrors bluesky.ts's publish() stub.
  async publish(_opts: PublishOptions): Promise<PublishResult> {
    return {
      success: false,
      error: "zernioPublisher uses publishText (public media URL), not asset upload",
    };
  },

  async publishText(opts: PublishTextOptions): Promise<PublishResult> {
    try {
      // 1. Resolve the Zernio accountId from the account's oauthRef
      //    ("zernio:<id>"), forwarded by the relayer.
      const zid = parseZernioAccountId(opts.oauthRef);
      if (!zid) {
        return {
          success: false,
          error: `account ${opts.socialAccountId} has no "zernio:<id>" oauthRef`,
        };
      }

      // 2. Resolve the per-account Bearer key.
      const key = zernioKeyFor(zid);
      if (!key) {
        return { success: false, error: `no ZERNIO_KEY_${zid} configured` };
      }

      // 3. Resolve the Zernio platform name. Default IG; honor a payload
      //    override so a queued row can target another platform in the same
      //    Zernio workspace.
      const tdPlatform = (opts.payload?.platform as string | undefined) || "instagram";
      const zPlatform = PLATFORM_MAP[tdPlatform];
      if (!zPlatform) {
        return { success: false, error: `unmapped platform '${tdPlatform}'` };
      }

      // 4. Media: Zernio fetches these PUBLIC URLs itself. We pass mediaUrls
      //    straight through.
      //    TODO(media-hosting): team-dashboard has no generic "upload Buffer →
      //    public CDN URL" helper. Its S3 storage layer (server/src/storage)
      //    only streams objects back through the authenticated server; the only
      //    public-serving path is `${PAPERCLIP_PUBLIC_URL}/api/reels/:id/stream`
      //    (public-reels.ts, no-auth). So callers MUST enqueue already-public
      //    absolute URLs (e.g. R2 `.r2.dev` or the public reels stream URL). If
      //    a non-public/relative URL is enqueued, Zernio cannot fetch it and the
      //    post fails. Adding an in-publisher R2/S3 public-upload step is a
      //    separate decision (needs new creds) — do NOT improvise it here.
      const mediaUrls = opts.mediaUrls || [];
      const nonPublic = mediaUrls.find(isNonPublicMediaUrl);
      if (nonPublic) {
        return {
          success: false,
          error: `media url is not a public http(s) URL Zernio can fetch: ${nonPublic}`,
        };
      }
      const mediaItems = mediaUrls.map((url) => ({ type: mediaType(url), url }));

      // 5. Build the platforms[] entry. Pass through optional per-platform
      //    extras the queued row may carry in payload.
      //    altTexts has no verified Zernio equivalent (crosspost.py /
      //    schedule_girls.py) → dropped. TODO(verify) if Zernio adds alt-text.
      const platformEntry: Record<string, unknown> = { platform: zPlatform, accountId: zid };
      if (opts.payload?.platformSpecificData) {
        platformEntry.platformSpecificData = opts.payload.platformSpecificData;
      }
      if (opts.payload?.customContent) {
        platformEntry.customContent = opts.payload.customContent;
      }

      // 6. Body. publishNow:true — team-dashboard's relayer is itself the
      //    scheduler (it only releases rows whose scheduled_at <= now()), so by
      //    the time we run, "now" IS the schedule. Forwarding scheduledFor would
      //    create two schedulers fighting → do NOT send it.
      const body: Record<string, unknown> = {
        content: opts.text,
        platforms: [platformEntry],
        publishNow: true,
      };
      if (mediaItems.length > 0) body.mediaItems = mediaItems;

      const res = await fetch(`${ZERNIO_API_BASE}/posts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // Stable per-row request id so Zernio can de-dupe retries: when the
          // relayer retries a row whose 2xx was lost, the same social_posts.id
          // (forwarded as opts.postId) yields the same x-request-id. Fallback to
          // randomUUID() only when postId is absent (backward compatibility).
          "x-request-id": opts.postId || randomUUID(),
        },
        body: JSON.stringify(body),
      });

      const txt = await res.text();
      if (!res.ok) {
        return { success: false, error: `Zernio ${res.status}: ${txt.slice(0, 400)}` };
      }

      // TODO(verify): exact success-response shape of POST /v1/posts (created
      // post id + live URL field names) is UNVERIFIED. IG_Auditor only parses
      // Zernio's GET /posts response (ledger.py: `_id`,
      // `platforms[].platformPostUrl`); the POST response is never parsed in any
      // read file. Parse defensively — success is still recorded from res.ok
      // even if these fields end up undefined.
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(txt) as Record<string, unknown>;
      } catch {
        // non-JSON 2xx body — keep {} and still report success.
      }
      const platformPostId = pickPostId(data);
      const platformUrl = pickPostUrl(data);

      logger.info({ zid, platform: zPlatform, platformPostId }, "Zernio publish ok");
      return { success: true, platformPostId, platformUrl };
    } catch (err) {
      logger.error({ err }, "Zernio publishText failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

// --- defensive response parsing (field names UNVERIFIED — see TODO above) --- //

function pickPostId(data: Record<string, unknown>): string | undefined {
  const candidates = [
    data._id,
    data.id,
    (data.post as Record<string, unknown> | undefined)?._id,
    (data.post as Record<string, unknown> | undefined)?.id,
    (data.data as Record<string, unknown> | undefined)?._id,
    (data.data as Record<string, unknown> | undefined)?.id,
  ];
  const hit = candidates.find((v) => typeof v === "string" && v.length > 0);
  return hit as string | undefined;
}

function pickPostUrl(data: Record<string, unknown>): string | undefined {
  const platforms = data.platforms;
  if (Array.isArray(platforms) && platforms.length > 0) {
    // mirrors ledger.py's reconcile parse of platforms[].platformPostUrl
    const first = platforms[0] as Record<string, unknown> | undefined;
    const fromPlatforms = first?.platformPostUrl;
    if (typeof fromPlatforms === "string" && fromPlatforms.length > 0) return fromPlatforms;
  }
  const candidates = [data.platformPostUrl, data.postUrl, data.url];
  const hit = candidates.find((v) => typeof v === "string" && v.length > 0);
  return hit as string | undefined;
}
