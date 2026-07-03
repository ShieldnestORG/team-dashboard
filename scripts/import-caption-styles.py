#!/usr/bin/env python3
# ---------------------------------------------------------------------------
# import-caption-styles — sync the caption preset menu (STYLES) out of
# caption_clip.py into committed Content Hub data modules + preview PNGs.
#
#   pnpm caption-styles:sync           regenerate both data modules + previews
#   pnpm caption-styles:sync --check   recompute the STYLES hash and diff it
#                                      against both committed modules (CI-able);
#                                      exits 1 on drift. Renders nothing.
#   CAPTION_CLIP_PATH=/path/to/caption_clip.py  overrides the tool location
#
# WHY a build-time script + committed artifacts (not a runtime read): prod runs
# with a read-only rootfs and the video-automation repo lives on Mark's Mac,
# outside the Docker build context — caption_clip.py is unreachable at runtime
# AND at image-build time. Precedent: scripts/import-marketing-kits.ts.
#
# Single source of truth: caption_clip.py. This script importlib-loads it and
# reads BOTH the STYLES dict (names, descs, params) and its render_caption_png()
# (so every preview PNG is produced by the exact code path a real burn uses —
# zero fidelity drift between the picker thumbnail and the burned clip).
#
# The drift check hashes the STYLES payload only. If render_caption_png()
# itself changes visually (fonts, padding, shadow geometry), re-run the sync to
# refresh the previews — --check will not catch render-only changes.
#
# Outputs (all committed):
#   ui/src/content/caption-styles/styles.generated.ts    (Content Hub picker)
#   server/src/data/caption-styles.generated.ts          (agent JSON endpoint)
#   ui/public/caption-previews/<name>.png                (picker thumbnails)
# ---------------------------------------------------------------------------
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_TOOL = "/Users/exe/Downloads/Claude/6-2026-new-youtube-automation/tools/caption_clip.py"
UI_MODULE = os.path.join(REPO_ROOT, "ui/src/content/caption-styles/styles.generated.ts")
SERVER_MODULE = os.path.join(REPO_ROOT, "server/src/data/caption-styles.generated.ts")
PREVIEW_DIR = os.path.join(REPO_ROOT, "ui/public/caption-previews")

# Preview geometry mirrors a real 9:16 reels burn in burn_captions():
# fontsize = h * --font-size-pct (default 0.055), box_w = w * 0.8,
# bottom margin = h * --margin-pct (default 0.12).
FRAME_W, FRAME_H = 1080, 1920
FONT_SIZE = max(12, round(FRAME_H * 0.055))   # 106
BOX_W = int(FRAME_W * 0.8)                    # 864
MARGIN = round(FRAME_H * 0.12)                # 230
THUMB_W = 540                                 # 2x for ~270px-wide grid cells

# One realistic cue (caption_clip groups at max 4 words / 26 chars).
SAMPLE_TEXT = "Comment ROOM to start"
# argparse default in caption_clip.py — what a burn with no --style flag uses.
DEFAULT_STYLE = "classic"
BRAND_BOX_PREFIX = "#FF6B4A"  # Coherence Daddy coral


