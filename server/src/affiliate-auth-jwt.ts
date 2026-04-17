import { createHmac, timingSafeEqual } from "node:crypto";

interface JwtHeader {
  alg: string;
  typ?: string;
}

export interface AffiliateJwtClaims {
  sub: string;
  email: string;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
}

const JWT_ALGORITHM = "HS256";
const TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days
const ISSUER = "affiliate";
const AUDIENCE = "affiliate-api";

function getSecret(): string {
  return (
    process.env.BETTER_AUTH_SECRET ??
    process.env.PAPERCLIP_AGENT_JWT_SECRET ??
    "paperclip-dev-secret"
  );
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(secret: string, signingInput: string) {
  return createHmac("sha256", secret).update(signingInput).digest("base64url");
}

function parseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function safeCompare(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function createAffiliateJwt(affiliateId: string, email: string): string {
  const secret = getSecret();
  const now = Math.floor(Date.now() / 1000);
  const claims: AffiliateJwtClaims = {
    sub: affiliateId,
    email,
    iat: now,
    exp: now + TTL_SECONDS,
    iss: ISSUER,
    aud: AUDIENCE,
  };

  const header: JwtHeader = { alg: JWT_ALGORITHM, typ: "JWT" };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claims))}`;
  const signature = signPayload(secret, signingInput);

  return `${signingInput}.${signature}`;
}

export function verifyAffiliateJwt(token: string): AffiliateJwtClaims | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerB64, claimsB64, signature] = parts;

  const header = parseJson(base64UrlDecode(headerB64));
  if (!header || header.alg !== JWT_ALGORITHM) return null;

  const secret = getSecret();
  const signingInput = `${headerB64}.${claimsB64}`;
  const expectedSig = signPayload(secret, signingInput);
  if (!safeCompare(signature, expectedSig)) return null;

  const claims = parseJson(base64UrlDecode(claimsB64));
  if (!claims) return null;

  const sub = typeof claims.sub === "string" ? claims.sub : null;
  const email = typeof claims.email === "string" ? claims.email : null;
  const iat = typeof claims.iat === "number" ? claims.iat : null;
  const exp = typeof claims.exp === "number" ? claims.exp : null;
  const iss = typeof claims.iss === "string" ? claims.iss : null;
  const aud = typeof claims.aud === "string" ? claims.aud : null;

  if (!sub || !email || !iat || !exp || !iss || !aud) return null;
  if (iss !== ISSUER || aud !== AUDIENCE) return null;

  const now = Math.floor(Date.now() / 1000);
  if (exp < now) return null;

  return { sub, email, iat, exp, iss, aud };
}
