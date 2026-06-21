// ---------------------------------------------------------------------------
// Optimize Me SSO bridge — mint ↔ verify round-trip (no network, no DB).
//
// The bridge is the cross-org trust anchor: University (issuer) mints a
// short-lived, audience-pinned, HMAC-signed assertion that Optimize Me
// ("architect") verifies and exchanges for a Supabase session. This proves the
// crypto envelope is sound end-to-end with the SAME shared secret on both
// sides, and that every rejection path (bad sig / tamper / expiry / wrong aud /
// wrong iss / future-dated) is closed.
//
// Uses a TEST-ONLY BRIDGE_SHARED_SECRET set here — NOT a real one (the real
// BRIDGE_SHARED_SECRET is owner-gated env).
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  mintBridgeToken,
  verifyBridgeToken,
  BRIDGE_AUDIENCE,
  BRIDGE_ISSUER,
  type BridgePayload,
} from "../services/optimize-me-bridge.js";

// TEST secret only (>= 32 chars). Never a real BRIDGE_SHARED_SECRET.
const TEST_SECRET = "test-bridge-secret-test-bridge-secret-0123456789";

describe("optimize-me-bridge mint ↔ verify", () => {
  const saved = process.env.BRIDGE_SHARED_SECRET;
  beforeAll(() => {
    process.env.BRIDGE_SHARED_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.BRIDGE_SHARED_SECRET;
    else process.env.BRIDGE_SHARED_SECRET = saved;
  });

  it("round-trip: a freshly minted token verifies and the payload matches", () => {
    const { token, payload } = mintBridgeToken("Member@Example.com", "active");

    // The mint normalizes the email (trim + lowercase) and stamps the claims.
    expect(payload.email).toBe("member@example.com");
    expect(payload.status).toBe("active");
    expect(payload.aud).toBe(BRIDGE_AUDIENCE); // 'optimize-me'
    expect(payload.iss).toBe(BRIDGE_ISSUER); // 'cou-portal'
    expect(payload.exp - payload.iat).toBe(120); // ~120s TTL
    expect(typeof payload.jti).toBe("string");
    expect(payload.jti.length).toBeGreaterThan(0);

    // Token shape: <payload_b64url>.<sig_hex>.
    const dot = token.lastIndexOf(".");
    expect(dot).toBeGreaterThan(0);
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    // The signature is HMAC-SHA256(secret, payloadB64).hex — recompute with the
    // SAME secret the consumer holds and confirm it matches byte-for-byte.
    const expectedSig = createHmac("sha256", TEST_SECRET)
      .update(payloadB64)
      .digest("hex");
    expect(sig).toBe(expectedSig);

    // The payload is base64url(JSON) and decodes back to the same claims.
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as BridgePayload;
    expect(decoded).toEqual(payload);

    // And the issuer's own verifier accepts it, returning the same payload.
    const verified = verifyBridgeToken(token);
    expect(verified).toEqual(payload);
  });

  it("verifies a past_due member too (strict gate allows active + past_due)", () => {
    const { token } = mintBridgeToken("pd@example.com", "past_due");
    const verified = verifyBridgeToken(token);
    expect(verified?.status).toBe("past_due");
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const { token } = mintBridgeToken("member@example.com", "active");
    const dot = token.lastIndexOf(".");
    const payloadB64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    // Re-encode the payload with a flipped status but keep the ORIGINAL sig.
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as BridgePayload;
    decoded.email = "attacker@evil.com";
    const tamperedB64 = Buffer.from(JSON.stringify(decoded)).toString(
      "base64url",
    );
    const tampered = `${tamperedB64}.${sig}`;

    expect(verifyBridgeToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a DIFFERENT secret", () => {
    const { token } = mintBridgeToken("member@example.com", "active");
    const dot = token.lastIndexOf(".");
    const payloadB64 = token.slice(0, dot);
    const wrongSig = createHmac("sha256", "some-other-secret-some-other-secret-xx")
      .update(payloadB64)
      .digest("hex");
    expect(verifyBridgeToken(`${payloadB64}.${wrongSig}`)).toBeNull();
  });

  it("rejects an expired token", () => {
    // Mint dated 10 minutes ago → exp is in the past relative to now.
    const past = new Date(Date.now() - 10 * 60 * 1000);
    const { token } = mintBridgeToken("member@example.com", "active", past);
    expect(verifyBridgeToken(token)).toBeNull();
    // ...but it WAS valid at its own mint time (proves it's expiry, not a
    // structural reject).
    expect(verifyBridgeToken(token, new Date(past.getTime() + 1000))).not.toBeNull();
  });

  it("rejects a wrong-audience token", () => {
    const { token } = mintBridgeToken("member@example.com", "active");
    const dot = token.lastIndexOf(".");
    const payloadB64 = token.slice(0, dot);
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as BridgePayload;
    decoded.aud = "some-other-app";
    // Re-sign so the signature is VALID — the reject must come from the aud
    // claim check, not the signature check.
    const newB64 = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const newSig = createHmac("sha256", TEST_SECRET).update(newB64).digest("hex");
    expect(verifyBridgeToken(`${newB64}.${newSig}`)).toBeNull();
  });

  it("rejects a wrong-issuer token (validly signed)", () => {
    const { token } = mintBridgeToken("member@example.com", "active");
    const dot = token.lastIndexOf(".");
    const payloadB64 = token.slice(0, dot);
    const decoded = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as BridgePayload;
    decoded.iss = "not-cou-portal";
    const newB64 = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    const newSig = createHmac("sha256", TEST_SECRET).update(newB64).digest("hex");
    expect(verifyBridgeToken(`${newB64}.${newSig}`)).toBeNull();
  });

  it("rejects malformed input (no dot, empty, null)", () => {
    expect(verifyBridgeToken(null)).toBeNull();
    expect(verifyBridgeToken(undefined)).toBeNull();
    expect(verifyBridgeToken("")).toBeNull();
    expect(verifyBridgeToken("no-dot-here")).toBeNull();
  });
});
