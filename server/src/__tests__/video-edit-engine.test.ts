import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
  existsSync,
  readFileSync,
  realpathSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Set env vars BEFORE the engine module loads so the module-time consts bind correctly.
const TMP_ROOT = mkdtempSync(join(tmpdir(), "ve-engine-test-"));
const DATA_DIR = join(TMP_ROOT, "video-edit");
const FAKE_BIN = join(TMP_ROOT, "fake-video-use");
mkdirSync(DATA_DIR, { recursive: true });

// Create a fake VIDEO_USE_BIN that just writes argv as JSON to a file we can read.
// This lets us assert what argv the engine actually passed to execFile.
const ARGV_DUMP = join(TMP_ROOT, "argv.json");
writeFileSync(
  FAKE_BIN,
  `#!/usr/bin/env bash
# Dump argv as a JSON array then create the expected output so runVideoUseEngine
# completes the happy path. Single-quoted heredoc so $@ stays literal.
python3 -c "import sys, json; print(json.dumps(sys.argv[1:]))" "$@" > '${ARGV_DUMP}'
# Find --input value to know where to write the fake final.mp4
input=""
while [ $# -gt 0 ]; do
  case "$1" in
    --input) input="$2"; shift 2 ;;
    *) shift ;;
  esac
done
mkdir -p "$input/edit"
# Tiny non-empty MP4 placeholder (4 bytes) so statSync works
printf 'MP4\\0' > "$input/edit/final.mp4"
exit 0
`,
  { mode: 0o755 },
);

process.env.VIDEO_USE_BIN = FAKE_BIN;
process.env.VIDEO_EDIT_DATA_DIR = DATA_DIR;
process.env.VIDEO_EDIT_ENABLED = "true";

// Now import the engine — it captures the env at module load.
const engineMod = await import("../services/video-edit/engine.js");
const { assertInputDirSafe, runVideoUseEngine, isEngineConfigured, isPipelineEnabled, getEnginePaths } = engineMod;

afterAll(() => {
  try {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

describe("video-edit engine: pipeline & config flags", () => {
  it("isPipelineEnabled returns true with VIDEO_EDIT_ENABLED=true", () => {
    expect(isPipelineEnabled()).toBe(true);
  });

  it("isEngineConfigured returns true when VIDEO_USE_BIN points at an existing file", () => {
    expect(isEngineConfigured()).toBe(true);
  });

  it("getEnginePaths exposes the configured paths", () => {
    const p = getEnginePaths();
    expect(p.VIDEO_USE_BIN).toBe(FAKE_BIN);
    expect(p.VIDEO_EDIT_DATA_DIR).toBe(DATA_DIR);
    expect(p.VIDEO_EDIT_ENABLED).toBe(true);
  });
});

describe("assertInputDirSafe: path-traversal & symlink defenses", () => {
  it("accepts an inputDir that resolves under VIDEO_EDIT_DATA_DIR", () => {
    const safe = join(DATA_DIR, "raw", "ok-job");
    mkdirSync(safe, { recursive: true });
    expect(() => assertInputDirSafe(safe)).not.toThrow();
  });

  it("rejects a relative inputDir", () => {
    expect(() => assertInputDirSafe("relative/path")).toThrow(/absolute/);
  });

  it("rejects a non-existent inputDir", () => {
    expect(() => assertInputDirSafe("/nonexistent/dir/that/does/not/exist")).toThrow(/does not exist/);
  });

  it("rejects an absolute inputDir outside VIDEO_EDIT_DATA_DIR", () => {
    const outside = mkdtempSync(join(tmpdir(), "outside-"));
    try {
      expect(() => assertInputDirSafe(outside)).toThrow(/must be under VIDEO_EDIT_DATA_DIR/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("rejects an inputDir that symlinks out via realpath", () => {
    const escape = mkdtempSync(join(tmpdir(), "ve-escape-"));
    const sneaky = join(DATA_DIR, "raw", "sneaky-link");
    mkdirSync(join(DATA_DIR, "raw"), { recursive: true });
    try {
      symlinkSync(escape, sneaky);
      expect(() => assertInputDirSafe(sneaky)).toThrow(/must be under VIDEO_EDIT_DATA_DIR/);
    } finally {
      try { rmSync(sneaky, { force: true }); } catch { /* ignore */ }
      rmSync(escape, { recursive: true, force: true });
    }
  });
});

describe("runVideoUseEngine: argv shape is injection-safe", () => {
  it("passes editBrief verbatim as one argv element even with shell metacharacters", async () => {
    const jobDir = join(DATA_DIR, "raw", "argv-test-1");
    mkdirSync(jobDir, { recursive: true });

    // A brief that would explode in any shell-interpolation context.
    const evilBrief = `; rm -rf / && $(touch /tmp/pwned) \`echo HACKED\` "&& :"`;
    const result = await runVideoUseEngine({
      inputDir: jobDir,
      editBrief: evilBrief,
      options: { aspect: "16:9" },
      jobId: "test-job-1",
    });

    // Engine resolves the input dir via realpath (defeats symlink escapes), so
    // compare against the realpath form too — on macOS /var/folders → /private/var/folders.
    expect(result.outputPath).toBe(join(realpathSync(jobDir), "edit", "final.mp4"));
    expect(existsSync(result.outputPath)).toBe(true);

    // Read what argv the fake binary actually saw — proves no shell parsed the string.
    const argv = JSON.parse(readFileSync(ARGV_DUMP, "utf8")) as string[];
    // Find the brief in argv (it should be one literal element, not split, not expanded)
    const briefIdx = argv.indexOf("--brief");
    expect(briefIdx).toBeGreaterThanOrEqual(0);
    expect(argv[briefIdx + 1]).toBe(evilBrief);
    // Confirm metacharacters survived unmangled
    expect(argv[briefIdx + 1]).toContain("$(touch /tmp/pwned)");
    expect(argv[briefIdx + 1]).toContain("`echo HACKED`");
    // Confirm the "side effect" never fired
    expect(existsSync("/tmp/pwned")).toBe(false);
  });

  it("passes inputDir, options, jobId as their own argv elements", async () => {
    const jobDir = join(DATA_DIR, "raw", "argv-test-2");
    mkdirSync(jobDir, { recursive: true });

    await runVideoUseEngine({
      inputDir: jobDir,
      editBrief: "make it short",
      options: { aspect: "9:16", burnCaptions: true },
      jobId: "argv-test-2",
    });

    const argv = JSON.parse(readFileSync(ARGV_DUMP, "utf8")) as string[];

    expect(argv).toContain("--input");
    expect(argv).toContain("--brief");
    expect(argv).toContain("--options");
    expect(argv).toContain("--job-id");
    expect(argv).toContain("argv-test-2");

    const optsIdx = argv.indexOf("--options");
    const opts = JSON.parse(argv[optsIdx + 1]);
    expect(opts).toEqual({ aspect: "9:16", burnCaptions: true });
  });

  it("rejects an inputDir outside the data dir BEFORE invoking the engine", async () => {
    const outside = mkdtempSync(join(tmpdir(), "ve-outside-"));
    try {
      await expect(
        runVideoUseEngine({
          inputDir: outside,
          editBrief: "x",
          options: {},
          jobId: "outside-test",
        }),
      ).rejects.toThrow(/must be under VIDEO_EDIT_DATA_DIR/);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
