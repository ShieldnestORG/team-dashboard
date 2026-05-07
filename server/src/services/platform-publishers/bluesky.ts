import { AtpAgent, RichText } from "@atproto/api";
import { logger } from "../../middleware/logger.js";
import type {
  PlatformPublisher,
  PublishOptions,
  PublishResult,
  PublishTextOptions,
} from "./types.js";

const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE || "";
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || "";
const BLUESKY_SERVICE = process.env.BLUESKY_SERVICE || "https://bsky.social";

let cachedAgent: AtpAgent | null = null;
let cachedHandle: string | null = null;

async function getAgent(): Promise<AtpAgent> {
  if (cachedAgent && cachedHandle === BLUESKY_HANDLE) return cachedAgent;
  const agent = new AtpAgent({ service: BLUESKY_SERVICE });
  await agent.login({ identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD });
  cachedAgent = agent;
  cachedHandle = BLUESKY_HANDLE;
  return agent;
}

async function fetchAsBytes(url: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  const mime = res.headers.get("content-type") || "image/jpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, mime };
}

export const blueskyPublisher: PlatformPublisher = {
  name: "bluesky",

  isConfigured() {
    return !!(BLUESKY_HANDLE && BLUESKY_APP_PASSWORD);
  },

  async publish(_opts: PublishOptions): Promise<PublishResult> {
    return {
      success: false,
      error: "Bluesky video publishing not implemented — use publishText for text/image posts",
    };
  },

  async publishText(opts: PublishTextOptions): Promise<PublishResult> {
    if (!this.isConfigured()) {
      return { success: false, error: "Bluesky credentials not configured (BLUESKY_HANDLE, BLUESKY_APP_PASSWORD)" };
    }

    try {
      const agent = await getAgent();

      const rt = new RichText({ text: opts.text });
      await rt.detectFacets(agent);

      const record: Record<string, unknown> = {
        $type: "app.bsky.feed.post",
        text: rt.text,
        facets: rt.facets,
        createdAt: new Date().toISOString(),
      };

      const mediaUrls = (opts.mediaUrls || []).slice(0, 4);
      if (mediaUrls.length > 0) {
        const images = [] as Array<{ image: unknown; alt: string }>;
        for (let i = 0; i < mediaUrls.length; i++) {
          const url = mediaUrls[i];
          const { bytes, mime } = await fetchAsBytes(url);
          const upload = await agent.uploadBlob(bytes, { encoding: mime });
          images.push({
            image: upload.data.blob,
            alt: opts.altTexts?.[i] || "",
          });
        }
        record.embed = {
          $type: "app.bsky.embed.images",
          images,
        };
      }

      const did = agent.session?.did;
      if (!did) throw new Error("Bluesky agent has no session DID after login");

      const created = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection: "app.bsky.feed.post",
        record,
      });

      const rkey = created.data.uri.split("/").pop() || "";
      const handleForUrl = BLUESKY_HANDLE.startsWith("did:") ? did : BLUESKY_HANDLE;
      const platformUrl = `https://bsky.app/profile/${handleForUrl}/post/${rkey}`;

      logger.info({ uri: created.data.uri, cid: created.data.cid }, "Bluesky post published");

      return {
        success: true,
        platformPostId: created.data.uri,
        platformUrl,
      };
    } catch (err) {
      logger.error({ err }, "Bluesky publishText failed");
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
