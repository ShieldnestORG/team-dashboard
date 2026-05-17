import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { maybeEnableUiDevMiddleware } from "../commands/run.js";

// These tests exercise the auto-enable logic in maybeEnableUiDevMiddleware,
// which decides whether to set PAPERCLIP_UI_DEV_MIDDLEWARE=true based on
// whether a built ui/dist bundle is already present at one of the two
// candidate paths the server itself checks (see server/src/app.ts).

let tmpRoot: string;
let serverSrc: string;
let entrypoint: string;
const originalEnv = process.env.PAPERCLIP_UI_DEV_MIDDLEWARE;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-run-test-"));
  serverSrc = path.join(tmpRoot, "server", "src");
  fs.mkdirSync(serverSrc, { recursive: true });
  entrypoint = path.join(serverSrc, "index.ts");
  fs.writeFileSync(entrypoint, "// fake entry\n");
  delete process.env.PAPERCLIP_UI_DEV_MIDDLEWARE;
});

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.PAPERCLIP_UI_DEV_MIDDLEWARE;
  } else {
    process.env.PAPERCLIP_UI_DEV_MIDDLEWARE = originalEnv;
  }
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe("maybeEnableUiDevMiddleware", () => {
  it("enables dev middleware when no built ui/dist is present", () => {
    maybeEnableUiDevMiddleware(entrypoint);
    expect(process.env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBe("true");
  });

  it("skips auto-enable when monorepo ui/dist/index.html exists", () => {
    const uiDist = path.join(tmpRoot, "ui", "dist");
    fs.mkdirSync(uiDist, { recursive: true });
    fs.writeFileSync(path.join(uiDist, "index.html"), "<html></html>");
    maybeEnableUiDevMiddleware(entrypoint);
    expect(process.env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBeUndefined();
  });

  it("skips auto-enable when published server/ui-dist/index.html exists", () => {
    const uiDist = path.join(tmpRoot, "server", "ui-dist");
    fs.mkdirSync(uiDist, { recursive: true });
    fs.writeFileSync(path.join(uiDist, "index.html"), "<html></html>");
    maybeEnableUiDevMiddleware(entrypoint);
    expect(process.env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBeUndefined();
  });

  it("respects an explicit caller-set value", () => {
    process.env.PAPERCLIP_UI_DEV_MIDDLEWARE = "false";
    maybeEnableUiDevMiddleware(entrypoint);
    expect(process.env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBe("false");
  });

  it("does nothing when entrypoint is not a server index", () => {
    const other = path.join(tmpRoot, "other.ts");
    fs.writeFileSync(other, "// not a server entry\n");
    maybeEnableUiDevMiddleware(other);
    expect(process.env.PAPERCLIP_UI_DEV_MIDDLEWARE).toBeUndefined();
  });
});
