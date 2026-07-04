#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Post-build self-test for the Marketing MCPB bundle.
//
// Spawns the bundled server, drives a real JSON-RPC initialize + tools/list
// over stdio, and asserts the handshake succeeds and exactly EXPECTED_TOOLS
// tools are registered. Called by scripts/build-mcpb.sh against the freshly
// UNZIPPED archive, so an esbuild/SDK upgrade that breaks the bundle fails the
// build instead of shipping.
//
// Usage: node scripts/mcpb-selftest.mjs <path-to-server-entry.cjs>
// EXPECTED_TOOLS must match registerMarketingTools() in src/tools/marketing.ts.
// ---------------------------------------------------------------------------
import { spawn } from "node:child_process";

const entry = process.argv[2];
const EXPECTED_TOOLS = Number(process.env.EXPECTED_TOOLS ?? "15");

if (!entry) {
  console.error("selftest: missing server entry path");
  process.exit(2);
}

const child = spawn("node", [entry], {
  env: {
    ...process.env,
    // A syntactically-valid key + an unreachable URL: the handshake never
    // touches the network, so no live server is needed.
    PAPERCLIP_API_TOKEN: "pcp_board_selftest",
    PAPERCLIP_API_URL: "http://127.0.0.1:9",
  },
  stdio: ["pipe", "pipe", "inherit"],
});

let buf = "";
let sawInit = false;

const fail = (msg) => {
  console.error(`selftest FAILED: ${msg}`);
  child.kill();
  process.exit(1);
};

const timer = setTimeout(() => fail("timed out waiting for the server"), 10_000);

child.stdout.on("data", (chunk) => {
  buf += chunk.toString();
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      continue;
    }
    if (msg.id === 1) {
      if (!msg.result) fail("initialize did not return a result");
      sawInit = true;
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
    }
    if (msg.id === 2) {
      const tools = msg.result?.tools ?? [];
      if (!sawInit) fail("tools/list answered before initialize");
      if (tools.length !== EXPECTED_TOOLS) {
        fail(`expected ${EXPECTED_TOOLS} tools, got ${tools.length}: ${tools.map((t) => t.name).join(", ")}`);
      }
      clearTimeout(timer);
      console.log(`selftest OK: initialize + ${tools.length} tools`);
      child.kill();
      process.exit(0);
    }
  }
});

child.on("error", (err) => fail(`spawn error: ${err.message}`));

child.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "selftest", version: "0" } },
  }) + "\n",
);
