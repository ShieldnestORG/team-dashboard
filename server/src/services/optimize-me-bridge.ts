import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ---------------------------------------------------------------------------
// Optimize Me SSO bridge — University side (issuer).
//
// Mints a short-lived, single-use, audience-pinned, HMAC-signed assertion that
// proves a University member's email + entitlement status to the Optimize Me
// ("architect") app, which exchanges it for a real Supabase session.
//
// This is the cross-org trust anchor. It deliberately mirrors the house cookie
// style (base.sig with node:crypto HMAC-SHA256, timingSafeEqual compare) but:
//   - signs with a DEDICATED secret (BRIDGE_SHARED_SECRET), NOT
//     PORTAL_SESSION_SECRET — Optimize Me must never hold a portal secret, and
//     a dedicated secret limits blast radius across the org boundary.
//   - carries ONLY { email, status } in the payload — never the University
//     accountId, display name, or any portal identifier. (Keeps University
//     identity out of Optimize Me's activity zone; see the integration spec §6.)
//
// Token shape (mirrors cd_portal_session's `base.sig` so it fits the house
// style, but base is a base64url JSON payload):
//   <payload_b64url>.<sig_hex>
//   payload = { email, status, iat, exp, jti, aud, iss }
//   sig     = HMAC-SHA256(BRIDGE_SHARED_SECRET, payload_b64url)  (hex)
// ---------------------------------------------------------------------------

const MIN_SECRET_LENGTH = 32;
const TOKEN_TTL_SEC = 120; // 2 minutes — long enough to redirect + exchange.

export const BRIDGE_AUDIENCE = "optimize-me";
export const BRIDGE_ISSUER = "cou-portal";

export type BridgeStatus = "active" | "past_due";

export interface BridgePayload {
  email: string;
  status: BridgeStatus;
  iat: number;
  exp: number;
  jti: string;
  aud: string;
  iss: string;
}

function bridgeSecret(): string {
  const s = process.env.BRIDGE_SHARED_SECRET?.trim();
  if (!s || s.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `BRIDGE_SHARED_SECRET must be set and at least ${MIN_SECRET_LENGTH} chars`,
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * Mint a signed bridge assertion for a verified, entitled member.
 *
 * Callers MUST have already gated on status ∈ {active, past_due} (the strict
 * rule) before calling — this function trusts its inputs and only stamps the
 * crypto envelope around them.
 */
export function mintBridgeToken(
  email: string,
  status: BridgeStatus,
  now: Date = new Date(),
): { token: string; payload: BridgePayload } {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: BridgePayload = {
    email: email.trim().toLowerCase(),
    status,
    iat,
    exp: iat + TOKEN_TTL_SEC,
    jti: randomBytes(32).toString("base64url"),
    aud: BRIDGE_AUDIENCE,
    iss: BRIDGE_ISSUER,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", bridgeSecret())
    .update(payloadB64)
    .digest("hex");
  return { token: `${payloadB64}.${sig}`, payload };
}

/**
 * Verify a bridge assertion's signature + claims. Returns the payload on
 * success, or null on any failure (bad shape, bad sig, wrong aud/iss, expired,
 * iat too far in the future). This is the same routine the consumer (Optimize
 * Me) runs; it lives here so both sides share one implementation if the
 * package is ever shared, and so the issuer can self-test what it minted.
 */
export function verifyBridgeToken(
  token: string | undefined | null,
  now: Date = new Date(),
): BridgePayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!payloadB64 || !sig) return null;

  let secret: string;
  try {
    secret = bridgeSecret();
  } catch {
    return null;
  }

  const expected = createHmac("sha256", secret).update(payloadB64).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sig, "utf8");
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  let payload: BridgePayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as BridgePayload;
  } catch {
    return null;
  }

  if (payload.aud !== BRIDGE_AUDIENCE) return null;
  if (payload.iss !== BRIDGE_ISSUER) return null;
  if (typeof payload.exp !== "number" || typeof payload.iat !== "number") {
    return null;
  }
  const nowSec = Math.floor(now.getTime() / 1000);
  if (payload.exp <= nowSec) return null;
  // Reject tokens dated in the future beyond a small clock-skew allowance.
  if (payload.iat > nowSec + 60) return null;
  if (payload.status !== "active" && payload.status !== "past_due") return null;
  if (typeof payload.email !== "string" || !payload.email) return null;
  if (typeof payload.jti !== "string" || !payload.jti) return null;

  return payload;
}
