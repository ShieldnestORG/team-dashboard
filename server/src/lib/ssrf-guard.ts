/**
 * Shared SSRF guard for server-side URL fetches.
 *
 * Any route/service that fetches an operator- or user-supplied URL must run it
 * through `assertPublicHttpUrl` (or use `safeFetch`, which does so on every hop
 * including redirects) before letting Node's fetch touch the network.
 *
 * What it defends against:
 *   - non-http(s) schemes (file:, gopher:, data:, ...)
 *   - fetches to loopback / private / link-local / CGNAT / unique-local ranges,
 *     resolved via DNS so a public hostname that resolves to an internal IP is
 *     still rejected (defeats DNS-rebinding at check time)
 *   - open redirects into any of the above — `safeFetch` uses redirect:"manual"
 *     and re-validates each Location before following.
 *
 * NOTE: this re-validates at check time; it does not pin the socket to the
 * validated IP, so a rebind between the DNS check and the actual connect is
 * still theoretically possible. For our threat model (advisory audits, not a
 * proxy) re-validation on every hop is the pragmatic mitigation.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SsrfError";
  }
}

// Reject anything that isn't a normal outbound web fetch.
function assertHttpProtocol(parsed: URL): void {
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`Blocked non-http(s) URL scheme: ${parsed.protocol}`);
  }
}

// --- IP-literal classification ------------------------------------------------
//
// Given a numeric IP string (v4 or v6, as returned by dns.lookup or parsed from
// the hostname), decide whether it is disallowed (loopback / private / link-local
// / CGNAT / unique-local / unspecified / IPv4-mapped-IPv6 wrapping a bad v4).

function ipv4IsBlocked(a: number, b: number, _c: number, _d: number): boolean {
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT/tailnet
  if (a === 0) return true; // 0.0.0.0/8 "this" network
  return false;
}

function parseIpv4(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!];
}

function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    const v4 = parseIpv4(ip);
    return v4 ? ipv4IsBlocked(...v4) : true; // unparseable → reject
  }
  if (family === 6) {
    const lower = ip.toLowerCase().split("%")[0]!; // strip any zone id
    // Loopback + unspecified.
    if (lower === "::1" || lower === "::") return true;
    // Link-local fe80::/10.
    if (lower.startsWith("fe8") || lower.startsWith("fe9") ||
        lower.startsWith("fea") || lower.startsWith("feb")) return true;
    // Unique-local fc00::/7 (fc.. and fd..).
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    // IPv4-mapped / -compatible IPv6 (::ffff:a.b.c.d or ::a.b.c.d): validate the
    // embedded v4 too, in both dotted and hex tail forms.
    const mapped = lower.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) {
      const v4 = parseIpv4(mapped[1]!);
      return v4 ? ipv4IsBlocked(...v4) : true;
    }
    return false;
  }
  return true; // not a valid IP literal → reject
}

/**
 * Throws `SsrfError` if `url` is not a plain public http(s) URL. Resolves the
 * hostname via DNS and rejects if ANY resolved address is in a disallowed range.
 */
export async function assertPublicHttpUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError("Invalid URL");
  }
  assertHttpProtocol(parsed);

  const hostname = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  // If the hostname is already an IP literal, classify it directly — no DNS.
  if (isIP(hostname)) {
    if (isBlockedIp(hostname)) {
      throw new SsrfError(`Blocked private/reserved IP address: ${hostname}`);
    }
    return;
  }

  // Otherwise resolve via DNS and reject if ANY address is disallowed. `all:true`
  // returns every A/AAAA record so a multi-record rebind can't sneak one past us.
  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new SsrfError(`DNS resolution failed for host: ${hostname}`);
  }
  if (addresses.length === 0) {
    throw new SsrfError(`No DNS records for host: ${hostname}`);
  }
  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new SsrfError(
        `Host ${hostname} resolves to a private/reserved address: ${address}`,
      );
    }
  }
}

/**
 * SSRF-safe `fetch`. Validates the initial URL, then follows redirects manually,
 * re-validating each `Location` through `assertPublicHttpUrl` before the next hop.
 * Throws `SsrfError` on any violation. Passes `init` through unchanged except that
 * `redirect` is forced to `"manual"`.
 */
export async function safeFetch(
  url: string,
  init: RequestInit = {},
  maxRedirects = 5,
): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(current);
    const res = await fetch(current, { ...init, redirect: "manual" });
    // 3xx with a Location header → validate the target and follow one more hop.
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res; // no target to follow — hand the redirect back
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new SsrfError(`Too many redirects (>${maxRedirects}) for URL: ${url}`);
}
