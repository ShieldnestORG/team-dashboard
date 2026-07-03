import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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

export function zernioKeyFor(zernioAccountId: string): string | undefined {
  // Mirrors IG_Auditor's POST_KEY_<accountId>; read at call time so newly
  // provisioned keys are picked up without a restart of resolution logic.
  return process.env[`ZERNIO_KEY_${zernioAccountId}`];
}

export function parseZernioAccountId(oauthRef?: string): string | undefined {
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

// ============================================================================
// Zernio engagement API client
// (plan-zernio-leverage.md §2 lead-loop + §1 levers L4/L6; CONTROLLER-AUDIT
// Goal B analytics wiring. Contracts verified against zernio-openapi.yaml.)
//
// Key model: keys are PER-ACCOUNT scoped — a key only sees its own account(s)
// (proven by IG_Auditor automations.py discover(), which unions /accounts
// across keys). Workspace-ish reads (webhooks settings, contacts) therefore
// loop every configured ZERNIO_KEY_* rather than assuming one global key.
//
// HARD LINES carried from the spec (do not "fix" these):
//   - NO Zernio Conversions API calls — the in-house Meta CAPI/TikTok Events
//     build off the Stripe webhook is canonical; double-firing double-counts.
//   - NO multi-day DM drips / sequences, NO comment-list broadcasts — ToS
//     won't-build list in Ig_Auditor/DM-FUNNEL-PLAYBOOK.md.
// ============================================================================

const ZERNIO_TIMEOUT_MS = 30_000;

export class ZernioApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`Zernio ${status} on ${path}: ${body.slice(0, 300)}`);
    this.name = "ZernioApiError";
  }
}

// 402 analytics_addon_required and 403 requiresAddon are the SAME condition
// (add-on gate) and must be handled identically — audit Area 4.
export class ZernioAddonMissingError extends ZernioApiError {
  constructor(status: number, path: string, body: string) {
    super(status, path, body);
    this.name = "ZernioAddonMissingError";
  }
}

function isAddonGate(status: number, body: string): boolean {
  if (status === 402) return true;
  return status === 403 && /requiresAddon|addon_required|add-?on/i.test(body);
}

type QueryValue = string | number | boolean | undefined;

export async function zernioFetch<T = Record<string, unknown>>(
  key: string,
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  opts: { query?: Record<string, QueryValue>; body?: unknown } = {},
): Promise<T> {
  const url = new URL(`${ZERNIO_API_BASE}${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(ZERNIO_TIMEOUT_MS),
  });
  const txt = await res.text();
  if (!res.ok) {
    if (isAddonGate(res.status, txt)) {
      throw new ZernioAddonMissingError(res.status, path, txt);
    }
    throw new ZernioApiError(res.status, path, txt);
  }
  try {
    return JSON.parse(txt) as T;
  } catch {
    return {} as T;
  }
}

/** Every configured per-account key, from env ZERNIO_KEY_<zernioAccountId>. */
export function allZernioKeys(): Array<{ zernioAccountId: string; key: string }> {
  return Object.entries(process.env)
    .filter(([k, v]) => k.startsWith("ZERNIO_KEY_") && Boolean(v))
    .map(([k, v]) => ({ zernioAccountId: k.slice("ZERNIO_KEY_".length), key: v as string }));
}

// ----- accounts / profileId resolution ----- //

interface ZernioAccountRow {
  accountId: string;
  platform: string;
  username?: string;
  displayName?: string;
  profileId?: string;
}

function normalizeAccount(a: Record<string, unknown>): ZernioAccountRow {
  const pid = a.profileId as Record<string, unknown> | string | undefined;
  return {
    accountId: String(a._id ?? a.accountId ?? a.id ?? ""),
    platform: String(a.platform ?? "?"),
    username: (a.username as string | undefined) ?? undefined,
    displayName: (a.displayName as string | undefined) ?? undefined,
    profileId:
      typeof pid === "object" && pid !== null
        ? String((pid as Record<string, unknown>)._id ?? (pid as Record<string, unknown>).id ?? "")
        : (pid as string | undefined),
  };
}

export async function listZernioAccountsForKey(key: string): Promise<ZernioAccountRow[]> {
  const data = await zernioFetch<Record<string, unknown>>(key, "GET", "/accounts");
  const raw = (data.accounts ?? data.data ?? []) as Record<string, unknown>[];
  return raw.map(normalizeAccount).filter((r) => r.accountId);
}

// profileId is required by POST /comment-automations. It's stable per account,
// so cache the resolution for the process lifetime.
const profileIdCache = new Map<string, string>();

export async function getZernioProfileId(zernioAccountId: string): Promise<string> {
  const cached = profileIdCache.get(zernioAccountId);
  if (cached) return cached;
  const key = zernioKeyFor(zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${zernioAccountId} configured`);
  const accounts = await listZernioAccountsForKey(key);
  const match =
    accounts.find((a) => a.accountId === zernioAccountId) ??
    // per-account keys usually see exactly one account — trust it as fallback
    (accounts.length === 1 ? accounts[0] : undefined);
  if (!match?.profileId) {
    throw new Error(`could not resolve Zernio profileId for account ${zernioAccountId}`);
  }
  profileIdCache.set(zernioAccountId, match.profileId);
  return match.profileId;
}

