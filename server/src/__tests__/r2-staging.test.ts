// ---------------------------------------------------------------------------
// R2 public-staging helper tests.
//
// The S3 client is MOCKED — no real R2 upload happens. We assert:
//  - config is read strictly from env (and is "not configured" when absent)
//  - isAlreadyPublicUrl correctly distinguishes public URLs (pass-through) from
//    internal objectKeys / non-public hosts (stage candidates)
//  - the staging key is deterministic from bytes (idempotent re-stage)
//  - the public URL is `${R2_PUBLIC_BASE}/${key}`
//  - stageBufferToR2 issues exactly one PutObject with the right Bucket/Key
//  - stageBufferToR2 throws (FAIL LOUD) when R2 env is absent
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMock = vi.fn(async () => ({}));

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = sendMock;
  }
  class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return { S3Client, PutObjectCommand };
});

import {
  isAlreadyPublicUrl,
  isR2StagingConfigured,
  publicUrlForKey,
  readR2StagingConfig,
  stageBufferToR2,
  stagingKeyFor,
} from "../storage/r2-staging.js";

const R2_ENV = {
  R2_S3_ENDPOINT: "https://acct.r2.cloudflarestorage.com",
  R2_BUCKET: "ig-staging",
  R2_PUBLIC_BASE: "https://pub-test.r2.dev",
  R2_ACCESS_KEY_ID: "test-access-key",
  R2_SECRET_ACCESS_KEY: "test-secret-key",
} as const;

const saved: Record<string, string | undefined> = {};

function setR2Env() {
  for (const [k, v] of Object.entries(R2_ENV)) process.env[k] = v;
}
function clearR2Env() {
  for (const k of Object.keys(R2_ENV)) delete process.env[k];
}

describe("r2-staging helper", () => {
  beforeEach(() => {
    for (const k of Object.keys(R2_ENV)) saved[k] = process.env[k];
    sendMock.mockClear();
  });
  afterEach(() => {
    for (const k of Object.keys(R2_ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k]!;
    }
  });

  describe("config", () => {
    it("reads config from env when all vars present", () => {
      setR2Env();
      expect(isR2StagingConfigured()).toBe(true);
      const cfg = readR2StagingConfig();
      expect(cfg).toMatchObject({
        endpoint: R2_ENV.R2_S3_ENDPOINT,
        bucket: R2_ENV.R2_BUCKET,
        publicBase: R2_ENV.R2_PUBLIC_BASE,
      });
    });

    it("is not configured when any var is missing", () => {
      setR2Env();
      delete process.env.R2_SECRET_ACCESS_KEY;
      expect(isR2StagingConfigured()).toBe(false);
      expect(readR2StagingConfig()).toBeNull();
    });
  });

  describe("isAlreadyPublicUrl", () => {
    const publicCases = [
      "https://pub-test.r2.dev/staged/abc.mp4",
      "https://cdn.example.com/photo.jpg",
      "http://images.example.org/a.png",
    ];
    for (const url of publicCases) {
      it(`true for public url: ${url}`, () => {
        expect(isAlreadyPublicUrl(url)).toBe(true);
      });
    }

    const nonPublicCases = [
      "company-1/socials/2026/06/17/uuid-clip.mp4", // internal objectKey
      "/local/path/x.jpg",
      "https://localhost:8000/x.jpg",
      "https://127.0.0.1/x.jpg",
      "https://10.1.2.3/x.jpg",
      "https://192.168.1.5/x.jpg",
      "https://foo.internal/x.jpg",
    ];
    for (const url of nonPublicCases) {
      it(`false for non-public/objectKey: ${url}`, () => {
        expect(isAlreadyPublicUrl(url)).toBe(false);
      });
    }
  });

  describe("deterministic key + public url", () => {
    it("same bytes → same key (idempotent), preserves ext", () => {
      const buf = Buffer.from("hello bytes", "utf8");
      const k1 = stagingKeyFor(buf, "clip.mp4");
      const k2 = stagingKeyFor(buf, "other.mp4");
      expect(k1).toBe(k2);
      expect(k1.startsWith("staged/")).toBe(true);
      expect(k1.endsWith(".mp4")).toBe(true);
    });

    it("different bytes → different key", () => {
      expect(stagingKeyFor(Buffer.from("a"))).not.toBe(stagingKeyFor(Buffer.from("b")));
    });

    it("publicUrlForKey joins base + key without double slash", () => {
      const cfg = { ...readPlaceholderCfg(), publicBase: "https://pub-test.r2.dev/" };
      expect(publicUrlForKey(cfg, "/staged/x.jpg")).toBe("https://pub-test.r2.dev/staged/x.jpg");
    });
  });

  describe("stageBufferToR2", () => {
    it("uploads once and returns public r2.dev url", async () => {
      setR2Env();
      const buf = Buffer.from("video-bytes", "utf8");
      const url = await stageBufferToR2(buf, "video/mp4", "clip.mp4");

      expect(sendMock).toHaveBeenCalledTimes(1);
      const cmd = sendMock.mock.calls[0]![0] as { input: Record<string, unknown> };
      expect(cmd.input.Bucket).toBe(R2_ENV.R2_BUCKET);
      expect(String(cmd.input.Key).startsWith("staged/")).toBe(true);
      expect(cmd.input.ContentType).toBe("video/mp4");
      expect(url.startsWith("https://pub-test.r2.dev/staged/")).toBe(true);
      expect(url.endsWith(".mp4")).toBe(true);
    });

    it("FAILS LOUD when R2 is not configured", async () => {
      clearR2Env();
      await expect(stageBufferToR2(Buffer.from("x"), "image/png")).rejects.toThrow(
        /R2 staging is not configured/,
      );
      expect(sendMock).not.toHaveBeenCalled();
    });
  });
});

function readPlaceholderCfg() {
  return {
    endpoint: "https://acct.r2.cloudflarestorage.com",
    bucket: "ig-staging",
    publicBase: "https://pub-test.r2.dev",
    accessKeyId: "k",
    secretAccessKey: "s",
  };
}
