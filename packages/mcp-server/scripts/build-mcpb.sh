#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Build the Team Dashboard Marketing MCPB Desktop Extension (.mcpb).
#
# Output: dist-mcpb/team-dashboard-marketing.mcpb
# Install: Claude Desktop → Settings → Extensions → Install Extension → pick
# the file. The settings form (from manifest user_config) asks for the
# pcp_board_ access key (stored in the OS keychain) + the server URL.
#
# Self-contained by construction: esbuild inlines ALL runtime deps
# (@modelcontextprotocol/sdk, zod) into one CommonJS file, so the bundle
# ships zero node_modules and the end user needs nothing beyond Claude
# Desktop's built-in Node.js runtime.
#
# A .mcpb is a plain zip with manifest.json at the archive root
# (github.com/modelcontextprotocol/mcpb). We prefer the official `mcpb pack`
# CLI when it's on PATH (it validates the manifest), and fall back to zip.
# ---------------------------------------------------------------------------
set -euo pipefail
cd "$(dirname "$0")/.."

STAGING="tmp-mcpb-staging"   # tmp-* is gitignored repo-wide
OUT_DIR="dist-mcpb"
OUT="$OUT_DIR/team-dashboard-marketing.mcpb"

rm -rf "$STAGING" "$OUT"
mkdir -p "$STAGING/server" "$OUT_DIR"

# 1. Bundle the marketing entry point + all deps into a single CJS file.
#    (esbuild is a workspace-root devDependency.)
pnpm exec esbuild src/marketing.ts \
  --bundle \
  --platform=node \
  --target=node18 \
  --format=cjs \
  --outfile="$STAGING/server/index.cjs" \
  --log-level=warning

# 2. Manifest at the archive root, as the spec requires.
cp mcpb/manifest.json "$STAGING/manifest.json"

# 3. Pack.
if command -v mcpb >/dev/null 2>&1; then
  mcpb pack "$STAGING" "$OUT"
else
  (cd "$STAGING" && zip -qr "../$OUT" .)
fi

rm -rf "$STAGING"
echo "Built $(pwd)/$OUT"
unzip -l "$OUT"

# 4. Self-test the PACKED artifact: unzip it fresh and drive a real stdio
#    initialize + tools/list against the bundled server. Fails the build if
#    the bundle is broken (esbuild/SDK drift) or the tool count changed
#    unexpectedly. Keeps the shipped .mcpb verifiable, not just built.
echo "Self-testing the bundle…"
VERIFY_DIR="tmp-mcpb-verify"   # tmp-* is gitignored repo-wide
rm -rf "$VERIFY_DIR"
mkdir -p "$VERIFY_DIR"
unzip -qo "$OUT" -d "$VERIFY_DIR"
node scripts/mcpb-selftest.mjs "$VERIFY_DIR/server/index.cjs"
rm -rf "$VERIFY_DIR"