// ----- comment automations (keyword funnels: ROOM / COHERENT / ...) ----- //

export interface ZernioDmButton {
  type: "url" | "postback" | "phone";
  title: string; // ≤20 chars (Meta button_template)
  url?: string;
  payload?: string;
  phone?: string;
}

export interface ZernioAutomationInput {
  zernioAccountId: string;
  name: string;
  trigger?: "comment" | "story_reply";
  keywords: string[];
  matchMode?: "exact" | "contains";
  dmMessage: string; // ≤640 chars (button_template limit; enforced always)
  buttons?: ZernioDmButton[];
  commentReply?: string;
  linkTracking?: boolean;
  clickTag?: string;
  platformPostId?: string;
  postId?: string;
  postTitle?: string;
}

/**
 * Guardrail validation, returns human-readable problems (empty = valid).
 * Encodes the DM-FUNNEL-PLAYBOOK lines: keyword-gated only (fire-on-any-comment
 * is the volume/ban hazard), one-shot DM ≤640 chars, ≤3 buttons.
 */
export function validateZernioAutomationInput(input: ZernioAutomationInput): string[] {
  const problems: string[] = [];
  if (!input.zernioAccountId) problems.push("zernioAccountId is required");
  if (!input.name?.trim()) problems.push("name is required");
  const trigger = input.trigger ?? "comment";
  if (trigger !== "comment" && trigger !== "story_reply") {
    problems.push(`trigger must be 'comment' or 'story_reply' (got '${trigger}')`);
  }
  if (!Array.isArray(input.keywords) || input.keywords.filter((k) => k?.trim()).length === 0) {
    problems.push("at least one keyword is required (fire-on-any-comment is a ToS hazard)");
  }
  const matchMode = input.matchMode ?? "contains";
  if (matchMode !== "exact" && matchMode !== "contains") {
    problems.push(`matchMode must be 'exact' or 'contains' (got '${matchMode}')`);
  }
  if (!input.dmMessage?.trim()) problems.push("dmMessage is required");
  if (input.dmMessage && input.dmMessage.length > 640) {
    problems.push(`dmMessage is ${input.dmMessage.length} chars (max 640)`);
  }
  if (input.buttons) {
    if (input.buttons.length > 3) problems.push("at most 3 buttons allowed");
    for (const b of input.buttons) {
      if (!b.title?.trim()) problems.push("every button needs a title");
      else if (b.title.length > 20) problems.push(`button title '${b.title}' exceeds 20 chars`);
      if (b.type === "url" && !b.url) problems.push("url buttons need a url");
      if (b.type === "postback" && !b.payload) problems.push("postback buttons need a payload");
      if (b.type === "phone" && !b.phone) problems.push("phone buttons need a phone");
    }
  }
  return problems;
}

export interface ZernioAutomation extends Record<string, unknown> {
  id: string;
  name: string;
  platform?: string;
  trigger?: string;
  accountId?: string;
  keywords?: string[];
  matchMode?: string;
  dmMessage?: string;
  buttons?: ZernioDmButton[];
  commentReply?: string;
  linkTracking?: boolean;
  clickTag?: string;
  isActive?: boolean;
  stats?: Record<string, unknown>;
  createdAt?: string;
}

