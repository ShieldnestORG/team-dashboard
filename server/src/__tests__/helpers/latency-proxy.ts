import net from "node:net";

/**
 * A TCP proxy on 127.0.0.1 that holds every chunk for `oneWayMs` in each
 * direction, so a local Postgres behind it answers like one `2 * oneWayMs`
 * away. Used to count how many database round trips a request waits for.
 */
export async function startLatencyProxy(target: { host: string; port: number }, oneWayMs: number) {
  const sockets = new Set<net.Socket>();
  const server = net.createServer((client) => {
    const upstream = net.connect(target.port, target.host);
    sockets.add(client);
    sockets.add(upstream);
    pipeDelayed(client, upstream, oneWayMs);
    pipeDelayed(upstream, client, oneWayMs);
    const close = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("close", close);
    upstream.on("close", close);
    client.on("error", close);
    upstream.on("error", close);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function pipeDelayed(from: net.Socket, to: net.Socket, ms: number) {
  // Timers with the same delay fire in the order they were set, so chunks keep their order.
  from.on("data", (chunk) => {
    setTimeout(() => {
      if (!to.destroyed) to.write(chunk);
    }, ms);
  });
  from.on("end", () => setTimeout(() => to.end(), ms));
}
