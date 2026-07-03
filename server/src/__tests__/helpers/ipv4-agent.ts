import type { Server } from "node:http";
import type express from "express";
import request from "supertest";

// ---------------------------------------------------------------------------
// IPv4-pinned supertest agent.
//
// supertest's plain `request(app)` calls `app.listen(0)` on the dual-stack
// wildcard, then dials 127.0.0.1:<port>. On a dev machine with local daemons
// squatting the ephemeral range, the kernel can hand out a port whose IPv4
// 127.0.0.1 side is already owned by an unrelated process — the test request
// then reaches the squatter (typically a 200 "ok" with no content-type) and
// the assertion fails in a way that never reproduces (~1-in-10..200 runs,
// diagnosed live 2026-07-02 via lsof on the failing request's port).
//
// Fix: bind the test server to 127.0.0.1 explicitly and hand the LISTENING
// server to supertest. Suites using this must call `closeIpv4Servers()` in
// afterEach/afterAll (supertest never closes servers it did not open).
// ---------------------------------------------------------------------------

const servers: Server[] = [];

/** supertest agent bound to an IPv4-only listener for `app`. */
export async function ipv4Request(app: express.Express) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  servers.push(server);
  return request(server);
}

/** Close every server `ipv4Request` opened. Call from afterEach/afterAll. */
export async function closeIpv4Servers(): Promise<void> {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
}