export async function createZernioCommentAutomation(
  input: ZernioAutomationInput,
): Promise<ZernioAutomation> {
  const problems = validateZernioAutomationInput(input);
  if (problems.length > 0) {
    throw new Error(`invalid comment automation: ${problems.join("; ")}`);
  }
  const key = zernioKeyFor(input.zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${input.zernioAccountId} configured`);
  const profileId = await getZernioProfileId(input.zernioAccountId);
  const body: Record<string, unknown> = {
    profileId,
    accountId: input.zernioAccountId,
    name: input.name,
    trigger: input.trigger ?? "comment",
    keywords: input.keywords.map((k) => k.trim()).filter(Boolean),
    matchMode: input.matchMode ?? "contains",
    dmMessage: input.dmMessage,
    linkTracking: input.linkTracking ?? true,
  };
  if (input.buttons?.length) body.buttons = input.buttons;
  if (input.commentReply) body.commentReply = input.commentReply;
  if (input.clickTag) body.clickTag = input.clickTag;
  if (input.platformPostId) body.platformPostId = input.platformPostId;
  if (input.postId) body.postId = input.postId;
  if (input.postTitle) body.postTitle = input.postTitle;
  const data = await zernioFetch<{ automation?: ZernioAutomation }>(
    key,
    "POST",
    "/comment-automations",
    { body },
  );
  if (!data.automation?.id) {
    throw new Error("Zernio created the automation but returned no automation.id");
  }
  logger.info(
    { zid: input.zernioAccountId, automationId: data.automation.id, name: input.name },
    "Zernio comment automation created",
  );
  return data.automation;
}

/** List automations. With a zernioAccountId, uses that account's key; without
 *  one, unions across every configured key (per-account key scoping). */
export async function listZernioCommentAutomations(
  zernioAccountId?: string,
): Promise<{ automations: Array<ZernioAutomation & { zernioAccountId: string }>; errors: string[] }> {
  const targets = zernioAccountId
    ? [{ zernioAccountId, key: zernioKeyFor(zernioAccountId) }]
    : allZernioKeys();
  const automations: Array<ZernioAutomation & { zernioAccountId: string }> = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const t of targets) {
    if (!t.key) {
      errors.push(`no ZERNIO_KEY_${t.zernioAccountId} configured`);
      continue;
    }
    try {
      const data = await zernioFetch<{ automations?: ZernioAutomation[] }>(
        t.key,
        "GET",
        "/comment-automations",
      );
      for (const a of data.automations ?? []) {
        if (!a.id || seen.has(a.id)) continue;
        seen.add(a.id);
        automations.push({ ...a, zernioAccountId: String(a.accountId ?? t.zernioAccountId) });
      }
    } catch (err) {
      errors.push(`${t.zernioAccountId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { automations, errors };
}

export async function deleteZernioCommentAutomation(
  zernioAccountId: string,
  automationId: string,
): Promise<void> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${zernioAccountId} configured`);
  await zernioFetch(key, "DELETE", `/comment-automations/${encodeURIComponent(automationId)}`);
  logger.info({ zid: zernioAccountId, automationId }, "Zernio comment automation deleted");
}

// The mechanism actually used to flip a Zernio automation's active state.
//   "patch"    — Zernio accepted a PATCH isActive (verified-if-it-works path).
//   "delete"   — turned OFF by DELETE (the proven kill); also used when the
//                automation is already gone on Zernio (already-off).
//   "recreate" — turned ON by re-CREATE from the local mirror (PATCH-on path
//                unsupported), yielding a NEW automation id.
export type ZernioAutomationActiveMechanism = "patch" | "delete" | "recreate";

export interface ZernioSetActiveResult {
  mechanism: ZernioAutomationActiveMechanism;
  // The automation id that is authoritative AFTER the call. For "patch"/"delete"
  // this is the input id; for "recreate" it is the NEW id Zernio minted.
  zernioAutomationId: string;
}

// Fields the re-create fallback needs off the local mirror row when Zernio does
// not support PATCH-on. Mirrors zernio_comment_automations columns so a plain
// ZernioCommentAutomation row satisfies it structurally.
export interface ZernioAutomationMirrorRow {
  name: string;
  trigger?: string | null;
  keywords?: string[] | null;
  matchMode?: string | null;
  dmMessage: string;
  buttons?: unknown;
  commentReply?: string | null;
  linkTracking?: boolean | null;
  clickTag?: string | null;
}

// Detects the "method unsupported" shape from Zernio: a PATCH that comes back
// 404/405/400. Anything else (network, timeout, addon gate, 5xx) is a real
// failure that must propagate — we only fall back for method-shape errors.
function isPatchUnsupported(err: unknown): boolean {
  return err instanceof ZernioApiError && [400, 404, 405].includes(err.status);
}

/**
 * Set a Zernio comment automation active/inactive.
 *
 * The local mirror's isActive flag does NOTHING to Zernio's DM engine — only a
 * Zernio-side change does. This tries the (unverified) PATCH isActive first; if
 * Zernio rejects PATCH as method-unsupported (404/405/400) it falls back to the
 * proven mechanics:
 *   - isActive=false → DELETE the automation (proven kill).
 *   - isActive=true  → re-CREATE from the mirror row (new automation id).
 *
 * A 404 on DELETE (automation already gone on Zernio) when turning OFF is a
 * success — the automation is already-off; reported with mechanism "delete".
 *
 * Turning ON without a mirror row is impossible (nothing to re-create from) and
 * throws a clear error rather than silently no-op'ing.
 */
export async function setZernioCommentAutomationActive(
  zernioAccountId: string,
  automationId: string,
  isActive: boolean,
  mirrorRow?: ZernioAutomationMirrorRow,
): Promise<ZernioSetActiveResult> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${zernioAccountId} configured`);

  // 1. Try the (unverified) PATCH isActive. If Zernio supports it, we're done
  //    and the id is unchanged — no destructive fallback needed.
  try {
    await zernioFetch(key, "PATCH", `/comment-automations/${encodeURIComponent(automationId)}`, {
      body: { isActive },
    });
    logger.info(
      { zid: zernioAccountId, automationId, isActive },
      "Zernio comment automation active set via PATCH",
    );
    return { mechanism: "patch", zernioAutomationId: automationId };
  } catch (err) {
    if (!isPatchUnsupported(err)) throw err; // real failure — do not fall back
  }

  // 2. PATCH is method-unsupported → fall back to the proven mechanics.
  if (!isActive) {
    // Turn OFF via DELETE (the proven kill). If it's already gone on Zernio
    // (404), treat as already-off success.
    try {
      await zernioFetch(
        key,
        "DELETE",
        `/comment-automations/${encodeURIComponent(automationId)}`,
      );
    } catch (err) {
      if (err instanceof ZernioApiError && err.status === 404) {
        logger.info(
          { zid: zernioAccountId, automationId },
          "Zernio comment automation already absent — treated as already-off",
        );
        return { mechanism: "delete", zernioAutomationId: automationId };
      }
      throw err;
    }
    logger.info(
      { zid: zernioAccountId, automationId },
      "Zernio comment automation turned OFF via DELETE (PATCH unsupported)",
    );
    return { mechanism: "delete", zernioAutomationId: automationId };
  }

  // Turn ON via re-CREATE from the mirror row. Impossible without the row.
  if (!mirrorRow) {
    throw new Error(
      `cannot re-activate Zernio automation ${automationId}: PATCH unsupported and no mirror row provided to re-create from`,
    );
  }
  const keywords = (mirrorRow.keywords ?? []).map((k) => String(k)).filter(Boolean);
  const created = await createZernioCommentAutomation({
    zernioAccountId,
    name: mirrorRow.name,
    trigger: mirrorRow.trigger === "story_reply" ? "story_reply" : "comment",
    keywords,
    matchMode: mirrorRow.matchMode === "exact" ? "exact" : "contains",
    dmMessage: mirrorRow.dmMessage,
    buttons: Array.isArray(mirrorRow.buttons)
      ? (mirrorRow.buttons as ZernioDmButton[])
      : undefined,
    commentReply: mirrorRow.commentReply ?? undefined,
    linkTracking: mirrorRow.linkTracking ?? undefined,
    clickTag: mirrorRow.clickTag ?? undefined,
  });
  logger.info(
    { zid: zernioAccountId, oldAutomationId: automationId, newAutomationId: created.id },
    "Zernio comment automation turned ON via re-CREATE (PATCH unsupported)",
  );
  return { mechanism: "recreate", zernioAutomationId: created.id };
}

