import { describe, expect, it } from "vitest";
import { sniffSocialMedia, maxBytesFor, SOCIAL_MEDIA_MAX_IMAGE_BYTES, SOCIAL_MEDIA_MAX_VIDEO_BYTES } from "./media-upload.js";

function jpegBytes(): Buffer {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
}
function pngBytes(): Buffer {
  return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
}
function webpBytes(): Buffer {
  const b = Buffer.alloc(16);
  b.write("RIFF", 0, "ascii");
  b.write("WEBP", 8, "ascii");
  return b;
}
function isobmffBytes(): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt32BE(16, 0);
  b.write("ftyp", 4, "ascii");
  b.write("isom", 8, "ascii");
  return b;
}
function garbageBytes(): Buffer {
  return Buffer.from("not a media file at all");
}

describe("sniffSocialMedia", () => {
  it("classifies a JPEG by magic bytes regardless of extension", () => {
    const result = sniffSocialMedia(jpegBytes(), "photo.jpg");
    expect(result).toEqual({ kind: "image", contentType: "image/jpeg" });
  });

  it("classifies a PNG", () => {
    expect(sniffSocialMedia(pngBytes(), "photo.png")).toEqual({ kind: "image", contentType: "image/png" });
  });

  it("classifies a WEBP", () => {
    expect(sniffSocialMedia(webpBytes(), "photo.webp")).toEqual({ kind: "image", contentType: "image/webp" });
  });

  it("classifies an ISOBMFF container with a .mp4 extension as video/mp4", () => {
    expect(sniffSocialMedia(isobmffBytes(), "clip.mp4")).toEqual({ kind: "video", contentType: "video/mp4" });
  });

  it("classifies an ISOBMFF container with a .mov extension as video/quicktime", () => {
    expect(sniffSocialMedia(isobmffBytes(), "clip.mov")).toEqual({ kind: "video", contentType: "video/quicktime" });
  });

  it("rejects an ISOBMFF container whose extension is neither mp4 nor mov", () => {
    const result = sniffSocialMedia(isobmffBytes(), "clip.mkv");
    expect("error" in result).toBe(true);
  });

  it("rejects a renamed non-media file (extension lies, bytes don't)", () => {
    const result = sniffSocialMedia(garbageBytes(), "totally-a-photo.jpg");
    expect("error" in result).toBe(true);
  });
});

describe("maxBytesFor", () => {
  it("returns the image cap for images and the video cap for videos", () => {
    expect(maxBytesFor("image")).toBe(SOCIAL_MEDIA_MAX_IMAGE_BYTES);
    expect(maxBytesFor("video")).toBe(SOCIAL_MEDIA_MAX_VIDEO_BYTES);
  });
});
