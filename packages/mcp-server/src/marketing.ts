#!/usr/bin/env node

/**
 * Team Dashboard — Marketing MCP Server (stdio).
 *
 * The "Eagan access" entry point: a deliberately SMALL tool surface for an
 * external marketing collaborator's Claude Desktop, authenticated with a
 * marketing-scoped board API key (`pcp_board_…`). All enforcement (role
 * gate, admin-only mutations, voice registry, daily quota) is server-side —
 * this process is just a REST client.
 *
 * Distributed as an MCPB Desktop Extension (see mcpb/manifest.json +
 * scripts/build-mcpb.sh). Claude Desktop's built-in Node runs it; the
 * user_config settings form supplies the env below (api key stored in the
 * OS keychain).
 *
 * Configuration via environment variables:
 *   PAPERCLIP_API_URL   - Base URL of the Team Dashboard API
 *                         (default: https://api.coherencedaddy.com)
 *   PAPERCLIP_API_TOKEN - Marketing-scoped board API key (required)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MarketingClient } from "./marketing-client.js";
import { registerMarketingTools } from "./tools/marketing.js";

async function main() {
  const apiUrl = process.env.PAPERCLIP_API_URL ?? "https://api.coherencedaddy.com";
  const token = process.env.PAPERCLIP_API_TOKEN;

  if (!token) {
    console.error(
      "PAPERCLIP_API_TOKEN is required (the pcp_board_… dashboard access key).",
    );
    process.exit(1);
  }

  const client = new MarketingClient({ baseUrl: apiUrl, token });

  const server = new McpServer({
    name: "team-dashboard-marketing",
    version: "1.0.0",
  });

  registerMarketingTools(server, client); // 15 tools

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