export async function getZernioCommentAutomationLogs(
  zernioAccountId: string,
  automationId: string,
  opts: { status?: "sent" | "failed" | "skipped"; limit?: number; skip?: number } = {},
): Promise<Record<string, unknown>> {
  const key = zernioKeyFor(zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${zernioAccountId} configured`);
  return zernioFetch(key, "GET", `/comment-automations/${encodeURIComponent(automationId)}/logs`, {
    query: { status: opts.status, limit: opts.limit, skip: opts.skip },
  });
}

// ----- webhooks (L4) ----- //

export const ZERNIO_WEBHOOK_EVENTS = [
  "comment.received",
  "message.received",
  "lead.received",
  "post.published",
  "post.failed",
  "account.disconnected",
] as const;

/**
 * Verify X-Zernio-Signature: HMAC-SHA256 over the raw request body with the
 * webhook's configured secret. The spec doesn't pin the digest encoding, so
 * hex, "sha256=<hex>", and base64 are all accepted — each compared
 * timing-safely against our own computed digest.
 */
export function verifyZernioSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const presented = signatureHeader.replace(/^sha256=/i, "").trim();
  const hmac = createHmac("sha256", secret).update(rawBody);
  const digest = hmac.digest();
  const candidates = [digest.toString("hex"), digest.toString("base64")];
  const presentedBuf = Buffer.from(presented, "utf8");
  return candidates.some((c) => {
    const candidateBuf = Buffer.from(c, "utf8");
    return (
      candidateBuf.length === presentedBuf.length && timingSafeEqual(candidateBuf, presentedBuf)
    );
  });
}

export interface ZernioWebhookRegistrationResult {
  zernioAccountId: string;
  status: "created" | "exists" | "error";
  webhookId?: string;
  error?: string;
}

/**
 * Register (idempotently) a webhook pointing at `url` on EVERY configured key.
 * Keys are per-account scoped, so each account's events need its own
 * registration; an existing webhook with the same URL counts as done.
 */
export async function registerZernioWebhookForAllKeys(opts: {
  url: string;
  secret: string;
  events?: string[];
  name?: string;
}): Promise<ZernioWebhookRegistrationResult[]> {
  const events = opts.events ?? [...ZERNIO_WEBHOOK_EVENTS];
  const name = opts.name ?? "team-dashboard";
  const results: ZernioWebhookRegistrationResult[] = [];
  for (const { zernioAccountId, key } of allZernioKeys()) {
    try {
      const existing = await zernioFetch<{ webhooks?: Array<Record<string, unknown>> }>(
        key,
        "GET",
        "/webhooks/settings",
      );
      const already = (existing.webhooks ?? []).find((w) => w.url === opts.url);
      if (already) {
        results.push({
          zernioAccountId,
          status: "exists",
          webhookId: String(already._id ?? ""),
        });
        continue;
      }
      const created = await zernioFetch<{ webhook?: Record<string, unknown> }>(
        key,
        "POST",
        "/webhooks/settings",
        { body: { name, url: opts.url, secret: opts.secret, events, isActive: true } },
      );
      results.push({
        zernioAccountId,
        status: "created",
        webhookId: String(created.webhook?._id ?? ""),
      });
    } catch (err) {
      results.push({
        zernioAccountId,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

// ----- contacts (capture layer ONLY — Brevo stays the nurture CRM, L3) ----- //

export interface ZernioContact extends Record<string, unknown> {
  id: string;
  name?: string;
  email?: string;
  tags?: string[];
  platform?: string;
  platformIdentifier?: string;
  displayIdentifier?: string;
  createdAt?: string;
}

export async function listZernioContactsForKey(
  key: string,
  opts: { tag?: string; platform?: string; limit?: number; skip?: number } = {},
): Promise<{ contacts: ZernioContact[]; hasMore: boolean }> {
  const data = await zernioFetch<{
    contacts?: ZernioContact[];
    pagination?: { hasMore?: boolean };
  }>(key, "GET", "/contacts", {
    query: {
      tag: opts.tag,
      platform: opts.platform,
      limit: opts.limit ?? 200,
      skip: opts.skip,
    },
  });
  return { contacts: data.contacts ?? [], hasMore: Boolean(data.pagination?.hasMore) };
}

// ----- analytics (L6 / Goal B) ----- //

/**
 * Allowlist of every Zernio analytics surface we call (the 26 /v1/analytics
 * paths + the follower/health meta endpoints the audit groups with them).
 * Values are API paths; {conversationId} is interpolated from query params.
 * X-engine numbers from x_engagement_log are a DIFFERENT dataset — never
 * blend the two in one response.
 */
export const ZERNIO_ANALYTICS_PATHS: Record<string, string> = {
  posts: "/analytics",
  "daily-metrics": "/analytics/daily-metrics",
  "best-time": "/analytics/best-time",
  "content-decay": "/analytics/content-decay",
  "posting-frequency": "/analytics/posting-frequency",
  "post-timeline": "/analytics/post-timeline",
  "youtube-channel-insights": "/analytics/youtube/channel-insights",
  "youtube-daily-views": "/analytics/youtube/daily-views",
  "youtube-video-retention": "/analytics/youtube/video-retention",
  "youtube-demographics": "/analytics/youtube/demographics",
  "linkedin-org-aggregate-analytics": "/analytics/linkedin/org-aggregate-analytics",
  "tiktok-account-insights": "/analytics/tiktok/account-insights",
  "facebook-page-insights": "/analytics/facebook/page-insights",
  "instagram-account-insights": "/analytics/instagram/account-insights",
  "instagram-follower-history": "/analytics/instagram/follower-history",
  "instagram-demographics": "/analytics/instagram/demographics",
  "googlebusiness-performance": "/analytics/googlebusiness/performance",
  "googlebusiness-search-keywords": "/analytics/googlebusiness/search-keywords",
  "inbox-volume": "/analytics/inbox/volume",
  "inbox-heatmap": "/analytics/inbox/heatmap",
  "inbox-source-breakdown": "/analytics/inbox/source-breakdown",
  "inbox-response-time": "/analytics/inbox/response-time",
  "inbox-top-accounts": "/analytics/inbox/top-accounts",
  "inbox-conversations": "/analytics/inbox/conversations",
  "inbox-conversation": "/analytics/inbox/conversations/{conversationId}",
  "follower-stats": "/accounts/follower-stats",
  "accounts-health": "/accounts/health",
  "usage-stats": "/usage-stats",
};

/**
 * Call one allowlisted analytics endpoint with the given account's key.
 * Throws ZernioAddonMissingError on the 402/403 add-on gate (callers store
 * the gate rather than crashing — audit: handle both identically).
 */
export async function fetchZernioAnalytics(
  zernioAccountId: string,
  metricKey: string,
  query: Record<string, QueryValue> = {},
): Promise<Record<string, unknown>> {
  let path = ZERNIO_ANALYTICS_PATHS[metricKey];
  if (!path) throw new Error(`unknown analytics metric '${metricKey}'`);
  const key = zernioKeyFor(zernioAccountId);
  if (!key) throw new Error(`no ZERNIO_KEY_${zernioAccountId} configured`);
  const q = { ...query };
  if (path.includes("{conversationId}")) {
    const conversationId = q.conversationId;
    if (!conversationId) throw new Error("conversationId is required for this metric");
    path = path.replace("{conversationId}", encodeURIComponent(String(conversationId)));
    delete q.conversationId;
  }
  // Per-account keys scope the data already, but pass accountId explicitly on
  // the paths that accept it so multi-account keys stay filtered.
  if (!("accountId" in q) && !path.startsWith("/accounts") && path !== "/usage-stats") {
    q.accountId = zernioAccountId;
  }
  return zernioFetch(key, "GET", path, { query: q });
}
