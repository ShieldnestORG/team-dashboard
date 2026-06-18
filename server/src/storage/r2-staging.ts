// ---------------------------------------------------------------------------
// Cloudflare R2 PUBLIC staging helper.
//
// The Zernio publisher (services/platform-publishers/zernio.ts) hands Zernio a
// PUBLIC media URL that Zernio fetches SERVER-SIDE. team-dashboard's internal
// storage layer (storage/service.ts) is NOT public — its objects are streamed
// back only through authenticated routes. This module bridges that gap by
// re-staging bytes into the IG_Auditor R2 bucket (`ig-staging`) and returning
// the public `*.r2.dev` URL Zernio can fetch.
//
// This is deliberately a STANDALONE helper, not a method on StorageService:
//  - The internal store and this public staging bucket are different buckets
//    with different access models (internal = auth-gated; this = public CDN).
//    Adding `getPublicUrl()` to StorageService would falsely imply the internal
//    store is public.
//  - It mirrors IG_Auditor's `r2.py`: direct PUT via the S3 API + public URL =
//    `${R2_PUBLIC_BASE}/${key}`. Reuses the SAME R2 account/bucket/env names.
//
// Config is STRICTLY by env-var NAME (values provisioned at deploy, NOT here):
//   R2_S3_ENDPOINT   — R2 S3 API endpoint (https://<acct>.r2.cloudflarestorage.com)
//   R2_BUCKET        — bucket name (ig-staging)
//   R2_PUBLIC_BASE   — public CDN base (https://pub-<id>.r2.dev)
//   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — credentials
// (R2_ACCOUNT_ID is not needed directly — it is baked into R2_S3_ENDPOINT.)
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface R2StagingConfig {
  endpoint: string;
  bucket: string;
  publicBase: string;
  accessKeyId: string;
  secretAccessKey: string;
}

/** Read R2 staging config from env, or null if any required var is missing. */
export function readR2StagingConfig(): R2StagingConfig | null {
  const endpoint = process.env.R2_S3_ENDPOINT?.trim();
  const bucket = process.env.R2_BUCKET?.trim();
  const publicBase = process.env.R2_PUBLIC_BASE?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!endpoint || !bucket || !publicBase || !accessKeyId || !secretAccessKey) {
    return null;
  }
  return { endpoint, bucket, publicBase, accessKeyId, secretAccessKey };
}

export function isR2StagingConfigured(): boolean {
  return readR2StagingConfig() !== null;
}

/**
 * True iff `url` is already a PUBLIC absolute http(s) URL we can hand to Zernio
 * as-is (so we never re-stage it). This is the inverse of the publisher's
 * `isNonPublicMediaUrl` guard for the URL shapes that matter here: an absolute
 * https URL on a public host (the R2 public base, or any non-internal host).
 *
 * Non-absolute values (internal storage objectKeys, relative paths) return
 * false → they are candidates for staging.
 */
export function isAlreadyPublicUrl(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".internal") || host.endsWith(".local")) return false;
  // IPv6 literals in loopback / link-local / ULA ranges are not public. Mirrors
  // the publisher's isNonPublicMediaUrl (services/platform-publishers/zernio.ts).
  // Node's URL keeps the brackets on hostname (`[::1]`), so strip them first.
  const v6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (v6 === "::1" || v6 === "::") return false; // loopback / unspecified
  if (/^fe80:/.test(v6)) return false; // fe80::/10 link-local
  if (/^f[cd][0-9a-f][0-9a-f]:/.test(v6)) return false; // fc00::/7 ULA
  // IPv4 literals in private/loopback/link-local ranges are not public.
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 127 || a === 10) return false;
    if (a === 192 && b === 168) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
}

let cachedClient: { client: S3Client; key: string } | null = null;

function clientFor(config: R2StagingConfig): S3Client {
  // R2 is S3-compatible: virtual-host style works, region must be "auto".
  // Cache per-endpoint+key so we don't rebuild the client every post.
  const cacheKey = `${config.endpoint}|${config.accessKeyId}`;
  if (cachedClient && cachedClient.key === cacheKey) return cachedClient.client;
  const client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  cachedClient = { client, key: cacheKey };
  return client;
}

/**
 * Build a deterministic staging key from the bytes + a hint of the source name.
 * Deterministic = same bytes → same key → re-staging is an idempotent overwrite
 * of identical content (no duplicate objects on relayer retry).
 */
export function stagingKeyFor(buffer: Buffer, filenameHint?: string): string {
  const sha = createHash("sha256").update(buffer).digest("hex");
  const ext = filenameHint ? extractExt(filenameHint) : "";
  return `staged/${sha}${ext}`;
}

function extractExt(name: string): string {
  const m = /\.([a-z0-9]{1,8})(?:\?|$)/i.exec(name);
  return m ? `.${m[1].toLowerCase()}` : "";
}

/** Build the public URL for a staged key: `${R2_PUBLIC_BASE}/${key}`. */
export function publicUrlForKey(config: R2StagingConfig, key: string): string {
  return `${config.publicBase.replace(/\/+$/, "")}/${key.replace(/^\/+/, "")}`;
}

/**
 * Upload bytes to the R2 staging bucket under a deterministic key and return
 * the public absolute https URL. Throws if R2 is not configured (caller must
 * FAIL LOUD — never fall back to a non-public URL).
 */
export async function stageBufferToR2(
  buffer: Buffer,
  contentType: string,
  filenameHint?: string,
): Promise<string> {
  const config = readR2StagingConfig();
  if (!config) {
    throw new Error(
      "R2 staging is not configured (set R2_S3_ENDPOINT, R2_BUCKET, R2_PUBLIC_BASE, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)",
    );
  }
  const key = stagingKeyFor(buffer, filenameHint);
  await clientFor(config).send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType || "application/octet-stream",
      ContentLength: buffer.length,
    }),
  );
  return publicUrlForKey(config, key);
}
