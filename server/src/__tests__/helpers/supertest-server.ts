import http from "node:http";
import { afterAll, beforeAll } from "vitest";

// Passing a bare Express app to supertest makes it listen(0) per request on
// the IPv6 wildcard (::) while dialing 127.0.0.1. On macOS a concurrent
// process can bind 127.0.0.1:<same port> specifically mid-test and silently
// steal the dial (observed: workspace-runtime's mock agents answering
// 200 "ok" turned 404 assertions into flakes under parallel suite load).
// A 127.0.0.1-specific bind collides (EADDRINUSE) instead of being shadowed,
// so every suite must go through ONE shared server bound explicitly to
// 127.0.0.1.
//
// Usage — call at module or describe scope, then wrap every request():
//   const local = useLocalServer();
//   const res = await request(local.via(app)).get("/path");
//
// via() points the shared listening server at the given app and returns the
// server; supertest reuses an already-listening server and never closes it.
// Tests within a file run sequentially, so re-pointing the handler per call
// site is safe even when each test builds its own app — but do NOT use
// test.concurrent in a file that shares this server.
export function useLocalServer() {
  let handler: http.RequestListener | undefined;
  const server = http.createServer((req, res) => handler!(req, res));

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
  });

  afterAll(async () => {
    if (server.listening) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  return {
    via(app: unknown): http.Server {
      handler = app as http.RequestListener;
      return server;
    },
  };
}