def load_tool(tool_path: str):
    if not os.path.isfile(tool_path):
        sys.exit(f"caption_clip.py not found at {tool_path} "
                 "(pass a path argument or set CAPTION_CLIP_PATH)")
    spec = importlib.util.spec_from_file_location("caption_clip", tool_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # module level is constants + defs only; main() is guarded
    return mod


def build_styles(mod, tool_path: str):
    styles = []
    for name in sorted(mod.STYLES):  # same order as --list-styles / --style choices
        s = mod.STYLES[name]
        styles.append({
            "name": name,
            "desc": s["desc"],
            "preview": f"/caption-previews/{name}.png",
            "isDefault": name == DEFAULT_STYLE,
            "isBrand": bool(s.get("box")) and s["box"].upper().startswith(BRAND_BOX_PREFIX),
            "params": {
                "fill": s["fill"],
                "stroke": s.get("stroke"),
                "strokewidth": s.get("strokewidth", 0),
                "box": s.get("box"),
                "caps": bool(s.get("caps")),
                "shadow": bool(s.get("shadow")),
            },
        })
    canonical = json.dumps(
        [{k: v for k, v in st.items() if k in ("name", "desc", "params")} for st in styles],
        sort_keys=True,
    )
    meta = {
        "sourcePath": tool_path,
        "sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "syncedAt": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "sampleText": SAMPLE_TEXT,
    }
    return styles, meta


def ts_literal(value) -> str:
    # json.dumps output is valid TS for our all-JSON-safe payload.
    return json.dumps(value, indent=2, ensure_ascii=False)


def header(meta) -> str:
    return f"""// ============================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND. (scripts/import-caption-styles.py)
//
// Source: {meta['sourcePath']} (STYLES)
// STYLES sha256: {meta['sha256']}
// Synced: {meta['syncedAt']}
//
// Refresh path: edit STYLES in caption_clip.py → `pnpm caption-styles:sync`
// (regenerates BOTH data modules + the preview PNGs) → commit the whole diff.
// Verify drift: `pnpm caption-styles:sync --check` (exits 1 when the tool's
// STYLES and the committed modules differ; render-only changes need a re-run).
// ============================================================================
"""


def emit_ui_module(styles, meta):
    body = header(meta)
    body += 'import type { CaptionStyle, CaptionStyleSyncMeta } from "./types";\n\n'
    body += f"export const CAPTION_STYLE_SYNC_META: CaptionStyleSyncMeta = {ts_literal(meta)};\n\n"
    body += f"export const CAPTION_STYLES: CaptionStyle[] = {ts_literal(styles)};\n"
    os.makedirs(os.path.dirname(UI_MODULE), exist_ok=True)
    with open(UI_MODULE, "w") as f:
        f.write(body)


def emit_server_module(styles, meta):
    body = header(meta)
    body += """// Self-contained twin of ui/src/content/caption-styles (server and ui are
// separate TS projects). Served verbatim by GET /api/socials/caption-styles.

export interface CaptionStyleParams {
  fill: string;
  stroke: string | null;
  strokewidth: number;
  box: string | null;
  caps: boolean;
  shadow: boolean;
}

export interface CaptionStyle {
  name: string;
  desc: string;
  /** UI-origin public path (the API host does not serve these images). */
  preview: string;
  isDefault: boolean;
  isBrand: boolean;
  params: CaptionStyleParams;
}

export interface CaptionStyleSyncMeta {
  sourcePath: string;
  sha256: string;
  syncedAt: string;
  sampleText: string;
}

"""
    body += f"export const CAPTION_STYLE_SYNC_META: CaptionStyleSyncMeta = {ts_literal(meta)};\n\n"
    body += f"export const CAPTION_STYLES: CaptionStyle[] = {ts_literal(styles)};\n"
    os.makedirs(os.path.dirname(SERVER_MODULE), exist_ok=True)
    with open(SERVER_MODULE, "w") as f:
        f.write(body)


def run(cmd, what):
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        sys.stderr.write(p.stderr[-2000:] + "\n")
        sys.exit(f"{what} failed (exit {p.returncode})")


def render_sample_frame(path: str):
    """Deterministic synthetic 9:16 'video still': dark gradient + two soft
    color blobs, one behind the caption band so legibility differences between
    outline/box/shadow styles actually show in the thumbnails."""
    run([
        "magick", "-size", f"{FRAME_W}x{FRAME_H}", "gradient:#33445a-#0e131a",
        "(", "-size", f"{FRAME_W}x{FRAME_H}", "xc:none",
        "-draw", "fill rgba(214,138,96,0.35) circle 540,1560 830,1810",
        "-blur", "0x110", ")", "-composite",
        "(", "-size", f"{FRAME_W}x{FRAME_H}", "xc:none",
        "-draw", "fill rgba(96,148,208,0.30) circle 820,420 1060,660",
        "-blur", "0x120", ")", "-composite",
        path,
    ], "sample frame render (magick)")


def render_previews(mod, styles):
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        frame = os.path.join(tmp, "frame.png")
        render_sample_frame(frame)
        text = mod.sanitize_caption(SAMPLE_TEXT)
        for st in styles:
            cap = os.path.join(tmp, f"cap_{st['name']}.png")
            mod.render_caption_png(text, BOX_W, FONT_SIZE, cap, mod.STYLES[st["name"]])
            out = os.path.join(PREVIEW_DIR, f"{st['name']}.png")
            # ffmpeg overlays at y = H - h - margin; -gravity south +0+MARGIN
            # is the same placement. -strip drops timestamps for stable diffs.
            # -depth 8: the Q16 HDRI magick build otherwise writes 16-bit
            # channels (gradient source) — ~880 KB/thumb instead of ~250.
            run(["magick", frame, cap, "-gravity", "south",
                 "-geometry", f"+0+{MARGIN}", "-composite",
                 "-resize", f"{THUMB_W}x", "-depth", "8", "-strip", out],
                f"preview composite ({st['name']})")
            kb = os.path.getsize(out) // 1024
            flag = "  ⚠ large" if kb > 400 else ""
            print(f"  ✓ {st['name']}.png ({kb} KB){flag}")


def committed_sha(path: str) -> str | None:
    if not os.path.isfile(path):
        return None
    m = re.search(r'"sha256":\s*"([0-9a-f]{64})"', open(path).read())
    return m.group(1) if m else None


def main():
    args = [a for a in sys.argv[1:] if a != "--check"]
    check = "--check" in sys.argv[1:]
    tool_path = args[0] if args else os.environ.get("CAPTION_CLIP_PATH", DEFAULT_TOOL)

    mod = load_tool(tool_path)
    styles, meta = build_styles(mod, tool_path)

    if check:
        ok = True
        for label, path in (("ui", UI_MODULE), ("server", SERVER_MODULE)):
            have = committed_sha(path)
            if have != meta["sha256"]:
                ok = False
                print(f"✗ {label} module drifted (committed {have or 'MISSING'}, "
                      f"tool {meta['sha256'][:12]}…): {path}")
        missing = [st["name"] for st in styles
                   if not os.path.isfile(os.path.join(PREVIEW_DIR, st["name"] + ".png"))]
        if missing:
            ok = False
            print(f"✗ missing preview PNG(s): {', '.join(missing)}")
        if not ok:
            sys.exit("caption styles drifted — run `pnpm caption-styles:sync` and commit.")
        print(f"✓ in sync ({len(styles)} styles, sha {meta['sha256'][:12]}…)")
        return

    emit_ui_module(styles, meta)
    emit_server_module(styles, meta)
    print(f"✓ wrote {os.path.relpath(UI_MODULE, REPO_ROOT)}")
    print(f"✓ wrote {os.path.relpath(SERVER_MODULE, REPO_ROOT)}")
    print(f"→ rendering {len(styles)} previews (via the tool's own render_caption_png) …")
    render_previews(mod, styles)
    print(f"✓ done — {len(styles)} styles from {os.path.basename(tool_path)}")


if __name__ == "__main__":
    main()
