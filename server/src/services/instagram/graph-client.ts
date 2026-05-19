import { logger } from "../../middleware/logger.js";

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION || "v21.0";
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

type ContainerStatusCode = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

interface GraphErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

export class GraphApiError extends Error {
  readonly code: number;
  readonly subcode?: number;
  readonly retriable: boolean;
  readonly terminal: boolean;
  readonly authExpired: boolean;
  readonly fbtraceId?: string;

  constructor(body: GraphErrorBody, status: number) {
    super(`Graph ${status} ${body.error.code}: ${body.error.message}`);
    this.name = "GraphApiError";
    this.code = body.error.code;
    this.subcode = body.error.error_subcode;
    this.fbtraceId = body.error.fbtrace_id;
    this.authExpired = this.code === 190 || this.code === 463 || this.code === 467;
    this.terminal = this.code === 2207042 || this.code === 100;
    this.retriable = !this.terminal && (
      this.code === 4 ||
      this.code === 17 ||
      this.code === 32 ||
      this.code === 613 ||
      (this.code >= 80000 && this.code <= 80014) ||
      status >= 500
    );
  }
}

async function graphFetch(method: "GET" | "POST", path: string, params: Record<string, string>, accessToken: string): Promise<unknown> {
  const url = new URL(`${GRAPH_BASE}${path}`);
  let body: string | undefined;
  if (method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    url.searchParams.set("access_token", accessToken);
  } else {
    const form = new URLSearchParams(params);
    form.set("access_token", accessToken);
    body = form.toString();
  }

  const res = await fetch(url.toString(), {
    method,
    headers: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded" } : undefined,
    body,
  });

  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }

  if (!res.ok) {
    if (typeof json === "object" && json && "error" in json) {
      throw new GraphApiError(json as GraphErrorBody, res.status);
    }
    throw new Error(`Graph ${method} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return json;
}

export interface CreateContainerInput {
  igUserId: string;
  accessToken: string;
  caption?: string;
  imageUrl?: string;
  videoUrl?: string;
  mediaType?: "REELS" | "STORIES" | "CAROUSEL";
  isCarouselItem?: boolean;
  children?: string[];
  thumbOffset?: number;
  shareToFeed?: boolean;
  locationId?: string;
}

export async function createMediaContainer(input: CreateContainerInput): Promise<{ id: string }> {
  const params: Record<string, string> = {};
  if (input.caption) params.caption = input.caption;
  if (input.imageUrl) params.image_url = input.imageUrl;
  if (input.videoUrl) params.video_url = input.videoUrl;
  if (input.mediaType) params.media_type = input.mediaType;
  if (input.isCarouselItem) params.is_carousel_item = "true";
  if (input.children?.length) params.children = input.children.join(",");
  if (typeof input.thumbOffset === "number") params.thumb_offset = String(input.thumbOffset);
  if (typeof input.shareToFeed === "boolean") params.share_to_feed = String(input.shareToFeed);
  if (input.locationId) params.location_id = input.locationId;

  return graphFetch("POST", `/${input.igUserId}/media`, params, input.accessToken) as Promise<{ id: string }>;
}

export interface ContainerStatus {
  status_code: ContainerStatusCode;
  status?: string;
}

export async function getContainerStatus(containerId: string, accessToken: string): Promise<ContainerStatus> {
  return graphFetch("GET", `/${containerId}`, { fields: "status_code,status" }, accessToken) as Promise<ContainerStatus>;
}

export interface PollOptions {
  intervalMs?: number;
  maxAttempts?: number;
}

function jitter(ms: number): number {
  return Math.round(ms * (0.85 + Math.random() * 0.3));
}

export async function pollContainerUntilReady(containerId: string, accessToken: string, opts: PollOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 8000;
  const maxAttempts = opts.maxAttempts ?? 30;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const status = await getContainerStatus(containerId, accessToken);
    logger.debug({ containerId, attempt, status }, "IG container poll");

    if (status.status_code === "FINISHED") return;
    if (status.status_code === "PUBLISHED") return;
    if (status.status_code === "ERROR") {
      throw new Error(`IG container ${containerId} ERROR: ${status.status || "unspecified"}`);
    }
    if (status.status_code === "EXPIRED") {
      throw new Error(`IG container ${containerId} EXPIRED — must rebuild`);
    }
    if (attempt === maxAttempts) {
      throw new Error(`IG container ${containerId} still IN_PROGRESS after ${maxAttempts} polls`);
    }
    await new Promise((r) => setTimeout(r, jitter(intervalMs)));
  }
}

export async function publishMedia(igUserId: string, creationId: string, accessToken: string): Promise<{ id: string }> {
  return graphFetch("POST", `/${igUserId}/media_publish`, { creation_id: creationId }, accessToken) as Promise<{ id: string }>;
}

export async function getMediaPermalink(mediaId: string, accessToken: string): Promise<string | null> {
  try {
    const res = await graphFetch("GET", `/${mediaId}`, { fields: "permalink" }, accessToken) as { permalink?: string };
    return res.permalink || null;
  } catch (err) {
    logger.warn({ err, mediaId }, "IG permalink fetch failed (non-fatal)");
    return null;
  }
}

export async function getMe(accessToken: string): Promise<{ id: string; name?: string }> {
  return graphFetch("GET", "/me", { fields: "id,name" }, accessToken) as Promise<{ id: string; name?: string }>;
}
